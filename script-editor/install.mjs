import { copyFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererDirectory = path.join(
  os.homedir(), "Library", "Application Support", "Reef", "renderers", "lingjing.script-editor"
);
await mkdir(rendererDirectory, { recursive: true });
for (const file of ["renderer.json", "launch.sh", "renderer.mjs", "video-source.mjs", "script-editor.min.js", "paper-fibers.png"]) {
  await copyFile(path.join(sourceDirectory, file), path.join(rendererDirectory, file));
}
