

export function parseScriptTimestamp(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;

  const normalized = value.trim().replace(/^\[|\]$/g, "");
  if (!normalized) return null;
  const parts = normalized.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0) || parts.length > 3) return null;

  if (parts.length === 1) return parts[0];
  if (parts.at(-1)! >= 60) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts[1] >= 60) return null;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}
