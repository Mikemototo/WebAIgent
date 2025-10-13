import { db } from "../db.js";

export interface TenantConfig {
  tenantId: string;
  allowKeywords: string[];
  denyKeywords: string[];
  contextLimit?: number;
}

export function getTenantConfig(tenantId: string): TenantConfig {
  const row = db.prepare(`SELECT tenant_id, allow_keywords, deny_keywords, context_limit FROM tenants WHERE tenant_id = ?`).get(tenantId) as any;
  if (!row) {
    return { tenantId, allowKeywords: [], denyKeywords: [], contextLimit: undefined };
  }
  return {
    tenantId: row.tenant_id,
    allowKeywords: row.allow_keywords ? JSON.parse(row.allow_keywords) : [],
    denyKeywords: row.deny_keywords ? JSON.parse(row.deny_keywords) : [],
    contextLimit: row.context_limit ?? undefined,
  };
}

export function upsertTenantConfig(config: TenantConfig) {
  db.prepare(
    `INSERT INTO tenants (tenant_id, allow_keywords, deny_keywords, context_limit)
     VALUES (@tenant_id, @allow_keywords, @deny_keywords, @context_limit)
     ON CONFLICT(tenant_id) DO UPDATE SET allow_keywords=@allow_keywords, deny_keywords=@deny_keywords, context_limit=@context_limit`
  ).run({
    tenant_id: config.tenantId,
    allow_keywords: JSON.stringify(config.allowKeywords || []),
    deny_keywords: JSON.stringify(config.denyKeywords || []),
    context_limit: config.contextLimit ?? null,
  });
}
