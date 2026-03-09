/**
 * CLI Tool Detector Service
 *
 * Detects installed CLI tools (Claude Code, Codex CLI, Gemini CLI) on Windows.
 */

import { execSync } from 'child_process'
import type { ToolInfo, ToolType } from '@shared/types/tools.types'

// Windows where command to find executable
const WHERE_CMD = 'where'

/**
 * Tool detection configurations
 */
const TOOL_CONFIGS: Record<ToolType, {
  name: string
  command: string
  versionFlag: string
  description: string
  installHint: string
  homepage: string
}> = {
  claude: {
    name: 'Claude Code',
    command: 'claude',
    versionFlag: '--version',
    description: 'Anthropic\'s official Claude CLI for coding tasks',
    installHint: 'npm install -g @anthropic-ai/claude-code',
    homepage: 'https://claude.ai/code'
  },
  codex: {
    name: 'Codex CLI',
    command: 'codex',
    versionFlag: '--version',
    description: 'OpenAI\'s Codex CLI for code generation',
    installHint: 'pip install codex-cli',
    homepage: 'https://github.com/openai/codex'
  },
  gemini: {
    name: 'Gemini CLI',
    command: 'gemini',
    versionFlag: '--version',
    description: 'Google\'s Gemini CLI for AI assistance',
    installHint: 'pip install gemini-cli',
    homepage: 'https://ai.google.dev/'
  },
  custom: {
    name: 'Custom Command',
    command: '',
    versionFlag: '',
    description: 'User-defined custom command',
    installHint: '',
    homepage: ''
  }
}

/**
 * Find executable path using Windows 'where' command
 */
function findExecutable(command: string): string | null {
  try {
    const output = execSync(`${WHERE_CMD} ${command}`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    // Return first match
    const paths = output.trim().split('\n')
    return paths[0]?.trim() || null
  } catch {
    return null
  }
}

/**
 * Get version of a tool
 */
function getVersion(command: string, versionFlag: string): string | null {
  try {
    const output = execSync(`${command} ${versionFlag}`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return output.trim()
  } catch {
    return null
  }
}

/**
 * Detect a single tool
 */
function detectTool(type: ToolType): ToolInfo {
  const config = TOOL_CONFIGS[type]

  if (type === 'custom') {
    return {
      type,
      name: config.name,
      status: 'installed',
      description: config.description,
      installHint: config.installHint,
      homepage: config.homepage
    }
  }

  const path = findExecutable(config.command)

  if (!path) {
    return {
      type,
      name: config.name,
      status: 'not_installed',
      description: config.description,
      installHint: config.installHint,
      homepage: config.homepage
    }
  }

  const version = getVersion(config.command, config.versionFlag)

  return {
    type,
    name: config.name,
    status: 'installed',
    version: version || 'unknown',
    path,
    description: config.description,
    installHint: config.installHint,
    homepage: config.homepage
  }
}

/**
 * Detect all CLI tools
 */
export function detectAllTools(): ToolInfo[] {
  const tools: ToolInfo[] = []

  for (const type of ['claude', 'codex', 'gemini'] as ToolType[]) {
    try {
      tools.push(detectTool(type))
    } catch (error) {
      tools.push({
        type,
        name: TOOL_CONFIGS[type].name,
        status: 'error',
        error: error instanceof Error ? error.message : 'Detection failed',
        description: TOOL_CONFIGS[type].description,
        installHint: TOOL_CONFIGS[type].installHint,
        homepage: TOOL_CONFIGS[type].homepage
      })
    }
  }

  return tools
}

/**
 * Detect a specific tool
 */
export function detectToolByType(type: ToolType): ToolInfo {
  return detectTool(type)
}

/**
 * Check if a command is available
 */
export function isCommandAvailable(command: string): boolean {
  return findExecutable(command) !== null
}

/**
 * Get tool config
 */
export function getToolConfig(type: ToolType) {
  return TOOL_CONFIGS[type]
}
