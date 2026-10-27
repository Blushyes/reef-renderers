import type { StoryScriptProject } from "./story";
import type { StateEvidenceManifest } from "./evidence";

export interface SourceVideo { episodeIdx: number; name: string; url: string }
export interface VideoSuggestion {
  directory: string; reason: string; matched: number; total: number; files: number;
  warning: string | null; problem: string | null; extra: number; sampleNames: string[];
}
export interface VideoAssociation {
  directory: string; videos: SourceVideo[]; warning: string | null;
}
export interface EvidenceView {
  manifest: StateEvidenceManifest | null;
  urls: Record<string, string>;
  status: "idle" | "running" | "complete" | "error";
  message: string;
  canGenerate: boolean;
}
export interface PreviewData {
  project: StoryScriptProject & { sourceVideo?: string };
  videos: SourceVideo[];
  warning: string | null;
  error: string | null;
  serviceUrl: string;
  canAssociate: boolean;
}
export interface ServiceInput {
  project: PreviewData["project"];
  scriptPath?: string;
  rendererDirectory: string;
}

declare global {
  interface Window {
    reefScriptPreview: PreviewData;
    reefScriptEditorDark: boolean;
    webkit?: { messageHandlers?: { reefRenderer?: { postMessage: (message: { action: string }) => Promise<unknown> } } };
  }
}
