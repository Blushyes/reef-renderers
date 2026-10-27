import { createServer } from "node:http";
import { readFile, stat, realpath } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { NativeTranslator } from "./native-translator";
import { DialogueTranslationService } from "./translation";
import { parseStateEvidenceManifest, reconcileStateEvidenceManifest, stateEvidenceMediaFiles } from "./evidence";
import type { TranslationTarget } from "./translation-types";
import type { EvidenceView, ServiceInput } from "./types";
import { associateSourceVideo } from "../video-source.mjs";
import { suggestVideoSources } from "./video-suggestions";

const execute = promisify(execFile);
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input: ServiceInput = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const { scriptPath, rendererDirectory } = input;
let project = input.project;
const native = new NativeTranslator(path.join(rendererDirectory, "dialogue-translate"));
const translation = new DialogueTranslationService({
  platform: process.platform, native,
});
const token = randomBytes(24).toString("hex");
const media = new Map<string, string>();
const videos = new Map<string, { path: string; mimeType: string }>();
let lastRequest = Date.now();
let generating = false;
let status: EvidenceView["status"] = "idle";
let message = "";
let baseUrl = "";

async function exists(filename: string) {
  try { return (await stat(filename)).isFile(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function resolveWorkspace() {
  if (!scriptPath) return null;
  const directory = path.dirname(scriptPath);
  // A scriptctl workspace keeps its screenplay next to evidence/. Client
  // projects declare their ingest workspace in project.json.
  for (const root of [directory, path.dirname(directory)]) {
    const manifestPath = path.join(root, "project.json");
    if (await exists(manifestPath)) {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      return path.resolve(root, manifest.ingestWorkspace || "workspace");
    }
  }
  if (await exists(path.join(directory, "workspace/evidence/state-evidence.json"))) return path.join(directory, "workspace");
  return directory;
}
const workspace = await resolveWorkspace();

async function evidence(): Promise<EvidenceView> {
  const result: EvidenceView = { manifest: null, urls: {}, status, message, canGenerate: Boolean(scriptPath && project.sourceVideo && project.version === 4) };
  const filename = workspace && path.join(workspace, "evidence/state-evidence.json");
  if (!filename || !await exists(filename)) return result;
  const manifest = parseStateEvidenceManifest(await readFile(filename, "utf8"));
  if (!manifest) throw new Error("原片参考文件无法读取，请重新生成。");
  result.manifest = reconcileStateEvidenceManifest(manifest, project);
  const root = await realpath(path.join(workspace!, "evidence"));
  let missing = 0;
  await Promise.all(stateEvidenceMediaFiles(result.manifest).map(async (item) => {
    const filename = path.resolve(workspace!, item.framePath);
    if (!await exists(filename)) { missing++; return; }
    const actual = await realpath(filename);
    if (!actual.startsWith(root + path.sep)) throw new Error("原片参考图片必须位于 evidence 目录中。");
    const id = createHash("sha256").update(actual).digest("hex");
    media.set(id, actual);
    result.urls[item.id] = `${baseUrl}/media/${id}`;
  }));
  if (missing && !result.message) result.message = `${missing} 张参考图缺失，可重新生成原片参考。`;
  return result;
}

async function generate() {
  if (generating) return;
  if (!scriptPath || !workspace || !project.sourceVideo) throw new Error("请先关联源视频，再生成原片参考。");
  // Use the preview's document identity; never generate evidence for a newer file
  // while displaying an older screenplay.
  const current = JSON.parse(await readFile(scriptPath, "utf8"));
  if (JSON.stringify(current) !== JSON.stringify(project)) throw new Error("剧本已更新，请在 Reef 中重新打开后生成原片参考。");
  generating = true;
  status = "running";
  message = "正在按人物与造型提取原片参考帧…";
  void execute("scriptctl", ["evidence", "--script-path", scriptPath, "--source-path", project.sourceVideo,
    "--workspace-path", workspace, "--force", "--json"], { maxBuffer: 8 * 1024 * 1024 })
    .then(({ stdout }) => {
      const report = JSON.parse(stdout);
      status = "complete";
      message = `原片参考已更新：${report.states ?? 0} 个造型，${report.ready ?? 0} 张图片`;
    }).catch((error: Error & { stderr?: string; stdout?: string }) => {
      status = "error";
      if (error.stdout?.trim()) {
        try { message = JSON.parse(error.stdout).message || error.stdout.trim(); }
        catch { message = error.stdout.trim(); }
      } else message = error.stderr?.trim() || error.message;
    }).finally(() => { generating = false; lastRequest = Date.now(); });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url!, "http://127.0.0.1");
  if (!url.pathname.startsWith(`/${token}/`)) { response.writeHead(404).end(); return; }
  lastRequest = Date.now();
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
  const route = url.pathname.slice(token.length + 1);
  try {
    if (route.startsWith("/video/") && ["GET", "HEAD"].includes(request.method!)) {
      const source = videos.get(route.slice(7));
      if (!source) { response.writeHead(404).end(); return; }
      const { size } = await stat(source.path);
      response.setHeader("Content-Type", source.mimeType);
      response.setHeader("Accept-Ranges", "bytes");
      const range = request.headers.range;
      const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
      let start = 0, end = size - 1;
      if (range) {
        if (!match || (!match[1] && !match[2])) { response.writeHead(416, { "Content-Range": `bytes */${size}` }).end(); return; }
        start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (start > end || start >= size) { response.writeHead(416, { "Content-Range": `bytes */${size}` }).end(); return; }
        response.statusCode = 206;
        response.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      }
      response.setHeader("Content-Length", end - start + 1);
      if (request.method === "HEAD") response.end();
      else createReadStream(source.path, { start, end }).on("error", () => response.destroy()).pipe(response);
      return;
    }
    if (route.startsWith("/media/") && request.method === "GET") {
      const filename = media.get(route.slice(7));
      if (!filename) { response.writeHead(404).end(); return; }
      response.setHeader("Content-Type", path.extname(filename) === ".png" ? "image/png" : path.extname(filename) === ".webp" ? "image/webp" : "image/jpeg");
      createReadStream(filename).on("error", () => response.destroy()).pipe(response);
      return;
    }
    let result: unknown;
    if (route === "/video-suggestions" && request.method === "GET") result = scriptPath ? await suggestVideoSources(scriptPath, project) : [];
    else if (route === "/associate-video" && request.method === "POST") {
      if (!scriptPath) throw new Error("关联视频需要本地剧本文件。");
      if (generating) throw new Error("请等待当前原片参考提取完成后再更换视频。");
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      const { directory } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { directory: string };
      const raw = await readFile(scriptPath, "utf8");
      if (JSON.stringify(JSON.parse(raw)) !== JSON.stringify(project)) throw new Error("剧本已更新，请重新打开后关联视频。");
      const associated = await associateSourceVideo({ source: { localFileAvailable: true, localPath: scriptPath },
        body: { source: raw }, interaction: { action: "associateSourceVideo", directory } }, project);
      project = associated.project;
      videos.clear();
      for (const resource of associated.media.resources) videos.set(resource.id, resource);
      result = { directory: associated.media.directory, warning: associated.media.warning,
        videos: associated.media.videos.map(video => ({ ...video, url: `${baseUrl}/video/${video.url.split("/").pop()}` })) };
    }
    else if (route === "/evidence" && request.method === "GET") result = await evidence();
    else if (route === "/generate" && request.method === "POST") { await generate(); result = await evidence(); }
    else if (route === "/translate" && request.method === "POST") {
      const body: Buffer[] = [];
      for await (const chunk of request) body.push(chunk);
      const { texts, targetLanguage } = JSON.parse(Buffer.concat(body).toString("utf8")) as { texts: string[]; targetLanguage: TranslationTarget };
      result = await translation.translate(workspace ?? path.join(os.tmpdir(), "reef-script-reader"),
        { texts, targetLanguage });
    } else if (route === "/translation-settings" && request.method === "POST") {
      await execute("open", ["x-apple.systempreferences:com.apple.Localization-Settings.extension"]);
      result = { ok: true };
    } else if (route === "/ping") result = { ok: true };
    else { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(result));
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: (error as Error).message }));
  }
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("本地阅读服务启动失败");
  baseUrl = `http://127.0.0.1:${address.port}/${token}`;
  process.stdout.end(`${baseUrl}\n`);
});
function stop() { native.stop(); server.close(); process.exit(0); }
setInterval(() => { if (!generating && Date.now() - lastRequest > 15 * 60_000) stop(); }, 60_000).unref();
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
