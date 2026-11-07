/**
 * Fetch official extension metadata from Open VSX API.
 * Marketplace web pages block iframes (X-Frame-Options: DENY) — API is the embeddable source of truth.
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export interface OpenVsxDetails {
  namespace: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  downloadCount?: number;
  license?: string;
  repository?: string;
  homepage?: string;
  iconUrl?: string;
  readmeMarkdown?: string;
  detailUrl: string;
  publishedBy?: string;
}

async function httpGet(url: string): Promise<Response> {
  try {
    return await tauriFetch(url, { method: "GET" });
  } catch {
    return fetch(url);
  }
}

export function splitMarketplaceId(
  itemName: string,
): { namespace: string; name: string } | null {
  const parts = itemName.trim().split(".");
  if (parts.length < 2) return null;
  const namespace = parts[0]!;
  const name = parts.slice(1).join(".");
  if (!namespace || !name) return null;
  return { namespace, name };
}

export async function fetchOpenVsxDetails(
  marketplaceItemName: string,
): Promise<OpenVsxDetails> {
  const split = splitMarketplaceId(marketplaceItemName);
  if (!split) throw new Error(`Invalid extension id: ${marketplaceItemName}`);

  const apiUrl = `https://open-vsx.org/api/${encodeURIComponent(split.namespace)}/${encodeURIComponent(split.name)}/latest`;
  const res = await httpGet(apiUrl);
  if (!res.ok) {
    throw new Error(`Open VSX HTTP ${res.status} for ${marketplaceItemName}`);
  }
  const data = (await res.json()) as {
    namespace?: string;
    name?: string;
    displayName?: string;
    description?: string;
    version?: string;
    downloadCount?: number;
    license?: string;
    repository?: string;
    homepage?: string;
    files?: { readme?: string; icon?: string };
    publishedBy?: { loginName?: string; fullName?: string };
  };

  let readmeMarkdown: string | undefined;
  const readmeUrl = data.files?.readme;
  if (readmeUrl) {
    try {
      const r = await httpGet(readmeUrl);
      if (r.ok) readmeMarkdown = await r.text();
    } catch {
      /* optional */
    }
  }

  return {
    namespace: data.namespace ?? split.namespace,
    name: data.name ?? split.name,
    displayName: data.displayName || data.name || marketplaceItemName,
    description: data.description ?? "",
    version: data.version ?? "",
    downloadCount: data.downloadCount,
    license: data.license,
    repository: data.repository,
    homepage: data.homepage,
    iconUrl: data.files?.icon,
    readmeMarkdown,
    detailUrl: `https://open-vsx.org/extension/${split.namespace}/${split.name}`,
    publishedBy:
      data.publishedBy?.fullName || data.publishedBy?.loginName || undefined,
  };
}
