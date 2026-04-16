/**
 * Config Scanner Service
 *
 * Scans ~/.claude/skills/ and ~/.claude/mcp.json for installed skills and MCP servers.
 * Also scans project-level .claude/skills/ directories.
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import type {
  SkillInfo,
  McpConfigInfo,
  McpServerConfig,
  ClaudeMdInfo,
  ConfigResource,
  ResourceType,
} from '@shared/types/config.types';

/** Get Claude Code config directory */
export function getClaudeConfigDir(): string {
  return path.join(homedir(), '.claude');
}

/** Get skills directory */
export function getSkillsDir(): string {
  return path.join(getClaudeConfigDir(), 'skills');
}

/** Get MCP config file path */
export function getMcpConfigPath(): string {
  return path.join(getClaudeConfigDir(), 'mcp.json');
}

/**
 * Scan all skills from ~/.claude/skills/
 */
export async function scanSkills(projectPath?: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  // Scan system skills
  const systemSkillsDir = getSkillsDir();
  if (fs.existsSync(systemSkillsDir)) {
    const systemSkills = await scanSkillsDirectory(systemSkillsDir, false);
    skills.push(...systemSkills);
  }

  // Scan project skills if project path provided
  if (projectPath) {
    const projectSkillsDir = path.join(projectPath, '.claude', 'skills');
    if (fs.existsSync(projectSkillsDir)) {
      const projectSkills = await scanSkillsDirectory(projectSkillsDir, true);
      skills.push(...projectSkills);
    }
  }

  return skills;
}

/**
 * Scan a single skills directory
 */
async function scanSkillsDirectory(
  skillsDir: string,
  isProjectLevel: boolean
): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = path.join(skillsDir, entry.name);
      const skillInfo = await getSkillInfo(skillPath, entry.name, isProjectLevel);
      if (skillInfo) {
        skills.push(skillInfo);
      }
    }
  } catch (error) {
    console.error('[ConfigScanner] Error scanning skills:', error);
  }

  return skills;
}

/**
 * Get skill info from directory
 */
async function getSkillInfo(
  skillPath: string,
  name: string,
  isProjectLevel: boolean
): Promise<SkillInfo | null> {
  try {
    const stat = fs.statSync(skillPath);
    const readmePath = path.join(skillPath, 'SKILL.md');
    const hasReadme = fs.existsSync(readmePath);

    let description: string | undefined;
    let version: string | undefined;
    let commands: string[] | undefined;

    // Try to read SKILL.md for description
    if (hasReadme) {
      try {
        const content = fs.readFileSync(readmePath, 'utf-8');
        // Extract description from first paragraph
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('```')) {
            description = trimmed.slice(0, 200);
            break;
          }
        }

        // Extract commands from content
        const commandMatches = content.match(/\/[\w-]+/g);
        if (commandMatches) {
          commands = [...new Set(commandMatches)];
        }
      } catch {
        // Ignore read errors
      }
    }

    return {
      type: 'skill',
      name,
      displayName: name,
      path: skillPath,
      isProjectLevel,
      description,
      lastModified: stat.mtimeMs,
      hasReadme,
      version,
      commands,
    };
  } catch (error) {
    console.error(`[ConfigScanner] Error getting skill info for ${name}:`, error);
    return null;
  }
}

/**
 * Scan MCP configuration from ~/.claude/mcp.json
 */
export async function scanMcpConfig(projectPath?: string): Promise<McpConfigInfo[]> {
  const configs: McpConfigInfo[] = [];

  // Scan system MCP config
  const systemMcpPath = getMcpConfigPath();
  if (fs.existsSync(systemMcpPath)) {
    const config = await getMcpConfigInfo(systemMcpPath, false);
    if (config) {
      configs.push(config);
    }
  }

  // Scan project MCP config if project path provided
  if (projectPath) {
    const projectMcpPath = path.join(projectPath, '.claude', 'mcp.json');
    if (fs.existsSync(projectMcpPath)) {
      const config = await getMcpConfigInfo(projectMcpPath, true);
      if (config) {
        configs.push(config);
      }
    }
  }

  return configs;
}

/**
 * Get MCP config info from file
 */
async function getMcpConfigInfo(
  configPath: string,
  isProjectLevel: boolean
): Promise<McpConfigInfo | null> {
  try {
    const stat = fs.statSync(configPath);
    const content = fs.readFileSync(configPath, 'utf-8');
    const json = JSON.parse(content);

    // Parse MCP servers from config
    const servers: McpServerConfig[] = [];

    // Handle different MCP config formats
    if (json.mcpServers) {
      for (const [name, serverConfig] of Object.entries(json.mcpServers)) {
        const config = serverConfig as {
          command?: string;
          args?: string[];
          env?: Record<string, string>;
          disabled?: boolean;
        };
        if (config.command) {
          servers.push({
            name,
            command: config.command,
            args: config.args,
            env: config.env,
            disabled: config.disabled,
          });
        }
      }
    }

    return {
      type: 'mcp-config',
      name: path.basename(configPath),
      displayName: isProjectLevel ? 'Project MCP Config' : 'System MCP Config',
      path: configPath,
      isProjectLevel,
      lastModified: stat.mtimeMs,
      servers,
    };
  } catch (error) {
    console.error(`[ConfigScanner] Error parsing MCP config ${configPath}:`, error);
    return null;
  }
}

/**
 * Scan CLAUDE.md files
 */
export async function scanClaudeMd(projectPath?: string): Promise<ClaudeMdInfo[]> {
  const files: ClaudeMdInfo[] = [];

  // System CLAUDE.md
  const systemClaudeMd = path.join(getClaudeConfigDir(), 'CLAUDE.md');
  if (fs.existsSync(systemClaudeMd)) {
    const info = await getClaudeMdInfo(systemClaudeMd, 'System CLAUDE.md', false);
    if (info) {
      files.push(info);
    }
  }

  // Project CLAUDE.md
  if (projectPath) {
    const projectClaudeMd = path.join(projectPath, 'CLAUDE.md');
    if (fs.existsSync(projectClaudeMd)) {
      const info = await getClaudeMdInfo(projectClaudeMd, 'Project CLAUDE.md', true);
      if (info) {
        files.push(info);
      }
    }
  }

  return files;
}

/**
 * Get CLAUDE.md file info
 */
async function getClaudeMdInfo(
  filePath: string,
  displayName: string,
  isProjectLevel: boolean
): Promise<ClaudeMdInfo | null> {
  try {
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');

    return {
      type: 'claude-md',
      name: path.basename(filePath),
      displayName,
      path: filePath,
      isProjectLevel,
      lastModified: stat.mtimeMs,
      size: stat.size,
      preview: content.slice(0, 500),
    };
  } catch (error) {
    console.error(`[ConfigScanner] Error reading CLAUDE.md ${filePath}:`, error);
    return null;
  }
}

/**
 * Get all config resources
 */
export async function getResources(projectPath?: string): Promise<ConfigResource[]> {
  const resources: ConfigResource[] = [];

  // If no projectPath provided, use process.cwd() as fallback
  const effectiveProjectPath = projectPath || process.cwd();

  // Scan skills
  const skills = await scanSkills(effectiveProjectPath);
  resources.push(...skills);

  // Also scan parent directory's .claude/skills/ (workspace-level skills)
  const parentDir = path.dirname(effectiveProjectPath);
  if (parentDir !== effectiveProjectPath) {
    const parentSkills = await scanSkills(parentDir);
    // Deduplicate by path
    const existingPaths = new Set(resources.map(r => r.path));
    for (const skill of parentSkills) {
      if (!existingPaths.has(skill.path)) {
        resources.push(skill);
        existingPaths.add(skill.path);
      }
    }
  }

  // Scan MCP config
  const mcpConfigs = await scanMcpConfig(effectiveProjectPath);
  resources.push(...mcpConfigs);

  // Scan CLAUDE.md files
  const claudeMdFiles = await scanClaudeMd(effectiveProjectPath);
  resources.push(...claudeMdFiles);

  return resources;
}

/**
 * Get resource content
 */
export async function getResourceContent(resourcePath: string): Promise<string | null> {
  try {
    if (!fs.existsSync(resourcePath)) {
      return null;
    }

    // Check if it's a directory (skill)
    const stat = fs.statSync(resourcePath);
    if (stat.isDirectory()) {
      // Return SKILL.md content if available
      const skillMdPath = path.join(resourcePath, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        return fs.readFileSync(skillMdPath, 'utf-8');
      }
      // Otherwise list directory contents
      const entries = fs.readdirSync(resourcePath);
      return `# Skill: ${path.basename(resourcePath)}\n\nFiles:\n${entries.map((e) => `- ${e}`).join('\n')}`;
    }

    // Read file content
    return fs.readFileSync(resourcePath, 'utf-8');
  } catch (error) {
    console.error(`[ConfigScanner] Error reading resource ${resourcePath}:`, error);
    return null;
  }
}

/**
 * Watch for config changes (using fs.watch)
 */
export function watchConfigChanges(
  callback: (type: ResourceType, path: string) => void
): () => void {
  const watchers: fs.FSWatcher[] = [];

  // Watch skills directory
  const skillsDir = getSkillsDir();
  if (fs.existsSync(skillsDir)) {
    const watcher = fs.watch(skillsDir, { recursive: false }, (event, filename) => {
      if (filename) {
        callback('skill', path.join(skillsDir, filename));
      }
    });
    watchers.push(watcher);
  }

  // Watch MCP config
  const mcpPath = getMcpConfigPath();
  if (fs.existsSync(mcpPath)) {
    const watcher = fs.watch(mcpPath, (event) => {
      callback('mcp-config', mcpPath);
    });
    watchers.push(watcher);
  }

  // Return cleanup function
  return () => {
    for (const watcher of watchers) {
      watcher.close();
    }
  };
}
