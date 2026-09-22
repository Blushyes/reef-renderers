# LingJing Script Editor renderer

This is an external Reef renderer for ScriptProject JSON documents. It receives generic structured-data previews, decides whether the JSON matches its own document shape, and returns `notApplicable` for every other document.

```sh
npm install
npm run build
npm run install:renderer
```

Requires Node.js available in the user's zsh terminal (`command -v node`). The
launcher resolves Node through an interactive login zsh, including nvm setup in
`.zshrc`, so Finder-launched ReefMac can use it without a fixed installation path.
Shell startup output is kept separate from the renderer's JSON protocol.

The install step copies the renderer to `~/Library/Application Support/Reef/renderers/` and registers its manifest there.

To distribute the renderer, ZIP a folder containing `renderer.json`, `launch.sh`,
`renderer.mjs`, `video-source.mjs`, `script-editor.min.js`, and `paper-fibers.png`.
Recipients remove the previous renderer in ReefMac Settings, then import this
folder. The launcher works with the existing ReefMac renderer protocol.

## Source video

Requires ReefMac with `localResources` and `documentActions` renderer capabilities.
For scripts with `action.extend.timestamp`, use **关联源视频** to select the directory
containing the episode videos. The renderer writes its absolute path to the top-level
`sourceVideo` string in the local script, preserving all other fields. Reopening the
script restores the association. **更换源视频** repairs a moved or unavailable directory.

Files are matched to the script's 1-based episode positions by explicit filename:
`01.mp4`, `ep_001.mp4`, `Episode 1.mov`, or `第1集.mp4`. Supported containers are
MP4/M4V, MOV, and WebM; actual codecs must be supported by macOS WebKit. Duplicate
matches are rejected and missing episodes are reported; files are never assigned by
alphabetical order. Only immediate files in the chosen directory are considered, including symbolic links
to video files in other directories. Episode numbers come from the link filename.

Click a timestamped action to seek and play. Actions sharing a timestamp highlight
together until the next timestamp. Playback continues across actions and into the next
episode; a missing next episode stops playback. The player can be dragged by its header,
resized with its bottom-right handle, collapsed, and reopened from the toolbar. Its native video controls allow seeking,
pausing, volume control, and fullscreen.

```sh
npm run check
npm test
npm run build
npm run install:renderer
```

The renderer owns script-specific I/O in its Node process. ReefMac selects the directory
and invokes the process with `interaction: {action: "associateSourceVideo", directory}`;
the process compares the current file with the original preview before atomically
replacing it. The HTML only receives named media URLs, served by ReefMac's bounded,
cancellable byte-range resource handler.

Playback follows the current action in the script viewport: reaching 80% of its height
smoothly moves the action to 10% with a brisk ease-out curve. Manual scrolling pauses follow mode; **回到跟随** at the bottom
center returns to the current action and resumes following. Virtualized scenes are
revealed through the editor's reference-focus API before aligning their action row.
