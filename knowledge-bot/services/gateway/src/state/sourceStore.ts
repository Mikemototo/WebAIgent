import { db, serializeMetadata, deserializeMetadata } from "../db.js";

export type SourceType = "url" | "pdf" | "text" | "csv" | "sitemap";

export type IngestStatus = "pending" | "processing" | "ready" | "error";

export interface SourceRecord {
  id: string;
  tenantId: string;
  type: SourceType;
  value: string;
  embeddingProvider: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
  lastTriggeredAt?: string;
  lastIngestAt?: string;
  ingestStatus?: IngestStatus;
  ingestError?: string | null;
}

export interface ListOptions {
  tenantId?: string;
  search?: string;
  offset?: number;
  limit?: number;
}

function mapRow(row: any): SourceRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    value: row.value,
    embeddingProvider: row.embedding_provider,
    metadata: deserializeMetadata(row.metadata) ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    lastTriggeredAt: row.last_triggered_at ?? undefined,
    lastIngestAt: row.last_ingest_at ?? undefined,
    ingestStatus: row.ingest_status ?? undefined,
    ingestError: row.ingest_error ?? undefined,
  };
}

export async function listSources(options: ListOptions = {}) {
  const { tenantId, search, offset = 0, limit = 20 } = options;
  const params: any[] = [];
  const where: string[] = [];
  if (tenantId) {
    where.push("tenant_id = ?");
    params.push(tenantId);
  }
  if (search) {
    where.push("(value LIKE ? OR IFNULL(metadata, '') LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalStmt = db.prepare(`SELECT COUNT(*) AS total FROM sources ${whereClause}`);
  const totalRow = totalStmt.get(...params) as any;
  const total = totalRow ? (totalRow.total as number) : 0;

  const rows = db
    .prepare(`SELECT * FROM sources ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as any[];

  return {
    total,
    items: rows.map(mapRow),
  };
}

export async function addSource(record: SourceRecord) {
  db.prepare(
    `INSERT INTO sources (id, tenant_id, type, value, embedding_provider, metadata, created_at, updated_at, last_triggered_at, last_ingest_at, ingest_status, ingest_error)
     VALUES (@id, @tenant_id, @type, @value, @embedding_provider, @metadata, @created_at, @updated_at, @last_triggered_at, @last_ingest_at, @ingest_status, @ingest_error)`
  ).run({
    id: record.id,
    tenant_id: record.tenantId,
    type: record.type,
    value: record.value,
    embedding_provider: record.embeddingProvider,
    metadata: serializeMetadata(record.metadata) ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt ?? null,
    last_triggered_at: record.lastTriggeredAt ?? null,
    last_ingest_at: record.lastIngestAt ?? null,
    ingest_status: record.ingestStatus ?? null,
    ingest_error: record.ingestError ?? null,
  });
  return record;
}

export async function updateSource(id: string, patch: Partial<Omit<SourceRecord, "id" | "createdAt">>) {
  const existing = db.prepare("SELECT * FROM sources WHERE id = ?").get(id) as any;
  if (!existing) return null;
  const updated: SourceRecord = {
    id: existing.id,
    tenantId: existing.tenant_id,
    type: (patch.type ?? existing.type) as SourceType,
    value: patch.value ?? existing.value,
    embeddingProvider: patch.embeddingProvider ?? existing.embedding_provider,
    metadata: patch.metadata ?? deserializeMetadata(existing.metadata) ?? undefined,
    createdAt: existing.created_at,
    updatedAt: new Date().toISOString(),
    lastTriggeredAt: patch.lastTriggeredAt ?? existing.last_triggered_at ?? undefined,
    lastIngestAt: patch.lastIngestAt ?? existing.last_ingest_at ?? undefined,
    ingestStatus: patch.ingestStatus ?? existing.ingest_status ?? undefined,
    ingestError: patch.ingestError ?? existing.ingest_error ?? undefined,
  };
  db.prepare(
    `UPDATE sources SET type=@type, value=@value, embedding_provider=@embedding_provider, metadata=@metadata, updated_at=@updated_at, last_triggered_at=@last_triggered_at, last_ingest_at=@last_ingest_at, ingest_status=@ingest_status, ingest_error=@ingest_error WHERE id=@id`
  ).run({
    id: updated.id,
    type: updated.type,
    value: updated.value,
    embedding_provider: updated.embeddingProvider,
    metadata: serializeMetadata(updated.metadata) ?? null,
    updated_at: updated.updatedAt,
    last_triggered_at: updated.lastTriggeredAt ?? null,
    last_ingest_at: updated.lastIngestAt ?? null,
    ingest_status: updated.ingestStatus ?? null,
    ingest_error: updated.ingestError ?? null,
  });
  return updated;
}

export async function removeSource(id: string) {
  const res = db.prepare("DELETE FROM sources WHERE id = ?").run(id);
  db.prepare("DELETE FROM ingest_history WHERE source_id = ?").run(id);
  return res.changes > 0;
}

export function getSource(id: string): SourceRecord | null {
  const row = db.prepare("SELECT * FROM sources WHERE id = ?").get(id) as any;
  return row ? mapRow(row) : null;
}

export function getAllSources(): SourceRecord[] {
  const rows = db.prepare("SELECT * FROM sources ORDER BY created_at DESC").all() as any[];
  return rows.map(mapRow);
}

export async function updateIngestStatus(id: string, status: IngestStatus, detail: string | null, opts: { startedAt?: string; completedAt?: string } = {}) {
  const existing = getSource(id);
  if (!existing) return;
  const updated: Partial<SourceRecord> = {
    ingestStatus: status,
    ingestError: detail ?? null,
    lastTriggeredAt: opts.startedAt ?? existing.lastTriggeredAt,
    lastIngestAt: opts.completedAt ?? existing.lastIngestAt,
  };
  await updateSource(id, updated);
}

export async function recordHistory(sourceId: string, tenantId: string, status: IngestStatus, detail?: string) {
  const ts = new Date().toISOString();
  db.prepare(`INSERT INTO ingest_history (source_id, tenant_id, triggered_at, status, detail) VALUES (?, ?, ?, ?, ?)`)
    .run(sourceId, tenantId, ts, status, detail ?? null);
  db.prepare(`UPDATE sources SET last_triggered_at = ?, updated_at = ? WHERE id = ?`).run(ts, ts, sourceId);
}

export async function listHistory(tenantId: string, limit = 20) {
  const rows = db
    .prepare(
      `SELECT source_id, tenant_id, triggered_at, status, detail FROM ingest_history WHERE tenant_id = ? ORDER BY triggered_at DESC LIMIT ?`
    )
    .all(tenantId, limit) as any[];
  return rows.map((row) => ({
    sourceId: row.source_id,
    tenantId: row.tenant_id,
    triggeredAt: row.triggered_at,
    status: row.status,
    detail: row.detail ?? undefined,
  }));
}
