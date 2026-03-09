/**
 * Chat Archive Service
 *
 * Manages permanent storage of chat history.
 * Syncs ~/.claude/projects/ to ~/.multicc/chat-archive/
 * Claude Code deletes sessions after 30 days, archive preserves them.
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { getClaudeProjectsDir } from './chat-reader';

/** Archive directory path */
export function getArchiveDir(): string {
  return path.join(homedir(), '.multicc', 'chat-archive');
}

/** Sync progress callback */
export type SyncProgressCallback = (progress: {
  synced: number;
  total: number;
}) => void;

/**
 * Archive manager instance
 */
export interface ArchiveManager {
  sync(): Promise<void>;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  onProgress(callback: SyncProgressCallback): () => void;
}

/**
 * Create archive manager
 */
export function createArchiveManager(): ArchiveManager {
  let enabled = true;
  const progressCallbacks = new Set<SyncProgressCallback>();

  /**
   * Sync sessions from Claude Code to archive
   * Uses mtime comparison for incremental sync
   */
  async function sync(): Promise<void> {
    if (!enabled) return;

    const projectsDir = getClaudeProjectsDir();
    const archiveDir = getArchiveDir();

    if (!fs.existsSync(projectsDir)) return;

    // Ensure archive directory exists
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true });
    let synced = 0;
    let total = 0;

    // Count total files
    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;
      const projectPath = path.join(projectsDir, dir.name);
      const files = fs.readdirSync(projectPath).filter((f) => f.endsWith('.jsonl'));
      total += files.length;
    }

    // Sync each project
    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;

      const projectPath = path.join(projectsDir, dir.name);
      const archiveProjectPath = path.join(archiveDir, dir.name);

      // Ensure archive project directory exists
      if (!fs.existsSync(archiveProjectPath)) {
        fs.mkdirSync(archiveProjectPath, { recursive: true });
      }

      const files = fs.readdirSync(projectPath).filter((f) => f.endsWith('.jsonl'));

      for (const file of files) {
        const sourcePath = path.join(projectPath, file);
        const destPath = path.join(archiveProjectPath, file);

        try {
          const sourceStat = fs.statSync(sourcePath);

          // Check if destination needs update
          let needsSync = true;
          if (fs.existsSync(destPath)) {
            const destStat = fs.statSync(destPath);
            // Only sync if source is newer
            needsSync = sourceStat.mtimeMs > destStat.mtimeMs;
          }

          if (needsSync) {
            // Copy file (using copyFileSync for atomic operation)
            fs.copyFileSync(sourcePath, destPath);
          }

          synced++;
          notifyProgress({ synced, total });
        } catch (error) {
          console.error(`[Archive] Error syncing ${file}:`, error);
        }
      }
    }

    // Final progress notification
    notifyProgress({ synced: total, total });
  }

  /**
   * Check if archiving is enabled
   */
  function isEnabled(): boolean {
    return enabled;
  }

  /**
   * Enable or disable archiving
   */
  function setEnabled(value: boolean): void {
    enabled = value;
  }

  /**
   * Register progress callback
   * Returns unsubscribe function
   */
  function onProgress(callback: SyncProgressCallback): () => void {
    progressCallbacks.add(callback);
    return () => {
      progressCallbacks.delete(callback);
    };
  }

  /**
   * Notify all progress callbacks
   */
  function notifyProgress(progress: { synced: number; total: number }): void {
    for (const callback of progressCallbacks) {
      try {
        callback(progress);
      } catch (error) {
        console.error('[Archive] Progress callback error:', error);
      }
    }
  }

  return {
    sync,
    isEnabled,
    setEnabled,
    onProgress,
  };
}

/**
 * Restore a session from archive to Claude Code directory
 * Used for resuming archived-only sessions
 */
export async function restoreSessionFromArchive(
  projectHash: string,
  sessionId: string
): Promise<boolean> {
  const archivePath = path.join(
    getArchiveDir(),
    projectHash,
    `${sessionId}.jsonl`
  );
  const destPath = path.join(
    getClaudeProjectsDir(),
    projectHash,
    `${sessionId}.jsonl`
  );

  if (!fs.existsSync(archivePath)) {
    console.error('[Archive] Session not found in archive:', sessionId);
    return false;
  }

  // Ensure destination directory exists
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  try {
    fs.copyFileSync(archivePath, destPath);
    return true;
  } catch (error) {
    console.error('[Archive] Error restoring session:', error);
    return false;
  }
}

/**
 * Check if a session exists only in archive (deleted from CC)
 */
export function isArchiveOnly(projectHash: string, sessionId: string): boolean {
  const ccPath = path.join(
    getClaudeProjectsDir(),
    projectHash,
    `${sessionId}.jsonl`
  );
  const archivePath = path.join(
    getArchiveDir(),
    projectHash,
    `${sessionId}.jsonl`
  );

  return !fs.existsSync(ccPath) && fs.existsSync(archivePath);
}

/**
 * Delete a session from archive
 * Note: This only deletes from archive, not from Claude Code directory
 */
export async function deleteSessionFromArchive(
  projectHash: string,
  sessionId: string
): Promise<boolean> {
  const archivePath = path.join(
    getArchiveDir(),
    projectHash,
    `${sessionId}.jsonl`
  );

  if (!fs.existsSync(archivePath)) {
    console.warn('[Archive] Session not found in archive:', sessionId);
    return false;
  }

  try {
    fs.unlinkSync(archivePath);
    console.log('[Archive] Session deleted:', sessionId);
    return true;
  } catch (error) {
    console.error('[Archive] Error deleting session:', error);
    return false;
  }
}

/** Session metadata file path */
function getMetadataPath(): string {
  return path.join(getArchiveDir(), 'session-metadata.json');
}

/** Session metadata structure */
interface SessionMetadata {
  names: Record<string, string>; // sessionId -> name
  lastUpdated: string;
}

/**
 * Load session metadata
 */
function loadMetadata(): SessionMetadata {
  const metadataPath = getMetadataPath();
  try {
    if (fs.existsSync(metadataPath)) {
      const content = fs.readFileSync(metadataPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('[Archive] Error loading metadata:', error);
  }
  return { names: {}, lastUpdated: new Date().toISOString() };
}

/**
 * Save session metadata
 */
function saveMetadata(metadata: SessionMetadata): void {
  const metadataPath = getMetadataPath();
  metadata.lastUpdated = new Date().toISOString();
  try {
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  } catch (error) {
    console.error('[Archive] Error saving metadata:', error);
  }
}

/**
 * Set session name (persisted in metadata)
 */
export function setSessionName(sessionId: string, name: string): boolean {
  try {
    const metadata = loadMetadata();
    metadata.names[sessionId] = name;
    saveMetadata(metadata);
    console.log('[Archive] Session name set:', { sessionId, name });
    return true;
  } catch (error) {
    console.error('[Archive] Error setting session name:', error);
    return false;
  }
}

/**
 * Get session name from metadata
 */
export function getSessionName(sessionId: string): string | null {
  const metadata = loadMetadata();
  return metadata.names[sessionId] || null;
}

/**
 * Get all session names
 */
export function getAllSessionNames(): Record<string, string> {
  return loadMetadata().names;
}
