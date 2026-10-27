import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NativeTranslator } from "./native-translator.js";
import type { TranslateDialogueRequest, TranslationResult, TranslationTarget } from "./translation-types.js";

export function translationCacheKey(target: TranslationTarget, text: string) {
  return `${target}-${createHash("sha256").update(text).digest("hex")}`;
}

export class DialogueTranslationService {
  private inflight = new Map<string, Promise<TranslationResult>>();
  constructor(private options: {
    platform: string;
    native: Pick<NativeTranslator, "translate">;
  }) {}

  async translate(root: string, request: TranslateDialogueRequest): Promise<TranslationResult[]> {
    const directory = path.join(root, ".cache", "dialogue-translation");
    const missing: { text: string; key: string; resolve: (value: TranslationResult) => void }[] = [];
    const results = request.texts.map((text) => {
      const key = translationCacheKey(request.targetLanguage, text);
      const pendingKey = `${directory}/${key}`;
      const existing = this.inflight.get(pendingKey);
      if (existing) return existing;
      const promise = new Promise<TranslationResult>((resolve) => missing.push({ text, key, resolve }));
      this.inflight.set(pendingKey, promise);
      void promise.finally(() => this.inflight.delete(pendingKey));
      return promise;
    });
    if (missing.length) void (async () => {
      const uncached: typeof missing = [];
      for (const item of missing) {
        try { item.resolve(JSON.parse(await readFile(path.join(directory, `${item.key}.json`), "utf8"))); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          uncached.push(item);
        }
      }
      if (!uncached.length) return;
      const texts = uncached.map((item) => item.text);
      let translated: TranslationResult[];
      if (this.options.platform === "darwin") {
        translated = await this.options.native.translate(texts, request.targetLanguage).catch(() => texts.map(() => ({ status: "error" as const })));
      } else translated = texts.map(() => ({ status: "unsupported" }));
      await mkdir(directory, { recursive: true });
      await Promise.all(uncached.map(async (item, i) => {
        const result = translated[i];
        if (result.status === "translated" || result.status === "skipped") {
          await writeFile(path.join(directory, `${item.key}.json`), JSON.stringify(result), "utf8");
        }
        item.resolve(result);
      }));
    })().catch(() => missing.forEach((item) => item.resolve({ status: "error" })));
    return Promise.all(results);
  }
}
