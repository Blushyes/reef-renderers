import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";

const execute = promisify(execFile);
const rendererDirectory = path.resolve(".reef-build/script-editor");

test("Reef local reader extracts real frames and keeps the script unchanged", { timeout: 90_000 }, async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "reef-reader-test-"));
  const source = path.join(workspace, "source");
  await mkdir(source);
  await execute("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x240:rate=10:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(source, "episode_001.mp4")]);
  const project = {
    version: 4, title: "阅读器测试", worldview: "现代", style: "写实", synopsis: "全剧梗概", sourceVideo: source,
    actors: [{ actor_id: "actReefaa", actor_name: "测试人物", description: "用于阅读器联调", importance: "featured", states: [{ state_id: "default", state_name: "日常造型", description: "日常服装" }, { state_id: "stReefbb", state_name: "外套造型", description: "穿外套" }] }],
    locations: [{ location_id: "locReefaa", location_name: "室内", importance: "featured", description: "测试室内", states: [{ state_id: "default", state_name: "白天", description: "白天" }] }], props: [],
    episodes: [{ episode_id: "epReefaa", synopsis: "分集梗概", scenes: ["default", "stReefbb"].map((stateId, index) => ({
      scene_id: `scnReefa${index + 1}`, environment: { space: "interior", time: "day" }, location: { location_id: "locReefaa", state_ids: ["default"] },
      actors: [{ actor_id: "actReefaa", state_ids: [stateId] }], props: [],
      actions: [{ action_id: `acReefa${index + 1}`, type: "dialogue", content: "你好。", speaker: { actor_id: "actReefaa", state_id: stateId }, extend: { timestamp: `00:0${index * 2 + 1}` } }],
    })) }],
  };
  const scriptPath = path.join(workspace, "script.json");
  const raw = JSON.stringify(project, null, 2);
  await writeFile(scriptPath, raw);
  const child = spawn("/bin/sh", [path.join(rendererDirectory, "launch.sh"), path.join(rendererDirectory, "service.mjs")], {
    stdio: ["pipe", "pipe", "pipe"], env: { HOME: os.homedir(), PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
  });
  t.after(async () => { child.kill(); await once(child, "exit"); await rm(workspace, { recursive: true, force: true }); });
  child.stdin.end(JSON.stringify({ project, scriptPath, rendererDirectory }));
  const [chunk] = await once(child.stdout, "data");
  const base = chunk.toString().trim();
  const call = async (route, body) => {
    const response = await fetch(`${base}/${route}`, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    return response.json();
  };
  await t.test("only the session address can access local data", async () => {
    assert.equal((await fetch(new URL("/evidence", base))).status, 404);
    assert.equal((await call("evidence")).manifest, null);
    assert.equal((await call("evidence")).canGenerate, true);
  });
  await t.test("suggestions find nearby video folders without writing the script", async () => {
    const suggestions = await call("video-suggestions");
    assert.equal(suggestions[0].directory, await import("node:fs/promises").then(fs => fs.realpath(source)));
    assert.equal(suggestions[0].matched, 1);
    assert.equal(suggestions[0].warning, null);
    assert.equal(await readFile(scriptPath, "utf8"), raw);
  });
  await t.test("native translation skips same-language text without changing the screenplay", async () => {
    const result = await call("translate", { texts: ["你好，欢迎回来。"], targetLanguage: "zh-Hans" });
    assert.deepEqual(result, [{ status: "skipped" }]);
  });
  await t.test("cross-language translation returns a translation or an explicit language availability result", async () => {
    const [result] = await call("translate", { texts: ["I will be back tomorrow."], targetLanguage: "zh-Hans" });
    assert.ok(["translated", "not-installed", "unsupported"].includes(result.status), JSON.stringify(result));
    if (result.status === "translated") assert.ok(result.translation.length > 0);
  });
  await t.test("scriptctl extracts and serves references for both wardrobe states", async () => {
    let result = await call("generate", {});
    assert.equal(result.status, "running");
    while (result.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      result = await call("evidence");
    }
    assert.equal(result.status, "complete", result.message);
    assert.equal(result.manifest.items.length, 2);
    assert.ok(Object.keys(result.urls).length >= 6);
    const frame = await fetch(Object.values(result.urls)[0]);
    assert.match(frame.headers.get("content-type"), /^image\//);
    assert.ok((await frame.arrayBuffer()).byteLength > 100);
    assert.equal((await fetch(`${base}/media/not-an-allowed-file`)).status, 404);
    assert.equal(await readFile(scriptPath, "utf8"), raw);
  });
  await t.test("selecting a suggestion saves the association and streams seekable video immediately", async () => {
    const result = await call("associate-video", { directory: source });
    assert.equal(result.videos.length, 1);
    const saved = JSON.parse(await readFile(scriptPath, "utf8"));
    assert.deepEqual(saved, { ...project, sourceVideo: result.directory });
    const video = result.videos[0].url;
    const bytes = await readFile(path.join(source, "episode_001.mp4"));
    const response = await fetch(video, { headers: { Range: "bytes=10-29" } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), `bytes 10-29/${bytes.length}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(10, 30));
    const suffix = await fetch(video, { headers: { Range: "bytes=-10" } });
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(-10));
    const head = await fetch(video, { method: "HEAD" });
    assert.equal(Number(head.headers.get("content-length")), bytes.length);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal((await fetch(video, { headers: { Range: `bytes=${bytes.length}-` } })).status, 416);
    assert.equal((await fetch(`${base}/video/not-a-linked-video`)).status, 404);
    assert.equal((await call("evidence")).canGenerate, true);
  });
  await t.test("stale previews cannot overwrite a newer script's reference frames or association", async () => {
    await writeFile(scriptPath, JSON.stringify({ ...project, title: "已修改" }));
    const response = await fetch(`${base}/generate`, { method: "POST" });
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /剧本已更新/);
    const association = await fetch(`${base}/associate-video`, { method: "POST", body: JSON.stringify({ directory: source }) });
    assert.equal(association.status, 500);
    assert.equal(JSON.parse(await readFile(scriptPath, "utf8")).title, "已修改");
  });
});
