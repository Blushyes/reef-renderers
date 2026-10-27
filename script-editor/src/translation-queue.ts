import type { ScriptItem } from "@lingjingai/script-editor";
import type { TranslationResult } from "./translation-types";

export function dialogueTexts(action: ScriptItem): string[] {
  if (action.type !== "dialogue" && action.type !== "inner_thought") return [];
  return (action.lines?.length ? action.lines.map((line) => line.content) : [action.content])
    .filter((text): text is string => typeof text === "string" && text.trim().length > 0);
}

export class TranslationQueue {
  private results = new Map<string, TranslationResult>();
  private listeners = new Map<string, Set<() => void>>();
  private queued = new Set<string>();
  private requested = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private translate: (texts: string[]) => Promise<TranslationResult[]>) {}
  get(text: string) { return this.results.get(text); }
  retryUnavailable() {
    for (const [text, result] of this.results) {
      if (result.status === "translated" || result.status === "skipped") continue;
      this.results.delete(text);
      this.requested.delete(text);
      if (this.listeners.has(text)) {
        this.queued.add(text);
        this.listeners.get(text)!.forEach((listener) => listener());
      }
    }
    if (this.queued.size) this.timer ??= setTimeout(() => this.flush(), 50);
  }
  subscribe(text: string, listener: () => void) {
    const listeners = this.listeners.get(text) ?? new Set();
    listeners.add(listener);
    this.listeners.set(text, listeners);
    if (!this.requested.has(text)) {
      this.queued.add(text);
      this.timer ??= setTimeout(() => this.flush(), 50);
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        this.listeners.delete(text);
        this.queued.delete(text);
      }
    };
  }
  private flush() {
    this.timer = undefined;
    const texts = [...this.queued];
    this.queued.clear();
    for (let i = 0; i < texts.length; i += 50) {
      const batch = texts.slice(i, i + 50);
      batch.forEach((text) => this.requested.add(text));
      void this.translate(batch).catch(() => batch.map((): TranslationResult => ({ status: "error" }))).then((results) => {
        batch.forEach((text, index) => {
          this.results.set(text, results[index]);
          this.listeners.get(text)?.forEach((listener) => listener());
        });
      });
    }
  }
}
