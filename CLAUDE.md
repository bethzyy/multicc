# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MultiCC - Claude Code 多窗口管理器 (Windows 版)

基于 Electron + React + TypeScript + XTerm.js 的多终端管理器，可在单个窗口中以平铺布局同时运行多个 Claude Code / Codex / Gemini CLI 实例。

## Commands

```bash
npm run dev              # 开发模式（热重载）
npm run build            # 构建应用
npm run build:win        # 构建 Windows 可执行文件 (NSIS + portable)
npm run build:win:arm    # 构建 Windows ARM64 版本
npm install --ignore-scripts  # 安装依赖（必须使用，避免 node-pty 编译失败）
```

**运行应用：** 双击 `start.bat` 或执行 `npm run dev`

## Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Electron 40 |
| UI | React 19 |
| Language | TypeScript 5.9 (strict) |
| Terminal | XTerm.js 5 + fit/search/web-links addons |
| PTY | @lydell/node-pty (预编译版本) |
| Persistence | electron-store |
| Auto-Update | electron-updater |
| Build | electron-vite, electron-builder |

### Process Architecture

```
Renderer Process                              Main Process
┌──────────────────────┐                     ┌─────────────────────┐
│ App                  │                     │ index.ts            │
│  ├─ TitleBar         │                     │  ├─ ipc/             │
│  ├─ TileLayout       │ ─── preload ──────▶ │  │  ├─ terminal-*    │
│  │   └─ TerminalPane │   (contextBridge)   │  │  ├─ chat-*        │
│  ├─ ChatHistoryPanel │                     │  │  ├─ config-*      │
│  ├─ ConfigBrowser    │                     │  │  ├─ config-*      │
│  ├─ MarketplaceView  │                     │  │  ├─ marketplace-* │
│  ├─ ToolsBrowser     │                     │  │  ├─ tools-*       │
│  └─ UpdateNotification│                     │  │  └─ update-*      │
└──────────────────────┘                     │  └─ services/       │
                                             │     ├─ pty.ts       │
                                             │     ├─ config/      │
                                             │     ├─ store.ts     │
                                             │     ├─ chat/        │
                                             │     ├─ marketplace/ │
                                             │     ├─ terminal/    │
                                             │     ├─ tools/       │
                                             │     └─ update/      │
                                             └─────────────────────┘
```

### Security Model

**Main process** (`src/main/index.ts`):
- `nodeIntegration: false`, `contextIsolation: true`
- 所有 IPC 通道通过 preload bridge 暴露，无直接 `require('electron')` 在 renderer 中

**IPC 验证**: `src/main/ipc/config-handlers.ts` 中的 `GET_RESOURCE_CONTENT` 使用 `isPathAllowed()` 白名单校验路径

**命令执行**: `src/main/utils/security.ts` 中的 `isValidCommand()` 白名单校验

**PTY 环境清理**: 创建终端时移除 `CLAUDECODE` 环境变量，允许嵌套运行 Claude Code

### Shared Layer (`src/shared/`)

主进程和渲染进程共享的代码：

- `constants/channels.ts` — 所有 IPC 通道名集中定义
- `types/` — 共享类型定义（chat.types, config.types, tools.types, electron.d.ts）
- `machines/terminal-process.ts` — 终端进程状态机

### Key Services

**PtyService** (`src/main/services/pty.ts`):
- 使用 `@lydell/node-pty` 创建伪终端进程
- 统一轮询调度器（5秒间隔，智能跳过 90%+ 重复检测）
- 进程树清理：关闭终端时递归终止子进程
- 缓冲区管理：100KB 上限

**ChatService** (`src/main/services/chat/`):
- `chat-reader.ts` — 扫描 `~/.claude/projects/` 读取会话数据
- `chat-archive.ts` — 会话归档管理
- `chat-export.ts` — 导出为 Markdown/JSON
- 支持多源：claude-code, codex, gemini

**ConfigService** (`src/main/services/config.ts`):
- 应用配置持久化（Claude 路径、工作目录、主题、字体）

**ConfigScanner** (`src/main/services/config/ConfigScanner.ts`):
- 扫描 Skills/MCP/CLAUDE.md 资源（系统级 + 项目级 + 父目录级）
- 资源变更监听（FSWatcher）

**MarketplaceService** (`src/main/services/marketplace/`):
- `ClawHubApi.ts` — ClawHub API 客户端（搜索/浏览/详情/安装/卸载）
- `SkillInstaller.ts` — Skill 安装/卸载到 `~/.claude/skills/`

**StoreService** (`src/main/services/store.ts`):
- 通用 KV 存储，会话持久化

**CliDetector** (`src/main/services/tools/CliDetector.ts`):
- 检测已安装 CLI 工具（Claude Code, Codex CLI, Gemini CLI）

**UpdateManager** (`src/main/services/update/UpdateManager.ts`):
- electron-updater 封装，仅生产环境启用

### Renderer Components

**TerminalPane** (`src/renderer/components/Terminal/TerminalPane.tsx`):
- XTerm.js 终端，支持 FitAddon、WebLinksAddon、SearchAddon
- ResizeObserver 监听容器大小变化
- 智能复制粘贴：Ctrl+C 有选中时复制，否则发送中断信号
- **粘贴必须用 `xterm.paste()`**，不能用 `window.electron.terminal.write()`
- OutputRateMonitor 高负载输出保护

**TileLayout** (`src/renderer/components/Layout/TileLayout.tsx`):
- CSS Grid 自动布局：1=全屏, 2=2列, 3-4=2x2
- **聚焦模式**: 不卸载组件，用 CSS `display: none` 控制显隐

**ChatHistoryPanel** — 会话历史浏览、搜索、恢复
**ConfigBrowser** — Skills/MCP/CLAUDE.md 配置浏览 + EN→ZH 翻译切换（ZhipuAI GLM-4-flash）+ 翻译缓存（SHA-256 hash, StoreService 持久化）
**MarkdownContent** (`src/renderer/components/shared/MarkdownContent.tsx`) — react-markdown + remark-gfm 暗色主题渲染组件
**MarketplaceView** — ClawHub Skill 市场（搜索/浏览/安装/卸载）
**ToolsBrowser** — CLI 工具检测 + 自定义命令管理
**UpdateNotification** — 自动更新提示和进度

### IPC API

```typescript
// 终端操作
window.electron.terminal.create(id, cols, rows, cwd)
window.electron.terminal.write(id, data)
window.electron.terminal.resize(id, cols, rows)
window.electron.terminal.destroy(id)
window.electron.terminal.onData / onExit / onCwd(callback)

// 配置管理
window.electron.config.getClaudePath() / setClaudePath(path)
window.electron.config.getWorkingDirs() / addWorkingDir / removeWorkingDir
window.electron.config.getResourceContent(type, cwd)

// 资源浏览 (Skills/MCP/CLAUDE.md)
window.electron.resources.getResources(projectPath?)
window.electron.resources.getResourceContent(path)
window.electron.resources.translate(text)  // EN→ZH via ZhipuAI
window.electron.resources.onResourceChange(callback)

// ClawHub Marketplace
window.electron.marketplace.search(query, limit?)
window.electron.marketplace.browse(cursor?, limit?)
window.electron.marketplace.detail(slug)
window.electron.marketplace.install(slug, overwrite?)
window.electron.marketplace.uninstall(skillName)
window.electron.marketplace.installed()

// 会话存档
window.electron.session.save / load / list / delete(id)

// 聊天历史
window.electron.chat.getProjects() / getSessions(projectPath) / getSessionContent(...)

// 工具管理
window.electron.tools.detectCli() / getCustomCommands() / saveCustomCommand(...)

// 更新
window.electron.update.checkForUpdates() / downloadUpdate() / installUpdate()
```

### Configuration

- 应用配置：`%APPDATA%/multicc/config.json`
- 会话存储：`%APPDATA%/multicc/sessions/{id}.json`
- Claude 数据：`~/.claude/projects/`

**TypeScript 路径别名**：
- `@/*` → `src/*`
- `@main/*` → `src/main/*`
- `@renderer/*` → `src/renderer/*`
- `@shared/*` → `src/shared/*`

## Known Issues

- **node-pty 编译问题**：使用 `@lydell/node-pty` 预编译版本，安装时加 `--ignore-scripts`
- **React.StrictMode 双重渲染**：已移除 StrictMode（会导致 PTY 双重创建）

## Solved Issues

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 终端无法输入 | 使用 spawn 非 PTY | 使用 `@lydell/node-pty` |
| 内容无法复制 | CSS `user-select: none` | 为终端容器添加 `user-select: text` |
| 聚焦模式内容丢失 | 组件卸载/重新挂载 | CSS 控制显示/隐藏，不卸载 |
| 嵌套 Claude Code 检测 | CLAUDECODE 环境变量 | 创建 PTY 时移除该变量 |
| 标题栏路径变化 | cmd.exe 不支持 OSC 133 | 主动检测前台进程 |
| 高 CPU 消耗 | WMI 查询风暴 | 统一轮询调度器 + 智能跳过 |
| 粘贴内容截断 | 浏览器默认粘贴行为 | 使用 `xterm.paste()` API |
| 重负载输出闪退 | 进程检测并发冲突 | OutputRateMonitor + IPC 数据合并缓冲 |
| Installed 技能列表为空 | 未传 projectPath + 路径白名单过严 | 传 cwd + 扫描父目录 + 扩展白名单 |
