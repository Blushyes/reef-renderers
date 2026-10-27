import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import type { TranslationResult, TranslationTarget } from "./translation-types.js";

export function parseNativeResponse(line: string): { id: string; index: number; result: TranslationResult } {
  const value = JSON.parse(line);
  if (!value || typeof value.id !== "string" || !Number.isInteger(value.index) || value.index < 0) {
    throw new Error("翻译程序响应无效");
  }
  const { id, index, status } = value;
  if (status === "translated" && typeof value.translation === "string") {
    return { id, index, result: { status, translation: value.translation } };
  }
  if (status === "not-installed" && typeof value.sourceLanguage === "string" && typeof value.targetLanguage === "string") {
    return { id, index, result: { status, sourceLanguage: value.sourceLanguage, targetLanguage: value.targetLanguage } };
  }
  if (status === "skipped" || status === "unsupported" || status === "error") return { id, index, result: { status } };
  throw new Error("翻译程序响应无效");
}

export class NativeTranslator {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, {
    results: Map<number, TranslationResult>;
    count: number;
    resolve: (results: TranslationResult[]) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(private executable: string) {}

  translate(texts: string[], targetLanguage: TranslationTarget): Promise<TranslationResult[]> {
    if (!texts.length) return Promise.resolve([]);
    if (!this.child) {
      const child = spawn(this.executable, [], { stdio: "pipe" });
      this.child = child;
      child.stderr.resume();
      child.once("error", () => { if (this.child === child) this.stop(); });
      child.once("exit", () => { if (this.child === child) this.stop(); });
      createInterface({ input: child.stdout }).on("line", (line) => {
        try {
          const { id, index, result } = parseNativeResponse(line);
          const pending = this.pending.get(id);
          if (!pending || index >= pending.count || pending.results.has(index)) throw new Error("翻译响应序号无效");
          pending.results.set(index, result);
          if (pending.results.size === pending.count) {
            clearTimeout(pending.timer);
            this.pending.delete(id);
            pending.resolve(Array.from({ length: pending.count }, (_, i) => pending.results.get(i)!));
          }
        } catch { this.stop(); }
      });
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop(), 120_000);
      this.pending.set(id, { results: new Map(), count: texts.length, resolve, reject, timer });
      this.child!.stdin.write(`${JSON.stringify({ id, targetLanguage, texts })}\n`, (error) => {
        if (error) this.stop();
      });
    });
  }

  stop() {
    const child = this.child;
    this.child = null;
    child?.kill();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("本机翻译暂不可用"));
    }
    this.pending.clear();
  }
}
