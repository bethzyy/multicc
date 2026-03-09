/**
 * Multi-Source Chat Aggregator
 *
 * Aggregates chat history from multiple sources:
 * - Claude Code (~/.claude/projects/)
 * - Codex CLI (~/.codex/sessions/)
 * - Gemini CLI (~/.gemini/tmp/)
 */

import type { SessionSummary, SessionMessage, ChatSource } from '@shared/types/chat.types';
import { getSessions as getClaudeSessions, getSession as getClaudeSession } from '../chat-reader';
import { getCodexSessions, getCodexSession, isCodexAvailable } from './codex-source';
import { getGeminiSessions, getGeminiSession, isGeminiAvailable } from './gemini-source';

export interface SourceInfo {
  id: ChatSource;
  name: string;
  available: boolean;
  sessionCount: number;
}

/**
 * Get all available chat sources
 */
export async function getAvailableSources(): Promise<SourceInfo[]> {
  const sources: SourceInfo[] = [];

  // Claude Code
  sources.push({
    id: 'claude-code',
    name: 'Claude Code',
    available: true, // Always considered available
    sessionCount: 0, // Will be populated lazily
  });

  // Codex CLI
  const codexAvailable = isCodexAvailable();
  sources.push({
    id: 'codex-cli',
    name: 'Codex CLI',
    available: codexAvailable,
    sessionCount: codexAvailable ? (await getCodexSessions()).length : 0,
  });

  // Gemini CLI
  const geminiAvailable = isGeminiAvailable();
  sources.push({
    id: 'gemini-cli',
    name: 'Gemini CLI',
    available: geminiAvailable,
    sessionCount: geminiAvailable ? (await getGeminiSessions()).length : 0,
  });

  return sources;
}

/**
 * Get sessions from all sources
 * Optionally filter by source
 */
export async function getAllSessions(source?: ChatSource): Promise<SessionSummary[]> {
  const allSessions: SessionSummary[] = [];

  // Claude Code sessions
  if (!source || source === 'claude-code') {
    try {
      const claudeSessions = await getClaudeSessions(null);
      allSessions.push(...claudeSessions);
    } catch (error) {
      console.error('[MultiSource] Error loading Claude sessions:', error);
    }
  }

  // Codex CLI sessions
  if (!source || source === 'codex-cli') {
    if (isCodexAvailable()) {
      try {
        const codexSessions = await getCodexSessions();
        allSessions.push(...codexSessions);
      } catch (error) {
        console.error('[MultiSource] Error loading Codex sessions:', error);
      }
    }
  }

  // Gemini CLI sessions
  if (!source || source === 'gemini-cli') {
    if (isGeminiAvailable()) {
      try {
        const geminiSessions = await getGeminiSessions();
        allSessions.push(...geminiSessions);
      } catch (error) {
        console.error('[MultiSource] Error loading Gemini sessions:', error);
      }
    }
  }

  // Sort by last modified (most recent first)
  allSessions.sort((a, b) => b.lastModified - a.lastModified);

  return allSessions;
}

/**
 * Get session content from appropriate source
 */
export async function getSessionContent(
  sessionId: string,
  projectHash?: string
): Promise<SessionMessage[]> {
  // Determine source from session ID prefix
  if (sessionId.startsWith('codex-')) {
    return getCodexSession(sessionId);
  }

  if (sessionId.startsWith('gemini-')) {
    return getGeminiSession(sessionId);
  }

  // Default to Claude Code
  if (projectHash) {
    return getClaudeSession(projectHash, sessionId);
  }

  return [];
}

/**
 * Search across all sources
 */
export async function searchAllSources(
  query: string
): Promise<Array<{
  sessionId: string;
  projectHash?: string;
  snippet: string;
  timestamp: string;
  source: ChatSource;
}>> {
  const results: Array<{
    sessionId: string;
    projectHash?: string;
    snippet: string;
    timestamp: string;
    source: ChatSource;
  }>> = [];

  // Search in parallel
  const [claudeResults, codexResults, geminiResults] = await Promise.allSettled([
    searchClaudeCode(query),
    searchCodexCli(query),
    searchGeminiCli(query),
  ]);

  // Aggregate Claude Code results
  if (claudeResults.status === 'fulfilled') {
    results.push(...claudeResults.value.map(r => ({
      ...r,
      source: 'claude-code' as ChatSource,
    })));
  }

  // Aggregate Codex CLI results
  if (codexResults.status === 'fulfilled') {
    results.push(...codexResults.value.map(r => ({
      ...r,
      source: 'codex-cli' as ChatSource,
    })));
  }

  // Aggregate Gemini CLI results
  if (geminiResults.status === 'fulfilled') {
    results.push(...geminiResults.value.map(r => ({
      ...r,
      source: 'gemini-cli' as ChatSource,
    })));
  }

  // Sort by timestamp (most recent first)
  results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return results;
}

/**
 * Search in Claude Code sessions (wrapper)
 */
async function searchClaudeCode(query: string): Promise<Array<{
  sessionId: string;
  projectHash: string;
  snippet: string;
  timestamp: string;
}>> {
  const { searchSessions } = await import('../chat-reader');
  return searchSessions(query);
}

/**
 * Search in Codex CLI sessions
 */
async function searchCodexCli(query: string): Promise<Array<{
  sessionId: string;
  snippet: string;
  timestamp: string;
}>> {
  if (!isCodexAvailable()) return [];

  const { searchCodexSessions } = await import('./codex-source');
  return searchCodexSessions(query);
}

/**
 * Search in Gemini CLI sessions
 */
async function searchGeminiCli(query: string): Promise<Array<{
  sessionId: string;
  snippet: string;
  timestamp: string;
}>> {
  if (!isGeminiAvailable()) return [];

  const { searchGeminiSessions } = await import('./gemini-source');
  return searchGeminiSessions(query);
}

/**
 * Get source statistics
 */
export async function getSourceStats(): Promise<{
  totalSessions: number;
  bySource: Record<ChatSource, number>;
  oldestSession: string | null;
  newestSession: string | null;
}> {
  const sessions = await getAllSessions();

  const bySource: Record<ChatSource, number> = {
    'claude-code': 0,
    'codex-cli': 0,
    'gemini-cli': 0,
  };

  for (const session of sessions) {
    const source = session.source || 'claude-code';
    bySource[source] = (bySource[source] || 0) + 1;
  }

  const sortedByDate = [...sessions].sort(
    (a, b) => a.lastModified - b.lastModified
  );

  return {
    totalSessions: sessions.length,
    bySource,
    oldestSession: sortedByDate[0]?.startedAt || null,
    newestSession: sortedByDate[sortedByDate.length - 1]?.startedAt || null,
  };
}
