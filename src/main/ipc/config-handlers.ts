/**
 * Config IPC Handlers
 *
 * Handles IPC communication for config/skills/MCP functionality.
 * Routes: config:get-resources, config:get-resource-content, etc.
 */

import * as path from 'path';
import * as fs from 'fs';
import { ipcMain, BrowserWindow } from 'electron';
import { homedir } from 'os';
import { IPC_CHANNELS } from '@shared/constants/channels';
import type {
  ConfigResource,
  ResourceContent,
  ResourceType,
} from '@shared/types/config.types';
import {
  getResources,
  getResourceContent,
  watchConfigChanges,
} from '../services/config/ConfigScanner';
import { isPathAllowed, isValidWorkingDir } from '../utils/security';

/** Settings file path */
function getSettingsPath(): string {
  return path.join(homedir(), '.multicc', 'settings.json');
}

/** Default settings */
const DEFAULT_SETTINGS = {
  theme: 'dark',
  fontSize: 14,
  fontFamily: 'Consolas, "Courier New", monospace',
  confirmClose: true,
  enableArchive: true,
  maxTerminals: 20,
};

/** Load settings from file */
function loadSettings(): Record<string, unknown> {
  const settingsPath = getSettingsPath();
  try {
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(content);
      return { ...DEFAULT_SETTINGS, ...settings };
    }
  } catch (error) {
    console.error('[Config] Error loading settings:', error);
  }
  return { ...DEFAULT_SETTINGS };
}

/** Save settings to file */
function saveSettings(settings: Record<string, unknown>): boolean {
  const settingsPath = getSettingsPath();
  try {
    // Ensure directory exists
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write with atomic operation
    const tempPath = `${settingsPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2), 'utf-8');
    fs.renameSync(tempPath, settingsPath);

    return true;
  } catch (error) {
    console.error('[Config] Error saving settings:', error);
    return false;
  }
}

/**
 * Register all config IPC handlers
 */
export function registerConfigHandlers(_window: BrowserWindow): void {
  // Get all config resources
  ipcMain.handle(
    IPC_CHANNELS.CONFIG.GET_RESOURCES,
    async (_event, projectPath?: string): Promise<{ resources: ConfigResource[] }> => {
      const resources = await getResources(projectPath);
      return { resources };
    }
  );

  // Get resource content
  ipcMain.handle(
    IPC_CHANNELS.CONFIG.GET_RESOURCE_CONTENT,
    async (_event, resourcePath: string): Promise<ResourceContent | null> => {
      // Validate path is within allowed directories
      if (!isPathAllowed(resourcePath)) {
        console.warn('[Config] getResourceContent rejected: path not allowed', resourcePath)
        return null
      }

      const content = await getResourceContent(resourcePath);
      if (content === null) {
        return null;
      }

      // Determine if content is JSON
      let isJson = false;
      try {
        JSON.parse(content);
        isJson = true;
      } catch {
        // Not JSON
      }

      return {
        path: resourcePath,
        type: getResourceTypeFromPath(resourcePath),
        content,
        isJson,
      };
    }
  );

  // Get settings
  ipcMain.handle(
    IPC_CHANNELS.CONFIG.GET_SETTINGS,
    async (): Promise<{ settings: Record<string, unknown> }> => {
      const settings = loadSettings();
      return { settings };
    }
  );

  // Save settings
  ipcMain.handle(
    IPC_CHANNELS.CONFIG.SAVE_SETTINGS,
    async (_event, settings: Record<string, unknown>): Promise<{ success: boolean }> => {
      console.log('[Config] Save settings:', settings);
      const success = saveSettings(settings);
      return { success };
    }
  );

  // Get CLAUDE.md content
  ipcMain.handle(
    IPC_CHANNELS.CONFIG.GET_CLAUDE_MD,
    async (_event, projectPath?: string): Promise<{ content: string | null }> => {
      let claudeMdPath: string | null = null;

      // Try project level first
      if (projectPath) {
        const projectClaudeMd = path.join(projectPath, 'CLAUDE.md');
        if (fs.existsSync(projectClaudeMd)) {
          claudeMdPath = projectClaudeMd;
        }
      }

      // Fall back to system level
      if (!claudeMdPath) {
        const systemClaudeMd = path.join(homedir(), '.claude', 'CLAUDE.md');
        if (fs.existsSync(systemClaudeMd)) {
          claudeMdPath = systemClaudeMd;
        }
      }

      if (!claudeMdPath) {
        return { content: null };
      }

      try {
        const content = fs.readFileSync(claudeMdPath, 'utf-8');
        return { content };
      } catch (error) {
        console.error('[Config] Error reading CLAUDE.md:', error);
        return { content: null };
      }
    }
  );

  // Save CLAUDE.md content
  ipcMain.handle(
    IPC_CHANNELS.CONFIG.SAVE_CLAUDE_MD,
    async (_event, content: string, projectPath?: string): Promise<{ success: boolean }> => {
      let claudeMdPath: string;
      if (projectPath) {
        // C3: 路径验证 — 只允许写入合法工作目录
        if (!isValidWorkingDir(projectPath)) {
          console.warn('[Config] save-claude-md rejected: invalid projectPath', projectPath);
          return { success: false };
        }
        claudeMdPath = path.join(projectPath, 'CLAUDE.md');
      } else {
        claudeMdPath = path.join(homedir(), '.claude', 'CLAUDE.md');
      }

      try {
        // Ensure directory exists
        const dir = path.dirname(claudeMdPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Write with atomic operation (write to temp, then rename)
        const tempPath = `${claudeMdPath}.tmp`;
        fs.writeFileSync(tempPath, content, 'utf-8');
        fs.renameSync(tempPath, claudeMdPath);

        return { success: true };
      } catch (error) {
        console.error('[Config] Error saving CLAUDE.md:', error);
        return { success: false };
      }
    }
  );

  // Watch for config changes
  const unwatch = watchConfigChanges((type, changedPath) => {
    // Notify renderer of changes
    _window.webContents.send(IPC_CHANNELS.CONFIG.RESOURCE_CHANGE, {
      type,
      path: changedPath,
    });
  });

  // Cleanup on window close
  _window.on('closed', () => {
    unwatch();
  });

  // Translate text (EN → ZH) using ZhipuAI GLM
  ipcMain.handle(
    IPC_CHANNELS.TRANSLATE,
    async (_event, text: string): Promise<{ success: boolean; translated?: string; error?: string }> => {
      if (!text || !text.trim()) {
        return { success: false, error: 'No text to translate' };
      }

      const apiKey = process.env.ZHIPU_API_KEY;
      if (!apiKey) {
        return { success: false, error: 'ZHIPU_API_KEY not set' };
      }

      try {
        const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'glm-4-flash',
            messages: [
              {
                role: 'system',
                content: 'You are a translator. Translate the following text to Chinese (Simplified). Preserve markdown formatting, code blocks, and technical terms. Output ONLY the translated text, nothing else.',
              },
              { role: 'user', content: text },
            ],
            temperature: 0.1,
            max_tokens: 4096,
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          return { success: false, error: `API error: ${response.status}` };
        }

        const data = await response.json() as { choices: Array<{ message: { content: string } }> };
        const translated = data.choices?.[0]?.message?.content;
        if (!translated) {
          return { success: false, error: 'No translation returned' };
        }

        return { success: true, translated };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  );
}

/**
 * Get resource type from file path
 */
function getResourceTypeFromPath(filePath: string): ResourceType {
  const basename = path.basename(filePath).toLowerCase();

  if (basename === 'mcp.json') {
    return 'mcp-config';
  }

  if (basename === 'claude.md') {
    return 'claude-md';
  }

  if (basename === 'skill.md') {
    return 'skill';
  }

  // Check if parent directory is a skill directory
  const parentDir = path.dirname(filePath);
  const skillMdPath = path.join(parentDir, 'SKILL.md');
  if (fs.existsSync(skillMdPath)) {
    return 'skill';
  }

  // Default to settings
  return 'settings';
}
