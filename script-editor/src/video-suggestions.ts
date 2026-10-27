import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { episodeNumber, loadVideoSource } from "../video-source.mjs";
import type { PreviewData, VideoSuggestion } from "./types";

async function entries(directory: string) {
  try { return await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code!)) return [];
    throw error;
  }
}

// Search the document's immediate neighbourhood and explicit project paths.
// Discovery reads directory entries only; choosing a result is a separate action.
export async function suggestVideoSources(scriptPath: string, project: PreviewData["project"]): Promise<VideoSuggestion[]> {
  const roots = new Map<string, string>();
  const add = (directory: string, reason: string) => { if (!roots.has(directory)) roots.set(directory, reason); };
  if (project.sourceVideo) add(project.sourceVideo, "当前关联");
  const directory = path.dirname(scriptPath);
  const parent = path.dirname(directory);
  for (const root of [directory, parent]) {
    let manifest;
    try { manifest = JSON.parse(await readFile(path.join(root, "project.json"), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    const original = manifest.kind === "rewrite" && path.resolve(root, manifest.sourceFile || "") !== scriptPath;
    const reason = original ? "项目记录的原剧视频，请核对是否适用于当前稿" : "项目记录的视频来源";
    for (const value of [manifest.videoSource?.path, manifest.sourcePath]) {
      if (typeof value === "string" && value) add(path.resolve(root, value), reason);
    }
    if (manifest.sourceProjectId) {
      const sourceRoot = path.resolve(root, "..", manifest.sourceProjectId);
      try {
        const source = JSON.parse(await readFile(path.join(sourceRoot, "project.json"), "utf8"));
        const sourceScript = JSON.parse(await readFile(path.resolve(sourceRoot, source.activeScript || "script.json"), "utf8"));
        for (const value of [sourceScript.sourceVideo, source.videoSource?.path, source.sourcePath]) {
          if (typeof value === "string" && value) add(path.resolve(sourceRoot, value), "来源项目的视频，请核对当前稿");
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
  add(directory, "剧本所在目录");
  // A projects collection contains unrelated productions, not sibling media.
  if (path.basename(parent) !== "projects" && parent !== path.parse(parent).root) add(parent, "剧本上一级目录");
  const nearby = [...roots.keys()].filter(root => root === directory || root === parent);
  for (const root of nearby) {
    for (const entry of await entries(root)) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const child = path.join(root, entry.name);
      add(child, "附近目录");
      if (root === directory) {
        for (const sub of await entries(child)) {
          if (sub.isDirectory() && !sub.name.startsWith(".") && sub.name !== "node_modules") add(path.join(child, sub.name), "附近目录");
        }
      }
    }
  }
  const seen = new Set<string>();
  const result: VideoSuggestion[] = [];
  for (const [candidate, reason] of roots) {
    const files = (await entries(candidate)).filter(entry => /\.(mp4|m4v|mov|webm)$/i.test(entry.name) && (entry.isFile() || entry.isSymbolicLink())).map(entry => entry.name);
    if (!files.length) continue;
    const actual = await realpath(candidate);
    if (seen.has(actual)) continue;
    seen.add(actual);
    const total = project.episodes?.length ?? 0;
    const extra = files.filter(name => (episodeNumber(name) ?? 0) > total).length;
    try {
      const media = await loadVideoSource(actual, total);
      result.push({ directory: actual, reason, matched: media.videos.length, total, files: files.length,
        warning: media.warning, problem: null, extra, sampleNames: media.videos.slice(0, 3).map(video => video.name) });
    } catch (error) {
      result.push({ directory: actual, reason, matched: 0, total, files: files.length, warning: null,
        problem: (error as Error).message, extra, sampleNames: files.slice(0, 3) });
    }
  }
  return result.sort((a, b) => Number(Boolean(a.problem)) - Number(Boolean(b.problem))
    || Number(b.reason === "当前关联") - Number(a.reason === "当前关联")
    || Number(b.reason.includes("项目")) - Number(a.reason.includes("项目"))
    || b.matched / b.total - a.matched / a.total);
}
