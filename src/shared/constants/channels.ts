/**
 * IPC Channel Names
 *
 * Centralized channel definitions for main-renderer communication.
 * Uses namespace prefixes to avoid collisions.
 */

export const IPC_CHANNELS = {
  // Existing terminal channels
  TERMINAL: {
    CREATE: 'terminal:create',
    WRITE: 'terminal:write',
    RESIZE: 'terminal:resize',
    DESTROY: 'terminal:destroy',
    ON_DATA: 'terminal:on-data',
    ON_EXIT: 'terminal:on-exit',
  },

  // Chat history channels (new)
  CHAT: {
    GET_PROJECTS: 'chat:get-projects',
    GET_SESSIONS: 'chat:get-sessions',
    GET_SESSION: 'chat:get-session',
    SEARCH: 'chat:search',
    EXPORT: 'chat:export',
    SET_SESSION_NAME: 'chat:set-session-name',
    DELETE_SESSION: 'chat:delete-session',
    RESTORE_SESSION: 'chat:restore-session',
    // Push events (main → renderer)
    SESSION_UPDATE: 'chat:session-update',
    SYNC_STATUS: 'chat:sync-status',
    ARCHIVE_PROGRESS: 'chat:archive-progress',
  },

  // Config channels (future)
  CONFIG: {
    GET_RESOURCES: 'config:get-resources',
    GET_RESOURCE_CONTENT: 'config:get-resource-content',
    GET_SETTINGS: 'config:get-settings',
    SAVE_SETTINGS: 'config:save-settings',
    GET_CLAUDE_MD: 'config:get-claude-md',
    SAVE_CLAUDE_MD: 'config:save-claude-md',
    // Push events
    RESOURCE_CHANGE: 'config:resource-change',
  },

  // App channels (existing)
  APP: {
    GET_CONFIG: 'app:get-config',
    SAVE_CONFIG: 'app:save-config',
    GET_HOME_PATH: 'app:get-home-path',
  },

  // Marketplace channels (ClawHub)
  MARKETPLACE: {
    SEARCH: 'marketplace:search',
    BROWSE: 'marketplace:browse',
    DETAIL: 'marketplace:detail',
    CATEGORIES: 'marketplace:categories',
    INSTALL: 'marketplace:install',
    UNINSTALL: 'marketplace:uninstall',
    INSTALLED: 'marketplace:installed',
  },

  // Translation
  TRANSLATE: 'config:translate',

  // Update channels (new)
  UPDATE: {
    CHECK: 'update:check',
    DOWNLOAD: 'update:download',
    INSTALL: 'update:install',
    GET_STATUS: 'update:get-status',
    // Push events
    STATUS: 'update:status',
    PROGRESS: 'update:progress',
    DOWNLOADED: 'update:downloaded',
    ERROR: 'update:error',
  },
} as const;
