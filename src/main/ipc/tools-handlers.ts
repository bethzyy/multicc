/**
 * Tools IPC Handlers
 *
 * Handles IPC communication for CLI tool detection and management.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { detectAllTools, detectToolByType } from '../services/tools/CliDetector'
import type { ToolInfo, CustomCommand, ToolsConfig } from '@shared/types/tools.types'
import { StoreService } from '../services/store'
import {
  isCommandAllowed,
  isValidWorkingDir,
  sanitizeFilename,
} from '../utils/security'

let storeService: StoreService | null = null

const TOOLS_CONFIG_KEY = 'tools-config'

function getDefaultConfig(): ToolsConfig {
  return {
    customCommands: [],
    autoDetect: true
  }
}

/**
 * Get tools configuration from store
 */
function getToolsConfig(): ToolsConfig {
  if (!storeService) {
    return getDefaultConfig()
  }
  try {
    const config = storeService.get(TOOLS_CONFIG_KEY) as ToolsConfig | undefined
    return config || getDefaultConfig()
  } catch {
    return getDefaultConfig()
  }
}

/**
 * Save tools configuration to store
 */
function saveToolsConfig(config: ToolsConfig): void {
  if (!storeService) {
    throw new Error('Store service not initialized')
  }
  storeService.set(TOOLS_CONFIG_KEY, config)
}

/**
 * Register all tools IPC handlers
 */
export function registerToolsHandlers(window: BrowserWindow, store: StoreService): void {
  storeService = store

  // Detect all tools
  ipcMain.handle('tools:detect-all', async (): Promise<{ tools: ToolInfo[] }> => {
    try {
      const tools = detectAllTools()
      return { tools }
    } catch (error) {
      console.error('[ToolsHandler] Detection failed:', error)
      return { tools: [] }
    }
  })

  // Detect specific tool
  ipcMain.handle('tools:detect', async (_, type: string): Promise<{ tool: ToolInfo | null }> => {
    try {
      const tool = detectToolByType(type as 'claude' | 'codex' | 'gemini' | 'custom')
      return { tool }
    } catch (error) {
      console.error('[ToolsHandler] Detection failed:', error)
      return { tool: null }
    }
  })

  // Get tools configuration
  ipcMain.handle('tools:get-config', async (): Promise<{ config: ToolsConfig }> => {
    return { config: getToolsConfig() }
  })

  // Save tools configuration
  ipcMain.handle('tools:save-config', async (_, config: ToolsConfig): Promise<{ success: boolean }> => {
    try {
      saveToolsConfig(config)
      return { success: true }
    } catch (error) {
      console.error('[ToolsHandler] Save config failed:', error)
      return { success: false }
    }
  })

  // Add custom command
  ipcMain.handle('tools:add-custom-command', async (_, command: CustomCommand): Promise<{ success: boolean; commands: CustomCommand[]; error?: string }> => {
    try {
      // Validate command
      if (!command.command || typeof command.command !== 'string') {
        return { success: false, commands: [], error: 'Invalid command' }
      }

      // Check if command is allowed
      if (!isCommandAllowed(command.command)) {
        console.warn('[ToolsHandler] Command not allowed:', command.command)
        return { success: false, commands: [], error: 'Command not allowed for security reasons' }
      }

      // Validate working directory if provided
      if (command.cwd && !isValidWorkingDir(command.cwd)) {
        return { success: false, commands: [], error: 'Invalid working directory' }
      }

      // Sanitize command name
      const sanitizedCommand: CustomCommand = {
        ...command,
        name: command.name ? sanitizeFilename(command.name) : 'Unnamed',
      }

      const config = getToolsConfig()
      config.customCommands.push(sanitizedCommand)
      saveToolsConfig(config)
      return { success: true, commands: config.customCommands }
    } catch (error) {
      console.error('[ToolsHandler] Add custom command failed:', error)
      return { success: false, commands: [], error: 'Failed to add command' }
    }
  })

  // Remove custom command
  ipcMain.handle('tools:remove-custom-command', async (_, id: string): Promise<{ success: boolean; commands: CustomCommand[] }> => {
    try {
      const config = getToolsConfig()
      config.customCommands = config.customCommands.filter(c => c.id !== id)
      saveToolsConfig(config)
      return { success: true, commands: config.customCommands }
    } catch (error) {
      console.error('[ToolsHandler] Remove custom command failed:', error)
      return { success: false, commands: [] }
    }
  })

  // Update custom command
  ipcMain.handle('tools:update-custom-command', async (_, command: CustomCommand): Promise<{ success: boolean; commands: CustomCommand[] }> => {
    try {
      const config = getToolsConfig()
      const index = config.customCommands.findIndex(c => c.id === command.id)
      if (index >= 0) {
        config.customCommands[index] = command
        saveToolsConfig(config)
      }
      return { success: true, commands: config.customCommands }
    } catch (error) {
      console.error('[ToolsHandler] Update custom command failed:', error)
      return { success: false, commands: [] }
    }
  })

  // Get custom commands
  ipcMain.handle('tools:get-custom-commands', async (): Promise<{ commands: CustomCommand[] }> => {
    const config = getToolsConfig()
    return { commands: config.customCommands }
  })
}
