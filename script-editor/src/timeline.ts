import { formatTimestamp } from "@lingjingai/script-editor";
import type { ScriptActionTarget, ScriptProject } from "@lingjingai/script-editor";

export interface TimedAction {
  target: ScriptActionTarget;
  seconds: number;
}

export function buildTimeline(project: ScriptProject): TimedAction[][] {
  return (project.episodes ?? []).map((episode, episodeIdx) => {
    const actions: TimedAction[] = [];
    for (const scene of episode.scenes ?? []) {
      const sceneId = scene.scene_id;
      if (!sceneId) continue;
      (scene.actions ?? []).forEach((action, actionIndex) => {
        const timestamp = formatTimestamp(action.extend?.timestamp);
        if (!timestamp) return;
        const [minutes, seconds] = timestamp.full.split(":").map(Number);
        actions.push({
          target: { episodeIdx, sceneId, actionIndex, actionId: action.action_id },
          seconds: minutes * 60 + seconds,
        });
      });
    }
    return actions.sort((a, b) => a.seconds - b.seconds);
  });
}

/** All actions at the latest timestamp remain active until the next distinct timestamp. */
export function activeActions(timeline: TimedAction[], seconds: number): TimedAction[] {
  let low = 0;
  let high = timeline.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (timeline[mid].seconds <= seconds) low = mid + 1;
    else high = mid;
  }
  if (low === 0) return [];
  const end = low;
  const startTime = timeline[low - 1].seconds;
  while (low > 0 && timeline[low - 1].seconds === startTime) low--;
  return timeline.slice(low, end);
}

export function sameTarget(a: ScriptActionTarget, b: ScriptActionTarget) {
  return a.episodeIdx === b.episodeIdx && a.sceneId === b.sceneId && a.actionIndex === b.actionIndex;
}
