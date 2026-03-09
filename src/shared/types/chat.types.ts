/**
 * Chat History Domain Types
 *
 * Based on file system scanning of ~/.claude/projects/ directory
 * Data hierarchy: Project → Session → Message
 */

/** Chat data source */
export type ChatSource = 'claude-code' | 'codex' | 'gemini';

/** Project info scanned from ~/.claude/projects/ */
export interface ProjectInfo {
  /** Directory name (projectHash), e.g. "-Users-rl-..." */
  projectHash: string;
  /** Full project path from session's cwd field */
  displayPath: string;
  /** Short name (last segment of displayPath) */
  displayName: string;
  /** Number of .jsonl session files in this project */
  sessionCount: number;
  /** Total size of all session files in bytes */
  totalSize?: number;
  /** Last active time (ms, latest session file's mtime) */
  lastActivity: number;
  /** Data source tool */
  source?: ChatSource;
}

/** Single session summary (extracted from .jsonl file header) */
export interface SessionSummary {
  /** Session UUID (filename without .jsonl) */
  sessionId: string;
  /** Project hash */
  projectHash: string;
  /** First user message text (truncated ~100 chars) as title */
  title: string;
  /** Session start time (ISO string) */
  startedAt: string;
  /** File modification time (ms) for sorting */
  lastModified: number;
  /** Session file size (bytes) */
  fileSize: number;
  /** Data source tool */
  source?: ChatSource;
  /** User-defined custom title (from terminal naming) */
  customTitle?: string;
  /** Session-level working directory (from JSONL) for resume */
  cwd?: string;
  /** true if session only in archive (CC deleted original), cannot resume */
  archiveOnly?: boolean;
}

/** Content block in messages (shared by user and assistant) */
export interface AssistantContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  /** Text content when type='text' */
  text?: string;
  /** Tool name when type='tool_use' */
  name?: string;
  /** Tool input when type='tool_use' */
  input?: unknown;
  /** Result content when type='tool_result' */
  content?: unknown;
  /** Associated tool_use_id when type='tool_result' */
  tool_use_id?: string;
  /** Image source when type='image' */
  source?: { type: string; media_type: string; data: string };
}

/** Normalized session message for UI rendering */
export interface SessionMessage {
  /** Message UUID */
  uuid: string;
  /** Message type (skip file-history-snapshot) */
  type: 'user' | 'assistant' | 'system';
  /** Session ID */
  sessionId: string;
  /** Working directory */
  cwd: string;
  /** Git branch */
  gitBranch?: string;
  /** ISO timestamp */
  timestamp: string;
  /**
   * Message content
   * - user: string
   * - assistant: AssistantContentBlock[]
   */
  content: string | AssistantContentBlock[];
}

/** chat:search result */
export interface SearchResult {
  /** Project hash */
  projectHash: string;
  /** Session ID */
  sessionId: string;
  /** Matched text snippet */
  snippet: string;
  /** ISO timestamp */
  timestamp: string;
}

/** chat:session-update push event (M→R) */
export interface ChatSessionUpdateEvent {
  projectHash: string;
  sessionId: string;
}

/** chat:sync-status */
export type ChatSyncStatus = 'syncing' | 'idle' | 'error';

/** chat:export request params */
export interface ChatExportRequest {
  projectHash: string;
  sessionId: string;
  format: 'markdown' | 'json';
}

/** chat:export response */
export interface ChatExportResponse {
  outputPath: string;
}
