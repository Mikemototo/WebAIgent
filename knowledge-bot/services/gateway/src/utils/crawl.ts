import fetch from "node-fetch";
import { URL } from "url";

export interface CrawlConfig {
  baseUrl: string;
  html: string;
  maxInternal: number;
  maxExternal: number;
}

export interface CrawlResult {
  docUrls: string[];
}

export async function crawlLinks(config: CrawlConfig): Promise<CrawlResult> {
  const { baseUrl, html, maxInternal, maxExternal } = config;
  if (maxInternal === 0 && maxExternal === 0) {
    return { docUrls: [] };
  }

  const parsedBase = new URL(baseUrl);
  const origin = `${parsedBase.protocol}//${parsedBase.hostname}${parsedBase.port ? `:${parsedBase.port}` : ""}`;

  const toVisit: Array<{ url: string; depth: number; internal: boolean }> = [];
  try {
    extractLinks(html, baseUrl).forEach((link) => {
      const internal = link.startsWith(origin);
      toVisit.push({ url: link, depth: 1, internal });
    });
  } catch (err) {
    return { docUrls: [] };
  }

  const discovered = new Set<string>();
  let visitedInternal = 0;
  let visitedExternal = 0;

  while (toVisit.length) {
    const current = toVisit.shift();
    if (!current) break;
    const { url, depth, internal } = current;
    if (discovered.has(url)) continue;

    if (internal) {
      if (maxInternal >= 0 && visitedInternal >= maxInternal) continue;
    } else {
      if (maxExternal >= 0 && visitedExternal >= maxExternal) continue;
    }

    discovered.add(url);
    if (internal) {
      visitedInternal += 1;
    } else {
      visitedExternal += 1;
    }

    let body: string | null = null;
    try {
      const resp = await fetch(url, { method: "GET" });
      if (!resp.ok) continue;
      const contentType = resp.headers.get("content-type") || "";
      if (contentType && !contentType.startsWith("text/html")) continue;
      body = await resp.text();
    } catch (err) {
      continue;
    }

    const limit = internal ? getDepthLimit(maxInternal) : getDepthLimit(maxExternal);
    if (body && depth < limit) {
      extractLinks(body, url).forEach((child) => {
        const childInternal = child.startsWith(origin);
        toVisit.push({ url: child, depth: depth + 1, internal: childInternal });
      });
    }
  }

  return { docUrls: Array.from(discovered) };
}

function getDepthLimit(max: number): number {
  if (max < 0) return Number.POSITIVE_INFINITY;
  return max;
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const regex = /<a[^>]+href=["']([^"'#]+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html))) {
    const raw = match[1];
    try {
      const url = new URL(raw, baseUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        links.add(url.toString());
      }
    } catch (err) {
      continue;
    }
  }
  return Array.from(links);
}
