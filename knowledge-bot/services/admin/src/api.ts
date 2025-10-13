export interface SourceInput {
  tenantId: string;
  type: "url" | "pdf" | "text" | "csv" | "sitemap";
  value: string;
  embeddingProvider: string;
  metadata?: Record<string, unknown>;
}

export interface SourceRecord {
  id: string;
  tenantId: string;
  type: SourceInput["type"];
  value: string;
  embeddingProvider: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
  lastTriggeredAt?: string;
  lastIngestAt?: string;
  ingestStatus?: string;
  ingestError?: string | null;
}

export interface ClientOpts {
  gatewayUrl: string;
  adminToken: string;
  tenantId?: string;
  authMode?: "token" | "jwt";
}

function adminHeaders(token: string, mode: "token" | "jwt") {
  if (mode === "jwt") {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    } as Record<string, string>;
  }
  return {
    "Content-Type": "application/json",
    "X-Admin-Token": token,
  } as Record<string, string>;
}

export interface ListParams extends ClientOpts {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface PaginatedSources {
  sources: SourceRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pages: number;
  };
}

export async function listSources(opts: ListParams) {
  const mode = opts.authMode || "token";
  const url = new URL("/admin/sources", opts.gatewayUrl);
  if (opts.tenantId) url.searchParams.set("tenantId", opts.tenantId);
  if (opts.page) url.searchParams.set("page", String(opts.page));
  if (opts.pageSize) url.searchParams.set("pageSize", String(opts.pageSize));
  if (opts.search) url.searchParams.set("search", opts.search);

  const res = await fetch(url.toString(), {
    headers: adminHeaders(opts.adminToken, mode),
  });
  if (!res.ok) {
    throw new Error(`Failed to list sources: ${res.status}`);
  }
  return res.json() as Promise<PaginatedSources>;
}

export async function createSource(opts: { gatewayUrl: string; adminToken: string; authMode?: "token" | "jwt"; input: SourceInput }) {
  const mode = opts.authMode || "token";
  const res = await fetch(new URL("/admin/sources", opts.gatewayUrl).toString(), {
    method: "POST",
    headers: adminHeaders(opts.adminToken, mode),
    body: JSON.stringify(opts.input),
  });
  if (!res.ok) {
    throw new Error(`Failed to create source: ${res.status}`);
  }
  return res.json() as Promise<{ source: SourceRecord; error?: string }>;
}

export async function updateSourceApi(opts: { gatewayUrl: string; adminToken: string; authMode?: "token" | "jwt"; id: string; patch: Record<string, unknown> }) {
  const mode = opts.authMode || "token";
  const res = await fetch(new URL(`/admin/sources/${opts.id}`, opts.gatewayUrl).toString(), {
    method: "PATCH",
    headers: adminHeaders(opts.adminToken, mode),
    body: JSON.stringify(opts.patch),
  });
  if (!res.ok) {
    throw new Error(`Failed to update source: ${res.status}`);
  }
  return res.json() as Promise<{ source: SourceRecord; error?: string }>;
}

export async function deleteSource(opts: { gatewayUrl: string; adminToken: string; authMode?: "token" | "jwt"; id: string }) {
  const mode = opts.authMode || "token";
  const res = await fetch(new URL(`/admin/sources/${opts.id}`, opts.gatewayUrl).toString(), {
    method: "DELETE",
    headers: adminHeaders(opts.adminToken, mode),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete source: ${res.status}`);
  }
}

export interface AnalyticsRow {
  tenantId: string;
  sourceCount: number;
  lastIngestAt?: string;
  docCount: number;
}

export interface HistoryEntry {
  sourceId: string;
  triggeredAt: string;
  status: string;
  detail?: string;
}

export interface HistoryPoint {
  date: string;
  count: number;
}

export interface AnalyticsResponse {
  analytics: AnalyticsRow[];
  history?: HistoryEntry[];
  series?: HistoryPoint[];
}

export async function fetchAnalytics(
  opts: ClientOpts & { tenantId?: string; historyLimit?: number; seriesDays?: number }
): Promise<AnalyticsResponse> {
  const mode = opts.authMode || "token";
  const url = new URL("/admin/analytics", opts.gatewayUrl);
  if (opts.tenantId) url.searchParams.set("tenantId", opts.tenantId);
  if (opts.historyLimit) url.searchParams.set("limit", String(opts.historyLimit));
  if (opts.seriesDays) url.searchParams.set("days", String(opts.seriesDays));
  const res = await fetch(url.toString(), {
    headers: adminHeaders(opts.adminToken, mode),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch analytics: ${res.status}`);
  }
  return res.json() as Promise<AnalyticsResponse>;
}


export interface TenantConfig { tenantId: string; allowKeywords: string[]; denyKeywords: string[]; contextLimit?: number | null; }

export async function getTenantConfig(opts: ClientOpts & { tenantId: string }): Promise<{ config: TenantConfig }> {
  const mode = opts.authMode || "token";
  const url = new URL(`/admin/config?tenantId=${opts.tenantId}`, opts.gatewayUrl);
  const res = await fetch(url.toString(), { headers: adminHeaders(opts.adminToken, mode) });
  if (!res.ok) throw new Error(`Failed to fetch tenant config: ${res.status}`);
  return res.json();
}

export async function updateTenantConfig(opts: ClientOpts & { config: TenantConfig }): Promise<{ config: TenantConfig }> {
  const mode = opts.authMode || "token";
  const res = await fetch(new URL("/admin/config", opts.gatewayUrl).toString(), {
    method: "PUT",
    headers: adminHeaders(opts.adminToken, mode),
    body: JSON.stringify(opts.config),
  });
  if (!res.ok) throw new Error(`Failed to update tenant config: ${res.status}`);
  return res.json();
}
