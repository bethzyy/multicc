/**
 * JSONL Parser for Claude Code session files
 *
 * Parses .jsonl files from ~/.claude/projects/ directory.
 * Each line is a JSON object representing a message or system event.
 */

import * as fs from 'fs';
import * as readline from 'readline';
import type { SessionMessage, AssistantContentBlock } from '@shared/types/chat.types';

/** Raw JSONL line structure from Claude Code */
interface RawJsonlLine {
  type: string;
  uuid?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  message?: {
    role: 'user' | 'assistant' | 'system';
    content: string | AssistantContentBlock[];
  };
  // System messages
  subtype?: string;
  // Tool use/result
  tool_use_id?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
}

/**
 * Protocol message types to skip during parsing
 * These are internal Claude Code messages, not user/assistant content
 */
const SKIP_TYPES = new Set([
  'idle_notification',
  'teammate_terminated',
  'file-history-snapshot',
  'summary',
]);

/**
 * Command prefixes to skip when extracting title
 * These are not meaningful conversation starters
 */
const SKIP_TITLE_PREFIXES = [
  '/commit',
  '/help',
  '/clear',
  '/review-pr',
  '<system-reminder>',
];

/**
 * Parse a single JSONL line into a normalized message
 */
export function parseJsonlLine(line: string, sessionId: string): SessionMessage | null {
  if (!line.trim()) return null;

  try {
    const raw: RawJsonlLine = JSON.parse(line);

    // Skip protocol messages
    if (SKIP_TYPES.has(raw.type) || SKIP_TYPES.has(raw.subtype || '')) {
      return null;
    }

    // Must have message field for user/assistant messages
    if (!raw.message) return null;

    const { role, content } = raw.message;

    // Skip system messages that are internal
    if (role === 'system') return null;

    // Determine message type
    const type = role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system';

    return {
      uuid: raw.uuid || `${sessionId}-${Date.now()}-${Math.random()}`,
      type,
      sessionId,
      cwd: raw.cwd || '',
      gitBranch: raw.gitBranch,
      timestamp: raw.timestamp || new Date().toISOString(),
      content,
    };
  } catch {
    // Invalid JSON, skip
    return null;
  }
}

/**
 * Extract title from first user message
 * Returns truncated title (~100 chars)
 */
export function extractTitle(content: string | AssistantContentBlock[]): string {
  let text = '';

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    // Find first text block
    const textBlock = content.find((block) => block.type === 'text' && block.text);
    text = textBlock?.text || '';
  }

  // Skip command messages
  const trimmedText = text.trim();
  for (const prefix of SKIP_TITLE_PREFIXES) {
    if (trimmedText.startsWith(prefix)) {
      return '';
    }
  }

  // Truncate to ~100 chars
  if (text.length > 100) {
    return text.slice(0, 97) + '...';
  }
  return text;
}

/**
 * Stream parse a JSONL file and return all messages
 */
export async function parseJsonlFile(
  filePath: string,
  sessionId: string
): Promise<SessionMessage[]> {
  const messages: SessionMessage[] = [];

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const message = parseJsonlLine(line, sessionId);
    if (message) {
      messages.push(message);
    }
  }

  return messages;
}

/**
 * Stream read first N lines of a JSONL file
 * Used for extracting session summary (title, cwd)
 */
export async function readFirstLines(
  filePath: string,
  lineCount: number = 20
): Promise<RawJsonlLine[]> {
  const lines: RawJsonlLine[] = [];

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let count = 0;
  for await (const line of rl) {
    if (count >= lineCount) break;

    if (line.trim()) {
      try {
        lines.push(JSON.parse(line));
        count++;
      } catch {
        // Skip invalid JSON
      }
    }
  }

  rl.close();
  fileStream.destroy();

  return lines;
}

/**
 * Search for text in a JSONL file
 * Returns first match with context snippet
 */
export async function searchInJsonlFile(
  filePath: string,
  query: string,
  sessionId: string,
  projectHash: string
): Promise<{ found: boolean; snippet?: string; timestamp?: string }> {
  const lowerQuery = query.toLowerCase();

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.toLowerCase().includes(lowerQuery)) {
      try {
        const raw: RawJsonlLine = JSON.parse(line);
        const timestamp = raw.timestamp;

        // Extract context around the match
        const lowerLine = line.toLowerCase();
        const matchIndex = lowerLine.indexOf(lowerQuery);

        if (matchIndex !== -1) {
          // Get context: 30 chars before and after
          const start = Math.max(0, matchIndex - 30);
          const end = Math.min(line.length, matchIndex + query.length + 30);
          const snippet = line.slice(start, end);

          rl.close();
          fileStream.destroy();

          return {
            found: true,
            snippet: snippet.replace(/\s+/g, ' ').trim(),
            timestamp,
          };
        }
      } catch {
        // Invalid JSON, continue
      }
    }
  }

  rl.close();
  fileStream.destroy();

  return { found: false };
}
