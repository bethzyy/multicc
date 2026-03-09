/**
 * Chat Reader Service
 *
 * Scans ~/.claude/projects/ directory and reads chat history.
 * Implements caching for performance (5-minute TTL).
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import type {
  ProjectInfo,
  SessionSummary,
  SessionMessage,
} from '@shared/types/chat.types';
import { parseJsonlFile, readFirstLines, extractTitle, searchInJsonlFile } from './jsonl-parser';
import { getArchiveDir } from './chat-archive';

/** Cache entry with TTL */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  etag?: string; // For incremental updates
}

/** 5-minute cache TTL */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Search debounce time */
const SEARCH_DEBOUNCE_MS = 300;

/** Project list cache */
let projectsCache: CacheEntry<ProjectInfo[]> | null = null;

/** Session summary cache (keyed by projectHash) */
const sessionsCache = new Map<string, CacheEntry<SessionSummary[]>>();

/** Search debounce state */
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let searchAbortController: AbortController | null = null;

/**
 * Get Claude Code projects directory path
 */
export function getClaudeProjectsDir(): string {
  return path.join(homedir(), '.claude', 'projects');
}

/**
 * Check if cache entry is still valid
 */
function isCacheValid<T>(entry: CacheEntry<T> | null): boolean {
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

/**
 * Scan all projects from ~/.claude/projects/
 * Uses cache to avoid frequent filesystem access
 */
export async function getProjects(): Promise<ProjectInfo[]> {
  // Check cache
  if (projectsCache && isCacheValid(projectsCache)) {
    return projectsCache.data;
  }

  const projectsDir = getClaudeProjectsDir();
  const projects: ProjectInfo[] = [];

  try {
    if (!fs.existsSync(projectsDir)) {
      return [];
    }

    const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true });

    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;

      const projectPath = path.join(projectsDir, dir.name);
      const files = fs.readdirSync(projectPath);
      const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));

      if (jsonlFiles.length === 0) continue;

      // Get project display path from first session
      let displayPath = '';
      let lastActivity = 0;
      let totalSize = 0;

      for (const file of jsonlFiles) {
        const filePath = path.join(projectPath, file);
        const stat = fs.statSync(filePath);
        totalSize += stat.size;

        if (stat.mtimeMs > lastActivity) {
          lastActivity = stat.mtimeMs;
        }

        // Try to get cwd from first file if not set
        if (!displayPath) {
          try {
            const lines = await readFirstLines(filePath, 5);
            const firstWithCwd = lines.find((l) => l.cwd);
            if (firstWithCwd?.cwd) {
              displayPath = firstWithCwd.cwd;
            }
          } catch {
            // Ignore errors
          }
        }
      }

      // Extract display name from path
      const displayName = displayPath ? path.basename(displayPath) : dir.name;

      projects.push({
        projectHash: dir.name,
        displayPath,
        displayName,
        sessionCount: jsonlFiles.length,
        totalSize,
        lastActivity,
        source: 'claude-code',
      });
    }

    // Sort by last activity (most recent first)
    projects.sort((a, b) => b.lastActivity - a.lastActivity);

    // Update cache
    projectsCache = {
      data: projects,
      timestamp: Date.now(),
    };

    return projects;
  } catch (error) {
    console.error('[ChatReader] Error scanning projects:', error);
    return [];
  }
}

/**
 * Get all sessions for a project
 * @param projectHash Project hash, or null for all projects
 */
export async function getSessions(projectHash: string | null): Promise<SessionSummary[]> {
  // "All projects" mode
  if (!projectHash || projectHash === '__all__') {
    const projects = await getProjects();
    const allSessions: SessionSummary[] = [];

    for (const project of projects) {
      const sessions = await getSessionsForProject(project.projectHash);
      allSessions.push(...sessions);
    }

    // Sort by last modified (most recent first)
    allSessions.sort((a, b) => b.lastModified - a.lastModified);
    return allSessions;
  }

  // Single project mode
  return getSessionsForProject(projectHash);
}

/**
 * Get sessions for a specific project
 */
async function getSessionsForProject(projectHash: string): Promise<SessionSummary[]> {
  // Check cache
  const cached = sessionsCache.get(projectHash);
  if (cached && isCacheValid(cached)) {
    return cached.data;
  }

  const projectsDir = getClaudeProjectsDir();
  const projectPath = path.join(projectsDir, projectHash);
  const sessions: SessionSummary[] = [];

  try {
    if (!fs.existsSync(projectPath)) {
      return [];
    }

    const files = fs.readdirSync(projectPath);
    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));

    for (const file of jsonlFiles) {
      const filePath = path.join(projectPath, file);
      const stat = fs.statSync(filePath);
      const sessionId = file.replace('.jsonl', '');

      // Extract title and cwd from first lines
      let title = sessionId.slice(0, 8); // Default to short ID
      let cwd = '';

      try {
        const lines = await readFirstLines(filePath, 20);

        // Find first user message for title
        for (const line of lines) {
          if (line.message?.role === 'user') {
            const extractedTitle = extractTitle(line.message.content);
            if (extractedTitle) {
              title = extractedTitle;
              break;
            }
          }
        }

        // Get cwd from first message with cwd
        const firstWithCwd = lines.find((l) => l.cwd);
        if (firstWithCwd?.cwd) {
          cwd = firstWithCwd.cwd;
        }
      } catch {
        // Use defaults
      }

      sessions.push({
        sessionId,
        projectHash,
        title,
        startedAt: stat.birthtime.toISOString(),
        lastModified: stat.mtimeMs,
        fileSize: stat.size,
        source: 'claude-code',
        cwd,
      });
    }

    // Sort by last modified (most recent first)
    sessions.sort((a, b) => b.lastModified - a.lastModified);

    // Update cache
    sessionsCache.set(projectHash, {
      data: sessions,
      timestamp: Date.now(),
    });

    return sessions;
  } catch (error) {
    console.error('[ChatReader] Error scanning sessions:', error);
    return [];
  }
}

/**
 * Get full session content with all messages
 */
export async function getSession(
  projectHash: string,
  sessionId: string
): Promise<SessionMessage[]> {
  const projectsDir = getClaudeProjectsDir();
  const filePath = path.join(projectsDir, projectHash, `${sessionId}.jsonl`);

  if (!fs.existsSync(filePath)) {
    // Try archive
    const archivePath = path.join(getArchiveDir(), projectHash, `${sessionId}.jsonl`);
    if (!fs.existsSync(archivePath)) {
      return [];
    }
    return parseJsonlFile(archivePath, sessionId);
  }

  return parseJsonlFile(filePath, sessionId);
}

/**
 * Search across all sessions
 */
export async function searchSessions(query: string): Promise<
  Array<{
    projectHash: string;
    sessionId: string;
    snippet: string;
    timestamp: string;
  }>
> {
  const results: Array<{
    projectHash: string;
    sessionId: string;
    snippet: string;
    timestamp: string;
  }> = [];

  const projects = await getProjects();

  // Search in batches of 10 files concurrently
  const batchSize = 10;
  const searchPromises: Promise<void>[] = [];

  for (const project of projects) {
    const projectPath = path.join(getClaudeProjectsDir(), project.projectHash);

    if (!fs.existsSync(projectPath)) continue;

    const files = fs.readdirSync(projectPath).filter((f) => f.endsWith('.jsonl'));

    for (const file of files) {
      const sessionId = file.replace('.jsonl', '');
      const filePath = path.join(projectPath, file);

      const promise = searchInJsonlFile(
        filePath,
        query,
        sessionId,
        project.projectHash
      ).then((result) => {
        if (result.found && result.snippet && result.timestamp) {
          results.push({
            projectHash: project.projectHash,
            sessionId,
            snippet: result.snippet,
            timestamp: result.timestamp,
          });
        }
      });

      searchPromises.push(promise);

      // Process in batches
      if (searchPromises.length >= batchSize) {
        await Promise.all(searchPromises);
        searchPromises.length = 0;
      }
    }
  }

  // Wait for remaining promises
  await Promise.all(searchPromises);

  // Sort by timestamp (most recent first)
  results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return results;
}

/**
 * Invalidate all caches
 */
export function invalidateCache(): void {
  projectsCache = null;
  sessionsCache.clear();
}

/**
 * Debounced search - waits for user to stop typing before executing
 * @param query Search query
 * @param callback Called with search results
 * @returns Cancel function
 */
export function debouncedSearch(
  query: string,
  callback: (results: Array<{
    projectHash: string;
    sessionId: string;
    snippet: string;
    timestamp: string;
  }>) => void
): () => void {
  // Cancel any pending search
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  if (searchAbortController) {
    searchAbortController.abort();
  }

  // Create new abort controller
  searchAbortController = new AbortController();
  const controller = searchAbortController;

  // Schedule search
  searchDebounceTimer = setTimeout(async () => {
    if (controller.signal.aborted) return;

    try {
      const results = await searchSessions(query);
      if (!controller.signal.aborted) {
        callback(results);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error('[ChatReader] Search error:', error);
        callback([]);
      }
    }
  }, SEARCH_DEBOUNCE_MS);

  // Return cancel function
  return () => {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    if (searchAbortController) {
      searchAbortController.abort();
      searchAbortController = null;
    }
  };
}

/**
 * Check if cache needs refresh by comparing file modification times
 */
export async function checkCacheFreshness(projectHash?: string): Promise<boolean> {
  const projectsDir = getClaudeProjectsDir();

  if (!projectHash) {
    // Check projects cache freshness
    if (!projectsCache) return false;

    try {
      const stat = fs.statSync(projectsDir);
      const cacheTime = projectsCache.timestamp;
      return stat.mtimeMs < cacheTime;
    } catch {
      return false;
    }
  }

  // Check specific project cache freshness
  const cached = sessionsCache.get(projectHash);
  if (!cached) return false;

  const projectPath = path.join(projectsDir, projectHash);
  try {
    const files = fs.readdirSync(projectPath).filter((f) => f.endsWith('.jsonl'));
    for (const file of files.slice(0, 5)) { // Check first 5 files only
      const stat = fs.statSync(path.join(projectPath, file));
      if (stat.mtimeMs > cached.timestamp) {
        return false; // Cache is stale
      }
    }
    return true;
  } catch {
    return false;
  }
}
