import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { associateSourceVideo, loadVideoSource } from "./video-source.mjs";

const input = JSON.parse(await readStdin());
let project = scriptProject(input.body?.kind === "structuredData" ? input.body.source : null);
if (project === null) {
  process.stdout.write(JSON.stringify({ kind: "notApplicable" }));
  process.exit(0);
}

let media = { videos: [], resources: [], warning: null };
let mediaError = null;
if (input.interaction) {
  const associated = await associateSourceVideo(input, project);
  project = associated.project;
  media = associated.media;
} else if (project.sourceVideo !== undefined) {
  try {
    media = await loadVideoSource(project.sourceVideo, project.episodes.length);
  } catch (error) {
    // A missing source directory must remain repairable from the script preview.
    mediaError = error.message;
  }
}
const rendererDirectory = path.dirname(fileURLToPath(import.meta.url));
const script = await readFile(path.join(rendererDirectory, "script-editor.min.js"), "utf8");
const encodedSource = Buffer.from(JSON.stringify({ project, videos: media.videos, warning: media.warning, error: mediaError }), "utf8").toString("base64");

process.stdout.write(JSON.stringify({
  kind: "interactiveHtml",
  resources: media.resources,
  html: `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: file:; media-src reef-resource:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <style>html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}</style>
  <script>
    const bytes = Uint8Array.from(atob("${encodedSource}"), character => character.charCodeAt(0));
    window.reefScriptPreview = JSON.parse(new TextDecoder().decode(bytes));
    window.reefScriptEditorDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  </script>
</head>
<body>
  <div id="root"></div>
  <script>${script.replaceAll("</script>", "<\\/script>")}</script>
</body>
</html>`
}));

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function scriptProject(source) {
  if (typeof source !== "string") {
    return null;
  }
  let project;
  try {
    project = JSON.parse(source);
  } catch {
    return null;
  }
  if (
    !project ||
    typeof project !== "object" ||
    ![3, 4].includes(project.version) ||
    typeof project.title !== "string" ||
    !["actors", "locations", "props", "episodes"].every(key => Array.isArray(project[key]))
  ) {
    return null;
  }
  return project.episodes.every(episode =>
    episode &&
    typeof episode.episode_id === "string" &&
    Array.isArray(episode.scenes) &&
    episode.scenes.every(scene =>
      scene && typeof scene.scene_id === "string" && Array.isArray(scene.actions)
    )
  ) ? project : null;
}
