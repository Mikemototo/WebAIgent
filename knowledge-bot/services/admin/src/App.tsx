import { useCallback, useEffect, useMemo, useState, DragEvent } from "react";
import {
  listSources,
  createSource,
  deleteSource,
  updateSourceApi,
  fetchAnalytics,
  getTenantConfig,
  updateTenantConfig,
  SourceInput,
  SourceRecord,
  AnalyticsRow,
  HistoryEntry,
} from "./api";
import { Pagination } from "./components/Pagination";

const DEFAULT_GATEWAY = "http://localhost:8787";
const DEFAULT_EMBED_PROVIDER = (import.meta.env.VITE_DEFAULT_EMBED_PROVIDER || "local").toLowerCase() === "cloud" ? "gemini" : "ollama";
const DEFAULT_INTERNAL_CRAWL_DEPTH = Number(import.meta.env.VITE_DEFAULT_INTERNAL_CRAWL_DEPTH ?? "0");
const DEFAULT_EXTERNAL_CRAWL_DEPTH = Number(import.meta.env.VITE_DEFAULT_EXTERNAL_CRAWL_DEPTH ?? "0");

type FormState = SourceInput & {
  internalCrawlDepth: string;
  externalCrawlDepth: string;
};

const emptyForm: FormState = {
  tenantId: "TENANT_123",
  type: "url",
  value: "",
  embeddingProvider: DEFAULT_EMBED_PROVIDER,
  metadata: {},
  internalCrawlDepth: String(DEFAULT_INTERNAL_CRAWL_DEPTH),
  externalCrawlDepth: String(DEFAULT_EXTERNAL_CRAWL_DEPTH),
};

function App() {
  const [gatewayUrl, setGatewayUrl] = useState(() => window.localStorage.getItem("gatewayUrl") || DEFAULT_GATEWAY);
  const [adminToken, setAdminToken] = useState(() => window.localStorage.getItem("adminToken") || "");
  const [tenantId, setTenantId] = useState(() => window.localStorage.getItem("adminTenant") || "TENANT_123");
  const [authMode, setAuthMode] = useState<"token" | "jwt">(() => (window.localStorage.getItem("adminAuthMode") as "token" | "jwt") || "token");

  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsRow[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [series, setSeries] = useState<{ date: string; count: number }[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...emptyForm, tenantId });
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreviewName, setCsvPreviewName] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tenantAllow, setTenantAllow] = useState("");
  const [tenantDeny, setTenantDeny] = useState("");
  const [tenantContextLimit, setTenantContextLimit] = useState("");
  const [configSaving, setConfigSaving] = useState(false);
  const [configMessage, setConfigMessage] = useState<{ text: string; variant: "success" | "error" } | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);

  const headersValid = useMemo(() => Boolean(adminToken && tenantId && gatewayUrl), [adminToken, tenantId, gatewayUrl]);

  const persistPrefs = useCallback(() => {
    window.localStorage.setItem("gatewayUrl", gatewayUrl);
    window.localStorage.setItem("adminToken", adminToken);
    window.localStorage.setItem("adminTenant", tenantId);
    window.localStorage.setItem("adminAuthMode", authMode);
  }, [gatewayUrl, adminToken, tenantId, authMode]);

  const refresh = useCallback(async () => {
    if (!headersValid) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listSources({ gatewayUrl, adminToken, tenantId, page, pageSize, search, authMode });
      setSources(data.sources);
      setTotal(data.pagination.total);
    } catch (err) {
      console.error(err);
      setError("Failed to load sources");
    } finally {
      setLoading(false);
    }
  }, [gatewayUrl, adminToken, tenantId, headersValid, page, pageSize, search, authMode]);

  const loadAnalytics = useCallback(async () => {
    if (!headersValid) return;
    try {
      const data = await fetchAnalytics({ gatewayUrl, adminToken, authMode, tenantId, historyLimit: 20, seriesDays: 14 });
      setAnalytics(data.analytics);
      setHistory(data.history || []);
      setSeries(data.series || []);
    } catch (err) {
      console.error(err);
    }
  }, [gatewayUrl, adminToken, authMode, headersValid, tenantId]);

  const loadTenantConfig = useCallback(async () => {
    if (!headersValid || !tenantId) return;
    try {
      const data = await getTenantConfig({ gatewayUrl, adminToken, authMode, tenantId });
      setTenantAllow((data.config.allowKeywords || []).join(", "));
      setTenantDeny((data.config.denyKeywords || []).join(", "));
      setTenantContextLimit(
        data.config.contextLimit === null || data.config.contextLimit === undefined
          ? ""
          : String(data.config.contextLimit)
      );
      setConfigMessage(null);
    } catch (err) {
      console.error(err);
      setConfigMessage({ text: "Failed to load tenant guardrails", variant: "error" });
    }
  }, [headersValid, gatewayUrl, adminToken, authMode, tenantId]);

  useEffect(() => {
    if (!headersValid) return;
    refresh();
    loadAnalytics();
    loadTenantConfig();
  }, [headersValid, refresh, loadAnalytics, loadTenantConfig]);

  useEffect(() => {
    setForm((f) => ({ ...f, tenantId }));
    setPage(1);
    setTenantAllow("");
    setTenantDeny("");
    setTenantContextLimit("");
    setConfigMessage(null);
    setSeries([]);
    setHistory([]);
    setAnalytics([]);
    setCsvFile(null);
    setCsvPreviewName(null);
  }, [tenantId]);

  const resetForm = () => {
    setForm({ ...emptyForm, tenantId });
    setEditingId(null);
    setCsvFile(null);
    setCsvPreviewName(null);
    setUploadProgress(null);
    setError(null);
  };

  const parseDepthInput = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === "") return 0;
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed) || !Number.isFinite(parsed)) return 0;
    return Math.trunc(parsed);
  };

  const depthFromMetadata = (
    meta: Record<string, unknown> | undefined,
    key: string,
    fallback: number
  ) => {
    const raw = meta?.[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
    if (typeof raw === "string" && raw.trim() !== "") {
      const parsed = Number(raw);
      if (!Number.isNaN(parsed) && Number.isFinite(parsed)) return Math.trunc(parsed);
    }
    return fallback;
  };

  const statusBadge = (status?: string) => {
    const value = (status ?? "pending").toLowerCase();
    const palette: Record<string, string> = {
      ready: "#16a34a",
      processing: "#2563eb",
      pending: "#f97316",
      error: "#dc2626",
    };
    const color = palette[value] ?? "#6b7280";
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
          padding: "0.1rem 0.65rem",
          borderRadius: "999px",
          fontSize: "12px",
          fontWeight: 600,
          background: `${color}20`,
          color,
        }}
      >
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: color,
          }}
        />
        {value}
      </span>
    );
  };

  const keywordStringToList = (value: string) =>
    value
      .split(/[,\\n]/)
      .map((item) => item.trim())
      .filter(Boolean);

  const seriesSummary = useMemo(() => {
    if (!series.length) {
      return {
        points: "",
        max: 0,
        total: 0,
        labels: [] as string[],
        bars: [] as { x: number; height: number; value: number; date: string }[],
      };
    }
    const max = Math.max(...series.map((item) => item.count), 1);
    const total = series.reduce((sum, item) => sum + item.count, 0);
    const lastEntry = series.length > 0 ? series[series.length - 1] : undefined;
    const labels = [series[0]?.date, series[Math.floor(series.length / 2)]?.date, lastEntry?.date].filter(
      Boolean
    ) as string[];
    const coords = series
      .map((item, index) => {
        const x = series.length === 1 ? 0 : (index / (series.length - 1)) * 100;
        const y = 100 - (item.count / max) * 90 - 5;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
    const bars = series.map((item, index) => {
      const x = series.length === 1 ? 0 : (index / (series.length - 1)) * 100;
      const height = max === 0 ? 0 : (item.count / max) * 90;
      return { x, height, value: item.count, date: item.date };
    });
    return { points: coords, max, total, labels, bars };
  }, [series]);

  const handleTypeChange = (nextType: SourceInput["type"]) => {
    setForm((prev) => ({
      ...prev,
      type: nextType,
      value: nextType === "text" ? prev.value : "",
    }));
    setCsvFile(null);
    setCsvPreviewName(null);
  };

  const readFileAsDataURL = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        if (result) {
          setUploadProgress(100);
          resolve(result);
        } else {
          reject(new Error("Failed to read file"));
        }
      };
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
      reader.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(percent);
          setProgressMessage(`Uploading CSV… ${percent}%`);
        }
      };
      reader.readAsDataURL(file);
    });

  const handleCsvDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    setCsvFile(file);
    setCsvPreviewName(file.name);
    setUploadProgress(null);
    setProgressMessage(`Selected ${file.name}`);
  };


  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    persistPrefs();

    const metadata: Record<string, unknown> = { ...(form.metadata || {}) };
    metadata.internalCrawlDepth = parseDepthInput(form.internalCrawlDepth);
    metadata.externalCrawlDepth = parseDepthInput(form.externalCrawlDepth);
    if (form.type !== "csv" && "filename" in metadata) {
      delete metadata.filename;
    }

    let value = form.value.trim();

    if (form.type === "csv") {
      if (!csvFile) {
        setError("Please select a CSV file to upload");
        return;
      }
      setUploadProgress(0);
      setProgressMessage("Uploading CSV… 0%");
      try {
        const dataUrl = await readFileAsDataURL(csvFile);
        value = dataUrl.includes(",") ? dataUrl.split(",")[1] ?? "" : dataUrl;
      } catch (err) {
        console.error(err);
        setUploadProgress(null);
        const message = "Failed to read CSV file";
        setError(message);
        setProgressMessage(message);
        return;
      }
      metadata.filename = csvFile.name;
    } else if (form.type === "text") {
      if (!value) {
        setError("Please provide text input");
        return;
      }
    } else {
      if (!value) {
        setError("Source value is required");
        return;
      }
    }

    setProgressMessage("Saving source…");
    setLoading(true);
    setError(null);
    setPendingSourceId(null);

    try {
      let response;
      if (editingId) {
        response = await updateSourceApi({
          gatewayUrl,
          adminToken,
          authMode,
          id: editingId,
          patch: {
            type: form.type,
            value,
            embeddingProvider: form.embeddingProvider,
            metadata,
            trigger_ingest: true,
          },
        });
      } else {
        response = await createSource({
          gatewayUrl,
          adminToken,
          authMode,
          input: {
            tenantId: form.tenantId,
            type: form.type,
            value,
            embeddingProvider: form.embeddingProvider,
            metadata,
          },
        });
      }

      if (response?.error) {
        setError(response.error);
        setProgressMessage(response.error);
      }

      const createdSource = response?.source;
      if (createdSource) {
        setPendingSourceId(createdSource.id);
        if (!response?.error) {
          setProgressMessage("Ingestion started…");
        }
      }

      resetForm();
      await refresh();
      await loadAnalytics();
    } catch (err) {
      console.error(err);
      const message = (err as Error).message || "Failed to save source";
      setError(message);
      setProgressMessage(message);
      setPendingSourceId(null);
    } finally {
      setLoading(false);
      setUploadProgress(null);
    }
  };

  const handleEdit = (record: SourceRecord) => {
    setEditingId(record.id);
    const meta = (record.metadata as Record<string, unknown> | undefined) ?? {};
    const internalDepth = depthFromMetadata(meta, "internalCrawlDepth", DEFAULT_INTERNAL_CRAWL_DEPTH);
    const externalDepth = depthFromMetadata(meta, "externalCrawlDepth", DEFAULT_EXTERNAL_CRAWL_DEPTH);
    setForm({
      tenantId: record.tenantId,
      type: record.type,
      value: record.type === "csv" ? "" : record.value,
      embeddingProvider: record.embeddingProvider,
      metadata: { ...meta },
      internalCrawlDepth: String(internalDepth),
      externalCrawlDepth: String(externalDepth),
    });
    if (record.type === "csv") {
      const filename = (record.metadata as any)?.filename || "Existing CSV";
      setCsvPreviewName(filename);
    } else {
      setCsvPreviewName(null);
    }
    setCsvFile(null);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Remove this source?")) return;
    setPendingSourceId((prev) => (prev === id ? null : prev));
    setProgressMessage(null);
    setLoading(true);
    setError(null);
    try {
      await deleteSource({ gatewayUrl, adminToken, authMode, id });
      if (editingId === id) resetForm();
      await refresh();
      await loadAnalytics();
    } catch (err) {
      console.error(err);
      setError("Failed to delete source");
    } finally {
      setLoading(false);
    }
  };

  const handleReingest = async (record: SourceRecord) => {
    setLoading(true);
    setError(null);
    setPendingSourceId(record.id);
    setProgressMessage("Re-ingesting source…");
    try {
      const response = await updateSourceApi({
        gatewayUrl,
        adminToken,
        authMode,
        id: record.id,
        patch: { trigger_ingest: true },
      });
      if (response?.error) {
        setError(response.error);
        setProgressMessage(response.error);
      }
      await refresh();
      await loadAnalytics();
    } catch (err) {
      console.error(err);
      setError("Failed to trigger ingest");
      setProgressMessage("Failed to trigger ingest");
      setPendingSourceId(null);
    } finally {
      setLoading(false);
    }
  };


  const handleRefreshStatus = async (id: string) => {
    setProgressMessage("Refreshing status…");
    setPendingSourceId(id);
    try {
      await refresh();
    } catch (err) {
      console.error(err);
      setProgressMessage("Failed to refresh status");
    }
  };

  const handleSaveTenantConfig = async () => {
    if (!headersValid || !tenantId) return;
    setConfigSaving(true);
    setConfigMessage(null);
    try {
      const allowKeywords = keywordStringToList(tenantAllow);
      const denyKeywords = keywordStringToList(tenantDeny);
      const limitRaw = tenantContextLimit.trim();
      let limitValue: number | undefined;
      if (limitRaw) {
        const parsed = Number(limitRaw);
        if (Number.isNaN(parsed) || parsed <= 0) {
          throw new Error("Context limit must be a positive number");
        }
        limitValue = parsed;
      }
      await updateTenantConfig({
        gatewayUrl,
        adminToken,
        authMode,
        config: {
          tenantId,
          allowKeywords,
          denyKeywords,
          contextLimit: limitValue ?? null,
        },
      });
      setTenantAllow(allowKeywords.join(", "));
      setTenantDeny(denyKeywords.join(", "));
      setTenantContextLimit(limitValue !== undefined ? String(limitValue) : "");
      setConfigMessage({ text: "Guardrails updated", variant: "success" });
    } catch (err) {
      console.error(err);
      setConfigMessage({
        text: (err as Error).message || "Failed to update guardrails",
        variant: "error",
      });
    } finally {
      setConfigSaving(false);
    }
  };

  useEffect(() => {
    if (!pendingSourceId) return;
    if (loading) return;
    const interval = window.setInterval(() => {
      refresh();
    }, 4000);
    return () => window.clearInterval(interval);
  }, [pendingSourceId, refresh, loading]);

  useEffect(() => {
    if (!pendingSourceId) return;
    const target = sources.find((item) => item.id === pendingSourceId);
    if (!target) return;
    const status = (target.ingestStatus ?? "pending").toLowerCase();
    if (status === "pending" || status === "processing") {
      setProgressMessage(`Ingestion ${status}…`);
      return;
    }
    if (status === "ready") {
      setProgressMessage("Ingestion complete ✅");
    } else {
      setProgressMessage(`Ingestion ${status}: ${target.ingestError || "check gateway logs"}`);
    }
    setPendingSourceId(null);
  }, [sources, pendingSourceId]);

  useEffect(() => {
    if (!progressMessage) return;
    if (pendingSourceId) return;
    const timeout = window.setTimeout(() => setProgressMessage(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [progressMessage, pendingSourceId]);


  return (
    <div style={{ padding: "2rem", maxWidth: 960, margin: "0 auto" }}>
      <h1>Knowledge Bot Admin</h1>
      <section
        style={{
          display: "grid",
          gap: "1rem",
          background: "#fff",
          padding: "1.5rem",
          borderRadius: "12px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.04)",
        }}
      >
        <h2 style={{ margin: 0 }}>Connection</h2>
        <label>
          Gateway URL
          <input
            value={gatewayUrl}
            onChange={(e) => setGatewayUrl(e.target.value)}
            style={{ width: "100%", marginTop: "0.25rem" }}
            placeholder="http://localhost:8787"
          />
        </label>
        <label>
          Admin Token / JWT Secret
          <input
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            style={{ width: "100%", marginTop: "0.25rem" }}
            placeholder="X-Admin-Token or JWT secret"
          />
        </label>
        <label>
          Tenant ID
          <input
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            style={{ width: "100%", marginTop: "0.25rem" }}
          />
        </label>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            Auth mode
            <select value={authMode} onChange={(e) => setAuthMode(e.target.value as "token" | "jwt") }>
              <option value="token">Header token</option>
              <option value="jwt">JWT (Bearer)</option>
            </select>
          </label>
          <button type="button" onClick={() => { persistPrefs(); refresh(); loadAnalytics(); }} disabled={!headersValid || loading}>
            Refresh sources
          </button>
          <button type="button" onClick={resetForm} disabled={loading || !editingId}>
            Clear form
          </button>
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search sources"
            style={{ flex: "1 1 160px", minWidth: "160px" }}
          />
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            style={{ minWidth: "100px" }}
          >
            {[10, 20, 50].map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
        </div>
      </section>
      {progressMessage && (
        <div
          style={{
            marginTop: "1.5rem",
            background: "#eef2ff",
            border: "1px solid #c7d2fe",
            padding: "0.75rem 1rem",
            borderRadius: "10px",
            color: "#1e1b4b",
          }}
        >
          <strong>Status:</strong> {progressMessage}
          {uploadProgress !== null && (
            <div
              style={{
                marginTop: "0.5rem",
                background: "#fff",
                borderRadius: "6px",
                border: "1px solid #c7d2fe",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${uploadProgress}%`,
                  background: "#4f46e5",
                  height: "6px",
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          )}
        </div>
      )}

      <section
        style={{
          marginTop: "2rem",
          background: "#fff",
          padding: "1.5rem",
          borderRadius: "12px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.04)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Tenant Guardrails</h2>
        <p style={{ fontSize: "13px", color: "#555", marginTop: 0 }}>
          Configure optional allow/deny keyword lists and context size limits. Leave fields blank to use defaults.
        </p>
        <label style={{ display: "block" }}>
          Allow keywords (comma or newline separated)
          <textarea
            value={tenantAllow}
            onChange={(e) => setTenantAllow(e.target.value)}
            style={{ width: "100%", minHeight: "70px", marginTop: "0.25rem" }}
            placeholder="keyword-one, keyword-two"
          />
        </label>
        <label style={{ display: "block", marginTop: "1rem" }}>
          Deny keywords (comma or newline separated)
          <textarea
            value={tenantDeny}
            onChange={(e) => setTenantDeny(e.target.value)}
            style={{ width: "100%", minHeight: "70px", marginTop: "0.25rem" }}
            placeholder="sensitive-term, restricted-topic"
          />
        </label>
        <label style={{ display: "block", marginTop: "1rem" }}>
          Context limit (tokens)
          <input
            type="number"
            min={1}
            value={tenantContextLimit}
            onChange={(e) => setTenantContextLimit(e.target.value)}
            style={{ width: "100%", marginTop: "0.25rem" }}
            placeholder="e.g. 2048"
          />
        </label>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "1rem", flexWrap: "wrap" }}>
          <button type="button" onClick={handleSaveTenantConfig} disabled={!headersValid || configSaving}>
            {configSaving ? "Saving..." : "Save guardrails"}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfigMessage(null);
              void loadTenantConfig();
            }}
            disabled={!headersValid || configSaving}
          >
            Reload current config
          </button>
          {configMessage && (
            <span
              style={{
                color: configMessage.variant === "error" ? "#b00020" : "#0a7c2d",
                fontSize: "13px",
              }}
            >
              {configMessage.text}
            </span>
          )}
        </div>
      </section>
      {progressMessage && (
        <div
          style={{
            marginTop: "1.5rem",
            background: "#eef2ff",
            border: "1px solid #c7d2fe",
            padding: "0.75rem 1rem",
            borderRadius: "10px",
            color: "#1e1b4b",
          }}
        >
          <strong>Status:</strong> {progressMessage}
          {uploadProgress !== null && (
            <div
              style={{
                marginTop: "0.5rem",
                background: "#fff",
                borderRadius: "6px",
                border: "1px solid #c7d2fe",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${uploadProgress}%`,
                  background: "#4f46e5",
                  height: "6px",
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          )}
        </div>
      )}

      <section
        style={{
          marginTop: "2rem",
          background: "#fff",
          padding: "1.5rem",
          borderRadius: "12px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.04)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>{editingId ? "Edit Source" : "Add Source"}</h2>
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>
          <label>
            Source Type
            <select
              value={form.type}
              onChange={(e) => handleTypeChange(e.target.value as SourceInput["type"])}
              style={{ width: "100%", marginTop: "0.25rem" }}
            >
              <option value="url">URL</option>
              <option value="pdf">PDF</option>
              <option value="text">Raw Text</option>
              <option value="csv">CSV Upload</option>
            </select>
          </label>
          <label>
            {form.type === "csv" ? "Upload CSV" : "Value"}
            {form.type === "text" ? (
              <textarea
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                style={{ width: "100%", minHeight: "90px", marginTop: "0.25rem" }}
                placeholder="Paste text content"
              />
            ) : form.type === "csv" ? (
              <div
                onDrop={handleCsvDrop}
                onDragOver={(event) => event.preventDefault()}
                style={{
                  display: "grid",
                  gap: "0.5rem",
                  marginTop: "0.25rem",
                  padding: "0.75rem",
                  border: "1px dashed #c7d2fe",
                  borderRadius: "10px",
                  background: "#f9fafb",
                }}
              >
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setCsvFile(file);
                    setCsvPreviewName(file ? file.name : null);
                    if (file) {
                      setProgressMessage(`Selected ${file.name}`);
                      setUploadProgress(null);
                    }
                  }}
                />
                <small style={{ color: "#555" }}>
                  {csvFile?.name || csvPreviewName || "No file selected"}
                </small>
                <small style={{ color: "#777" }}>Drag & drop a CSV here or click to choose.</small>
                {uploadProgress !== null && (
                  <small style={{ color: "#4f46e5" }}>Upload progress: {uploadProgress}%</small>
                )}
              </div>
            ) : (
              <input
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                style={{ width: "100%", marginTop: "0.25rem" }}
                placeholder={form.type === "pdf" ? "https://example.com/my-document.pdf" : "https://example.com/..."}
              />
            )}
          </label>
          <label>
            Embedding Provider
            <select
              value={form.embeddingProvider}
              onChange={(e) => setForm({ ...form, embeddingProvider: e.target.value })}
              style={{ width: "100%", marginTop: "0.25rem" }}
            >
              <option value="ollama">Ollama (local)</option>
              <option value="gemini">Gemini (cloud)</option>
            </select>
          </label>
          <label>
            Internal crawl depth (-1 = all links, 0 = none)
            <input
              type="number"
              value={form.internalCrawlDepth}
              onChange={(e) => setForm({ ...form, internalCrawlDepth: e.target.value })}
              style={{ width: "100%", marginTop: "0.25rem" }}
            />
          </label>
          <label>
            External crawl depth (-1 = all links, 0 = none)
            <input
              type="number"
              value={form.externalCrawlDepth}
              onChange={(e) => setForm({ ...form, externalCrawlDepth: e.target.value })}
              style={{ width: "100%", marginTop: "0.25rem" }}
            />
          </label>
          <button type="submit" disabled={!headersValid || loading}>
            {loading ? "Saving..." : editingId ? "Save changes" : "Save & Ingest"}
          </button>
          {error && <span style={{ color: "#b00020" }}>{error}</span>}
        </form>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Sources ({total})</h2>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {sources.length === 0 && <div style={{ color: "#777" }}>No sources yet.</div>}
          {sources.map((source) => (
            <article
              key={source.id}
              style={{
                background: "#fff",
                padding: "1rem",
                borderRadius: "10px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                borderLeft: "4px solid #4f46e5",
              }}
            >
              <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>{source.type.toUpperCase()}</strong>
                <small>
                  {new Date(source.createdAt).toLocaleString()}
                  {source.updatedAt ? ` • Updated ${new Date(source.updatedAt).toLocaleString()}` : ""}
                </small>
              </header>
              <p style={{ margin: "0.5rem 0", wordBreak: "break-word" }}>
                {source.type === "csv"
                  ? (source.metadata as any)?.filename || "CSV file uploaded"
                  : source.value}
              </p>
              <footer style={{ fontSize: "12px", color: "#555", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
                  <span>Tenant: <code>{source.tenantId}</code></span>
                  <span>Provider: {source.embeddingProvider}</span>
                  {statusBadge(source.ingestStatus)}
                  <span>
                    Last ingest: {source.lastIngestAt
                      ? new Date(source.lastIngestAt).toLocaleString()
                      : source.lastTriggeredAt
                      ? new Date(source.lastTriggeredAt).toLocaleString()
                      : "-"}
                  </span>
                </div>
                {source.ingestError && (
                  <div style={{ color: "#dc2626" }}>Error: {source.ingestError}</div>
                )}
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button type="button" onClick={() => handleEdit(source)} disabled={loading}>
                    Edit
                  </button>
                  <button type="button" onClick={() => handleReingest(source)} disabled={loading}>
                    Re-ingest
                  </button>
                  <button type="button" onClick={() => handleRefreshStatus(source.id)} disabled={loading}>
                    Refresh status
                  </button>
                  <button type="button" onClick={() => handleDelete(source.id)} disabled={loading}>
                    Delete
                  </button>
                </div>
              </footer>
            </article>
          ))}
        </div>
        <div style={{ marginTop: "1rem" }}>
          <Pagination page={page} pageSize={pageSize} total={total} onPageChange={(next) => setPage(Math.max(1, next))} />
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Tenant Analytics</h2>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {series.length > 0 && (
            <div
              style={{
                background: "#fff",
                padding: "1rem",
                borderRadius: "10px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                display: "grid",
                gap: "0.75rem",
              }}
            >
              <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>Ingests (last {series.length} days)</strong>
                <span style={{ fontSize: "12px", color: "#555" }}>
                  Total {seriesSummary.total} • Peak {seriesSummary.max}
                </span>
              </header>
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "160px" }}>
                <rect x="0" y="0" width="100" height="100" fill="#eef2ff" rx="4" ry="4" />
                {seriesSummary.bars.map((bar, index) => (
                  <rect
                    key={`${bar.date}-${index}`}
                    x={Math.max(bar.x - 1.5, 0)}
                    y={100 - bar.height - 5}
                    width={3}
                    height={bar.height}
                    fill="#4f46e5"
                    opacity="0.4"
                  />
                ))}
                <polyline
                  fill="none"
                  stroke="#4338ca"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={seriesSummary.points}
                />
              </svg>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#555" }}>
                {seriesSummary.labels.map((label, index) => (
                  <span key={`${label}-${index}`} style={{ whiteSpace: "nowrap" }}>
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {history.length > 0 && (
            <div style={{ background: "#fff", padding: "1rem", borderRadius: "10px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
              <h3 style={{ margin: "0 0 0.5rem" }}>Recent Ingest Activity ({tenantId})</h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "12px", color: "#555" }}>
                {history.map((event) => (
                  <li key={`${event.sourceId}-${event.triggeredAt}`}>
                    <strong>{new Date(event.triggeredAt).toLocaleString()}</strong> — {event.sourceId} ({event.status}
                    {event.detail ? ` – ${event.detail}` : ""})
                  </li>
                ))}
              </ul>
            </div>
          )}
          {analytics.length === 0 && <div style={{ color: "#777" }}>No analytics data.</div>}
          {analytics.map((row) => (
            <article
              key={row.tenantId}
              style={{ background: "#fff", padding: "1rem", borderRadius: "10px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}
            >
              <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>{row.tenantId}</strong>
                <small>{row.sourceCount} sources</small>
              </header>
              <p style={{ margin: "0.5rem 0", fontSize: "13px", color: "#555" }}>Documents in Qdrant: {row.docCount}</p>
              <footer style={{ fontSize: "12px", color: "#555" }}>
                Last ingest: {row.lastIngestAt ? new Date(row.lastIngestAt).toLocaleString() : "Never"}
              </footer>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default App;
