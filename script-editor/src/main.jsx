import React from "react";
import { createRoot } from "react-dom/client";
import { ScriptEditor } from "@lingjingai/script-editor";
import editorStyles from "@lingjingai/script-editor/style.css";

const style = document.createElement("style");
style.textContent = editorStyles;
document.head.append(style);

const root = document.getElementById("root");
if (!root) {
  throw new Error("Reef script editor root is missing");
}

createRoot(root).render(
  <ScriptEditor
    value={window.reefScriptProject}
    onEdit={() => {}}
    disabled
    dark={window.reefScriptEditorDark}
    paper={false}
    toc="sidebar"
    contentMode="all"
    sceneDetails="popover"
  />
);
