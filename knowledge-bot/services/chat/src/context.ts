export interface RetrievalHit {
  payload?: {
    title?: string;
    url?: string;
    text?: string;
  };
}

export function buildContext(hits: RetrievalHit[], limit?: number | null) {
  const max =
    typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? limit : Number.POSITIVE_INFINITY;
  let remaining = max;
  const unlimited = !Number.isFinite(remaining);
  const parts: string[] = [];

  for (let i = 0; i < hits.length; i += 1) {
    if (!unlimited && remaining <= 0) break;
    const hit = hits[i];
    const title = hit?.payload?.title ?? "";
    const url = hit?.payload?.url ?? "";
    const text = hit?.payload?.text ?? "";
    const headerContent = [title, url].filter(Boolean).join(" ").trim();
    const header = headerContent ? `[#${i + 1}] ${headerContent}\n` : "";

    if (unlimited) {
      parts.push(`${header}${text}`);
      continue;
    }

    const available = Math.max(0, remaining - header.length);
    if (available <= 0) break;
    const snippet = text.slice(0, available);
    parts.push(`${header}${snippet}`);
    remaining -= header.length + snippet.length;
  }

  return parts.join("\n\n").trim();
}
