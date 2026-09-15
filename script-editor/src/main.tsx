import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ScriptEditor } from "@lingjingai/script-editor";
import type { ScriptActionTarget, ScriptHighlight } from "@lingjingai/script-editor";
import editorStyles from "@lingjingai/script-editor/style.css";
import playerStyles from "./player.css";
import { activeActions, buildTimeline, sameTarget } from "./timeline";
import type { TimedAction } from "./timeline";
import type { SourceVideo } from "./host";
import { usePlaybackFollow } from "./use-playback-follow";

const style = document.createElement("style");
style.textContent = editorStyles + playerStyles;
document.head.append(style);

const preview = window.reefScriptPreview;
const timeline = buildTimeline(preview.project);
const hasTimestamps = timeline.some(actions => actions.length > 0);
const host = window.webkit?.messageHandlers?.reefRenderer;
interface PlaybackRequest { video: SourceVideo; seconds: number; play: boolean; id: number }

function App() {
  const [request, setRequest] = useState<PlaybackRequest | null>(() => {
    const video = preview.videos[0];
    return video ? { video, seconds: 0, play: false, id: 0 } : null;
  });
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(preview.error);
  const [active, setActive] = useState<TimedAction[]>([]);
  const editorRoot = useRef<HTMLDivElement>(null);
  const follow = usePlaybackFollow(editorRoot, preview.project, active[0]?.target);
  const videoRef = useRef<HTMLVideoElement>(null);
  const appliedRequest = useRef(-1);
  const latestRequest = useRef(request);
  latestRequest.current = request;
  const highlights = useMemo<ScriptHighlight[]>(() => active.map(action => ({
    target: action.target,
    className: "source-video-active-action",
  })), [active]);

  function updatePosition(episodeIdx: number, seconds: number) {
    const next = activeActions(timeline[episodeIdx], seconds);
    setActive(previous => previous.length === next.length && previous.every((item, i) => sameTarget(item.target, next[i].target)) ? previous : next);
  }

  function applyRequest() {
    const video = videoRef.current;
    if (!request || !video || video.readyState === 0 || appliedRequest.current === request.id) return;
    appliedRequest.current = request.id;
    video.currentTime = request.seconds;
    updatePosition(request.video.episodeIdx, request.seconds);
    if (request.play) void video.play().catch(reason => {
      if (latestRequest.current?.id === request.id) setError(`无法播放视频：${String(reason)}`);
    });
  }
  useEffect(applyRequest, [request]);

  function playAt(video: SourceVideo, seconds: number) {
    setError(null);
    setVisible(true);
    setRequest(previous => ({ video, seconds, play: true, id: (previous?.id ?? 0) + 1 }));
  }

  function seekAction(target: ScriptActionTarget) {
    if (window.getSelection()?.isCollapsed === false) return;
    const action = timeline[target.episodeIdx].find(action => sameTarget(action.target, target));
    if (!action) return;
    const video = preview.videos.find(video => video.episodeIdx === target.episodeIdx);
    if (!video) {
      if (preview.project.sourceVideo) setError(`缺少第 ${target.episodeIdx + 1} 集视频，请检查源视频目录。`);
      return;
    }
    playAt(video, action.seconds);
  }

  async function associate() {
    if (!host) return;
    setBusy(true);
    setError(null);
    try {
      await host.postMessage({ action: "associateSourceVideo" });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div ref={editorRoot} className="source-video-editor">
    <ScriptEditor
      value={preview.project} onEdit={() => {}} disabled
      dark={window.reefScriptEditorDark} paper={false} toc="sidebar"
      contentMode="all" sceneDetails="popover" showTimestamp={hasTimestamps}
      onActionClick={seekAction} highlights={highlights}
      referenceFocusRequest={follow.focus}
      topBarActions={<div className="source-video-actions">
        {(hasTimestamps || preview.project.sourceVideo) && <button
          disabled={busy || !host} onClick={() => void associate()}
          title={host ? preview.project.sourceVideo ?? "选择分集视频所在目录" : "关联视频需要支持文档操作的 ReefMac 本地预览"}
        >{busy ? "正在关联…" : preview.project.sourceVideo ? "更换源视频" : "关联源视频"}</button>}
        {request && !visible && <button onClick={() => setVisible(true)}>显示视频</button>}
      </div>}
    />
    </div>
    {!follow.following && <button className="source-video-follow" style={follow.buttonPosition} onClick={follow.resume}>回到跟随</button>}
    {(error || preview.warning) && <div className="source-video-message" role="status">{error ?? preview.warning}</div>}
    {request && <FloatingPlayer visible={visible}>
      <header className="source-video-header">
        <span className="source-video-drag-label">源视频</span>
        <select aria-label="播放分集" value={request.video.episodeIdx} onChange={event => {
          const video = preview.videos.find(video => video.episodeIdx === Number(event.target.value));
          if (video) playAt(video, 0);
        }}>{preview.videos.map(video => <option key={video.episodeIdx} value={video.episodeIdx}>第 {video.episodeIdx + 1} 集 · {video.name}</option>)}</select>
        <button aria-label="收起视频" title="收起视频" onClick={() => {
          videoRef.current?.pause();
          setVisible(false);
        }}>×</button>
      </header>
      <video key={request.video.url} ref={videoRef} src={request.video.url}
        controls playsInline preload="metadata" onLoadedMetadata={applyRequest}
        onTimeUpdate={event => updatePosition(request.video.episodeIdx, event.currentTarget.currentTime)}
        onSeeked={event => updatePosition(request.video.episodeIdx, event.currentTarget.currentTime)}
        onError={() => setError(`无法读取或解码 ${request.video.name}，请检查文件及视频编码。`)}
        onEnded={() => {
          if (!visible) return;
          const nextIdx = request.video.episodeIdx + 1;
          const next = preview.videos.find(video => video.episodeIdx === nextIdx);
          if (next) playAt(next, 0);
          else if (nextIdx < timeline.length) setError(`缺少第 ${nextIdx + 1} 集视频，连续播放已停止。`);
        }}
      />
    </FloatingPlayer>}
  </>;
}

type PlayerGesture =
  | { kind: "move"; pointer: number; dx: number; dy: number }
  | { kind: "resize"; pointer: number; x: number; y: number; width: number; height: number; left: number; top: number };

function FloatingPlayer({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const gesture = useRef<PlayerGesture | null>(null);
  function move(x: number, y: number) {
    const rect = panel.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) });
  }
  useEffect(() => {
    const resize = () => { if (position) move(position.x, position.y); };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [position]);
  return <aside ref={panel} hidden={!visible} className="source-video-player" aria-label="源视频播放器"
    style={{
      ...(position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : {}),
      ...(size ? { width: size.width, height: size.height } : {}),
    }}
    onPointerDown={event => {
      if (!(event.target instanceof HTMLElement) || event.button !== 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.target.closest(".source-video-resize")) {
        setPosition({ x: rect.left, y: rect.top });
        gesture.current = { kind: "resize", pointer: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, left: rect.left, top: rect.top };
      } else if (event.target.closest("header") && !event.target.closest("button, select")) {
        gesture.current = { kind: "move", pointer: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      } else return;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    }}
    onPointerMove={event => {
      const current = gesture.current;
      if (!current || current.pointer !== event.pointerId) return;
      if (current.kind === "move") move(event.clientX - current.dx, event.clientY - current.dy);
      else setSize({
        width: Math.min(window.innerWidth - current.left - 8, Math.max(240, current.width + event.clientX - current.x)),
        height: Math.min(window.innerHeight - current.top - 8, Math.max(170, current.height + event.clientY - current.y)),
      });
    }}
    onPointerUp={event => {
      if (gesture.current?.pointer === event.pointerId) {
        gesture.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }} onLostPointerCapture={() => { gesture.current = null; }}
  >{children}<div className="source-video-resize" title="拖拽调整视频窗口大小" aria-hidden="true" /></aside>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Reef script editor root is missing");
createRoot(root).render(<App />);
