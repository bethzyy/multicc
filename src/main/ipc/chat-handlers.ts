/**
 * Chat IPC Handlers
 *
 * Handles IPC communication for chat history functionality.
 * Routes: chat:get-projects, chat:get-sessions, chat:get-session, chat:search, chat:export
 */

import { ipcMain, BrowserWindow, dialog } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import type {
  ProjectInfo,
  SessionSummary,
  SessionMessage,
} from '../../shared/types/chat.types';
import {
  getProjects,
  getSessions,
  getSession,
  searchSessions,
  invalidateCache,
} from '../services/chat/chat-reader';
import {
  createArchiveManager,
  restoreSessionFromArchive,
  isArchiveOnly,
  deleteSessionFromArchive,
  setSessionName,
  getSessionName,
  type ArchiveManager,
} from '../services/chat/chat-archive';
import { exportSession, getExportDir } from '../services/chat/chat-export';
import {
  isValidProjectHash,
  isValidSessionId,
  isPathAllowed,
} from '../utils/security';

let archiveManager: ArchiveManager | null = null;

/**
 * Register all chat IPC handlers
 */
export function registerChatHandlers(window: BrowserWindow): void {
  // Initialize archive manager
  archiveManager = createArchiveManager();

  // Forward archive progress to renderer
  archiveManager.onProgress((progress) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.CHAT.ARCHIVE_PROGRESS, progress);
    }
  });

  // Get all projects
  ipcMain.handle(
    IPC_CHANNELS.CHAT.GET_PROJECTS,
    async (): Promise<{ projects: ProjectInfo[] }> => {
      const projects = await getProjects();
      return { projects };
    }
  );

  // Get sessions for a project (or all projects)
  ipcMain.handle(
    IPC_CHANNELS.CHAT.GET_SESSIONS,
    async (
      _event,
      projectHash: string | null
    ): Promise<{ sessions: SessionSummary[] }> => {
      // Validate projectHash if provided
      if (projectHash && !isValidProjectHash(projectHash)) {
        console.warn('[Chat] Invalid project hash:', projectHash);
        return { sessions: [] };
      }

      const sessions = await getSessions(projectHash);

      // Mark archive-only sessions
      for (const session of sessions) {
        if (session.projectHash) {
          session.archiveOnly = isArchiveOnly(session.projectHash, session.sessionId);
        }
      }

      return { sessions };
    }
  );

  // Get single session content
  ipcMain.handle(
    IPC_CHANNELS.CHAT.GET_SESSION,
    async (
      _event,
      projectHash: string,
      sessionId: string
    ): Promise<{ messages: SessionMessage[] }> => {
      // Validate inputs
      if (!isValidProjectHash(projectHash)) {
        console.warn('[Chat] Invalid project hash:', projectHash);
        return { messages: [] };
      }
      if (!isValidSessionId(sessionId)) {
        console.warn('[Chat] Invalid session ID:', sessionId);
        return { messages: [] };
      }

      const messages = await getSession(projectHash, sessionId);
      return { messages };
    }
  );

  // Search across all sessions
  ipcMain.handle(
    IPC_CHANNELS.CHAT.SEARCH,
    async (
      _event,
      query: string
    ): Promise<{
      results: Array<{
        projectHash: string;
        sessionId: string;
        snippet: string;
        timestamp: string;
      }>;
    }> => {
      const results = await searchSessions(query);
      return { results };
    }
  );

  // Export session
  ipcMain.handle(
    IPC_CHANNELS.CHAT.EXPORT,
    async (
      _event,
      projectHash: string,
      sessionId: string,
      format: 'markdown' | 'json',
      title?: string
    ): Promise<{ outputPath: string }> => {
      // Validate inputs
      if (!isValidProjectHash(projectHash)) {
        throw new Error('Invalid project hash');
      }
      if (!isValidSessionId(sessionId)) {
        throw new Error('Invalid session ID');
      }

      const messages = await getSession(projectHash, sessionId);
      const sessionTitle = title || sessionId.slice(0, 8);
      const outputPath = await exportSession(messages, sessionTitle, format);

      return { outputPath };
    }
  );

  // Set session name (stored in archive metadata)
  ipcMain.handle(
    IPC_CHANNELS.CHAT.SET_SESSION_NAME,
    async (
      _event,
      _cwd: string,
      name: string,
      sessionId?: string
    ): Promise<{ success: boolean }> => {
      // Validate session ID if provided
      if (!sessionId) {
        console.warn('[Chat] No session ID provided for naming');
        return { success: false };
      }
      if (!isValidSessionId(sessionId)) {
        console.warn('[Chat] Invalid session ID for naming');
        return { success: false };
      }

      // Validate name (basic sanitization)
      const sanitizedName = name.trim().slice(0, 100);
      if (!sanitizedName) {
        return { success: false };
      }

      // Persist session name to metadata
      const success = setSessionName(sessionId, sanitizedName);
      if (success) {
        invalidateCache();
      }
      return { success };
    }
  );

  // Delete session
  ipcMain.handle(
    IPC_CHANNELS.CHAT.DELETE_SESSION,
    async (
      _event,
      projectHash: string,
      sessionId: string
    ): Promise<{ success: boolean }> => {
      // Validate inputs
      if (!isValidProjectHash(projectHash)) {
        console.warn('[Chat] Invalid project hash for deletion');
        return { success: false };
      }
      if (!isValidSessionId(sessionId)) {
        console.warn('[Chat] Invalid session ID for deletion');
        return { success: false };
      }

      // Delete from archive (not from Claude Code directory)
      const deleted = await deleteSessionFromArchive(projectHash, sessionId);
      if (deleted) {
        invalidateCache();
      }
      return { success: deleted };
    }
  );

  // Restore session from archive
  ipcMain.handle(
    IPC_CHANNELS.CHAT.RESTORE_SESSION,
    async (
      _event,
      projectHash: string,
      sessionId: string
    ): Promise<{ success: boolean; restored: boolean }> => {
      // Validate inputs
      if (!isValidProjectHash(projectHash)) {
        console.warn('[Chat] Invalid project hash for restore');
        return { success: false, restored: false };
      }
      if (!isValidSessionId(sessionId)) {
        console.warn('[Chat] Invalid session ID for restore');
        return { success: false, restored: false };
      }

      const restored = await restoreSessionFromArchive(projectHash, sessionId);
      if (restored) {
        invalidateCache();
      }
      return { success: restored, restored };
    }
  );

  // Get archive enabled status
  ipcMain.handle(
    'chat:get-archive-enabled',
    async (): Promise<{ enabled: boolean }> => {
      return { enabled: archiveManager?.isEnabled() ?? true };
    }
  );

  // Set archive enabled status
  ipcMain.handle(
    'chat:set-archive-enabled',
    async (_event, enabled: boolean): Promise<{ success: boolean }> => {
      archiveManager?.setEnabled(enabled);
      return { success: true };
    }
  );

  // Reveal file in explorer
  ipcMain.handle(
    'chat:reveal-file',
    async (_event, filePath: string): Promise<void> => {
      // Validate file path
      if (!filePath || typeof filePath !== 'string') {
        console.warn('[Chat] Invalid file path for reveal');
        return;
      }

      // Check if path is within allowed directories
      if (!isPathAllowed(filePath)) {
        console.warn('[Chat] File path not in allowed directories:', filePath);
        return;
      }

      // Use Windows explorer to reveal file
      const { shell } = require('electron');
      shell.showItemInFolder(filePath);
    }
  );

  // Run archive sync
  ipcMain.handle('chat:sync-archive', async (): Promise<void> => {
    await archiveManager?.sync();
  });
}

/**
 * Unregister all chat IPC handlers
 */
export function unregisterChatHandlers(): void {
  Object.values(IPC_CHANNELS.CHAT).forEach((channel) => {
    if (typeof channel === 'string') {
      ipcMain.removeHandler(channel);
    }
  });
}
