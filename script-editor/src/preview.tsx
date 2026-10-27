import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ScriptEditor, type ScriptActionTarget, type ScriptEditorProps, type StudioSelection, type ScriptFormat, type ScriptSpeakerPreviewTarget } from "@lingjingai/script-editor";
import { Button } from "@base-ui/react/button";
import { Tabs } from "@base-ui/react/tabs";
import { Select } from "@base-ui/react/select";
import { Dialog } from "@base-ui/react/dialog";
import { Collapsible } from "@base-ui/react/collapsible";
import { Input } from "@base-ui/react/input";
import { Tooltip } from "@base-ui/react/tooltip";
import editorCss from "@lingjingai/script-editor/style.css";
import readerCss from "./reader.css";
import { episodeSynopsisAnchors, filterStoryEpisodes } from "./story";
import { TranslationQueue, dialogueTexts } from "./translation-queue";
import { parseScriptTimestamp } from "./timestamp";
import type { StateEvidenceSample } from "./evidence";
import type { TranslationResult, TranslationTarget } from "./translation-types";
import type { EvidenceView, SourceVideo, VideoAssociation, VideoSuggestion } from "./types";
import { FloatingVideo, activeAt, usePlaybackFollow, videoTimeline } from "./video";

const style = document.createElement("style");
style.textContent = editorCss + readerCss;
document.head.append(style);
const data = window.reefScriptPreview;
const project = data.project;
const timeline = videoTimeline(project);
const hasTimestamp = timeline.some((items) => items.length);
const languages: Record<TranslationTarget, string> = { "zh-Hans": "简体中文", en: "English", ja: "日本語", ko: "한국어" };
const sections = { story: "故事梗概", script: "剧本", actors: "人物", locations: "场景", props: "道具" };
type Section = keyof typeof sections;

async function request<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${data.serviceUrl}/${route}`, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "本地阅读服务暂不可用，请重新打开剧本。");
  return result;
}

function Choice<T extends string>({ value, options, label, onChange }: { value: T; options: Record<T, string>; label: string; onChange: (value: T) => void }) {
  return <Select.Root value={value} onValueChange={(next) => { if (next) onChange(next); }} items={options}>
    <Select.Trigger className="reader-button" aria-label={label}><Select.Value /><Select.Icon>⌄</Select.Icon></Select.Trigger>
    <Select.Portal><Select.Positioner className="reader-select-positioner" sideOffset={4}>
      <Select.Popup className="reader-select"><Select.List>
        {(Object.entries(options) as [T, string][]).map(([key, title]) => <Select.Item className="reader-option" key={key} value={key}><Select.ItemText>{title}</Select.ItemText><Select.ItemIndicator>✓</Select.ItemIndicator></Select.Item>)}
      </Select.List></Select.Popup>
    </Select.Positioner></Select.Portal>
  </Select.Root>;
}

function Prose({ title, children }: { title: string; children?: ReactNode }) {
  return children ? <section className="reader-prose"><h2>{title}</h2>{typeof children === "string" ? <p>{children}</p> : children}</section> : null;
}
function TranslationLine({ text, queue, format }: { text: string; queue: TranslationQueue; format: ScriptFormat }) {
  const subscribe = useCallback((notify: () => void) => queue.subscribe(text, notify), [queue, text]);
  const result = useSyncExternalStore(subscribe, () => queue.get(text));
  if (result?.status !== "translated" && result) return null;
  return <div className="reader-translation" data-format={format} data-dialogue-translation>{result?.status === "translated" ? result.translation : "翻译中…"}</div>;
}
function Synopsis({ text }: { text: string }) {
  return <Collapsible.Root defaultOpen className="reader-synopsis"><Collapsible.Trigger className="reader-button">本集梗概 <span>⌄</span></Collapsible.Trigger><Collapsible.Panel><p>{text}</p></Collapsible.Panel></Collapsible.Root>;
}

function App() {
  const [source, setSource] = useState({ directory: project.sourceVideo, videos: data.videos, warning: data.warning });
  const [sourceOpen, setSourceOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<VideoSuggestion[] | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("script");
  const [selection, setSelection] = useState<StudioSelection>({ kind: "empty" });
  const [query, setQuery] = useState("");
  const [synopsis, setSynopsis] = useState(true);
  const [translate, setTranslate] = useState(false);
  const [language, setLanguage] = useState<TranslationTarget>("zh-Hans");
  const [notice, setNotice] = useState<TranslationResult | null>(null);
  const [error, setError] = useState<string | null>(data.error);
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceView | null>(null);
  const [image, setImage] = useState<{ sample: StateEvidenceSample; title: string; url: string } | null>(null);
  const [speaker, setSpeaker] = useState<ScriptSpeakerPreviewTarget | null>(null);
  const [playback, setPlayback] = useState<{ video: SourceVideo; seconds: number; id: number; play: boolean } | null>(() => source.videos[0] ? { video: source.videos[0], seconds: 0, id: 0, play: false } : null);
  const [videoVisible, setVideoVisible] = useState(Boolean(playback));
  const [active, setActive] = useState<ScriptActionTarget[]>([]);
  const video = useRef<HTMLVideoElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const applied = useRef(-1);
  const follow = usePlaybackFollow(editor, project, section === "script" && videoVisible ? active[0] : undefined);
  const anchors = useMemo(() => episodeSynopsisAnchors(project), []);
  const queue = useMemo(() => new TranslationQueue(async (texts) => {
    const results = await request<TranslationResult[]>("translate", { texts, targetLanguage: language }).catch((error: Error) => {
      setError(error.message); setNotice({ status: "error" }); throw error;
    });
    const unavailable = results.find((result) => result.status === "not-installed")
      ?? results.find((result) => result.status !== "translated" && result.status !== "skipped");
    if (unavailable) setNotice(unavailable);
    return results;
  }), [language]);
  useEffect(() => {
    if (!translate) return;
    queue.retryUnavailable();
    const retry = () => { setNotice(null); queue.retryUnavailable(); };
    window.addEventListener("focus", retry);
    return () => window.removeEventListener("focus", retry);
  }, [translate, queue]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.altKey && event.code === "KeyA" && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.repeat
        && !(event.target as HTMLElement).closest("input,textarea,[contenteditable=true]")) {
        event.preventDefault(); setTranslate((enabled) => !enabled);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    void request<EvidenceView>("evidence").then(setEvidence).catch((error: Error) => setError(error.message));
    const heartbeat = setInterval(() => { void request("ping").catch((error: Error) => setError(error.message)); }, 60_000);
    return () => clearInterval(heartbeat);
  }, []);
  useEffect(() => {
    if (evidence?.status !== "running") return;
    const timer = setInterval(() => { void request<EvidenceView>("evidence").then(setEvidence).catch((error: Error) => { setError(error.message); setEvidence((value) => value && ({ ...value, status: "error" })); }); }, 2000);
    return () => clearInterval(timer);
  }, [evidence?.status]);

  function syncTime(episodeIdx: number, seconds: number) {
    const targets = activeAt(timeline[episodeIdx], seconds).map((entry) => entry.target);
    setActive((previous) => JSON.stringify(previous) === JSON.stringify(targets) ? previous : targets);
  }
  function seek() {
    const element = video.current;
    if (!element || !playback || element.readyState === 0 || applied.current === playback.id) return;
    applied.current = playback.id;
    element.currentTime = playback.seconds;
    syncTime(playback.video.episodeIdx, playback.seconds);
    if (playback.play) void element.play().catch((error: Error) => setError(error.message));
  }
  useEffect(seek, [playback]);
  function play(episodeIdx: number, seconds: number) {
    const selectedVideo = source.videos.find((item) => item.episodeIdx === episodeIdx);
    if (!selectedVideo) { setError(`缺少第 ${episodeIdx + 1} 集视频，请关联源视频目录。`); return; }
    setError(null); setVideoVisible(true);
    setPlayback((previous) => ({ video: selectedVideo, seconds, id: (previous?.id ?? 0) + 1, play: true }));
  }
  function actionClick(target: ScriptActionTarget) {
    if (window.getSelection()?.isCollapsed === false) return;
    const entry = timeline[target.episodeIdx].find((entry) => entry.target.sceneId === target.sceneId && entry.target.actionIndex === target.actionIndex);
    if (entry && source.videos.length) play(target.episodeIdx, entry.seconds);
  }
  async function discoverSources() {
    setSourceOpen(true); setSuggestions(null); setSourceError(null);
    try { setSuggestions(await request<VideoSuggestion[]>("video-suggestions")); }
    catch (error) { setSuggestions([]); setSourceError((error as Error).message); }
  }
  async function chooseSource(directory: string) {
    setBusy(true); setSourceError(null);
    try {
      const next = await request<VideoAssociation>("associate-video", { directory });
      setSource(next); setError(null); setActive([]);
      setPlayback((previous) => next.videos[0] ? { video: next.videos[0], seconds: 0, id: (previous?.id ?? 0) + 1, play: false } : null);
      setVideoVisible(next.videos.length > 0); setSourceOpen(false);
      await request<EvidenceView>("evidence").then(setEvidence).catch((error: Error) => setError(error.message));
    } catch (error) { setSourceError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function associate() {
    setBusy(true); setError(null);
    try { setSourceOpen(false); await window.webkit!.messageHandlers!.reefRenderer!.postMessage({ action: "associateSourceVideo" }); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  async function generate() {
    setBusy(true); setError(null);
    try { setEvidence(await request<EvidenceView>("generate", {})); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  function navigate(next: Section, selection: StudioSelection = { kind: "empty" }) { setSection(next); setSelection(selection); setSpeaker(null); }
  const decorate = useCallback<NonNullable<ScriptEditorProps["actionDecorations"]>>(({ action, target, format }) => {
    const anchor = anchors.get(target.episodeIdx);
    return {
      before: synopsis && anchor?.action === action ? <Synopsis text={anchor.synopsis} /> : null,
      after: translate ? dialogueTexts(action).map((text, index) => <TranslationLine key={`${index}:${text}`} text={text} queue={queue} format={format} />) : null,
    };
  }, [synopsis, translate, queue, anchors]);

  function frames(samples: StateEvidenceSample[], label: string) {
    const ready = samples.filter((sample) => evidence?.urls[sample.evidence_id]);
    return ready.length ? <div className="reader-frames" aria-label={label}>{ready.map((sample) => <figure key={sample.evidence_id}>
      <Button className="reader-frame-button" aria-label={`放大 ${label} 第 ${sample.episode} 集 ${sample.timestamp}`} onClick={() => setImage({ sample, title: label, url: evidence!.urls[sample.evidence_id] })}>
        <img loading="lazy" src={evidence!.urls[sample.evidence_id]} alt={`${label} · 第 ${sample.episode} 集 ${sample.timestamp}`} />
      </Button><figcaption>第 {sample.episode} 集 · {sample.timestamp}</figcaption>
    </figure>)}</div> : <p className="reader-muted">尚无可用原片参考，可在上方生成。</p>;
  }
  const asset: ScriptEditorProps["asset"] = {
    getStateEvidenceCount: ({ assetId, stateId }) => evidence?.manifest?.items.filter((item) => item.actor_id === assetId && item.state_id === stateId).flatMap((item) => item.samples).filter((sample) => evidence.urls[sample.evidence_id]).length ?? 0,
    renderStateDetail: ({ kind, assetId, stateId, state }) => {
      if (kind !== "actor") return null;
      const identity = evidence?.manifest?.identities?.find((item) => item.actor_id === assetId);
      const samples = evidence?.manifest?.items.filter((item) => item.actor_id === assetId && item.state_id === stateId).flatMap((item) => item.samples) ?? [];
      return <div className="reader-evidence" data-actor-evidence={assetId} data-state-evidence={stateId}>
        {identity && <Prose title="人物识别 · 原片参考">{frames(identity.samples.slice(0, 6), identity.actor_name)}</Prose>}
        <Prose title={`${state.state_name || state.name || "当前造型"} · 原片参考`}>{frames(samples.slice(0, 3), state.state_name || state.name || "当前造型")}</Prose>
        {samples.length > 0 && <p className="reader-muted">所选时刻及前后各 1 秒，点击图片可放大或查看原片。</p>}
      </div>;
    },
  };
  const filtered = filterStoryEpisodes(project.episodes ?? [], query);
  const person = speaker && project.actors?.find((actor) => actor.actor_id === speaker.actorId);
  const portraits = speaker ? evidence?.manifest?.identities?.find((item) => item.actor_id === speaker.actorId)?.samples.filter((sample) => evidence.urls[sample.evidence_id]).slice(0, 6) ?? [] : [];
  return <main className="reader" data-theme={window.reefScriptEditorDark ? "dark" : "light"}>
    <header className="reader-toolbar">
      <Tabs.Root value={section} onValueChange={(value) => navigate(value as Section)}><Tabs.List aria-label="剧本阅读内容" className="reader-tabs">
        {Object.entries(sections).map(([key, label]) => <Tabs.Tab className="reader-tab" key={key} value={key}>{label}</Tabs.Tab>)}
      </Tabs.List></Tabs.Root>
      <div className="reader-actions">
        {section === "script" && <>
          <Button className="reader-button" aria-pressed={synopsis} onClick={() => setSynopsis(!synopsis)}>本集梗概</Button>
          <Button className="reader-button" aria-pressed={translate} title="Option+A" onClick={() => setTranslate(!translate)}>台词翻译</Button>
          {translate && <Choice value={language} options={languages} label="翻译目标语言" onChange={(language) => { setLanguage(language); setNotice(null); }} />}
        </>}
        {section === "actors" && <Button className="reader-button" disabled={busy || evidence?.status === "running" || !evidence?.canGenerate} title={!evidence?.canGenerate ? "需要本地 Script v4 剧本及关联源视频" : "按当前剧本中的人物和造型提取原片参考"} onClick={() => void generate()}>
          {evidence?.status === "running" ? "正在提取…" : evidence?.manifest ? "更新原片参考" : "生成原片参考"}
        </Button>}
        {(hasTimestamp || source.directory) && <Button data-video-associate className="reader-button" disabled={busy || !data.canAssociate || evidence?.status === "running"} onClick={() => void discoverSources()}>{busy ? "处理中…" : source.directory ? "更换源视频" : "关联源视频"}</Button>}
        {playback && !videoVisible && <Button className="reader-button" onClick={() => setVideoVisible(true)}>显示视频</Button>}
      </div>
    </header>
    {section === "script" && translate && notice && <div className="reader-notice" role="status">
      <span>{notice.status === "not-installed" ? `本机尚未安装 ${notice.sourceLanguage} → ${notice.targetLanguage} 翻译语言包。` : "本机翻译暂不可用；需要 macOS 26 和已下载的翻译语言。"}</span>
      <Button className="reader-button" onClick={() => { void request("translation-settings", {}).catch((error: Error) => setError(error.message)); }}>下载翻译语言</Button>
      <Button className="reader-button" onClick={() => { setNotice(null); queue.retryUnavailable(); }}>重试翻译</Button>
    </div>}
    {(error || source.warning || (section === "actors" && evidence?.message)) && <div className="reader-notice" role="status"><span>{error || (section === "actors" && evidence?.message) || source.warning}</span>{error && <Button className="reader-button" onClick={() => setError(null)} aria-label="关闭提示">×</Button>}</div>}
    {section === "story" ? <div className="reader-story-scroll"><article className="reader-story">
      <h1>{project.title}</h1>{project.logline && <p className="reader-logline">{project.logline}</p>}
      <Prose title="主题">{project.theme}</Prose><Prose title="全剧梗概">{project.synopsis || "剧本尚未提供全剧梗概。"}</Prose>
      {!!project.main_characters?.length && <Prose title="主要人物"><dl>{project.main_characters.map((character, index) => {
        const actor = project.actors?.find((actor) => (actor.actor_name || actor.name) === character.name);
        return <div key={index}><dt>{actor?.actor_id ? <Button className="reader-text-button" onClick={() => navigate("actors", { kind: "actor", actorId: actor.actor_id! })}>{character.name}</Button> : character.name}</dt><dd>{character.role}</dd></div>;
      })}</dl></Prose>}
      <Prose title="世界观">{project.worldview}</Prose><Prose title="风格">{project.style}</Prose>
      <Prose title="分集梗概"><Input className="reader-input" value={query} onValueChange={setQuery} placeholder="搜索集标题或梗概" aria-label="筛选分集梗概" />
        {filtered.map(({ episode, episodeIdx }) => <section className="reader-episode" key={episode.episode_id ?? episodeIdx}>
          <Button className="reader-text-button" onClick={() => navigate("script", { kind: "episode", episodeIdx })}>第 {episodeIdx + 1} 集{episode.title ? ` · ${episode.title}` : ""} →</Button><p>{episode.synopsis}</p>
        </section>)}
        {!filtered.length && <p className="reader-muted">{query ? "没有匹配的分集梗概" : "剧本尚未提供分集梗概。"}</p>}
      </Prose>
    </article></div> : <div className="reader-editor" ref={editor}>
      <ScriptEditor key={section} value={project} disabled dark={window.reefScriptEditorDark} paper={false} toc="sidebar"
        selection={selection} onSelectionChange={setSelection} contentMode={section === "script" ? "script" : "assets"}
        assetGroups={section === "script" ? undefined : [section]} asset={section === "actors" ? asset : undefined}
        sceneDetails="popover" showTimestamp={hasTimestamp} showSaveCapsule={false}
        actionDecorations={decorate} onActionClick={actionClick} referenceFocusRequest={follow.focus} onSpeakerPreviewChange={setSpeaker}
        highlights={active.map((target) => ({ target, className: "reader-active-action" }))} />
    </div>}
    <Tooltip.Root open={section === "script" && Boolean(person) && portraits.length > 0} onOpenChange={(open) => { if (!open) setSpeaker(null); }}>
      <Tooltip.Portal><Tooltip.Positioner anchor={speaker?.anchor} side="bottom" align="start" sideOffset={8} className="reader-tooltip-positioner">
        <Tooltip.Popup role="tooltip" className="reader-person-preview"><strong>{person?.actor_name || person?.name}</strong><span className="reader-muted">人物识别 · 原片参考</span>
          <div>{portraits.map((sample) => <img key={sample.evidence_id} src={evidence!.urls[sample.evidence_id]} alt={`${person?.actor_name || person?.name} · 第 ${sample.episode} 集 ${sample.timestamp}`} />)}</div>
        </Tooltip.Popup>
      </Tooltip.Positioner></Tooltip.Portal>
    </Tooltip.Root>
    {section === "script" && videoVisible && active.length > 0 && !follow.following && <Button className="reader-button reader-follow" onClick={follow.resume}>回到跟随</Button>}
    {playback && <FloatingVideo visible={videoVisible}><header><span>源视频</span>
      <Choice value={String(playback.video.episodeIdx)} options={Object.fromEntries(source.videos.map((video) => [String(video.episodeIdx), `第 ${video.episodeIdx + 1} 集 · ${video.name}`]))} label="播放分集" onChange={(value) => play(Number(value), 0)} />
      <Button className="reader-button" aria-label="收起视频" onClick={() => { video.current?.pause(); setVideoVisible(false); }}>×</Button>
    </header><video key={playback.video.url} ref={video} src={playback.video.url} controls playsInline preload="metadata"
      onLoadedMetadata={seek} onTimeUpdate={(event) => syncTime(playback.video.episodeIdx, event.currentTarget.currentTime)} onSeeked={(event) => syncTime(playback.video.episodeIdx, event.currentTarget.currentTime)}
      onError={() => setError(`无法读取或解码 ${playback.video.name}，请检查源视频。`)} onEnded={() => {
        if (!videoVisible) return;
        const next = playback.video.episodeIdx + 1;
        if (next < timeline.length) play(next, 0);
      }} /></FloatingVideo>}
    <Dialog.Root open={sourceOpen} onOpenChange={(open) => { if (!busy) setSourceOpen(open); }}>
      <Dialog.Portal><Dialog.Backdrop className="reader-backdrop" /><Dialog.Popup className="reader-image-dialog reader-source-dialog" finalFocus={() => document.querySelector<HTMLButtonElement>('[data-video-associate]')}>
        <header><Dialog.Title>关联源视频</Dialog.Title><Dialog.Close className="reader-button" disabled={busy} aria-label="关闭视频关联">×</Dialog.Close></header>
        <Dialog.Description>查找项目记录、剧本所在目录及附近两层目录。按文件名匹配集号，请核对剧名后选择。</Dialog.Description>
        <div className="reader-source-list" aria-busy={suggestions === null}>
          {suggestions === null && <p className="reader-muted" role="status">正在查找附近的视频…</p>}
          {suggestions?.length === 0 && !sourceError && <p className="reader-muted">附近没有找到分集视频。可以手动选择视频文件夹。</p>}
          {suggestions?.map((item) => <section className="reader-source-row" key={item.directory}>
            <div className="reader-source-heading"><strong>{item.matched} / {item.total} 集可匹配</strong><span className="reader-muted">{item.reason}</span></div>
            <p className="reader-source-path">{item.directory}</p>
            <p className="reader-muted">{item.sampleNames.join(" · ")}</p>
            {item.warning && <p className="reader-muted">{item.warning}。补齐分集后可提取人物参考。</p>}
            {item.extra > 0 && <p className="reader-muted">另有 {item.extra} 集超出当前剧本范围；提取人物参考需要选择与剧本集数一致的目录。</p>}
            {item.problem && <p className="reader-muted">{item.problem}</p>}
            <Button className="reader-button" disabled={busy || Boolean(item.problem)} aria-label={`关联 ${item.directory}`} onClick={() => void chooseSource(item.directory)}>{busy ? "正在关联…" : source.directory === item.directory ? "使用当前目录" : "关联此目录"}</Button>
          </section>)}
        </div>
        {sourceError && <p className="reader-muted" role="alert">{sourceError}</p>}
        <footer className="reader-actions">
          <Button className="reader-button" disabled={busy || suggestions === null} onClick={() => void discoverSources()}>重新查找</Button>
          <Button className="reader-button" disabled={busy || !window.webkit?.messageHandlers?.reefRenderer} onClick={() => void associate()}>手动选择文件夹…</Button>
        </footer>
      </Dialog.Popup></Dialog.Portal>
    </Dialog.Root>
    <Dialog.Root open={Boolean(image)} onOpenChange={(open) => { if (!open) setImage(null); }}>
      <Dialog.Portal><Dialog.Backdrop className="reader-backdrop" /><Dialog.Popup className="reader-image-dialog">
        <header><Dialog.Title>{image?.title}</Dialog.Title><Dialog.Close className="reader-button" aria-label="关闭图片">×</Dialog.Close></header>
        <Dialog.Description>第 {image?.sample.episode} 集 · {image?.sample.timestamp} · 原片参考</Dialog.Description>
        {image && <img src={image.url} alt={image.title} />}
        {image && <Button className="reader-button" disabled={!source.videos.some((video) => video.episodeIdx === image.sample.episode - 1)} onClick={() => { play(image.sample.episode - 1, parseScriptTimestamp(image.sample.timestamp) ?? 0); setImage(null); }}>查看此处原片</Button>}
      </Dialog.Popup></Dialog.Portal>
    </Dialog.Root>
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
