import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ScriptActionTarget, ScriptProject, ScriptReferenceFocusRequest } from "@lingjingai/script-editor";

export function followOffset(rowTop: number, viewportHeight: number, force: boolean): number {
  return force || rowTop < 0 || rowTop >= viewportHeight * 0.8
    ? rowTop - viewportHeight * 0.1 : 0;
}

/** Quartic ease-out: immediate momentum with a short, soft landing. */
export function scrollEase(progress: number): number {
  return 1 - (1 - progress) ** 4;
}

function animateScroll(scroller: HTMLElement, offset: number, finish: () => void): () => void {
  const start = scroller.scrollTop;
  const end = Math.max(0, Math.min(start + offset, scroller.scrollHeight - scroller.clientHeight));
  const duration = Math.min(520, Math.max(360, Math.abs(end - start) * 0.2 + 300));
  const started = performance.now();
  let frame = 0;
  function step(now: number) {
    const progress = Math.min(1, (now - started) / duration);
    scroller.scrollTop = start + (end - start) * scrollEase(progress);
    if (progress < 1) frame = requestAnimationFrame(step);
    else finish();
  }
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

/** Uses the editor's action data attributes for geometry and its focus API to mount virtual scenes. */
export function usePlaybackFollow(root: RefObject<HTMLDivElement | null>, project: ScriptProject, target: ScriptActionTarget | undefined) {
  const [following, setFollowing] = useState(true);
  const [focus, setFocus] = useState<ScriptReferenceFocusRequest | null>(null);
  const [buttonPosition, setButtonPosition] = useState({ left: 0, bottom: 16 });
  const enabled = useRef(true);
  const forceNext = useRef(false);
  const requestId = useRef(0);
  const animation = useRef<(() => void) | null>(null);
  const scheduleFollow = useRef<(() => void) | null>(null);
  useLayoutEffect(() => () => { animation.current?.(); }, []);

  useLayoutEffect(() => {
    const container = root.current;
    const element = container?.querySelector<HTMLElement>(".lj-se-stream");
    if (!container || !element) return;
    const scroller = element;
    let frame = 0;
    let focusRequested = false;
    let mustAlign = forceNext.current;
    forceNext.current = false;
    setFocus(null);

    function detach() {
      if (!target) return;
      animation.current?.();
      animation.current = null;
      enabled.current = false;
      setFollowing(false);
      setFocus(null);
    }
    function wheel(event: WheelEvent) { if (event.deltaY !== 0) detach(); }
    function key(event: KeyboardEvent) {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) detach();
    }
    function pointer(event: PointerEvent) {
      const rect = scroller.getBoundingClientRect();
      if (event.clientX >= rect.right - 16) detach();
    }
    function navigation(event: MouseEvent) {
      if (event.target instanceof HTMLElement && event.target.closest(".lj-se-toc")) detach();
    }
    function positionButton() {
      const viewport = scroller.getBoundingClientRect();
      setButtonPosition(previous => {
        const left = viewport.left + viewport.width / 2;
        const bottom = window.innerHeight - viewport.bottom + 16;
        return previous.left === left && previous.bottom === bottom ? previous : { left, bottom };
      });
    }
    function align() {
      frame = 0;
      if (!enabled.current || !following || !target || animation.current) return;
      const viewport = scroller.getBoundingClientRect();
      const scene = [...scroller.querySelectorAll<HTMLElement>("[data-script-scene]")].find(element =>
        element.dataset.scriptEpisodeIndex === String(target.episodeIdx) && element.dataset.scriptSceneId === target.sceneId);
      const action = scene?.querySelector<HTMLElement>(`[data-script-action-index="${target.actionIndex}"]`);
      if (!action) {
        if (focusRequested) return;
        const sceneIdx = project.episodes?.[target.episodeIdx]?.scenes?.findIndex(scene => scene.scene_id === target.sceneId);
        if (sceneIdx === undefined || sceneIdx < 0) return;
        focusRequested = true;
        mustAlign = true;
        setFocus({ requestId: ++requestId.current, reference: { source: { episodeIdx: target.episodeIdx, sceneIdx, itemIdx: target.actionIndex } } });
        return;
      }
      if (focusRequested) {
        // Cancel the editor's initial reveal once the row exists, then apply our 10% alignment.
        focusRequested = false;
        setFocus(null);
        schedule();
        return;
      }
      const offset = followOffset(action.getBoundingClientRect().top - viewport.top, scroller.clientHeight, mustAlign);
      mustAlign = false;
      if (Math.abs(offset) > 1) {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          scroller.scrollBy({ top: offset, behavior: "auto" });
        } else {
          animation.current = animateScroll(scroller, offset, () => {
            animation.current = null;
            scheduleFollow.current?.();
          });
        }
      }
    }
    function schedule() {
      if (enabled.current && following && target && !animation.current && !frame) {
        frame = requestAnimationFrame(align);
      }
    }
    scheduleFollow.current = schedule;
    scroller.addEventListener("wheel", wheel, { passive: true });
    scroller.addEventListener("touchstart", detach, { passive: true });
    scroller.addEventListener("keydown", key);
    scroller.addEventListener("pointerdown", pointer);
    scroller.addEventListener("scroll", schedule, { passive: true });
    container.addEventListener("click", navigation);
    const mutations = new MutationObserver(schedule);
    mutations.observe(scroller, { childList: true, subtree: true });
    const resize = new ResizeObserver(() => { positionButton(); schedule(); });
    resize.observe(scroller);
    positionButton();
    schedule();
    return () => {
      scheduleFollow.current = null;
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      scroller.removeEventListener("wheel", wheel);
      scroller.removeEventListener("touchstart", detach);
      scroller.removeEventListener("keydown", key);
      scroller.removeEventListener("pointerdown", pointer);
      scroller.removeEventListener("scroll", schedule);
      container.removeEventListener("click", navigation);
    };
  }, [root, project, target, following]);

  function resume() {
    enabled.current = true;
    forceNext.current = true;
    setFollowing(true);
  }
  return { following, focus, buttonPosition, resume };
}
