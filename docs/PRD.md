# MultiCC 产品需求文档 (PRD)

| 属性 | 值 |
|------|-----|
| **产品名称** | MultiCC - Claude Code 多窗口管理器 |
| **版本** | 1.0.0 |
| **平台** | Windows |
| **最后更新** | 2026-03-26 |
| **状态** | 活跃开发中 |

---

## 1. 产品概述

### 1.1 产品定位

MultiCC 是一款专为 Claude Code 用户设计的 Windows 桌面终端管理器，基于 Electron + React + TypeScript + XTerm.js 技术栈构建。它允许用户在单个窗口中以平铺布局同时运行多个 Claude Code 实例，提高多任务处理效率。

### 1.2 目标用户

- Claude Code 重度用户
- 需要同时处理多个项目的开发者
- 希望在同一界面管理多个 AI 编程会话的用户

### 1.3 核心价值

| 价值点 | 描述 |
|--------|------|
| **效率提升** | 无需在多个终端窗口间切换 |
| **会话持久化** | 保存对话历史，支持续聊 |
| **快捷操作** | 快捷键快速管理终端 |
| **灵活布局** | 自动平铺 + 聚焦模式 |

---

## 2. 功能需求

### 2.1 核心功能

#### F1: 多终端管理

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 新建终端 | 创建新的 Claude Code 实例 | P0 |
| 关闭终端 | 关闭指定终端 | P0 |
| 终端切换 | 在多个终端间快速切换 | P0 |
| 终端输入/输出 | 实时终端交互 | P0 |

#### F2: 布局管理

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 自动平铺 | CSS Grid 自动布局（1/2/4 窗口） | P0 |
| 聚焦模式 | 一键放大当前终端 | P0 |
| 窗口调整 | 终端大小自适应 | P1 |

#### F3: 会话存档

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 保存会话 | 保存当前终端对话历史 | P1 |
| 加载会话 | 恢复之前的会话 | P1 |
| 会话列表 | 查看所有已保存会话 | P1 |
| 删除会话 | 删除指定会话 | P1 |

#### F4: 配置管理

| 功能 | 描述 | 优先级 |
|------|------|--------|
| Claude 路径配置 | 自定义 Claude Code 可执行文件路径 | P1 |
| 工作目录管理 | 添加/删除常用工作目录 | P1 |
| 主题设置 | 深色/浅色模式切换 | P2 |
| 字体大小 | 自定义终端字体大小 | P2 |

### 2.2 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+N` | 新建终端 |
| `Ctrl+W` | 关闭当前终端 |
| `Ctrl+Tab` | 切换终端 |
| `F11` | 切换聚焦模式 |

### 2.3 待实现功能（来自需求追踪）

| 需求 ID | 功能 | 优先级 | 状态 |
|---------|------|--------|------|
| REQ-001 | 支持深色模式 | Medium | Active |
| REQ-002 | 启动后自动关闭启动用的 cmd 窗口 | Medium | Active |
| REQ-003 | 新建按钮移到 Multicc 标题右边 | Medium | Active |
| REQ-004 | 每个 terminal 添加最大化/最小化按钮 | Medium | Active |
| REQ-005 | terminal 标题栏显示当前工作路径 | Medium | Active |

---

## 3. 技术架构

### 3.1 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 框架 | Electron | 40.6.1 |
| UI | React | 19.0.0 |
| 语言 | TypeScript | 5.9.0 |
| 终端 | XTerm.js | 5.3.0 |
| PTY | @lydell/node-pty | 1.2.0-beta.3 |
| 状态存储 | electron-store | 10.0.0 |
| 构建 | electron-vite + electron-builder | - |

### 3.2 架构图

```
Renderer Process                          Main Process
┌─────────────────┐                      ┌─────────────┐
│ App → TileLayout │ ─── IPC ──────────▶ │ PtyService  │
│   → TerminalPane │                      │   ↓ node-pty│
│      (XTerm.js)  │                      │  cmd.exe    │
└─────────────────┘                      └─────────────┘
```

### 3.3 关键组件

#### PtyService (`src/main/services/pty.ts`)

- 使用 `@lydell/node-pty` 创建伪终端进程
- **重要**: 创建终端时移除 `CLAUDECODE` 环境变量，允许嵌套运行 Claude Code
- 统一轮询调度器（5秒间隔，智能跳过重复检测）

#### TerminalPane (`src/renderer/components/Terminal/TerminalPane.tsx`)

- XTerm.js 终端组件
- 支持 FitAddon、WebLinksAddon、SearchAddon
- 使用 ResizeObserver 监听容器大小变化
- 智能复制粘贴：Ctrl+C 有选中时复制，否则发送中断信号

#### TileLayout (`src/renderer/components/Layout/TileLayout.tsx`)

- CSS Grid 自动布局：1个=全屏，2个=2列，3-4个=2x2
- **聚焦模式**: 不卸载组件，用 CSS 控制显示/隐藏

### 3.4 目录结构

```
multicc/
├── src/
│   ├── main/           # Electron 主进程
│   │   ├── index.ts    # 入口
│   │   └── services/   # 服务（PTY、配置、存储）
│   ├── preload/        # 预加载脚本
│   └── renderer/       # React 渲染进程
│       ├── components/ # UI 组件
│       └── styles/     # CSS 样式
├── resources/          # 应用图标
├── start.bat           # 启动脚本
└── package.json        # 项目配置
```

---

## 4. IPC API

### 4.1 终端操作

```typescript
// 创建终端
window.electron.terminal.create(id, cols, rows, cwd)

// 写入数据
window.electron.terminal.write(id, data)

// 调整大小
window.electron.terminal.resize(id, cols, rows)

// 销毁终端
window.electron.terminal.destroy(id)

// 数据回调
window.electron.terminal.onData(callback)

// 退出回调
window.electron.terminal.onExit(callback)
```

### 4.2 配置管理

```typescript
// Claude 路径
window.electron.config.getClaudePath()
window.electron.config.setClaudePath(path)

// 工作目录
window.electron.config.getWorkingDirs()
window.electron.config.addWorkingDir(dir)
window.electron.config.removeWorkingDir(dir)
```

### 4.3 会话存档

```typescript
window.electron.session.save(id, data)
window.electron.session.load(id)
window.electron.session.list()
window.electron.session.delete(id)
```

---

## 5. 配置

### 5.1 配置文件

**位置**: `%APPDATA%/multicc/config.json`

```json
{
  "claudePath": "claude",
  "workingDirs": ["C:\\Projects"],
  "theme": "dark",
  "fontSize": 14
}
```

### 5.2 会话存储

**位置**: `%APPDATA%/multicc/sessions/{id}.json`

每个会话保存为独立的 JSON 文件。

### 5.3 TypeScript 路径别名

| 别名 | 路径 |
|------|------|
| `@/*` | `src/*` |
| `@main/*` | `src/main/*` |
| `@renderer/*` | `src/renderer/*` |

---

## 6. 已知问题与解决方案

### 6.1 已解决问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 终端无法输入 | 使用 spawn 非 PTY | 使用 `@lydell/node-pty` |
| 内容无法复制 | CSS `user-select: none` | 为终端容器添加 `user-select: text` |
| 聚焦模式内容丢失 | 组件卸载/重新挂载 | CSS 控制显示/隐藏，不卸载 |
| 嵌套 Claude Code 检测 | CLAUDECODE 环境变量 | 创建 PTY 时移除该变量 |
| 标题栏路径变化 | cmd.exe 不支持 OSC 133 | 主动检测前台进程 |
| 高 CPU 消耗 | WMI 查询风暴 | 统一轮询调度器 + 智能跳过 |

### 6.2 高 CPU 优化要点

- 统一轮询调度器：4×2s → 1×5s
- 智能跳过：缓存 PID，跳过 90%+ 重复检测
- 进程树清理：关闭终端时递归终止子进程

### 6.3 当前已知问题

| 问题 | 状态 | 备注 |
|------|------|------|
| node-pty 编译问题 | 已规避 | 使用 `@lydell/node-pty` 预编译版本 |
| React.StrictMode 双重渲染 | 已解决 | 已移除 StrictMode |

---

## 7. 构建与部署

### 7.1 开发命令

```bash
# 安装依赖（必须使用 --ignore-scripts）
npm install --ignore-scripts

# 开发模式（热重载）
npm run dev

# 构建
npm run build

# 预览构建结果
npm run preview
```

### 7.2 打包发布

```bash
# 构建 Windows 可执行文件 (x64)
npm run build:win

# 构建 Windows 可执行文件 (ARM64)
npm run build:win:arm

# 重建 node-pty
npm run rebuild
```

### 7.3 输出格式

- **NSIS 安装包**: 支持自定义安装路径
- **便携版**: 无需安装，直接运行

---

## 8. 版本历史

| 日期 | 版本 | 更新内容 |
|------|------|----------|
| 2026-03-10 | - | 高 CPU 消耗问题修复 + 双重验证 |
| 2026-03-07 | - | 声音提示功能恢复 |
| 2026-03-04 | - | 标题栏路径保持不变（v4 修复） |

---

## 9. 相关文档

| 文档 | 路径 | 描述 |
|------|------|------|
| CLAUDE.md | `/multicc/CLAUDE.md` | Claude Code 工作指引 |
| README.md | `/multicc/README.md` | 项目说明 |
| REQUIREMENTS.md | `/multicc/REQUIREMENTS.md` | 需求追踪文档 |

---

*本文档由 Claude Code 自动生成*
