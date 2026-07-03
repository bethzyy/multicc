# 设计文档：终端标题目录修正 + 最小化布局 + 任务栏红点

日期：2026-07-03
状态：已获用户批准的设计，待实现

## 背景与目标

三个改进需求：

1. **标题目录**：每个终端的标题要正确显示 claude 启动时所在的目录（只需启动时目录）。claude 退出后用户换目录再启动，标题必须显示新目录。
   - 现状问题：cwd 由 5 秒轮询 + 宽松正则从缓冲区尾部解析（cmd.exe 不支持 OSC 133），claude 运行时其输出中的文件路径会被误认成 cwd；换目录重启后标题也不一定刷新。
2. **最小化**：每个终端可最小化；未最小化的终端自动调整大小尽量占满屏幕（允许一个终端比其他大）。
3. **任务栏红点**：任一终端处于红灯（waiting_input）状态时，Windows 任务栏上的 multicc 图标叠加红点徽章；红灯全部消除后恢复原图标。

已确认的用户决策：

- 最小化终端停靠在**底部任务栏**（无最小化终端时自动隐藏）。
- 大格子给**最后活跃（最近获得焦点）的终端**，即现有 `focusedId`。
- 需求 3 采用 **overlay 红点徽章**，不整体替换图标。

## 第 1 节：标题目录 —— 严格提示符解析（仅主进程）

新建纯函数 `parsePromptCwd(bufferTail: string): string | null`，放在 `src/main/services/terminal/` 下（与现有 OSC 解析器同级，无文件系统依赖，便于 vitest 测试），替换 `pty.ts` 中的 `parseCwdFromBuffer`：

- 对缓冲区尾部逐行清理 ANSI/OSC/控制字符。
- 只匹配**行首锚定**的提示符格式，`>` 后允许跟用户敲入的命令（命令回显行如 `D:\new>claude` 本身就记录了启动目录）：
  - cmd：`^([A-Za-z]:\\[^<>|?*"\n]*)>`
  - PowerShell：`^PS ([A-Za-z]:\\[^>\n]*)>`
  - Git Bash（MINGW）与 WSL：保留现有两种格式，改为行首锚定。
- 取**最后一条**匹配作为 cwd；无匹配时返回 null，调用方**不更新**（保持现值）。
- `pollCwd` 中现有的 `isValidCwdPath`（含目录存在性检查）继续兜底；OSC7/OSC99 更新路径不变。

**行为推演**：

- `cd D:\new` → 启动 claude → 尾部最后的提示符行为 `D:\new>claude` → 标题显示 `D:\new`。
- claude 运行期间：TUI 输出行带边框字符或路径非行首带 `>` 格式，不产生新匹配 → 标题冻结在启动目录。
- claude 退出：新提示符出现 → 恢复跟踪；换目录再启动即显示新目录。
- 命令回显行被 100KB 缓冲挤出时只是"不更新"，不会变错。
- 渲染进程与 IPC 无改动。

## 第 2 节：最小化 + 自动填满布局

### 数据模型（App.tsx）

- `TerminalInstance` 增加 `minimized?: boolean`。
- 新增 `minimizeTerminal(id)` / `restoreTerminal(id)`。
- 最小化当前焦点终端时，焦点移交给列表中第一个可见终端；若无可见终端，`focusedId = null`。
- 在聚焦模式中最小化该终端时，退出聚焦模式回到平铺。
- 恢复终端时同时将其设为焦点（按大格规则自然进大格）。

### 布局算法（纯函数 `computeTileLayout(n)`，放渲染进程 utils）

- 可见终端数 n；列数 `cols = ceil(sqrt(n))`（与现状一致，n=2 时为 2x1）；行数 `rows = ceil(n/cols)`；空洞数 `holes = cols*rows − n`。
- `holes === 0`（1、2、4、6、9 个等）→ 均分网格，与现状相同，**不做交换**，按列表顺序排列。
- `holes > 0` → **大格 = 第 1 列纵向跨 (holes+1) 行**，其余终端按行优先填充剩余格子，永远无空洞。示例：3 个 → 左侧全高 1 + 右侧上下 2；5 个 → 左侧全高 1 + 右侧 2x2；7 个 → 左侧全高 1 + 右侧 3x2；8 个 → 左上跨 2 行 1 + 其余 7 格。
- **焦点交换进大格**（仅 `holes > 0` 时）：渲染槽位 = 可见终端按列表顺序复制，将焦点终端与第 0 位（大格）互换。每次焦点变化只有 2 个 pane 换位/resize，其余不动。焦点终端被最小化或不存在时不交换。

### 渲染（TileLayout.tsx + main.css）

- 最小化终端**不卸载**，wrapper 加 `display: none`（沿用聚焦模式做法），PTY 与状态事件照常。
- `.terminal-wrapper` 从 `display: contents` 改为真正网格项（block，`min-width/min-height: 0`），跨格通过内联 `gridRow`/`gridColumn` 设置；`.terminal-pane` 撑满 wrapper（height: 100%）。聚焦模式的现有 CSS 行为保持不变。
- 恢复时 ResizeObserver 触发现有 refit 机制。

### 底部任务栏（新组件 `MinimizedBar`，src/renderer/components/Layout/）

- 有 ≥1 个最小化终端时渲染在主内容区下方（约 32px 高的横条）；否则不渲染、不占空间。
- 每个胶囊：状态圆点（复用现有红/绿灯样式）+ 终端名 + 缩短目录（复用 `formatCwd`）。
- 点击胶囊：恢复并聚焦该终端。
- 聚焦模式下任务栏照常显示。
- 全部终端被最小化时，主区域显示"所有终端已最小化"提示。

### 入口

- TerminalPane 标题栏按钮区新增"─"最小化按钮，位于聚焦按钮左侧。

## 第 3 节：任务栏图标红点（overlay badge）

- `src/shared/constants/channels.ts` 新增通道 `app:set-overlay-badge`；preload 暴露 `window.electron.app.setOverlayBadge(hasWaiting: boolean)`；`electron.d.ts` 同步类型。
- App.tsx 用 `useEffect` 监听 terminals：`terminals.some(t => t.state === 'waiting_input')` 布尔值**变化时**才发 IPC（ref 去重）。
- 主进程 handler：`hasWaiting` 为 true 时 `mainWindow.setOverlayIcon(红点图标, '有终端等待输入')`，false 时 `setOverlayIcon(null, '')`。
- 红点图标：内嵌 base64 PNG 常量经 `nativeImage.createFromDataURL` 生成，不新增图标文件。
- 加 `process.platform === 'win32'` 守卫与 try/catch（overlay 仅 Windows 支持）。
- 最小化终端组件仍挂载、状态照常更新，其红灯同样点亮 overlay 与任务栏胶囊。

## 错误处理

- `parsePromptCwd` 无匹配 → 不更新 cwd，永不清空已有值。
- `setOverlayIcon` 失败 → try/catch 吞掉并 console.warn，不影响主流程。
- 布局函数对 n=0 返回空布局（TileLayout 不渲染网格）。

## 测试

- **单测**（vitest，`tests/unit/`，参照 waiting-input 测试先例）：
  - `parsePromptCwd`：空闲 cmd 提示符、`D:\new>claude` 命令回显、PS 提示符、带 ANSI 装饰的提示符、claude TUI 输出片段（含文件路径，应返回 null）、box-drawing 行、混合场景取最后一条。
  - `computeTileLayout`：n=1..9 断言无空洞、跨格正确、格数吻合；交换逻辑断言焦点变化只影响 2 个槽位、均分网格不交换。
- **构建门禁**：`npm run build`（项目约定；tsc --noEmit 有预存噪音不作为门禁）。
- **手动验证**（`npm run dev`）：
  1. 换目录重启 claude，标题显示新目录；claude 运行中标题不漂移。
  2. 最小化/恢复：内容零丢失、可见终端自动填满、焦点终端进大格、任务栏胶囊与红绿灯正确。
  3. 触发红灯（等待输入），任务栏图标出现红点；输入后红点消除。

## 范围外

- 最小化状态不做跨重启持久化（应用当前也不恢复终端列表）。
- macOS/Linux 的 dock 徽章不在本次范围（overlay 仅 win32）。
- 不改变 5 秒轮询节奏与 PTY 缓冲区上限。
