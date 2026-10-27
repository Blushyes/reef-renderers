import { build } from "esbuild";
import { mkdir, copyFile, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(directory);
const output = path.resolve(process.argv[2] ?? path.join(root, ".reef-build/script-editor"));
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root, entryPoints: [path.join(root, "src/preview.tsx")],
  outfile: path.join(output, "script-editor.min.js"), bundle: true, minify: true,
  format: "iife", target: "safari17", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".css": "text", ".png": "dataurl" },
  plugins: [{ name: "inline-editor-css", setup(builder) {
    builder.onLoad({ filter: /style\.css$/ }, async (args) => ({
      contents: (await readFile(args.path, "utf8")).replaceAll(/url\(["']?\.\/paper-fibers\.png["']?\)/g,
        `url(data:image/png;base64,${(await readFile(path.join(path.dirname(args.path), "paper-fibers.png"))).toString("base64")})`),
      loader: "text",
    }));
  } }],
});
await build({
  absWorkingDir: root, entryPoints: [path.join(root, "src/service.ts")],
  outfile: path.join(output, "service.mjs"), bundle: true, platform: "node", format: "esm", target: "node22",
});
for (const name of ["renderer.mjs", "renderer.json", "video-source.mjs", "launch.sh", "USAGE.md"]) {
  await copyFile(path.join(root, name), path.join(output, name === "USAGE.md" ? "README.md" : name));
}
// Replace the Mach-O inode so macOS refreshes its executable signature cache.
await copyFile(path.join(root, ".native-build/dialogue-translate"), path.join(output, "dialogue-translate.next"));
await rename(path.join(output, "dialogue-translate.next"), path.join(output, "dialogue-translate"));
console.log(output);
