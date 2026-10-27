import type { ScriptProject } from "@lingjingai/script-editor";

export type StateEvidenceFrameStatus = "pending" | "ready" | "unavailable";

export interface StateEvidenceSample {
  evidence_id: string;
  episode: number;
  episode_id: string;
  scene_id: string;
  timestamp: string;
  offset_ms: -1000 | 0 | 1000;
  selection: "model" | "target_anchor" | "scene_fallback";
  source_sha256: string;
  frame_path: string;
  frame_status: StateEvidenceFrameStatus;
  error?: string;
}

export interface ActorStateEvidence {
  evidence_id: string;
  asset_kind: "actor";
  actor_id: string;
  actor_name: string;
  state_id: string;
  state_name: string;
  samples: StateEvidenceSample[];
}

/**
 * 人物识别证据：回答“这个人长什么样”，与造型无关。由 scriptctl 跨集筛出清晰脸部或
 * 侧前方半身。version 1 sidecar 尚未提供时可从 `items` 降级；version 2 明确缺失时
 * 保持为空，避免重新引入被严格选帧拒绝的错误人物照。
 */
export interface ActorIdentityEvidence {
  evidence_id: string;
  asset_kind: "actor";
  actor_id: string;
  actor_name: string;
  samples: StateEvidenceSample[];
}

/**
 * 人物视觉图板：由人物识别证据与状态造型证据合成的单张图，`source_evidence_ids`
 * 记录全部来源以便溯源。`origin` 必须显式声明——`ai_summary` 的图板只能作为
 * 标注过的归纳图展示，不得当作原片证据。
 */
export interface ActorVisualBoard {
  board_id: string;
  actor_id: string;
  /** null 表示只含人物识别、不绑定具体造型。 */
  state_id: string | null;
  identity_evidence_id: string | null;
  state_evidence_id: string | null;
  source_evidence_ids: string[];
  frame_path: string;
  frame_status: StateEvidenceFrameStatus;
  origin: "original_frames" | "ai_summary";
  generated_at: string;
}

export interface StateEvidenceManifest {
  version: 1 | 2;
  generated_at: string;
  source_sha256: string;
  items: ActorStateEvidence[];
  /** scriptctl 尚未生成时缺失；读取侧必须容忍并降级。 */
  identities?: ActorIdentityEvidence[];
  boards?: ActorVisualBoard[];
}

export interface StateEvidenceMediaFile {
  id: string;
  framePath: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeEvidencePath(value: unknown, prefix: string): string {
  const normalized = text(value).replaceAll("\\", "/");
  return normalized.startsWith(prefix)
    && !normalized.split("/").includes("..")
    && /\.(?:jpe?g|png|webp)$/i.test(normalized)
    ? normalized
    : "";
}

function safeFramePath(value: unknown): string {
  return safeEvidencePath(value, "evidence/frames/");
}

/** 图板是合成图，落在 evidence/boards/ 而不是抽帧目录。 */
function safeBoardPath(value: unknown): string {
  return safeEvidencePath(value, "evidence/boards/");
}

function frameStatus(value: unknown): StateEvidenceFrameStatus | null {
  return value === "pending" || value === "ready" || value === "unavailable" ? value : null;
}

function parseTimestampSeconds(value: string): number | null {
  const parts = value.replace(/^\[|\]$/g, "").split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts.at(-1)! >= 60) return null;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts[1]! >= 60) return null;
  return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
}

function parseEvidenceSamples(value: unknown): StateEvidenceSample[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((sampleCandidate): StateEvidenceSample[] => {
    const sample = record(sampleCandidate);
    if (!sample) return [];
    const sampleEvidenceId = text(sample.evidence_id);
    const episode = Number(sample.episode);
    const episodeId = text(sample.episode_id);
    const sceneId = text(sample.scene_id);
    const timestamp = text(sample.timestamp);
    const offsetMs = sample.offset_ms === -1000 || sample.offset_ms === 1000 ? sample.offset_ms : 0;
    const selection = sample.selection === "model" || sample.selection === "target_anchor" || sample.selection === "scene_fallback"
      ? sample.selection
      : null;
    const sourceSha256 = text(sample.source_sha256);
    const framePath = safeFramePath(sample.frame_path);
    const status = frameStatus(sample.frame_status);
    if (!sampleEvidenceId || !Number.isInteger(episode) || episode < 1 || !episodeId || !sceneId
      || parseTimestampSeconds(timestamp) === null || !selection || !sourceSha256 || !framePath || !status) return [];
    return [{
      evidence_id: sampleEvidenceId,
      episode,
      episode_id: episodeId,
      scene_id: sceneId,
      timestamp,
      offset_ms: offsetMs,
      selection,
      source_sha256: sourceSha256,
      frame_path: framePath,
      frame_status: status,
      ...(text(sample.error) ? { error: text(sample.error) } : {}),
    }];
  });
}

function parseActorIdentities(value: unknown): ActorIdentityEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): ActorIdentityEvidence[] => {
    const item = record(candidate);
    if (!item || item.asset_kind !== "actor") return [];
    const evidenceId = text(item.evidence_id);
    const actorId = text(item.actor_id);
    const actorName = text(item.actor_name);
    if (!evidenceId || !actorId || !actorName) return [];
    const samples = parseEvidenceSamples(item.samples);
    return samples.length > 0
      ? [{ evidence_id: evidenceId, asset_kind: "actor", actor_id: actorId, actor_name: actorName, samples }]
      : [];
  });
}

function parseVisualBoards(value: unknown): ActorVisualBoard[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): ActorVisualBoard[] => {
    const item = record(candidate);
    if (!item) return [];
    const boardId = text(item.board_id);
    const actorId = text(item.actor_id);
    const framePath = safeBoardPath(item.frame_path);
    const status = frameStatus(item.frame_status);
    // origin 必须显式声明：无法判断来源的图板一律丢弃，避免 AI 归纳图被当成原片证据。
    const origin = item.origin === "original_frames" || item.origin === "ai_summary" ? item.origin : null;
    if (!boardId || !actorId || !framePath || !status || !origin) return [];
    const sourceEvidenceIds = Array.isArray(item.source_evidence_ids)
      ? item.source_evidence_ids.map((entry) => text(entry)).filter(Boolean)
      : [];
    if (sourceEvidenceIds.length === 0) return [];
    return [{
      board_id: boardId,
      actor_id: actorId,
      state_id: text(item.state_id) || null,
      identity_evidence_id: text(item.identity_evidence_id) || null,
      state_evidence_id: text(item.state_evidence_id) || null,
      source_evidence_ids: sourceEvidenceIds,
      frame_path: framePath,
      frame_status: status,
      origin,
      generated_at: text(item.generated_at),
    }];
  });
}

export function parseStateEvidenceManifest(raw: string): StateEvidenceManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const root = record(value);
  if (!root || (root.version !== 1 && root.version !== 2) || !Array.isArray(root.items)) return null;
  const items = root.items.flatMap((candidate): ActorStateEvidence[] => {
    const item = record(candidate);
    if (!item || item.asset_kind !== "actor" || !Array.isArray(item.samples)) return [];
    const evidenceId = text(item.evidence_id);
    const actorId = text(item.actor_id);
    const actorName = text(item.actor_name);
    const stateId = text(item.state_id);
    const stateName = text(item.state_name);
    if (!evidenceId || !actorId || !actorName || !stateId || !stateName) return [];
    return [{
      evidence_id: evidenceId,
      asset_kind: "actor",
      actor_id: actorId,
      actor_name: actorName,
      state_id: stateId,
      state_name: stateName,
      samples: parseEvidenceSamples(item.samples),
    }];
  }).filter((item) => item.samples.length > 0);
  const identities = parseActorIdentities(root.identities);
  const boards = parseVisualBoards(root.boards);
  return {
    version: root.version,
    generated_at: text(root.generated_at),
    source_sha256: text(root.source_sha256),
    items,
    ...(identities.length > 0 ? { identities } : {}),
    ...(boards.length > 0 ? { boards } : {}),
  };
}

/**
 * 收集 sidecar 中所有可展示媒体。人物识别照和图板不是 `items` 的子项，宿主不能只
 * 遍历状态样本，否则悬停卡能选中证据却拿不到 URL。
 */
export function stateEvidenceMediaFiles(
  manifest: StateEvidenceManifest,
): StateEvidenceMediaFile[] {
  const byId = new Map<string, StateEvidenceMediaFile>();
  const add = (id: string, framePath: string, status: StateEvidenceFrameStatus) => {
    if (status !== "ready" || !id || !framePath || byId.has(id)) return;
    byId.set(id, { id, framePath });
  };
  for (const item of manifest.items) {
    for (const sample of item.samples) add(sample.evidence_id, sample.frame_path, sample.frame_status);
  }
  for (const identity of manifest.identities ?? []) {
    for (const sample of identity.samples) add(sample.evidence_id, sample.frame_path, sample.frame_status);
  }
  for (const board of manifest.boards ?? []) {
    add(board.board_id, board.frame_path, board.frame_status);
  }
  return [...byId.values()];
}

function normalizedEntityName(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s_\-—·・.]+/g, "");
}

/**
 * 剧本校准可能合并人物或造型，但原片抽帧是可复用证据，不应因此删除。读取时只做
 * “唯一精确名称/别名”重挂：有歧义就保持原 ID，随后由分组逻辑隐藏，绝不猜测。
 */
export function reconcileStateEvidenceManifest(
  manifest: StateEvidenceManifest,
  document: ScriptProject,
): StateEvidenceManifest {
  const actors = (document.actors ?? []).flatMap((actor) => {
    const actorId = actor.actor_id?.trim();
    if (!actorId) return [];
    const aliases = "aliases" in actor && Array.isArray(actor.aliases)
      ? actor.aliases.filter((value): value is string => typeof value === "string")
      : [];
    return [{ actor, actorId, names: [actor.actor_name, actor.name, ...aliases]
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      .map(normalizedEntityName) }];
  });
  const byActorId = new Map(actors.map((entry) => [entry.actorId, entry] as const));
  const resolveActor = (actorId: string, actorName: string) => {
    const current = byActorId.get(actorId);
    if (current) return current;
    const name = normalizedEntityName(actorName);
    const candidates = actors.filter((entry) => entry.names.includes(name));
    return candidates.length === 1 ? candidates[0]! : null;
  };
  const stateFor = (
    actorEntry: (typeof actors)[number],
    stateId: string,
    stateName: string,
  ) => {
    const states = Array.isArray(actorEntry.actor.states) ? actorEntry.actor.states : [];
    const current = states.find((state) => state.state_id?.trim() === stateId);
    if (current) return current;
    const name = normalizedEntityName(stateName);
    const candidates = states.filter((state) => normalizedEntityName(
      state.state_name?.trim() || state.name?.trim() || "",
    ) === name);
    return candidates.length === 1 ? candidates[0]! : null;
  };

  const itemBindings = new Map<string, { actorId: string; stateId: string }>();
  const items = manifest.items.map((item) => {
    const actorEntry = resolveActor(item.actor_id, item.actor_name);
    if (!actorEntry) return item;
    const state = stateFor(actorEntry, item.state_id, item.state_name);
    const actorName = actorEntry.actor.actor_name?.trim() || actorEntry.actor.name?.trim() || item.actor_name;
    const stateId = state?.state_id?.trim() || item.state_id;
    const stateName = state?.state_name?.trim() || state?.name?.trim() || item.state_name;
    itemBindings.set(item.evidence_id, { actorId: actorEntry.actorId, stateId });
    return { ...item, actor_id: actorEntry.actorId, actor_name: actorName, state_id: stateId, state_name: stateName };
  });
  const identities = manifest.identities?.map((identity) => {
    const actorEntry = resolveActor(identity.actor_id, identity.actor_name);
    return actorEntry ? {
      ...identity,
      actor_id: actorEntry.actorId,
      actor_name: actorEntry.actor.actor_name?.trim() || actorEntry.actor.name?.trim() || identity.actor_name,
    } : identity;
  });
  const boards = manifest.boards?.map((board) => {
    const binding = board.state_evidence_id ? itemBindings.get(board.state_evidence_id) : null;
    if (binding) return { ...board, actor_id: binding.actorId, state_id: binding.stateId };
    const actorEntry = resolveActor(board.actor_id, "");
    return actorEntry ? { ...board, actor_id: actorEntry.actorId } : board;
  });
  return { ...manifest, items, ...(identities ? { identities } : {}), ...(boards ? { boards } : {}) };
}
