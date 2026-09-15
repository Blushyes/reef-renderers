// @ts-check
import { readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const mediaTypes = new Map([
  [".mp4", "video/mp4"], [".m4v", "video/mp4"], [".mov", "video/quicktime"],
  [".webm", "video/webm"],
]);

/**
 * Match explicit episode labels, or a bare numeric filename; never infer array order.
 * @param {string} filename
 */
export function episodeNumber(filename) {
  const stem = path.parse(filename).name;
  const match = /^(\d+)$/.exec(stem) ?? /(?:^|[^a-z])(?:ep(?:isode)?[_ .-]*|第\s*)(\d+)(?:集|[^\d]|$)/i.exec(stem);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** @param {string} directory @param {number} episodeCount */
export async function loadVideoSource(directory, episodeCount) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) {
    throw new Error("sourceVideo 必须是分集视频目录的绝对路径。");
  }
  const root = await realpath(directory);
  const entries = await readdir(root, { withFileTypes: true });
  const videos = [];
  const resources = [];
  const matched = new Set();
  for (const entry of entries) {
    const mimeType = mediaTypes.get(path.extname(entry.name).toLowerCase());
    if (!mimeType || (!entry.isFile() && !entry.isSymbolicLink())) continue;
    const number = episodeNumber(entry.name);
    if (number === null || number > episodeCount) continue;
    const resourcePath = await realpath(path.join(root, entry.name));
    if (!(await stat(resourcePath)).isFile()) continue;
    if (matched.has(number)) throw new Error(`第 ${number} 集匹配到多个视频，请保留一个明确的分集文件。`);
    matched.add(number);
    const id = createHash("sha256").update(resourcePath).digest("hex");
    videos.push({ episodeIdx: number - 1, name: entry.name, url: `reef-resource://media/${id}` });
    resources.push({ id, path: resourcePath, mimeType });
  }
  if (!videos.length) throw new Error("未找到对应分集视频。请使用 01.mp4、ep_001.mp4 或 第1集.mp4 等文件名。");
  videos.sort((a, b) => a.episodeIdx - b.episodeIdx);
  const missing = Array.from({ length: episodeCount }, (_, i) => i + 1).filter(number => !matched.has(number));
  return { directory: root, videos, resources, warning: missing.length ? `缺少第 ${missing.join("、")} 集视频` : null };
}

/**
 * The source comparison rejects stale previews; atomic replacement preserves all other fields.
 * @param {{source: {localFileAvailable: boolean, localPath?: string}, body: {source: string}, interaction: {action: string, directory: string}}} input
 * @param {import('@lingjingai/script-editor').ScriptProject & {episodes: import('@lingjingai/script-editor').ScriptEpisode[]}} project
 */
export async function associateSourceVideo(input, project) {
  if (input.interaction.action !== "associateSourceVideo") throw new Error("未知的剧本操作。");
  const localPath = input.source.localPath;
  if (!input.source.localFileAvailable || !localPath || !path.isAbsolute(localPath)) {
    throw new Error("关联视频需要本地剧本文件。");
  }
  const media = await loadVideoSource(input.interaction.directory, project.episodes.length);
  const filename = await realpath(localPath);
  const current = await readFile(filename, "utf8");
  if (current !== input.body.source) throw new Error("剧本已被修改，请等待预览刷新后重新关联视频。");
  const updated = { ...project, sourceVideo: media.directory };
  const fileStat = await stat(filename);
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, { flag: "wx", mode: fileStat.mode });
  await rename(temporary, filename);
  return { project: updated, media };
}
