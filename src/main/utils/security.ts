/**
 * Security Utilities
 *
 * Provides input validation and path sanitization for IPC handlers.
 */

import { normalize, resolve, sep, basename, dirname, join } from 'path'
import { existsSync, realpathSync, statSync } from 'fs'
import { homedir } from 'os'

// Allowed base directories for file operations
const ALLOWED_BASE_DIRS = [
  join(homedir(), '.claude'),
  join(homedir(), '.multicc'),
  join(homedir(), '.codex'),
  join(homedir(), '.gemini'),
]

// Command whitelist for custom commands
const ALLOWED_COMMANDS = [
  'claude',
  'codex',
  'gemini',
  'npm',
  'node',
  'npx',
  'yarn',
  'pnpm',
  'git',
  'python',
  'python3',
  'pip',
  'pip3',
  'cargo',
  'rustc',
  'go',
  'code',
  'code-insiders',
  'cursor',
]

// Dangerous command patterns
const DANGEROUS_PATTERNS = [
  /rm\s+-rf/,
  /del\s+\/[sS]/,
  /format\s+/,
  /:\(\)\{.*;\};/,
  />\s*\/dev\//,
  /mklink/,
  /reg\s+/,
  /powershell.*-enc/,
  /cmd.*\/c.*del/i,
  /&&\s*del/i,
  /\|\s*del/i,
]

/**
 * Validate and normalize a user-provided path
 * Returns null if the path is invalid or attempts traversal
 */
export function safePath(baseDir: string, userPath: string): string | null {
  try {
    // Normalize the path to remove .. and .
    const normalized = normalize(userPath)

    // Resolve to absolute path
    const absolute = resolve(baseDir, normalized)

    // Check if the resolved path is within the base directory
    if (!absolute.startsWith(baseDir + sep) && absolute !== baseDir) {
      console.warn(`[Security] Path traversal attempt: ${userPath} resolved to ${absolute}`)
      return null
    }

    // Additional check: ensure no null bytes
    if (absolute.includes('\0')) {
      console.warn('[Security] Null byte in path')
      return null
    }

    return absolute
  } catch (error) {
    console.error('[Security] Path validation error:', error)
    return null
  }
}

/**
 * Validate that a path is within allowed directories
 */
export function isPathAllowed(filePath: string): boolean {
  const resolved = resolve(filePath)

  return ALLOWED_BASE_DIRS.some(baseDir => {
    const normalizedBase = resolve(baseDir)
    return resolved.startsWith(normalizedBase + sep) || resolved === normalizedBase
  })
    // Also allow paths under any .claude/skills/ directory (project-level skills)
    || isProjectLevelClaudePath(resolved)
}

/**
 * Check if a path is under a project-level .claude directory
 * (e.g., C:\Projects\myapp\.claude\skills\...)
 */
function isProjectLevelClaudePath(resolved: string): boolean {
  // Match paths containing .claude/skills or .claude/mcp.json or .claude/CLAUDE.md
  const normalized = resolved.replace(/\\/g, '/')
  return /\.claude\/(skills|mcp\.json|CLAUDE\.md)/.test(normalized)
    || normalized.endsWith('.claude/skills')
    || /\.claude\/skills\//.test(normalized)
}

/**
 * Validate project hash (should be alphanumeric with possible hyphens)
 */
export function isValidProjectHash(hash: string): boolean {
  if (!hash || typeof hash !== 'string') return false
  // Project hashes are typically 64 character hex strings or similar
  return /^[a-zA-Z0-9_-]+$/.test(hash) && hash.length <= 128
}

/**
 * Validate session ID (should be alphanumeric with possible hyphens)
 */
export function isValidSessionId(sessionId: string): boolean {
  if (!sessionId || typeof sessionId !== 'string') return false
  return /^[a-zA-Z0-9_-]+$/.test(sessionId) && sessionId.length <= 128
}

/**
 * Validate command is allowed and safe
 */
export function isCommandAllowed(command: string): boolean {
  if (!command || typeof command !== 'string') return false

  // Trim and get the base command
  const trimmed = command.trim()
  if (trimmed.length === 0) return false

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      console.warn(`[Security] Dangerous command pattern detected: ${trimmed}`)
      return false
    }
  }

  // Extract the base command (first word)
  const baseCmd = trimmed.split(/\s+/)[0]

  // On Windows, handle path-based commands
  const cmdName = basename(baseCmd, '.exe').toLowerCase()

  // Check against whitelist
  const isAllowed = ALLOWED_COMMANDS.some(
    allowed => cmdName === allowed.toLowerCase() ||
               baseCmd.toLowerCase() === allowed.toLowerCase()
  )

  if (!isAllowed) {
    console.warn(`[Security] Command not in whitelist: ${baseCmd}`)
  }

  return isAllowed
}

/**
 * Sanitize filename by removing dangerous characters
 */
export function sanitizeFilename(filename: string): string {
  // Remove path separators and null bytes
  let sanitized = filename.replace(/[\/\\:\x00]/g, '_')

  // Remove other potentially dangerous characters on Windows
  sanitized = sanitized.replace(/[<>:"|?*]/g, '_')

  // Limit length
  if (sanitized.length > 255) {
    const ext = sanitized.slice(-10)
    sanitized = sanitized.slice(0, 245) + ext
  }

  return sanitized
}

/**
 * Validate URL is safe (basic check)
 */
export function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url)

    // Only allow http and https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false
    }

    // Block local network access (optional, depends on requirements)
    const hostname = parsed.hostname
    if (hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.')) {
      // Allow for development, but log it
      console.log(`[Security] Local network URL accessed: ${hostname}`)
    }

    return true
  } catch {
    return false
  }
}

/**
 * Escape shell argument for safe command execution
 */
export function escapeShellArg(arg: string): string {
  // On Windows, use double quotes and escape internal quotes
  if (process.platform === 'win32') {
    return `"${arg.replace(/"/g, '""')}"`
  }
  // On Unix, use single quotes and escape internal single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`
}

/**
 * Validate working directory path
 */
export function isValidWorkingDir(cwd: string | undefined): boolean {
  if (!cwd) return true // Empty is valid (will use default)

  try {
    const resolved = resolve(cwd)

    // Check if directory exists
    if (!existsSync(resolved)) {
      return false
    }

    // Check if it's actually a directory
    const stats = statSync(resolved)
    if (!stats.isDirectory()) {
      return false
    }

    return true
  } catch {
    return false
  }
}
