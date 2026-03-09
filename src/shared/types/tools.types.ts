/**
 * CLI Tools Types
 *
 * Type definitions for CLI tool detection and management.
 */

export type ToolType = 'claude' | 'codex' | 'gemini' | 'custom'

export type ToolStatus = 'installed' | 'not_installed' | 'error'

export interface ToolInfo {
  /** Tool identifier */
  type: ToolType
  /** Display name */
  name: string
  /** Installation status */
  status: ToolStatus
  /** Version string if installed */
  version?: string
  /** Executable path if found */
  path?: string
  /** Error message if status is 'error' */
  error?: string
  /** Description */
  description: string
  /** Installation command hint */
  installHint?: string
  /** Homepage URL */
  homepage?: string
}

export interface CustomCommand {
  /** Unique ID */
  id: string
  /** Display name */
  name: string
  /** Command to execute */
  command: string
  /** Working directory (optional) */
  cwd?: string
  /** Description */
  description?: string
  /** Icon (emoji) */
  icon?: string
}

export interface ToolsState {
  /** Detected tools */
  tools: ToolInfo[]
  /** Custom commands */
  customCommands: CustomCommand[]
  /** Detection in progress */
  detecting: boolean
  /** Last detection time */
  lastDetected?: string
}

export interface ToolsConfig {
  /** Custom commands saved by user */
  customCommands: CustomCommand[]
  /** Tool detection enabled */
  autoDetect: boolean
}
