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

## Testing

```bash
npm test                 # 全量测试（vitest run）
npm run test:unit        # 只跑单元测试（<5s，Stop hook 自动跑的就是这个）
npm run test:integration # 只跑集成测试（真实 git，~15s）
npm run test:watch       # 监听模式
npx vitest run tests/integration/worktree-manager.test.ts  # 只跑单个套件
```

**分层执行策略**（测试规模增长后依然不拖慢开发）：
- 改代码过程中：只跑**相关的测试文件**（vitest 指定单文件，秒级）
- 每次 AI 回合结束：`.claude/settings.json` 的 Stop hook 自动跑 `test:unit`（快层，红了会阻断并反馈给 AI）
- 每天 00:00：Windows 计划任务 `multicc-nightly-test` 自动跑全量（`scripts/nightly-test.ps1`，红了弹系统通知，日志在 `%LOCALAPPDATA%\multicc\nightly-test.log`；错过时间点会在下次开机补跑）
- 提交/推送前：手动 `npm test` 全量；push 后 GitHub Actions 再跑一遍

**目录结构**：
- `tests/unit/` — 纯函数单元测试（tileLayout、parsePromptCwd、path 工具等，不依赖 electron/DOM）
- `tests/integration/` — 服务层集成测试（WorktreeManager 在临时目录跑真实 git，不 mock）
- `tests/fixtures/` — 测试数据

**CI 硬卡点**：`.github/workflows/test.yml` 在每次 push/PR 自动跑 no-skip 检查 + 全部测试 + 构建。配合 GitHub branch protection（Require status checks）实现"不绿不能合并"。

**测试规范**（任何功能改动都适用）：
1. **测试全绿才算完成**——改完代码必须跑 `npm test`，红着不能交付
2. **行为变更必须在同一次提交里改/删对应测试**，并在 commit message 注明需求变更理由；禁止为让测试通过而迁就断言
3. **测行为，不测实现**——断言走公开 API（类的 public 方法、IPC 返回值），禁止断言内部调用细节；重构内部实现不应导致测试变红
4. **用例名写清"条件 + 行为 + 理由"**（如"删除含未提交改动的 worktree 时非 force 必须抛 DIRTY，防一键丢数据"），让失败时能立刻判断是代码坏了还是需求变了
5. **禁止 `.only`/`.skip` 进仓库**（CI 会拦），临时 skip 必须注明原因和期限
6. **新测试先验证会红**——故意破坏被测逻辑跑一次，确认失败信息指向正确原因，再恢复提交

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

**WorktreeManager** (`src/main/services/worktree/WorktreeManager.ts`):
- Git worktree 管理：创建（`<repo>/.worktrees/wt-N` + 同名分支）/ 列表（含脏文件数、ahead/behind）/ 重命名 / 安全删除 / squash 合并回主分支
- 主仓库定位：`worktree list --porcelain` 第一条（git 保证主 worktree 排首位）
- 忽略规则写 `.git/info/exclude`（纯本地），不修改用户的 `.gitignore`
- 删除默认非 force：有未提交改动抛 `DIRTY` 结构化错误码，UI 确认后才 force + 删分支；目录被占用抛 `LOCKED`
- `mergeToMain`：双方必须干净，冲突时 `reset --merge` 自动回滚并抛 `CONFLICT`
- 新建后 setup 钩子：拷贝 `config.json` 里 `worktreeSetup.copyFiles`（默认 `.env`），`setupCommand` 在新终端中自动键入执行
- 路径比较统一走 `src/shared/utils/path.ts`（git 输出正斜杠 vs PTY 反斜杠，Windows 大小写不敏感）
- **已知局限**：`isMerged` 基于 `branch --merged`，squash-merge（含本工具的 merge 按钮）后检测不到已合并状态

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
- 动态网格布局（`utils/tileLayout.ts` 纯函数）：cols=ceil(sqrt(n))；有空洞时焦点终端占大格（第 1 列跨行）填满，交换而非重排
- **聚焦模式**: 不卸载组件，用 CSS `display: none` 控制显隐
- **最小化**: 同样不卸载，`display: none`；底部 MinimizedBar 胶囊点击恢复

**ChatHistoryPanel** — 会话历史浏览、搜索、恢复
**ConfigBrowser** — Skills/MCP/CLAUDE.md 配置浏览 + EN→ZH 翻译切换（ZhipuAI GLM-4-flash）+ 翻译缓存（SHA-256 hash, StoreService 持久化）
**MarkdownContent** (`src/renderer/components/shared/MarkdownContent.tsx`) — react-markdown + remark-gfm 暗色主题渲染组件
**MarketplaceView** — ClawHub Skill 市场（搜索/浏览/安装/卸载）
**ToolsBrowser** — CLI 工具检测 + 自定义命令管理
**MinimizedBar** (`src/renderer/components/Layout/MinimizedBar.tsx`) — 底部最小化任务栏（状态灯+名称+目录胶囊，点击恢复并聚焦）
**UpdateNotification** — 自动更新提示和进度

### IPC API

```typescript
// 终端操作
window.electron.terminal.create(id, cols, rows, cwd)
window.electron.terminal.write(id, data)
window.electron.terminal.resize(id, cols, rows)
window.electron.terminal.destroy(id)
window.electron.terminal.onData(id, callback) / onExit(id, callback) / onCwd(id, callback)  // 按终端 id 订阅专属通道

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

// Git Worktree
window.electron.worktree.detectRepo(cwd) / list(repoPath) / create(repoPath)
window.electron.worktree.getStatus(path) / remove(path, force?) / rename(path, branch) / merge(path)
// 破坏性操作只接受 <repo>/.worktrees/ 下的路径；错误带结构化 code（DIRTY/LOCKED/CONFLICT/...）

// 更新
window.electron.update.checkForUpdates() / downloadUpdate() / installUpdate()

// 应用
window.electron.app.setOverlayBadge(hasWaiting)  // 任务栏图标红点徽章
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
| 标题目录被 claude 输出污染/换目录重启不刷新 | 宽松正则全缓冲扫描猜 cwd | 行首锚定提示符解析 `parsePromptCwd`，无匹配即冻结 |
| Worktree 一键强删丢数据 / current 徽章 Windows 失效 | 无脏检查直接 force + git 正斜杠 vs PTY 反斜杠路径比较 | 两段式删除（getStatus→确认）+ `normalizePath` 统一比较 |
