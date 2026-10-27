export const translationTargets = ["zh-Hans", "en", "ja", "ko"] as const;
export type TranslationTarget = typeof translationTargets[number];
export type TranslationResult =
  | { status: "translated"; translation: string }
  | { status: "skipped" }
  | { status: "not-installed"; sourceLanguage: string; targetLanguage: string }
  | { status: "unsupported" | "error" };

export interface TranslateDialogueRequest {
  targetLanguage: TranslationTarget;
  texts: string[];
}
