# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MultiCC - Claude Code 多窗口管理器 (Windows 版)

基于 Electron + React + TypeScript + XTerm.js 的多终端管理器，可在单个窗口中以平铺布局同时运行多个 Claude Code 实例。

## Commands

**运行应用：**
```bash
start.bat
# 或
npm run dev
```

**构建：**
```bash
npm run build        # 构建应用
npm run build:win    # 构建 Windows 可执行文件
```

**安装依赖：**
```bash
npm install --ignore-scripts
```

## Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Electron 34 |
| UI | React 19 |
| Language | TypeScript 5.9 |
| Terminal | XTerm.js 5 |
| PTY | @lydell/node-pty |
| Build | electron-vite, electron-builder |

### Directory Structure

```
src/
├── main/           # Electron 主进程
│   ├── index.ts    # 入口，创建窗口和初始化服务
│   └── services/
│       ├── pty.ts  # PTY 服务（终端进程管理）
│       ├── config.ts # 配置服务
│       └── store.ts  # 会话存储服务
├── preload/        # 预加载脚本
│   └── index.ts    # 暴露 IPC API 到渲染进程
└── renderer/       # React 渲染进程
    ├── App.tsx     # 主应用组件
    ├── components/
    │   ├── Terminal/TerminalPane.tsx  # 终端面板
    │   ├── Layout/TileLayout.tsx      # 平铺布局
    │   ├── Sidebar/Sidebar.tsx        # 侧边栏
    │   └── TitleBar/TitleBar.tsx      # 标题栏
    └── styles/main.css  # 全局样式
```

### Key Components

**PtyService** (`src/main/services/pty.ts`):
- 使用 `@lydell/node-pty` 创建伪终端进程
- 支持 Windows cmd.exe / PowerShell
- 通过 IPC 发送终端数据到渲染进程

**TerminalPane** (`src/renderer/components/Terminal/TerminalPane.tsx`):
- XTerm.js 终端组件
- FitAddon 自适应大小
- 双击标题重命名终端

**TileLayout** (`src/renderer/components/Layout/TileLayout.tsx`):
- CSS Grid 自动布局
- 1-2个: 2列, 3-4个: 2x2, 5+: 动态计算

### IPC API (preload/index.ts)

```typescript
window.electron.terminal.create(id, cols, rows, cwd)
window.electron.terminal.write(id, data)
window.electron.terminal.resize(id, cols, rows)
window.electron.terminal.destroy(id)
window.electron.config.getWorkingDirs()
window.electron.session.save(session)
```

### Configuration

配置文件：`%APPDATA%/multicc/config.json`

```json
{
  "claudePath": "claude",
  "workingDirs": ["C:\\Projects"],
  "theme": "dark",
  "fontSize": 14
}
```

### Sessions

会话存储：`%APPDATA%/multicc/sessions/{id}.json`

## Known Issues

**node-pty 编译问题：**
- 使用 `@lydell/node-pty` 预编译版本，无需 Visual Studio Build Tools
- 如果遇到问题，尝试 `npm install --ignore-scripts`

**终端大小调整：**
- 窗口大小改变时需要调用 `fitAddon.fit()`
- 聚焦模式切换时需要延迟调整
