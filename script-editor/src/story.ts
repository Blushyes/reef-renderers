import type { ScriptEpisode, ScriptItem, ScriptProject } from "@lingjingai/script-editor";

export interface StoryEpisode extends ScriptEpisode {
  synopsis?: string;
}

export interface StoryScriptProject extends ScriptProject {
  logline?: string;
  theme?: string;
  synopsis?: string;
  main_characters?: { name: string; role: string }[];
  episodes?: StoryEpisode[];
}

export function filterStoryEpisodes(episodes: readonly StoryEpisode[], query: string) {
  const keyword = query.trim().toLocaleLowerCase();
  return episodes.flatMap((episode, episodeIdx) => {
    if (!episode.synopsis?.trim()) return [];
    if (keyword && !`${episode.title ?? ""}\n${episode.synopsis}`.toLocaleLowerCase().includes(keyword)) {
      return [];
    }
    return [{ episode, episodeIdx }];
  });
}

export interface EpisodeSynopsisAnchor {
  episodeKey: string;
  action: ScriptItem;
  synopsis: string;
}

export function episodeSynopsisAnchors(document: StoryScriptProject | null) {
  const anchors = new Map<number, EpisodeSynopsisAnchor>();
  document?.episodes?.forEach((episode, episodeIdx) => {
    const action = episode.scenes?.[0]?.actions?.[0];
    if (!action || !episode.synopsis?.trim()) return;
    anchors.set(episodeIdx, {
      episodeKey: episode.episode_id ?? String(episodeIdx),
      action,
      synopsis: episode.synopsis,
    });
  });
  return anchors;
}
