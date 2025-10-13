import fetch from "node-fetch";
import { db } from "../db.js";

const qdrantUrl = process.env.QDRANT_URL || "http://qdrant:6333";

export interface TenantAnalytics {
  tenantId: string;
  sourceCount: number;
  lastIngestAt?: string;
  docCount: number;
}

export interface TenantHistory {
  sourceId: string;
  triggeredAt: string;
  status: string;
  detail?: string;
}

export interface HistoryPoint {
  date: string;
  count: number;
}

async function countDocs(tenantId: string) {
  try {
    const res = await fetch(`${qdrantUrl}/collections/docs_${tenantId}/points/count`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exact: false }),
    });
    if (!res.ok) return 0;
    const data: any = await res.json();
    return data?.result?.count ?? 0;
  } catch {
    return 0;
  }
}

export async function computeAnalytics(): Promise<TenantAnalytics[]> {
  const rows = db.prepare(
    `SELECT tenant_id, COUNT(*) AS sourceCount, MAX(COALESCE(last_ingest_at, last_triggered_at)) AS lastIngestAt FROM sources GROUP BY tenant_id`
  ).all() as any[];
  const analytics: TenantAnalytics[] = [];
  for (const row of rows) {
    const docCount = await countDocs(row.tenant_id);
    analytics.push({
      tenantId: row.tenant_id,
      sourceCount: row.sourceCount,
      lastIngestAt: row.lastIngestAt ?? undefined,
      docCount,
    });
  }
  return analytics;
}

export function fetchHistory(tenantId: string, limit = 20): TenantHistory[] {
  const rows = db
    .prepare(
      `SELECT source_id, triggered_at, status, detail FROM ingest_history WHERE tenant_id = ? ORDER BY triggered_at DESC LIMIT ?`
    )
    .all(tenantId, limit) as any[];
  return rows.map((row) => ({
    sourceId: row.source_id,
    triggeredAt: row.triggered_at,
    status: row.status,
    detail: row.detail ?? undefined,
  }));
}

export function fetchHistorySeries(tenantId: string, days = 14): HistoryPoint[] {
  const cutoff = new Date(Date.now() - Math.max(days - 1, 0) * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT substr(triggered_at, 1, 10) AS day, COUNT(*) AS count
       FROM ingest_history
       WHERE tenant_id = ? AND triggered_at >= ?
       GROUP BY day
       ORDER BY day ASC`
    )
    .all(tenantId, cutoff) as any[];

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.day, Number(row.count) || 0);
  }

  const result: HistoryPoint[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return result;
}
