import { copyFile, mkdir, readdir, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const sourceDirectory = path.join(root, ".reef-build/script-editor");
const rendererDirectory = path.join(os.homedir(), "Library", "Application Support", "Reef", "renderers", "lingjing.script-editor");
const files = await readdir(sourceDirectory);
await mkdir(rendererDirectory, { recursive: true });
for (const file of files) {
  const target = path.join(rendererDirectory, file);
  // Replacing the inode refreshes macOS executable signature caches.
  await copyFile(path.join(sourceDirectory, file), `${target}.next`);
  await rename(`${target}.next`, target);
}
console.log(rendererDirectory);
