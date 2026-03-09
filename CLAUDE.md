# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MultiCC - Claude Code 多窗口管理器 (Windows 版)

基于 Electron + React + TypeScript + XTerm.js 的多终端管理器，可在单个窗口中以平铺布局同时运行多个 Claude Code 实例。

## Commands

```bash
npm run dev              # 开发模式（热重载）
npm run build            # 构建应用
npm run build:win        # 构建 Windows 可执行文件 (nsis + portable)
npm run build:win:arm    # 构建 Windows ARM64 可执行文件
npm run preview          # 预览构建结果
npm install --ignore-scripts  # 安装依赖（跳过 node-pty 编译，必须使用）
```

**运行应用：** 双击 `start.bat` 或执行 `npm run dev`

**构建输出：** `dist/` 目录（NSIS 安装包 + 便携版）

## Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Electron 40 |
| UI | React 19 |
| Language | TypeScript 5.9 |
| Terminal | XTerm.js 5 + addons (fit, web-links, search) |
| PTY | @lydell/node-pty (预编译版本) |
| Build | electron-vite, electron-builder |

### Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                    Renderer Process                      │
│  ┌─────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │  App    │───▶│ TileLayout  │───▶│ TerminalPane[]  │  │
│  └─────────┘    └─────────────┘    └─────────────────┘  │
│       │                                    │ XTerm.js   │
│       │                                    ▼            │
│       │                           window.electron.terminal
└───────┼─────────────────────────────────────│───────────┘
        │                                     │ IPC
┌───────┼─────────────────────────────────────│───────────┐
│       │            Main Process              ▼           │
│  ┌────┴────┐                         ┌─────────────┐    │
│  │ PtyService◀───────────────────────│ preload.ts  │    │
│  └─────────┘                         └─────────────┘    │
│       │ node-pty                                        │
│       ▼                                                 │
│  cmd.exe / PowerShell                                   │
└─────────────────────────────────────────────────────────┘
```

### Key Components

**PtyService** (`src/main/services/pty.ts`):
- 使用 `@lydell/node-pty` 创建伪终端进程
- **重要**: 创建终端时移除 `CLAUDECODE` 环境变量，允许在 multicc 终端中嵌套运行 Claude Code
- 维护终端缓冲区 (buffer)，最大 100KB

**TerminalPane** (`src/renderer/components/Terminal/TerminalPane.tsx`):
- XTerm.js 终端组件，支持 FitAddon 自适应、WebLinksAddon 链接、SearchAddon 搜索
- 使用 ResizeObserver 监听容器大小变化（聚焦模式切换时自动 fit）
- 双击标题重命名终端
- 点击终端时触发 `onFocus` 回调更新选中状态

**TileLayout** (`src/renderer/components/Layout/TileLayout.tsx`):
- CSS Grid 自动布局：1个=全屏，2个=2列，3-4个=2x2，5+=动态计算
- **聚焦模式实现**: 不卸载组件，用 CSS 控制显示/隐藏
  - `.focused-visible`: 全屏显示选中终端
  - `.hidden`: 隐藏其他终端（但保留 XTerm 实例和内容）

### IPC API (preload/index.ts)

```typescript
// 终端操作（双向通信）
window.electron.terminal.create(id, cols, rows, cwd)  // 创建 PTY (invoke)
window.electron.terminal.write(id, data)              // 写入数据 (send)
window.electron.terminal.resize(id, cols, rows)       // 调整大小 (invoke)
window.electron.terminal.destroy(id)                  // 销毁终端 (invoke)
window.electron.terminal.onData(callback)             // 监听输出 (on)
window.electron.terminal.onExit(callback)             // 监听退出 (on)

// 配置管理（invoke，返回 Promise）
window.electron.config.getClaudePath()
window.electron.config.setClaudePath(path)
window.electron.config.getWorkingDirs()
window.electron.config.addWorkingDir(path)
window.electron.config.removeWorkingDir(path)

// 会话存档（invoke，返回 Promise）
window.electron.session.save/load/list/delete(id)

// 窗口控制（invoke，返回 Promise）
window.electron.window.minimize/maximize/close/isMaximized()
```

**IPC 通信模式：**
- `invoke/send`: 渲染进程 → 主进程（使用 `ipcRenderer.invoke/send`）
- `on`: 主进程 → 渲染进程（使用 `ipcRenderer.on` 监听 `webContents.send`）

### Focus Mode Architecture

聚焦模式切换时**不卸载组件**，确保终端内容保持：

1. `App.tsx` 始终渲染 `<TileLayout focusMode={...} />`
2. `TileLayout` 用 `terminal-wrapper` 包装每个终端
3. 聚焦模式下通过 CSS 类控制可见性：
   - 选中终端: `.terminal-wrapper.focused-visible`
   - 其他终端: `.terminal-wrapper.hidden` (display: none)
4. `TerminalPane` 使用 `ResizeObserver` 自动调用 `fitAddon.fit()` 调整大小

**CSS 实现细节：**
```css
/* 聚焦模式激活 */
.tile-layout.focus-mode-active {
  display: block;  /* 从 grid 切换为 block */
  padding: 0;
}

/* 隐藏非焦点终端 */
.terminal-wrapper.hidden {
  display: none;
}

/* 全屏显示焦点终端 */
.terminal-wrapper.focused-visible {
  display: block;
  height: 100%;
  width: 100%;
}
```

### Configuration

配置文件：`%APPDATA%/multicc/config.json`
会话存储：`%APPDATA%/multicc/sessions/{id}.json`

**TypeScript 路径别名：**
```typescript
@/*              → src/*
@main/*          → src/main/*
@renderer/*      → src/renderer/*
```

**TypeScript 配置：**
- 严格模式已启用 (`strict: true`)
- 未使用变量/参数检测 (`noUnusedLocals`, `noUnusedParameters`)
- JSX 使用 `react-jsx` 转换（React 19 新架构）

## Known Issues

**node-pty 编译问题：** 使用 `@lydell/node-pty` 预编译版本，安装时加 `--ignore-scripts`

**React.StrictMode 双重渲染：** 已在 `src/renderer/main.tsx` 移除 StrictMode，避免 useEffect 执行两次导致终端重复创建/销毁

## Important Implementation Details

### 终端复制粘贴处理

TerminalPane 实现了智能复制粘贴：
- **Ctrl+C**: 有选中文字时复制，否则作为中断信号发送
- **Ctrl+V**: 粘贴剪贴板内容到终端
- **右键菜单**: 选中文字时复制，否则粘贴
- 使用捕获阶段 (`{ capture: true }`) 拦截键盘事件

### 终端缓冲区管理

PtyService 维护每个终端的输出缓冲区：
- 最大 100KB，超过时截断保留最新 50KB
- 用于重连时恢复终端历史（未来功能）

### 环境变量处理

创建 PTY 时移除 `CLAUDECODE` 环境变量（`pty.ts:28`）：
```typescript
const { CLAUDECODE, ...envWithoutClaudeCode } = process.env
```

这允许在 multicc 终端中嵌套运行 Claude Code，否则会报 "cannot be launched inside another session" 错误。

## Solved Issues

### 终端无法输入
原因：使用 `child_process.spawn` 非真正的 PTY。解决：使用 `@lydell/node-pty`。

### 终端内容无法复制
原因：CSS `user-select: none`。解决：移除全局设置，为 `.terminal-container` 添加 `user-select: text`。

### 聚焦模式内容丢失
原因：切换模式时卸载/重新挂载组件，XTerm 实例被销毁。解决：始终渲染组件，用 CSS 控制显示/隐藏。

### 嵌套 Claude Code 检测
问题：在 multicc 终端运行 Claude Code 报 "cannot be launched inside another session"。解决：在 `PtyService.create()` 中移除 `CLAUDECODE` 环境变量。
