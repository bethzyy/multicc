# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MultiCC - Claude Code 多窗口管理器 (Windows 版)

基于 Electron + React + TypeScript + XTerm.js 的多终端管理器，可在单个窗口中以平铺布局同时运行多个 Claude Code 实例。

## Commands

```bash
npm run dev           # 开发模式（热重载）
npm run build         # 构建应用
npm run build:win     # 构建 Windows 可执行文件 (nsis + portable)
npm install --ignore-scripts  # 安装依赖（跳过 node-pty 编译）
```

**运行应用：** 双击 `start.bat` 或执行 `npm run dev`

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
window.electron.terminal.create(id, cols, rows, cwd)  // 创建 PTY
window.electron.terminal.write(id, data)              // 写入数据
window.electron.terminal.resize(id, cols, rows)       // 调整大小
window.electron.terminal.destroy(id)                  // 销毁终端
window.electron.terminal.onData(callback)             // 监听输出
window.electron.terminal.onExit(callback)             // 监听退出
window.electron.config.getWorkingDirs()               // 获取工作目录列表
window.electron.session.save/load/list/delete()       // 会话管理
```

### Focus Mode Architecture

聚焦模式切换时**不卸载组件**，确保终端内容保持：

1. `App.tsx` 始终渲染 `<TileLayout focusMode={...} />`
2. `TileLayout` 用 `terminal-wrapper` 包装每个终端
3. 聚焦模式下通过 CSS 类控制可见性：
   - 选中终端: `.terminal-wrapper.focused-visible`
   - 其他终端: `.terminal-wrapper.hidden` (display: none)
4. `TerminalPane` 使用 `ResizeObserver` 自动调用 `fitAddon.fit()` 调整大小

### Configuration

配置文件：`%APPDATA%/multicc/config.json`
会话存储：`%APPDATA%/multicc/sessions/{id}.json`

## Known Issues

**node-pty 编译问题：** 使用 `@lydell/node-pty` 预编译版本，安装时加 `--ignore-scripts`

**React.StrictMode 双重渲染：** 已在 `src/renderer/main.tsx` 移除 StrictMode，避免 useEffect 执行两次导致终端重复创建/销毁

## Solved Issues

### 终端无法输入
原因：使用 `child_process.spawn` 非真正的 PTY。解决：使用 `@lydell/node-pty`。

### 终端内容无法复制
原因：CSS `user-select: none`。解决：移除全局设置，为 `.terminal-container` 添加 `user-select: text`。

### 聚焦模式内容丢失
原因：切换模式时卸载/重新挂载组件，XTerm 实例被销毁。解决：始终渲染组件，用 CSS 控制显示/隐藏。

### 嵌套 Claude Code 检测
问题：在 multicc 终端运行 Claude Code 报 "cannot be launched inside another session"。解决：在 `PtyService.create()` 中移除 `CLAUDECODE` 环境变量。
