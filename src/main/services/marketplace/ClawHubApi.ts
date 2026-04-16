/**
 * ClawHub API Client
 *
 * Communicates with ClawHub's public REST API (https://clawhub.ai/api/v1/).
 * Read operations require no authentication (120 req/min per IP).
 * Uses cursor-based pagination.
 */

import type {
  MarketplaceSkill,
  MarketplaceListResponse,
  MarketplaceSearchResponse,
  SkillDetail,
  SecurityScanResult,
} from '@shared/types/config.types';

const BASE_URL = 'https://clawhub.ai/api/v1';

// Simple in-memory cache
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expiry: Date.now() + ttlMs });
}

/** Generic fetch wrapper with error handling */
async function request<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000), // 15s timeout
  });

  if (response.status === 429) {
    throw new Error('Rate limit exceeded. Please wait a moment and try again.');
  }

  if (!response.ok) {
    throw new Error(`ClawHub API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

// ── Public API ──

/** Browse skills — uses search API as workaround (list endpoint returns empty) */
export async function browseSkills(opts?: {
  cursor?: string;
  limit?: number;
}): Promise<MarketplaceListResponse> {
  // The /skills list endpoint returns empty data on ClawHub production.
  // Workaround: use /search with a generic query to populate the browse view.
  const limit = opts?.limit || 20;

  // If cursor is provided, it encodes the offset (page-based fallback)
  let offset = 0;
  if (opts?.cursor) {
    try {
      offset = parseInt(opts.cursor, 10);
    } catch {
      offset = 0;
    }
  }

  // Use popular generic terms to get a diverse set of skills
  const browseQueries = ['agent', 'code', 'web', 'tool', 'search', 'api', 'file', 'data', 'cli', 'build'];
  const queryIndex = offset > 0 ? Math.floor(offset / limit) % browseQueries.length : 0;
  const query = browseQueries[queryIndex];

  const searchResult = await request<MarketplaceSearchResponse>('/search', {
    q: query,
    limit: String(limit * 2), // fetch more to deduplicate
  });

  // Convert search results to list format
  const items: MarketplaceSkill[] = searchResult.results
    .filter((r) => r.slug !== null)
    .slice(0, limit)
    .map((r) => ({
      slug: r.slug!,
      displayName: r.displayName || r.slug!,
      summary: r.summary,
      tags: {},
      stats: {},
      createdAt: r.updatedAt || Date.now(),
      updatedAt: r.updatedAt || Date.now(),
      latestVersion: r.version
        ? { version: r.version, createdAt: r.updatedAt || Date.now(), changelog: '' }
        : null,
    }));

  // Next cursor is the offset for the next page
  const nextCursor = items.length === limit ? String(offset + limit) : null;

  return { items, nextCursor };
}

/** Search skills by keyword (semantic vector search) */
export async function searchSkills(
  query: string,
  limit?: number,
): Promise<MarketplaceSearchResponse> {
  if (!query.trim()) {
    return { results: [] };
  }
  return request<MarketplaceSearchResponse>('/search', {
    q: query,
    limit: String(limit || 20),
  });
}

/** Get skill detail by slug */
export async function getSkillDetail(slug: string): Promise<SkillDetail> {
  // Cache for 5 minutes
  const cacheKey = `detail:${slug}`;
  const cached = getCached<SkillDetail>(cacheKey);
  if (cached) return cached;

  const result = await request<SkillDetail>(`/skills/${encodeURIComponent(slug)}`);
  setCache(cacheKey, result, 5 * 60 * 1000);
  return result;
}

/** Get a single file from a skill (e.g., SKILL.md) */
export async function getSkillFile(slug: string, filePath: string): Promise<string> {
  const url = `${BASE_URL}/skills/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(filePath)}`;

  const response = await fetch(url, {
    headers: { 'Accept': 'text/plain' },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`);
  }

  return response.text();
}

/** Get security scan result for a skill */
export async function getScanResult(slug: string): Promise<SecurityScanResult> {
  const cacheKey = `scan:${slug}`;
  const cached = getCached<SecurityScanResult>(cacheKey);
  if (cached) return cached;

  try {
    const result = await request<SecurityScanResult>(`/skills/${encodeURIComponent(slug)}/scan`);
    setCache(cacheKey, result, 10 * 60 * 1000);
    return result;
  } catch {
    return {
      status: 'error',
      hasWarnings: false,
      checkedAt: null,
      model: null,
      hasScanResult: false,
    };
  }
}

/** Download skill as zip buffer */
export async function downloadSkill(slug: string): Promise<Buffer> {
  const url = `${BASE_URL}/download?slug=${encodeURIComponent(slug)}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(60000), // 60s for large downloads
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Get skill versions */
export async function getSkillVersions(
  slug: string,
  opts?: { cursor?: string; limit?: number },
): Promise<{ items: Array<{ version: string; createdAt: number; changelog: string }>; nextCursor: string | null }> {
  return request(`/skills/${encodeURIComponent(slug)}/versions`, {
    cursor: opts?.cursor || '',
    limit: String(opts?.limit || 10),
  });
}
