import { copyFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererDirectory = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Reef",
  "renderers",
  "lingjing-script-editor"
);

await mkdir(rendererDirectory, { recursive: true });
for (const file of ["renderer.mjs", "script-editor.min.js", "paper-fibers.png"]) {
  await copyFile(path.join(sourceDirectory, file), path.join(rendererDirectory, file));
}

const manifest = {
  id: "lingjing.script-editor",
  name: "LingJing Script Editor",
  priority: 100,
  capabilities: ["interactiveHtml"],
  assetRoot: rendererDirectory,
  command: [process.execPath, path.join(rendererDirectory, "renderer.mjs")],
  match: {
    detectedKinds: ["structuredData"]
  }
};
await writeFile(
  path.join(os.homedir(), "Library", "Application Support", "Reef", "renderers", "lingjing-script-editor.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);
