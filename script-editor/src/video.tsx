import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { ScriptActionTarget, ScriptProject, ScriptReferenceFocusRequest } from "@lingjingai/script-editor";
import { parseScriptTimestamp } from "./timestamp";

export function videoTimeline(project: ScriptProject) {
  return (project.episodes ?? []).map((episode, episodeIdx) => (episode.scenes ?? []).flatMap((scene) =>
    (scene.actions ?? []).flatMap((action, actionIndex) => {
      const seconds = parseScriptTimestamp(action.extend?.timestamp);
      return seconds === null ? [] : [{ seconds, target: { episodeIdx, sceneId: scene.scene_id!, actionIndex, actionId: action.action_id } }];
    })).sort((a, b) => a.seconds - b.seconds));
}
export function activeAt(timeline: ReturnType<typeof videoTimeline>[number], seconds: number) {
  let left = 0, right = timeline.length;
  while (left < right) { const middle = (left + right) >>> 1; if (timeline[middle].seconds <= seconds) left = middle + 1; else right = middle; }
  if (!left) return [];
  const end = left, stamp = timeline[left - 1].seconds;
  while (left && timeline[left - 1].seconds === stamp) left--;
  return timeline.slice(left, end);
}

export function usePlaybackFollow(root: RefObject<HTMLDivElement | null>, project: ScriptProject, target: ScriptActionTarget | undefined) {
  const [following, setFollowing] = useState(true);
  const [focus, setFocus] = useState<ScriptReferenceFocusRequest | null>(null);
  const requestId = useRef(0);
  const force = useRef(false);
  useLayoutEffect(() => {
    const host = root.current;
    const scroller = host?.querySelector<HTMLElement>(".lj-se-stream");
    if (!host || !scroller || !target) return;
    let raf = 0, locating = false;
    const pause = () => { setFollowing(false); setFocus(null); };
    const wheel = (event: WheelEvent) => { if (event.deltaY) pause(); };
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest("input,textarea,[contenteditable=true]")) return;
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) pause();
    };
    const click = (event: MouseEvent) => { if ((event.target as HTMLElement).closest(".lj-se-toc")) pause(); };
    function follow() {
      raf = 0;
      if (!following) return;
      const scene = [...scroller!.querySelectorAll<HTMLElement>("[data-script-scene]")].find((element) =>
        element.dataset.scriptEpisodeIndex === String(target!.episodeIdx) && element.dataset.scriptSceneId === target!.sceneId);
      const row = scene?.querySelector<HTMLElement>(`[data-script-action-index="${target!.actionIndex}"]`);
      if (!row) {
        if (locating) return;
        locating = true;
        const sceneIdx = project.episodes?.[target!.episodeIdx]?.scenes?.findIndex((scene) => scene.scene_id === target!.sceneId) ?? -1;
        if (sceneIdx >= 0) setFocus({ requestId: ++requestId.current, reference: { source: { episodeIdx: target!.episodeIdx, sceneIdx, itemIdx: target!.actionIndex } } });
        return;
      }
      const top = row.getBoundingClientRect().top - scroller!.getBoundingClientRect().top;
      if (force.current || top < 0 || top >= scroller!.clientHeight * .8) {
        scroller!.scrollBy({ top: top - scroller!.clientHeight * .1, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
      force.current = false;
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(follow); };
    const observer = new MutationObserver(schedule);
    observer.observe(scroller, { childList: true, subtree: true });
    scroller.addEventListener("wheel", wheel, { passive: true });
    scroller.addEventListener("touchstart", pause, { passive: true });
    scroller.addEventListener("keydown", key);
    host.addEventListener("click", click);
    schedule();
    return () => {
      cancelAnimationFrame(raf); observer.disconnect();
      scroller.removeEventListener("wheel", wheel); scroller.removeEventListener("touchstart", pause);
      scroller.removeEventListener("keydown", key); host.removeEventListener("click", click);
    };
  }, [root, project, target, following]);
  return { following, focus, resume: () => { force.current = true; setFollowing(true); } };
}

type Drag = { pointer: number; kind: "move" | "resize"; x: number; y: number; left: number; top: number; width: number; height: number };
export function FloatingVideo({ visible, children }: { visible: boolean; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [bounds, setBounds] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  useEffect(() => {
    const resize = () => setBounds((current) => current && ({ ...current,
      left: Math.max(8, Math.min(current.left, window.innerWidth - current.width - 8)),
      top: Math.max(8, Math.min(current.top, window.innerHeight - current.height - 8)),
    }));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return <aside ref={ref} hidden={!visible} className="reader-video" aria-label="源视频播放器" style={bounds ?? undefined}
    onPointerDown={(event) => {
      const target = event.target as HTMLElement;
      if (event.button !== 0 || target.closest("button,[role=combobox]")) return;
      const kind = target.closest(".reader-resize") ? "resize" : target.closest("header") ? "move" : null;
      if (!kind) return;
      const rect = event.currentTarget.getBoundingClientRect();
      drag.current = { pointer: event.pointerId, kind, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
    }}
    onPointerMove={(event) => {
      const start = drag.current;
      if (!start || start.pointer !== event.pointerId) return;
      setBounds(start.kind === "move" ? {
        width: start.width, height: start.height,
        left: Math.max(8, Math.min(start.left + event.clientX - start.x, window.innerWidth - start.width - 8)),
        top: Math.max(8, Math.min(start.top + event.clientY - start.y, window.innerHeight - start.height - 8)),
      } : {
        left: start.left, top: start.top,
        width: Math.min(window.innerWidth - start.left - 8, Math.max(240, start.width + event.clientX - start.x)),
        height: Math.min(window.innerHeight - start.top - 8, Math.max(170, start.height + event.clientY - start.y)),
      });
    }}
    onPointerUp={(event) => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
    onLostPointerCapture={() => { drag.current = null; }}>
    {children}<div className="reader-resize" title="拖动调整大小" aria-hidden="true" />
  </aside>;
}
