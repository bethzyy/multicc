import { contextBridge, ipcRenderer } from 'electron'
import type {
  ProjectInfo,
  SessionSummary,
  SessionMessage,
  SearchResult,
} from '../shared/types/chat.types'
import type {
  ConfigResource,
  ResourceContent,
} from '../shared/types/config.types'
import type {
  ToolInfo,
  CustomCommand,
  ToolsConfig,
} from '../shared/types/tools.types'

// 暴露给渲染进程的 API
const electronAPI = {
  // 窗口控制
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  },

  // 终端操作
  terminal: {
    create: (id: string, cols: number, rows: number, cwd?: string) => {
      // 确保 cwd 是有效值
      const safeCwd = cwd || ''
      return ipcRenderer.invoke('terminal:create', { id, cols, rows, cwd: safeCwd })
    },

    write: (id: string, data: string) =>
      ipcRenderer.send('terminal:write', { id, data }),

    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', { id, cols, rows }),

    destroy: (id: string) =>
      ipcRenderer.invoke('terminal:destroy', { id }),

    // per-terminal 通道：每个终端只订阅自己的 channel，避免 O(N) 扇出
    onData: (id: string, callback: (data: string) => void) => {
      const channel = `terminal:data:${id}`
      const handler = (_: unknown, data: string) => callback(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },

    onExit: (id: string, callback: (info: { exitCode: number; signal?: number }) => void) => {
      const channel = `terminal:exit:${id}`
      const handler = (_: unknown, info: { exitCode: number; signal?: number }) => callback(info)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },

    onCwd: (id: string, callback: (cwd: string) => void) => {
      const channel = `terminal:cwd:${id}`
      const handler = (_: unknown, cwd: string) => callback(cwd)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
  },

  // 配置管理
  config: {
    getClaudePath: () => ipcRenderer.invoke('config:getClaudePath'),
    setClaudePath: (path: string) => ipcRenderer.invoke('config:setClaudePath', path),
    getWorkingDirs: () => ipcRenderer.invoke('config:getWorkingDirs'),
    addWorkingDir: (path: string) => ipcRenderer.invoke('config:addWorkingDir', path),
    removeWorkingDir: (path: string) => ipcRenderer.invoke('config:removeWorkingDir', path)
  },

  // 会话存档
  session: {
    save: (session: unknown) => ipcRenderer.invoke('session:save', session),
    load: (id: string) => ipcRenderer.invoke('session:load', id),
    list: () => ipcRenderer.invoke('session:list'),
    delete: (id: string) => ipcRenderer.invoke('session:delete', id)
  },

  // 聊天历史 (新增)
  chat: {
    // 获取所有项目
    getProjects: (): Promise<{ projects: ProjectInfo[] }> =>
      ipcRenderer.invoke('chat:get-projects'),

    // 获取项目的会话列表 (null = 所有项目)
    getSessions: (projectHash: string | null): Promise<{ sessions: SessionSummary[] }> =>
      ipcRenderer.invoke('chat:get-sessions', projectHash),

    // 获取会话内容
    getSession: (projectHash: string, sessionId: string): Promise<{ messages: SessionMessage[] }> =>
      ipcRenderer.invoke('chat:get-session', projectHash, sessionId),

    // 搜索
    search: (query: string): Promise<{ results: SearchResult[] }> =>
      ipcRenderer.invoke('chat:search', query),

    // 导出
    export: (
      projectHash: string,
      sessionId: string,
      format: 'markdown' | 'json',
      title?: string
    ): Promise<{ outputPath: string }> =>
      ipcRenderer.invoke('chat:export', projectHash, sessionId, format, title),

    // 设置会话名称
    setSessionName: (cwd: string, name: string, sessionId?: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('chat:set-session-name', cwd, name, sessionId),

    // 删除会话
    deleteSession: (projectHash: string, sessionId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('chat:delete-session', projectHash, sessionId),

    // 从存档恢复会话
    restoreSession: (projectHash: string, sessionId: string): Promise<{ success: boolean; restored: boolean }> =>
      ipcRenderer.invoke('chat:restore-session', projectHash, sessionId),

    // 存档设置
    getArchiveEnabled: (): Promise<{ enabled: boolean }> =>
      ipcRenderer.invoke('chat:get-archive-enabled'),

    setArchiveEnabled: (enabled: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('chat:set-archive-enabled', enabled),

    // 在资源管理器中显示文件
    revealFile: (filePath: string): Promise<void> =>
      ipcRenderer.invoke('chat:reveal-file', filePath),

    // 同步存档
    syncArchive: (): Promise<void> =>
      ipcRenderer.invoke('chat:sync-archive'),

    // 事件监听
    onSessionUpdate: (callback: (data: { projectHash: string; sessionId: string }) => void) => {
      const handler = (_: unknown, data: { projectHash: string; sessionId: string }) => callback(data)
      ipcRenderer.on('chat:session-update', handler)
      return () => ipcRenderer.removeListener('chat:session-update', handler)
    },

    onArchiveProgress: (callback: (data: { synced: number; total: number }) => void) => {
      const handler = (_: unknown, data: { synced: number; total: number }) => callback(data)
      ipcRenderer.on('chat:archive-progress', handler)
      return () => ipcRenderer.removeListener('chat:archive-progress', handler)
    }
  },

  // 配置/Skills/MCP (新增)
  resources: {
    // 获取所有资源（Skills, MCP, CLAUDE.md）
    getResources: (projectPath?: string): Promise<{ resources: ConfigResource[] }> =>
      ipcRenderer.invoke('config:get-resources', projectPath),

    // 获取资源内容
    getResourceContent: (resourcePath: string): Promise<ResourceContent | null> =>
      ipcRenderer.invoke('config:get-resource-content', resourcePath),

    // 获取设置
    getSettings: (): Promise<{ settings: Record<string, unknown> }> =>
      ipcRenderer.invoke('config:get-settings'),

    // 保存设置
    saveSettings: (settings: Record<string, unknown>): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('config:save-settings', settings),

    // 获取 CLAUDE.md 内容
    getClaudeMd: (projectPath?: string): Promise<{ content: string | null }> =>
      ipcRenderer.invoke('config:get-claude-md', projectPath),

    // 保存 CLAUDE.md 内容
    saveClaudeMd: (content: string, projectPath?: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('config:save-claude-md', content, projectPath),

    // 翻译文本 (EN → ZH)
    translate: (text: string): Promise<{ success: boolean; translated?: string; error?: string }> =>
      ipcRenderer.invoke('config:translate', text),

    // 事件监听
    onResourceChange: (callback: (data: { type: string; path: string }) => void) => {
      const handler = (_: unknown, data: { type: string; path: string }) => callback(data)
      ipcRenderer.on('config:resource-change', handler)
      return () => ipcRenderer.removeListener('config:resource-change', handler)
    }
  },

  // 自动更新 (新增)
  update: {
    // 检查更新
    check: (): Promise<{ success: boolean; info?: { version: string; releaseDate: string }; error?: string }> =>
      ipcRenderer.invoke('update:check'),

    // 下载更新
    download: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('update:download'),

    // 安装更新
    install: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('update:install'),

    // 获取状态
    getStatus: (): Promise<{
      status: {
        checking: boolean;
        available: boolean;
        downloading: boolean;
        downloaded: boolean;
        error: string | null;
        info: { version: string; releaseDate: string } | null;
        progress: { bytesPerSecond: number; percent: number; total: number; transferred: number } | null;
      }
    }> =>
      ipcRenderer.invoke('update:get-status'),

    // 事件监听
    onStatus: (callback: (status: {
      checking: boolean;
      available: boolean;
      downloading: boolean;
      downloaded: boolean;
      error: string | null;
      info: { version: string; releaseDate: string } | null;
      progress: { bytesPerSecond: number; percent: number; total: number; transferred: number } | null;
    }) => void) => {
      const handler = (_: unknown, status: unknown) => callback(status as typeof callback extends (s: infer S) => void ? S : never)
      ipcRenderer.on('update:status', handler)
      return () => ipcRenderer.removeListener('update:status', handler)
    }
  },

  // CLI 工具管理 (新增)
  tools: {
    // 检测所有工具
    detectAll: (): Promise<{ tools: ToolInfo[] }> =>
      ipcRenderer.invoke('tools:detect-all'),

    // 检测指定工具
    detect: (type: string): Promise<{ tool: ToolInfo | null }> =>
      ipcRenderer.invoke('tools:detect', type),

    // 获取配置
    getConfig: (): Promise<{ config: ToolsConfig }> =>
      ipcRenderer.invoke('tools:get-config'),

    // 保存配置
    saveConfig: (config: ToolsConfig): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('tools:save-config', config),

    // 添加自定义命令
    addCustomCommand: (command: CustomCommand): Promise<{ success: boolean; commands: CustomCommand[] }> =>
      ipcRenderer.invoke('tools:add-custom-command', command),

    // 删除自定义命令
    removeCustomCommand: (id: string): Promise<{ success: boolean; commands: CustomCommand[] }> =>
      ipcRenderer.invoke('tools:remove-custom-command', id),

    // 更新自定义命令
    updateCustomCommand: (command: CustomCommand): Promise<{ success: boolean; commands: CustomCommand[] }> =>
      ipcRenderer.invoke('tools:update-custom-command', command),

    // 获取自定义命令列表
    getCustomCommands: (): Promise<{ commands: CustomCommand[] }> =>
      ipcRenderer.invoke('tools:get-custom-commands')
  },

  // ClawHub Marketplace (新增)
  marketplace: {
    // 搜索 skills
    search: (query: string, limit?: number): Promise<{
      success: boolean;
      data?: { results: Array<{ score: number; slug: string | null; displayName: string | null; summary: string | null; version: string | null; updatedAt: number | null }> };
      error?: string;
    }> => ipcRenderer.invoke('marketplace:search', query, limit),

    // 浏览 skills（cursor 分页）
    browse: (cursor?: string, limit?: number): Promise<{
      success: boolean;
      data?: { items: Array<unknown>; nextCursor: string | null };
      error?: string;
    }> => ipcRenderer.invoke('marketplace:browse', cursor, limit),

    // 获取 skill 详情
    detail: (slug: string): Promise<{
      success: boolean;
      data?: Record<string, unknown>;
      error?: string;
    }> => ipcRenderer.invoke('marketplace:detail', slug),

    // 安装 skill
    install: (slug: string, overwrite?: boolean): Promise<{
      success: boolean;
      data?: { success: boolean; path: string; error?: string; alreadyExists?: boolean };
      error?: string;
    }> => ipcRenderer.invoke('marketplace:install', slug, overwrite),

    // 卸载 skill
    uninstall: (skillName: string): Promise<{
      success: boolean;
      data?: { success: boolean; path: string; error?: string };
      error?: string;
    }> => ipcRenderer.invoke('marketplace:uninstall', skillName),

    // 获取已安装 skills
    installed: (): Promise<{
      success: boolean;
      data?: { slugs: string[] };
      error?: string;
    }> => ipcRenderer.invoke('marketplace:installed'),
  }
}

// 暴露到 window.electron
contextBridge.exposeInMainWorld('electron', electronAPI)

// TypeScript 类型声明
export type ElectronAPI = typeof electronAPI
