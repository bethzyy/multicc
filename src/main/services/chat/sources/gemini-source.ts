/**
 * Gemini CLI Chat Source
 *
 * Reads chat history from Google Gemini CLI sessions.
 * Gemini CLI stores sessions in ~/.gemini/tmp/ as JSONL files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import type { SessionSummary, SessionMessage } from '@shared/types/chat.types';
import { parseJsonlFile, readFirstLines, extractTitle } from '../jsonl-parser';

/** Get Gemini CLI sessions directory */
export function getGeminiSessionsDir(): string {
  return path.join(homedir(), '.gemini', 'tmp');
}

/** Check if Gemini CLI is available */
export function isGeminiAvailable(): boolean {
  const sessionsDir = getGeminiSessionsDir();
  return fs.existsSync(sessionsDir);
}

/**
 * Get all Gemini CLI sessions
 * Returns sessions sorted by last modified time (most recent first)
 */
export async function getGeminiSessions(): Promise<SessionSummary[]> {
  const sessionsDir = getGeminiSessionsDir();
  const sessions: SessionSummary[] = [];

  if (!fs.existsSync(sessionsDir)) {
    return sessions;
  }

  try {
    const files = fs.readdirSync(sessionsDir);
    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));

    for (const file of jsonlFiles) {
      const filePath = path.join(sessionsDir, file);
      const stat = fs.statSync(filePath);
      const sessionId = file.replace('.jsonl', '');

      // Extract title and cwd from first lines
      let title = sessionId.slice(0, 8);
      let cwd = '';

      try {
        const lines = await readFirstLines(filePath, 20);

        // Find first user message for title
        for (const line of lines) {
          if (line.message?.role === 'user' || line.role === 'user') {
            const content = line.message?.content || line.content;
            const extractedTitle = extractTitle(content);
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
        sessionId: `gemini-${sessionId}`,
        projectHash: 'gemini-cli', // Single project for all Gemini sessions
        title: `[Gemini] ${title}`,
        startedAt: stat.birthtime.toISOString(),
        lastModified: stat.mtimeMs,
        fileSize: stat.size,
        source: 'gemini-cli',
        cwd,
      });
    }

    // Sort by last modified (most recent first)
    sessions.sort((a, b) => b.lastModified - a.lastModified);
  } catch (error) {
    console.error('[GeminiSource] Error reading sessions:', error);
  }

  return sessions;
}

/**
 * Get full Gemini session content
 */
export async function getGeminiSession(sessionId: string): Promise<SessionMessage[]> {
  // Remove 'gemini-' prefix if present
  const actualId = sessionId.replace(/^gemini-/, '');
  const filePath = path.join(getGeminiSessionsDir(), `${actualId}.jsonl`);

  if (!fs.existsSync(filePath)) {
    return [];
  }

  return parseJsonlFile(filePath, sessionId);
}

/**
 * Search in Gemini sessions
 */
export async function searchGeminiSessions(
  query: string
): Promise<Array<{ sessionId: string; snippet: string; timestamp: string }>> {
  const results: Array<{ sessionId: string; snippet: string; timestamp: string }> = [];
  const sessionsDir = getGeminiSessionsDir();

  if (!fs.existsSync(sessionsDir)) {
    return results;
  }

  try {
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'));

    for (const file of files) {
      const sessionId = `gemini-${file.replace('.jsonl', '')}`;
      const filePath = path.join(sessionsDir, file);

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const parsed = JSON.parse(line);
            const text = extractTextFromMessage(parsed);

            if (text && text.toLowerCase().includes(query.toLowerCase())) {
              // Extract snippet with context
              const index = text.toLowerCase().indexOf(query.toLowerCase());
              const start = Math.max(0, index - 30);
              const end = Math.min(text.length, index + query.length + 30);
              const snippet = (start > 0 ? '...' : '') +
                text.slice(start, end) +
                (end < text.length ? '...' : '');

              results.push({
                sessionId,
                snippet,
                timestamp: parsed.timestamp || new Date().toISOString(),
              });

              // Only return first match per session
              break;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }
  } catch (error) {
    console.error('[GeminiSource] Search error:', error);
  }

  return results;
}

/**
 * Extract text from various message formats
 */
function extractTextFromMessage(msg: unknown): string | null {
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as Record<string, unknown>;

  // Direct content string
  if (typeof m.content === 'string') return m.content;

  // Content array
  if (Array.isArray(m.content)) {
    const textParts: string[] = [];
    for (const block of m.content) {
      if (typeof block === 'string') {
        textParts.push(block);
      } else if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') {
          textParts.push(b.text);
        }
      }
    }
    return textParts.join(' ');
  }

  // message.content pattern
  if (m.message && typeof m.message === 'object') {
    const message = m.message as Record<string, unknown>;
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      const textParts: string[] = [];
      for (const block of message.content) {
        if (typeof block === 'string') {
          textParts.push(block);
        } else if (block && typeof block === 'object') {
          const b = block as Record<string, unknown>;
          if (b.type === 'text' && typeof b.text === 'string') {
            textParts.push(b.text);
          }
        }
      }
      return textParts.join(' ');
    }
  }

  // parts pattern (Gemini API format)
  if (Array.isArray(m.parts)) {
    const textParts: string[] = [];
    for (const part of m.parts) {
      if (typeof part === 'string') {
        textParts.push(part);
      } else if (part && typeof part === 'object') {
        const p = part as Record<string, unknown>;
        if (typeof p.text === 'string') {
          textParts.push(p.text);
        }
      }
    }
    return textParts.join(' ');
  }

  return null;
}
