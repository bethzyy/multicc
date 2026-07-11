/**
 * Global Window Electron API Types
 *
 * This file defines the complete window.electron API surface.
 * Import this in renderer processes to get type checking.
 */

import type {
  ProjectInfo,
  SessionSummary,
  SessionMessage,
  SearchResult,
} from './chat.types';
import type {
  ConfigResource,
  ResourceContent,
} from './config.types';
import type {
  ToolInfo,
  CustomCommand,
  ToolsConfig,
} from './tools.types';
import type { WorktreeInfo, WorktreeSetup, WorktreeErrorCode } from './worktree.types';

declare global {
  interface Window {
    electron: {
      // Window control
      window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
        isMaximized: () => Promise<boolean>;
      };

      // Terminal operations
      terminal: {
        create: (id: string, cols: number, rows: number, cwd?: string) => Promise<boolean>;
        write: (id: string, data: string) => void;
        resize: (id: string, cols: number, rows: number) => Promise<void>;
        destroy: (id: string) => Promise<void>;
        onData: (id: string, callback: (data: string) => void) => () => void;
        onExit: (id: string, callback: (info: { exitCode: number; signal?: number }) => void) => () => void;
        onCwd: (id: string, callback: (cwd: string) => void) => () => void;
        onState: (id: string, callback: (state: string) => void) => () => void;
      };

      // Config management (legacy)
      config: {
        getClaudePath: () => Promise<string>;
        setClaudePath: (path: string) => Promise<void>;
        getWorkingDirs: () => Promise<string[]>;
        addWorkingDir: (path: string) => Promise<void>;
        removeWorkingDir: (path: string) => Promise<void>;
      };

      // Session storage
      session: {
        save: (session: unknown) => Promise<void>;
        load: (id: string) => Promise<unknown>;
        list: () => Promise<unknown[]>;
        delete: (id: string) => Promise<void>;
      };

      // Chat history
      chat: {
        getProjects: () => Promise<{ projects: ProjectInfo[] }>;
        getSessions: (projectHash: string | null) => Promise<{ sessions: SessionSummary[] }>;
        getSession: (projectHash: string, sessionId: string) => Promise<{ messages: SessionMessage[] }>;
        search: (query: string) => Promise<{ results: SearchResult[] }>;
        export: (
          projectHash: string,
          sessionId: string,
          format: 'markdown' | 'json',
          title?: string
        ) => Promise<{ outputPath: string }>;
        setSessionName: (cwd: string, name: string, sessionId?: string) => Promise<{ success: boolean }>;
        deleteSession: (projectHash: string, sessionId: string) => Promise<{ success: boolean }>;
        restoreSession: (projectHash: string, sessionId: string) => Promise<{ success: boolean; restored: boolean }>;
        getArchiveEnabled: () => Promise<{ enabled: boolean }>;
        setArchiveEnabled: (enabled: boolean) => Promise<{ success: boolean }>;
        revealFile: (filePath: string) => Promise<void>;
        syncArchive: () => Promise<void>;
        onSessionUpdate?: (callback: (data: { projectHash: string; sessionId: string }) => void) => () => void;
        onArchiveProgress?: (callback: (data: { synced: number; total: number }) => void) => () => void;
      };

      // Resources (Skills, MCP, CLAUDE.md)
      resources: {
        getResources: (projectPath?: string) => Promise<{ resources: ConfigResource[] }>;
        getResourceContent: (resourcePath: string) => Promise<ResourceContent | null>;
        getSettings: () => Promise<{ settings: Record<string, unknown> }>;
        saveSettings: (settings: Record<string, unknown>) => Promise<{ success: boolean }>;
        getClaudeMd: (projectPath?: string) => Promise<{ content: string | null }>;
        saveClaudeMd: (content: string, projectPath?: string) => Promise<{ success: boolean }>;
        onResourceChange?: (callback: (data: { type: string; path: string }) => void) => () => void;
      };

      // Auto update
      update: {
        check: () => Promise<{
          success: boolean;
          info?: { version: string; releaseDate: string };
          error?: string;
        }>;
        download: () => Promise<{ success: boolean; error?: string }>;
        install: () => Promise<{ success: boolean; error?: string }>;
        getStatus: () => Promise<{
          status: {
            checking: boolean;
            available: boolean;
            downloading: boolean;
            downloaded: boolean;
            error: string | null;
            info: { version: string; releaseDate: string } | null;
            progress: {
              bytesPerSecond: number;
              percent: number;
              total: number;
              transferred: number;
            } | null;
          };
        }>;
        onStatus: (callback: (status: {
          checking: boolean;
          available: boolean;
          downloading: boolean;
          downloaded: boolean;
          error: string | null;
          info: { version: string; releaseDate: string } | null;
          progress: {
            bytesPerSecond: number;
            percent: number;
            total: number;
            transferred: number;
          } | null;
        }) => void) => () => void;
      };

      // CLI Tools management
      tools: {
        detectAll: () => Promise<{ tools: ToolInfo[] }>;
        detect: (type: string) => Promise<{ tool: ToolInfo | null }>;
        getConfig: () => Promise<{ config: ToolsConfig }>;
        saveConfig: (config: ToolsConfig) => Promise<{ success: boolean }>;
        addCustomCommand: (command: CustomCommand) => Promise<{ success: boolean; commands: CustomCommand[] }>;
        removeCustomCommand: (id: string) => Promise<{ success: boolean; commands: CustomCommand[] }>;
        updateCustomCommand: (command: CustomCommand) => Promise<{ success: boolean; commands: CustomCommand[] }>;
        getCustomCommands: () => Promise<{ commands: CustomCommand[] }>;
      };

      // Git Worktree management
      worktree: {
        detectRepo: (cwd: string) => Promise<{ isRepo: boolean; repoPath?: string; branch?: string }>;
        list: (repoPath: string) => Promise<{ worktrees: WorktreeInfo[]; setup?: WorktreeSetup; error?: string }>;
        create: (repoPath: string) => Promise<{ success: boolean; worktreePath?: string; branch?: string; setupCommand?: string; code?: WorktreeErrorCode; error?: string }>;
        rename: (worktreePath: string, newBranch: string) => Promise<{ success: boolean; code?: WorktreeErrorCode; error?: string }>;
        remove: (worktreePath: string, force?: boolean) => Promise<{ success: boolean; code?: WorktreeErrorCode; error?: string }>;
        getStatus: (worktreePath: string) => Promise<{ success: boolean; dirtyCount?: number; unmergedCount?: number; branch?: string; code?: WorktreeErrorCode; error?: string }>;
        merge: (worktreePath: string) => Promise<{ success: boolean; merged?: boolean; mainBranch?: string; code?: WorktreeErrorCode; error?: string }>;
      };

      shell: {
        openPath: (path: string) => Promise<string>;
      };

      // App-level operations
      app: {
        setOverlayBadge: (hasWaiting: boolean) => Promise<void>;
      };
    };
  }
}

export {};
