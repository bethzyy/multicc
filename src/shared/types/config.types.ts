/**
 * Config Domain Types
 *
 * Types for Skills, MCP servers, and other configuration resources.
 */

/** Resource type */
export type ResourceType = 'skill' | 'mcp-server' | 'mcp-config' | 'settings' | 'claude-md';

/** Base resource info */
export interface ResourceInfo {
  /** Resource type */
  type: ResourceType;
  /** Resource name/ID */
  name: string;
  /** Display name */
  displayName: string;
  /** Resource path */
  path: string;
  /** Whether this is a project-level resource */
  isProjectLevel: boolean;
  /** Description (from SKILL.md or config) */
  description?: string;
  /** Last modified time (ms) */
  lastModified?: number;
  /** File size (bytes) */
  size?: number;
}

/** Skill info */
export interface SkillInfo extends ResourceInfo {
  type: 'skill';
  /** Whether the skill has a SKILL.md file */
  hasReadme: boolean;
  /** Skill version (if available) */
  version?: string;
  /** Skill commands */
  commands?: string[];
}

/** MCP server configuration */
export interface McpServerConfig {
  /** Server name */
  name: string;
  /** Command to run */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Whether server is enabled */
  disabled?: boolean;
}

/** MCP config file info */
export interface McpConfigInfo extends ResourceInfo {
  type: 'mcp-config';
  /** MCP servers defined in this config */
  servers: McpServerConfig[];
}

/** Claude.md file info */
export interface ClaudeMdInfo extends ResourceInfo {
  type: 'claude-md';
  /** Content preview (first 500 chars) */
  preview?: string;
}

/** Config resource union type */
export type ConfigResource = SkillInfo | McpConfigInfo | ClaudeMdInfo;

/** Resource content response */
export interface ResourceContent {
  /** Resource path */
  path: string;
  /** Resource type */
  type: ResourceType;
  /** Content (text or JSON) */
  content: string;
  /** Whether content is JSON */
  isJson: boolean;
}

/** Settings file structure */
export interface AppSettings {
  /** Theme: 'dark' | 'light' | 'system' */
  theme: 'dark' | 'light' | 'system';
  /** Font size for terminal */
  fontSize: number;
  /** Font family for terminal */
  fontFamily: string;
  /** Whether to confirm before closing terminal with running process */
  confirmClose: boolean;
  /** Whether to enable chat history archive */
  enableArchive: boolean;
  /** Max terminals allowed */
  maxTerminals: number;
  /** Default shell */
  shell: string;
}

/** Default settings */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  fontSize: 14,
  fontFamily: 'Consolas, "Courier New", monospace',
  confirmClose: true,
  enableArchive: true,
  maxTerminals: 20,
  shell: 'cmd.exe',
};

// ── Marketplace types (ClawHub) ──

/** Skill list item from ClawHub API */
export interface MarketplaceSkill {
  slug: string;
  displayName: string;
  summary: string | null;
  tags: Record<string, string>;
  stats: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  latestVersion: {
    version: string;
    createdAt: number;
    changelog: string;
  } | null;
}

/** Skill detail from ClawHub API */
export interface SkillDetail {
  skill: {
    slug: string;
    displayName: string;
    summary: string | null;
    tags: Record<string, string>;
    stats: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
  } | null;
  latestVersion: {
    version: string;
    createdAt: number;
    changelog: string;
  } | null;
  owner: {
    handle: string | null;
    displayName: string | null;
    image: string | null;
  } | null;
  moderation: {
    isSuspicious: boolean;
    isMalwareBlocked: boolean;
    verdict: 'clean' | 'suspicious' | 'malicious';
    reasonCodes: string[];
    summary: string | null;
  } | null;
}

/** Search result from ClawHub API */
export interface MarketplaceSearchResult {
  score: number;
  slug: string | null;
  displayName: string | null;
  summary: string | null;
  version: string | null;
  updatedAt: number | null;
}

/** Paginated list response from ClawHub API */
export interface MarketplaceListResponse {
  items: MarketplaceSkill[];
  nextCursor: string | null;
}

/** Search response from ClawHub API */
export interface MarketplaceSearchResponse {
  results: MarketplaceSearchResult[];
}

/** Security scan result */
export interface SecurityScanResult {
  status: 'clean' | 'suspicious' | 'malicious' | 'pending' | 'error';
  hasWarnings: boolean;
  checkedAt: number | null;
  model: string | null;
  hasScanResult: boolean;
}

/** Install result */
export interface InstallResult {
  success: boolean;
  path: string;
  error?: string;
  alreadyExists?: boolean;
}
