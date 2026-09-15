import type { ScriptProject } from "@lingjingai/script-editor";

export interface SourceVideo {
  episodeIdx: number;
  name: string;
  url: string;
}

declare global {
  interface Window {
    reefScriptPreview: {
      project: ScriptProject & { sourceVideo?: string };
      videos: SourceVideo[];
      warning: string | null;
      error: string | null;
    };
    reefScriptEditorDark: boolean;
    webkit?: {
      messageHandlers?: {
        reefRenderer?: { postMessage(message: { action: "associateSourceVideo" }): Promise<boolean | null> };
      };
    };
  }
}
