import type { PreviewData } from "./src/types";
export function episodeNumber(filename: string): number | null;
export interface VideoMedia {
  directory: string;
  videos: PreviewData["videos"];
  resources: { id: string; path: string; mimeType: string }[];
  warning: string | null;
}
export function loadVideoSource(directory: string, episodeCount: number): Promise<VideoMedia>;
export function associateSourceVideo(input: {
  source: { localFileAvailable: boolean; localPath?: string };
  body: { source: string };
  interaction: { action: string; directory: string };
}, project: PreviewData["project"]): Promise<{ project: PreviewData["project"]; media: VideoMedia }>;
