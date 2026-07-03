# 终端标题目录 + 最小化布局 + 任务栏红点 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 终端标题正确显示 claude 启动目录；终端可最小化且可见终端自动填满屏幕（焦点终端占大格）；任一终端红灯时任务栏图标叠加红点。

**Architecture:** 三个独立子特性共用一份计划。cwd 解析改为主进程纯函数（行首锚定提示符匹配，无匹配即冻结）；最小化沿用"CSS 隐藏不卸载"模式 + 新的动态网格纯函数（大格交换）；红点走一条新 IPC 通道调 `setOverlayIcon`。设计规格见 `docs/superpowers/specs/2026-07-03-terminal-title-minimize-badge-design.md`。

**Tech Stack:** Electron 40, React 19, TypeScript 5.9 (strict), XTerm.js 5, vitest 2

## Global Constraints

- 构建门禁：`npm run build`（`tsc --noEmit` 有预存噪音，**不**作为门禁）
- 单测：`npx vitest run`（配置只跑 `tests/**/*.test.ts`，node 环境，纯逻辑）
- 不新增任何 npm 依赖（如确需安装依赖必须 `npm install --ignore-scripts`）
- TerminalPane/xterm 实例**绝不卸载重挂**（内容会永久丢失）；一切隐藏用 CSS `display: none`
- 粘贴必须用 `xterm.paste()`（既有约束，勿破坏）
- overlay 红点仅 `win32`，其他平台静默跳过；最小化状态不做持久化
- 提交信息：中文 + conventional 前缀（feat:/fix:/test:/docs:），结尾空行后加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 所有 `git add` 只加本任务明确列出的文件，工作区可能有其他改动

---

### Task 0: 提交工作区遗留的去重守卫修复

工作区有上一轮已完成但未提交的修复（`ScrollbackDeduplicator.shouldDrop` 有状态序列守卫、安全截断切点、resize 重置行哈希）。必须先单独提交，否则会混进本计划后续对 `TerminalPane.tsx` 的提交。

**Files:**
- Commit（不修改）: `src/renderer/components/Terminal/TerminalPane.tsx`, `src/renderer/utils/ScrollbackDeduplicator.ts`

- [ ] **Step 1: 确认工作区状态**

Run: `git status --short`
Expected: 仅 ` M src/renderer/components/Terminal/TerminalPane.tsx` 和 ` M src/renderer/utils/ScrollbackDeduplicator.ts` 两行（若有其他改动，停下来向用户确认）。

- [ ] **Step 2: 验证基线绿色**

Run: `npx vitest run`
Expected: 全部 PASS。

Run: `npm run build`
Expected: 构建成功，退出码 0。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/components/Terminal/TerminalPane.tsx src/renderer/utils/ScrollbackDeduplicator.ts
git commit -m "fix: 去重守卫——有状态控制序列帧放行、安全截断切点、resize 重置行哈希

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1: parsePromptCwd 纯函数（TDD）

**Files:**
- Create: `src/main/services/terminal/PromptCwdParser.ts`
- Create: `tests/fixtures/prompt-cwd-cases.ts`
- Test: `tests/unit/prompt-cwd.test.ts`

**Interfaces:**
- Consumes: 无（纯函数，无 IO、无 electron 依赖）
- Produces: `parsePromptCwd(bufferTail: string): string | null` —— Task 2 的 `pty.ts` 以
  `import { parsePromptCwd } from './terminal/PromptCwdParser'` 消费。

- [ ] **Step 1: 写测试夹具**

创建 `tests/fixtures/prompt-cwd-cases.ts`：

```typescript
/**
 * parsePromptCwd 数据驱动用例。
 * 新增回归场景请改这里，不要改测试断言代码（与 waiting-input-cases 同约定）。
 */
export interface PromptCwdCase {
  name: string
  input: string
  expected: string | null
}

export const PROMPT_CWD_CASES: PromptCwdCase[] = [
  {
    name: 'cmd 空闲提示符',
    input: 'Microsoft Windows [版本 10.0.19045]\r\n\r\nD:\\Gitrepo\\multicc>',
    expected: 'D:\\Gitrepo\\multicc',
  },
  {
    name: 'cmd 命令回显（启动 claude 的行记录启动目录）',
    input: 'D:\\new>claude\r\n',
    expected: 'D:\\new',
  },
  {
    name: '多条提示符取最后一条（cd 后再启动）',
    input: 'D:\\old>cd D:\\new\r\nD:\\new>claude\r\n',
    expected: 'D:\\new',
  },
  {
    name: '盘符根目录',
    input: 'C:\\>',
    expected: 'C:\\',
  },
  {
    name: 'PowerShell 提示符',
    input: 'PS D:\\Gitrepo\\multicc> ',
    expected: 'D:\\Gitrepo\\multicc',
  },
  {
    name: '带 ANSI 颜色的提示符',
    input: '\x1b[32mD:\\Gitrepo\\multicc>\x1b[0m',
    expected: 'D:\\Gitrepo\\multicc',
  },
  {
    name: '带光标控制序列前缀的提示符（conpty 重绘）',
    input: '\x1b[?25h\x1b[2KD:\\proj>',
    expected: 'D:\\proj',
  },
  {
    name: 'Git Bash 提示符',
    input: 'user@host MINGW64 /d/Gitrepo/multicc\r\n$ ',
    expected: '/d/Gitrepo/multicc',
  },
  {
    name: 'WSL 提示符',
    input: 'user@ubuntu:/home/u/proj$ ',
    expected: '/home/u/proj',
  },
  // ── 以下都是旧解析器的误报源，必须返回 null ──
  {
    name: 'claude TUI 输出中的缩进文件路径 + 输入框',
    input: '  Read D:\\Gitrepo\\multicc\\src\\main\\index.ts\r\n│ > try "fix the bug" │\r\n',
    expected: null,
  },
  {
    name: 'claude 输出的行尾路径',
    input: 'Reading file D:\\foo\\bar.ts\r\nDone.\r\n',
    expected: null,
  },
  {
    name: 'box-drawing 边框行',
    input: '╭──────╮\r\n│ hello │\r\n╰──────╯\r\n',
    expected: null,
  },
  {
    name: '箭头/URL 不误报',
    input: 'see docs -> https://example.com\r\n',
    expected: null,
  },
  {
    name: '空缓冲',
    input: '',
    expected: null,
  },
]
```

- [ ] **Step 2: 写测试**

创建 `tests/unit/prompt-cwd.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { parsePromptCwd } from '../../src/main/services/terminal/PromptCwdParser'
import { PROMPT_CWD_CASES } from '../fixtures/prompt-cwd-cases'

/**
 * 标题目录解析——纯逻辑回归测试。
 * 数据驱动：用例全部来自 tests/fixtures/prompt-cwd-cases.ts。
 */
describe('parsePromptCwd — 行首锚定提示符解析', () => {
  for (const c of PROMPT_CWD_CASES) {
    it(c.name, () => {
      expect(parsePromptCwd(c.input)).toBe(c.expected)
    })
  }
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/unit/prompt-cwd.test.ts`
Expected: FAIL —— `Cannot find module .../PromptCwdParser`（模块不存在）。

- [ ] **Step 4: 实现 PromptCwdParser**

创建 `src/main/services/terminal/PromptCwdParser.ts`：

```typescript
/**
 * 从终端缓冲区尾部解析"提示符"所在目录。
 *
 * 只匹配行首锚定的提示符格式（cmd / PowerShell / Git Bash / WSL），
 * `>` 之后允许跟用户键入的命令——命令回显行（如 `D:\new>claude`）
 * 本身就记录了该命令的启动目录。
 *
 * claude 等 TUI 运行期间的输出行（缩进、边框字符、行尾路径）不会产生匹配；
 * 调用方收到 null 时保持现值——cwd 因此自然冻结在命令启动时的目录，
 * 命令退出后提示符重新出现才恢复跟踪。
 *
 * 纯函数、无 IO：目录存在性等校验由调用方（PtyService.isValidCwdPath）兜底。
 */

// 逐行清理：OSC、CSI、其余控制字符（\n 已被 split 消耗，\r 落入 CTRL_RE）
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g
const CSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g
const CTRL_RE = /[\x00-\x09\x0b-\x1f\x7f]/g

function cleanLine(line: string): string {
  return line.replace(OSC_RE, '').replace(CSI_RE, '').replace(CTRL_RE, '')
}

// 提示符模式（全部行首锚定；捕获组 1 = 目录）
const PROMPT_PATTERNS: RegExp[] = [
  // PowerShell: PS D:\path> [命令]
  /^PS\s+([A-Za-z]:\\[^>\n]*?)>/,
  // cmd.exe: D:\path> [命令]（> 不是合法路径字符，捕获无歧义）
  /^([A-Za-z]:\\[^<>|?*"\n]*?)>/,
  // Git Bash: user@host MINGW64 /d/path
  /^[\w.-]+@[\w.-]+\s+MINGW\d+\s+(\/\S*)/,
  // WSL: user@host:/path$
  /^[\w.-]+@[\w.-]+:(\/[^\n$]*)\$/,
]

export function parsePromptCwd(bufferTail: string): string | null {
  let lastMatch: string | null = null
  for (const rawLine of bufferTail.split('\n')) {
    const line = cleanLine(rawLine)
    if (!line) continue
    for (const pattern of PROMPT_PATTERNS) {
      const m = pattern.exec(line)
      if (m) {
        const path = m[1].trim()
        if (path) lastMatch = path
        break
      }
    }
  }
  return lastMatch
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/unit/prompt-cwd.test.ts`
Expected: 全部 PASS（14 个用例）。

- [ ] **Step 6: 提交**

```bash
git add src/main/services/terminal/PromptCwdParser.ts tests/fixtures/prompt-cwd-cases.ts tests/unit/prompt-cwd.test.ts
git commit -m "feat: 新增行首锚定的提示符 cwd 解析纯函数 parsePromptCwd

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: pty.ts 接入 parsePromptCwd，删除旧解析

**Files:**
- Modify: `src/main/services/pty.ts`（import 区 ~L7-17；注释 ~L119；`pollCwd` ~L620；删除 ~L646-712 的三个旧方法）

**Interfaces:**
- Consumes: Task 1 的 `parsePromptCwd(bufferTail: string): string | null`
- Produces: 行为变化——`terminal:cwd:${id}` 推送只在缓冲区尾部出现真提示符行时更新（无渲染进程改动）

- [ ] **Step 1: 加 import**

在 `src/main/services/pty.ts` 的 `import { detectForegroundProcessAsync, ... }` 行之后加：

```typescript
import { parsePromptCwd } from './terminal/PromptCwdParser'
```

- [ ] **Step 2: 替换 pollCwd 中的调用**

找到 `pollCwd` 末尾（~L620）：

```typescript
    const cwd = this.parseCwdFromBuffer(this.getBufferTail(instance))
```

替换为：

```typescript
    const cwd = parsePromptCwd(this.getBufferTail(instance))
```

- [ ] **Step 3: 删除旧方法**

先确认没有其他引用：

Run: `grep -n "parseCwdFromBuffer\|cleanPath\|isValidWindowsPath" src/main/services/pty.ts`
Expected: 只剩方法定义处（`pollCwd` 的调用已在 Step 2 替换）。若有其他调用点，先看清用途再决定，不要盲删。

然后整体删除 `pty.ts` 中的三个私有方法（约 L646-712，即 `parseCwdFromBuffer`、`cleanPath`、`isValidWindowsPath` 连同各自的 JSDoc 注释）。`isValidCwdPath` **保留**（`pollCwd` 与 OSC 路径仍用它兜底）。

- [ ] **Step 4: 更新过时注释**

L119 附近 `FOREGROUND_DETECTION_ENABLED` 的注释里有一句 `cwd 显示仍由 parseCwdFromBuffer 驱动。` 改为 `cwd 显示仍由 parsePromptCwd 驱动。`

- [ ] **Step 5: 验证**

Run: `npx vitest run`
Expected: 全部 PASS。

Run: `npm run build`
Expected: 构建成功（若报 unused 变量/方法错误，说明 Step 3 有遗漏）。

- [ ] **Step 6: 提交**

```bash
git add src/main/services/pty.ts
git commit -m "fix: 标题目录改用行首锚定提示符解析，根治 claude 输出污染 cwd

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: computeTileLayout / orderForLayout 纯函数（TDD）

**Files:**
- Create: `src/renderer/utils/tileLayout.ts`
- Test: `tests/unit/tile-layout.test.ts`

**Interfaces:**
- Consumes: 无（纯函数，无 DOM）
- Produces（Task 4 的 TileLayout.tsx 消费）:
  - `interface TileSlot { row: number; col: number; rowSpan: number; colSpan: number }`（1-based）
  - `interface TileLayoutResult { cols: number; rows: number; hasBigSlot: boolean; slots: TileSlot[] }`
  - `computeTileLayout(n: number): TileLayoutResult` —— 有大格时 `slots[0]` 是大格
  - `orderForLayout<T extends { id: string }>(visible: T[], focusedId: string | null, hasBigSlot: boolean): T[]`

- [ ] **Step 1: 写测试**

创建 `tests/unit/tile-layout.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { computeTileLayout, orderForLayout } from '../../src/renderer/utils/tileLayout'

describe('computeTileLayout', () => {
  it('n=0 返回空布局', () => {
    expect(computeTileLayout(0)).toEqual({ cols: 0, rows: 0, hasBigSlot: false, slots: [] })
  })

  it('n=1 单格全屏', () => {
    expect(computeTileLayout(1)).toEqual({
      cols: 1,
      rows: 1,
      hasBigSlot: false,
      slots: [{ row: 1, col: 1, rowSpan: 1, colSpan: 1 }],
    })
  })

  it('n=2 两列均分，无大格', () => {
    const r = computeTileLayout(2)
    expect(r.cols).toBe(2)
    expect(r.rows).toBe(1)
    expect(r.hasBigSlot).toBe(false)
  })

  it('n=3 大格占第一列全高，右侧上下两格', () => {
    const r = computeTileLayout(3)
    expect(r.cols).toBe(2)
    expect(r.rows).toBe(2)
    expect(r.hasBigSlot).toBe(true)
    expect(r.slots[0]).toEqual({ row: 1, col: 1, rowSpan: 2, colSpan: 1 })
    expect(r.slots.slice(1)).toEqual([
      { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
      { row: 2, col: 2, rowSpan: 1, colSpan: 1 },
    ])
  })

  it('n=5 大格左侧全高，右侧 2x2', () => {
    const r = computeTileLayout(5)
    expect(r.cols).toBe(3)
    expect(r.rows).toBe(2)
    expect(r.hasBigSlot).toBe(true)
    expect(r.slots[0]).toEqual({ row: 1, col: 1, rowSpan: 2, colSpan: 1 })
  })

  // 通用不变量：无空洞、无重叠、槽数吻合、不越界
  for (let n = 1; n <= 12; n++) {
    it(`n=${n} 无空洞、无重叠、槽数吻合`, () => {
      const { cols, rows, slots } = computeTileLayout(n)
      expect(slots).toHaveLength(n)
      const covered = new Set<string>()
      for (const s of slots) {
        for (let r = s.row; r < s.row + s.rowSpan; r++) {
          for (let c = s.col; c < s.col + s.colSpan; c++) {
            const key = `${r},${c}`
            expect(covered.has(key), `重叠格子 ${key}`).toBe(false)
            covered.add(key)
            expect(r).toBeLessThanOrEqual(rows)
            expect(c).toBeLessThanOrEqual(cols)
          }
        }
      }
      expect(covered.size).toBe(cols * rows)
    })
  }
})

describe('orderForLayout — 焦点交换进大格', () => {
  const ts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('焦点与首位互换，第三者槽位不变', () => {
    expect(orderForLayout(ts, 'c', true).map((t) => t.id)).toEqual(['c', 'b', 'a'])
  })

  it('焦点已在首位时不变', () => {
    expect(orderForLayout(ts, 'a', true).map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('无大格（均分网格）时不交换', () => {
    expect(orderForLayout(ts, 'c', false).map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('焦点不在可见列表（已最小化/关闭）时不交换', () => {
    expect(orderForLayout(ts, 'x', true).map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('不修改入参数组', () => {
    const input = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    orderForLayout(input, 'c', true)
    expect(input.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/tile-layout.test.ts`
Expected: FAIL —— `Cannot find module .../tileLayout`。

- [ ] **Step 3: 实现 tileLayout.ts**

创建 `src/renderer/utils/tileLayout.ts`：

```typescript
/**
 * 平铺布局计算（纯函数，供 TileLayout 组件与单测共用）。
 *
 * 规则（见 2026-07-03 设计文档）：
 * - cols = ceil(sqrt(n))，rows = ceil(n/cols)，holes = cols*rows - n
 * - holes = 0：均分网格，无大格
 * - holes > 0：大格 = 第 1 列纵向跨 (holes+1) 行，其余格子行优先填充，永远无空洞
 * - 焦点终端通过 orderForLayout 与首位"交换"进大格：每次焦点变化只有
 *   两个槽位互换，其余终端不动，避免全局跳动
 */
export interface TileSlot {
  row: number
  col: number
  rowSpan: number
  colSpan: number
}

export interface TileLayoutResult {
  cols: number
  rows: number
  hasBigSlot: boolean
  slots: TileSlot[]
}

export function computeTileLayout(n: number): TileLayoutResult {
  if (n <= 0) return { cols: 0, rows: 0, hasBigSlot: false, slots: [] }

  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const holes = cols * rows - n

  if (holes === 0) {
    const slots: TileSlot[] = []
    for (let i = 0; i < n; i++) {
      slots.push({ row: Math.floor(i / cols) + 1, col: (i % cols) + 1, rowSpan: 1, colSpan: 1 })
    }
    return { cols, rows, hasBigSlot: false, slots }
  }

  const bigRowSpan = holes + 1
  const slots: TileSlot[] = [{ row: 1, col: 1, rowSpan: bigRowSpan, colSpan: 1 }]
  for (let r = 1; r <= rows && slots.length < n; r++) {
    for (let c = 1; c <= cols && slots.length < n; c++) {
      if (c === 1 && r <= bigRowSpan) continue // 被大格覆盖
      slots.push({ row: r, col: c, rowSpan: 1, colSpan: 1 })
    }
  }
  return { cols, rows, hasBigSlot: true, slots }
}

export function orderForLayout<T extends { id: string }>(
  visible: T[],
  focusedId: string | null,
  hasBigSlot: boolean
): T[] {
  const ordered = [...visible]
  if (!hasBigSlot || !focusedId) return ordered
  const idx = ordered.findIndex((t) => t.id === focusedId)
  if (idx > 0) {
    const tmp = ordered[0]
    ordered[0] = ordered[idx]
    ordered[idx] = tmp
  }
  return ordered
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/tile-layout.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/utils/tileLayout.ts tests/unit/tile-layout.test.ts
git commit -m "feat: 平铺布局纯函数——大格填洞 + 焦点交换

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: TileLayout 接入新网格（大格交换 + minimized 隐藏）

**Files:**
- Modify: `src/renderer/App.tsx`（`TerminalInstance` 接口，~L13-19）
- Modify: `src/renderer/components/Layout/TileLayout.tsx`（整体重写渲染逻辑）
- Modify: `src/renderer/styles/main.css`（`.terminal-wrapper` 区块，~L307-333）

**Interfaces:**
- Consumes: Task 3 的 `computeTileLayout` / `orderForLayout` / `TileSlot`
- Produces: `TerminalInstance.minimized?: boolean` 字段（Task 5 写入它；本任务只读）；
  TileLayout 对 `minimized` 终端渲染 `display:none` 的 wrapper

- [ ] **Step 1: TerminalInstance 加 minimized 字段**

`src/renderer/App.tsx` 的接口（~L13）改为：

```typescript
export interface TerminalInstance {
  id: string
  name: string
  cwd: string
  isFocused: boolean
  state?: 'running' | 'waiting_input' | 'busy' | 'idle'
  minimized?: boolean
}
```

- [ ] **Step 2: 重写 TileLayout.tsx**

用以下内容整体替换 `src/renderer/components/Layout/TileLayout.tsx`：

```tsx
import { TerminalPane } from '../Terminal/TerminalPane'
import { TerminalInstance } from '../../App'
import { computeTileLayout, orderForLayout, TileSlot } from '../../utils/tileLayout'

interface TileLayoutProps {
  terminals: TerminalInstance[]
  focusedId: string | null
  onCloseTerminal: (id: string) => void
  onRenameTerminal: (id: string, name: string) => void
  onFocusTerminal: (id: string) => void
  onTerminalStateChange: (id: string, state: string) => void
  onTerminalCwdChange: (id: string, cwd: string) => void
  onOpenWorktree: (path: string) => void
  focusMode: boolean
  onToggleFocusModeForTerminal: (id: string) => void
  theme: 'dark' | 'light'
}

export function TileLayout({
  terminals,
  focusedId,
  onCloseTerminal,
  onRenameTerminal,
  onFocusTerminal,
  onTerminalStateChange,
  onTerminalCwdChange,
  onOpenWorktree,
  focusMode,
  onToggleFocusModeForTerminal,
  theme
}: TileLayoutProps) {
  // 网格只对可见终端计算；最小化终端保持挂载但 display:none（内容零丢失）
  const visibleTerminals = terminals.filter(t => !t.minimized)
  const layout = computeTileLayout(visibleTerminals.length)
  const ordered = orderForLayout(visibleTerminals, focusedId, layout.hasBigSlot)
  const slotById = new Map<string, TileSlot>()
  ordered.forEach((t, i) => slotById.set(t.id, layout.slots[i]))

  const gridStyle = layout.cols > 0
    ? {
        gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
        gridTemplateRows: `repeat(${layout.rows}, 1fr)`
      }
    : {}

  return (
    <div
      className={`tile-layout ${focusMode ? 'focus-mode-active' : ''}`}
      style={focusMode ? {} : gridStyle}
    >
      {terminals.map(terminal => {
        const slot = slotById.get(terminal.id)
        const wrapperClass = [
          'terminal-wrapper',
          focusMode ? (terminal.id === focusedId ? 'focused-visible' : 'hidden') : '',
          terminal.minimized ? 'minimized' : ''
        ].filter(Boolean).join(' ')
        return (
          <div
            key={terminal.id}
            className={wrapperClass}
            style={!focusMode && slot ? {
              gridRow: `${slot.row} / span ${slot.rowSpan}`,
              gridColumn: `${slot.col} / span ${slot.colSpan}`
            } : undefined}
          >
            <TerminalPane
              terminal={terminal}
              onClose={() => onCloseTerminal(terminal.id)}
              onRename={(name) => onRenameTerminal(terminal.id, name)}
              onFocus={() => onFocusTerminal(terminal.id)}
              onStateChange={(state) => onTerminalStateChange(terminal.id, state)}
              onCwdChange={(cwd) => onTerminalCwdChange(terminal.id, cwd)}
              onOpenWorktree={onOpenWorktree}
              isFocused={terminal.id === focusedId}
              isInFocusMode={focusMode && terminal.id === focusedId}
              onToggleFocusMode={() => onToggleFocusModeForTerminal(terminal.id)}
              theme={theme}
            />
          </div>
        )
      })}
    </div>
  )
}
```

要点：删除了原 `useRef`/`containerRef`（不再使用）和 `getGridStyle`；渲染顺序仍按 `terminals` 原序（React key 稳定、DOM 不重排），格位完全由内联 `gridRow/gridColumn` 决定。

- [ ] **Step 3: 改 CSS——wrapper 从 display:contents 变为真网格项**

`src/renderer/styles/main.css` 中把：

```css
/* 终端包装器 */
.terminal-wrapper {
  display: contents;
}
```

替换为：

```css
/* 终端包装器：真网格项（承载 gridRow/gridColumn 跨格内联样式） */
.terminal-wrapper {
  display: block;
  min-width: 0;
  min-height: 0;
}

.terminal-wrapper > .terminal-pane {
  height: 100%;
}

/* 最小化：保持挂载但不显示、不占格 */
.terminal-wrapper.minimized {
  display: none;
}
```

聚焦模式的既有规则（`.tile-layout.focus-mode-active .terminal-wrapper` 等）不动——特异性更高，聚焦模式行为不变；聚焦模式下最小化终端必非焦点，走既有 `.hidden` 规则。

- [ ] **Step 4: 验证**

Run: `npx vitest run`
Expected: 全部 PASS。

Run: `npm run build`
Expected: 构建成功。

手动冒烟（可选，完整验证在 Task 7）：`npm run dev`，开 3 个终端 → 左侧一个全高大格 + 右侧两个；点击右侧小格终端 → 它与大格互换、第三个不动；开 4 个 → 2x2 均分、点击不再引起换位。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/App.tsx src/renderer/components/Layout/TileLayout.tsx src/renderer/styles/main.css
git commit -m "feat: 平铺布局无空洞化——焦点终端占大格，其余格子稳定不动

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 最小化闭环（按钮 + 状态 + 底部任务栏恢复）

**Files:**
- Create: `src/renderer/utils/formatCwd.ts`
- Create: `src/renderer/components/Layout/MinimizedBar.tsx`
- Modify: `src/renderer/App.tsx`（新增 minimize/restore 回调、MinimizedBar 渲染、全最小化提示）
- Modify: `src/renderer/components/Layout/TileLayout.tsx`（透传 `onMinimizeTerminal`）
- Modify: `src/renderer/components/Terminal/TerminalPane.tsx`（`onMinimize` prop + 按钮；formatCwd 改 import）
- Modify: `src/renderer/styles/main.css`（minimized-bar / chip / 提示样式）

**Interfaces:**
- Consumes: Task 4 的 `TerminalInstance.minimized`
- Produces:
  - `formatCwd(cwd: string | null): string`（`src/renderer/utils/formatCwd.ts`）
  - `MinimizedBar({ terminals, onRestore }: { terminals: TerminalInstance[]; onRestore: (id: string) => void })`
  - TerminalPane 新 prop：`onMinimize: () => void`
  - TileLayout 新 prop：`onMinimizeTerminal: (id: string) => void`

- [ ] **Step 1: 抽取 formatCwd 公共工具**

创建 `src/renderer/utils/formatCwd.ts`（内容从 TerminalPane.tsx L55-64 原样搬移）：

```typescript
// 格式化路径显示：显示最后两级
export function formatCwd(cwd: string | null): string {
  if (!cwd) return ''

  const normalizedCwd = cwd.replace(/\\/g, '/')
  const parts = normalizedCwd.split('/')
  const filtered = parts.filter(p => p)
  if (filtered.length <= 2) return cwd
  return '.../' + filtered.slice(-2).join('/')
}
```

`src/renderer/components/Terminal/TerminalPane.tsx`：删除本地 `formatCwd` 函数定义（L55-64），在文件顶部 import 区加：

```typescript
import { formatCwd } from '../../utils/formatCwd'
```

- [ ] **Step 2: TerminalPane 加最小化按钮**

`TerminalPaneProps` 接口中，在 `onFocus: () => void` 之后加一行：

```typescript
  onMinimize: () => void
```

函数参数解构中在 `onFocus,` 后加 `onMinimize,`。

JSX 中"聚焦按钮"块（`{onToggleFocusMode && (...)}`）**之前**插入：

```tsx
          {/* 最小化按钮 */}
          <button
            className="terminal-action-btn minimize-btn"
            onClick={(e) => {
              e.stopPropagation()
              onMinimize()
            }}
            title="最小化"
          >
            ─
          </button>
```

- [ ] **Step 3: 创建 MinimizedBar 组件**

创建 `src/renderer/components/Layout/MinimizedBar.tsx`：

```tsx
import { TerminalInstance } from '../../App'
import { formatCwd } from '../../utils/formatCwd'

interface MinimizedBarProps {
  terminals: TerminalInstance[]
  onRestore: (id: string) => void
}

/**
 * 底部最小化任务栏：每个最小化终端一个胶囊（状态灯 + 名称 + 目录），
 * 点击恢复并聚焦。无最小化终端时不渲染、不占空间。
 */
export function MinimizedBar({ terminals, onRestore }: MinimizedBarProps) {
  if (terminals.length === 0) return null

  return (
    <div className="minimized-bar">
      {terminals.map(t => (
        <button
          key={t.id}
          className="minimized-chip"
          onClick={() => onRestore(t.id)}
          title={t.cwd || t.name}
        >
          <span className={`terminal-status-dot ${
            t.state === 'waiting_input' ? 'waiting' :
            t.state === 'running' || t.state === 'busy' ? 'running' : 'idle'
          }`} />
          <span className="minimized-chip-name">{t.name}</span>
          {t.cwd && <span className="minimized-chip-cwd">{formatCwd(t.cwd)}</span>}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: App.tsx 接入状态与渲染**

`src/renderer/App.tsx`：

(a) import 区加：

```typescript
import { MinimizedBar } from './components/Layout/MinimizedBar'
```

(b) 在 `closeTerminal` 定义之后加两个回调（模式与 `closeTerminal` 一致——在函数式更新内部迁移焦点）：

```typescript
  // 最小化终端
  const minimizeTerminal = useCallback((id: string) => {
    setTerminals(prev => {
      const next = prev.map(t => t.id === id ? { ...t, minimized: true } : t)
      // 最小化的是当前焦点终端时，焦点移交给第一个可见终端
      if (focusedId === id) {
        const nextVisible = next.find(t => !t.minimized)
        setFocusedId(nextVisible ? nextVisible.id : null)
      }
      return next
    })
    // 在聚焦模式中最小化聚焦终端时，退出聚焦模式回到平铺
    if (focusMode && focusedId === id) {
      setFocusMode(false)
    }
  }, [focusedId, focusMode])

  // 恢复最小化的终端（恢复后设为焦点，有大格时自然进大格）
  const restoreTerminal = useCallback((id: string) => {
    setTerminals(prev => prev.map(t => t.id === id ? { ...t, minimized: false } : t))
    setFocusedId(id)
  }, [])
```

(c) 在 `const focusedTerminal = ...` 附近加派生值：

```typescript
  const minimizedTerminals = terminals.filter(t => t.minimized)
  const allMinimized = terminals.length > 0 && minimizedTerminals.length === terminals.length
```

(d) JSX：`<TileLayout ... />` 加 prop `onMinimizeTerminal={minimizeTerminal}`；
在 TileLayout 之后、`{terminals.length === 0 && (...)}` 空状态之前插入：

```tsx
          {/* 全部最小化时的提示（覆盖在网格区上方） */}
          {allMinimized && (
            <div className="all-minimized-hint">
              <p>所有终端已最小化，点击下方任务栏恢复</p>
            </div>
          )}
```

在 `</main>` 结束标签**之前**（空状态块之后）插入：

```tsx
          {/* 底部最小化任务栏 */}
          <MinimizedBar terminals={minimizedTerminals} onRestore={restoreTerminal} />
```

- [ ] **Step 5: TileLayout 透传 onMinimizeTerminal**

`src/renderer/components/Layout/TileLayout.tsx`：

`TileLayoutProps` 中 `onFocusTerminal` 之后加：

```typescript
  onMinimizeTerminal: (id: string) => void
```

参数解构加 `onMinimizeTerminal,`；`<TerminalPane>` 的 `onFocus` prop 之后加：

```tsx
              onMinimize={() => onMinimizeTerminal(terminal.id)}
```

- [ ] **Step 6: CSS**

`src/renderer/styles/main.css`：

(a) `.main-content` 规则（~L279）加一行 `position: relative;`（供提示层定位）。

(b) 文件的 `.empty-state` 区块之前插入：

```css
/* 全部最小化提示（覆盖在网格区上，不挡任务栏） */
.all-minimized-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 14px;
  pointer-events: none;
}

/* 底部最小化任务栏 */
.minimized-bar {
  display: flex;
  gap: 6px;
  padding: 4px 8px;
  background-color: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  overflow-x: auto;
  flex-shrink: 0;
}

.minimized-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.minimized-chip:hover {
  border-color: var(--accent-color);
}

.minimized-chip-cwd {
  color: var(--text-secondary);
}

/* 胶囊里的红灯不放大（复用 .terminal-status-dot 但压回小尺寸） */
.minimized-chip .terminal-status-dot.waiting {
  width: 10px;
  height: 10px;
}
```

- [ ] **Step 7: 验证**

Run: `npx vitest run`
Expected: 全部 PASS。

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 8: 提交**

```bash
git add src/renderer/utils/formatCwd.ts src/renderer/components/Layout/MinimizedBar.tsx src/renderer/components/Layout/TileLayout.tsx src/renderer/components/Terminal/TerminalPane.tsx src/renderer/App.tsx src/renderer/styles/main.css
git commit -m "feat: 终端最小化——底部任务栏胶囊恢复，可见终端自动填满

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 任务栏图标红点 overlay（IPC 全链路）

**Files:**
- Modify: `src/shared/constants/channels.ts`（APP 区块）
- Modify: `src/preload/index.ts`（`shell` 命名空间之后）
- Modify: `src/shared/types/electron.d.ts`（`shell` 类型之后）
- Modify: `src/main/index.ts`（import + handler）
- Modify: `src/renderer/App.tsx`（红灯聚合 effect）

**Interfaces:**
- Consumes: `TerminalInstance.state`（既有）
- Produces: IPC 通道 `app:set-overlay-badge`；`window.electron.app.setOverlayBadge(hasWaiting: boolean): Promise<void>`

- [ ] **Step 1: 通道常量**

`src/shared/constants/channels.ts` 的 `APP` 区块加一行：

```typescript
    SET_OVERLAY_BADGE: 'app:set-overlay-badge',
```

- [ ] **Step 2: preload**

`src/preload/index.ts` 的 `shell: { ... }` 之后（同级）加：

```typescript
  // 应用级操作
  app: {
    // 任务栏图标红点徽章（任一终端等待输入时点亮）
    setOverlayBadge: (hasWaiting: boolean) =>
      ipcRenderer.invoke('app:set-overlay-badge', hasWaiting),
  },
```

- [ ] **Step 3: 类型声明**

`src/shared/types/electron.d.ts` 的 `shell: {...};` 之后加：

```typescript
      app: {
        setOverlayBadge: (hasWaiting: boolean) => Promise<void>;
      };
```

- [ ] **Step 4: 主进程 handler**

`src/main/index.ts`：

(a) L1 的 import 改为：

```typescript
import { app, BrowserWindow, ipcMain, shell, nativeImage } from 'electron'
```

(b) 模块顶层（`const isDev = ...` 之后）加常量：

```typescript
// 任务栏 overlay 红点（32x32 红色圆点 PNG，#ef4444 与应用红灯一致）
const RED_DOT_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA10lEQVR4nM2XwQ3EIAwE09O1sNSQGiiGrtIDPfBxBejuY6SIg4gQyPLYTxTYAdtgNgE2pqjmPQBGACfAIUAQIKqCfnP6z3AAK4AX4Nsor2MeA3x0Za3GuQ6dowtg1+3tNU+KOtctgH2Aca4iRG3bR6y8tBN/4SgBPIl5S05cAtiJ5kn2CuBOqfXK1wDMC+ZJpgTgXgRwJYCZyVdNxjNAeBEglABm1H5NcUkAegjoSUgvQ/pBRD+Kl7iM6NfxEg0JvSVboik9h4PWlufVQXmY5KI9zaaJDvADmQ5CiaN4bbQAAAAASUVORK5CYII='
```

(c) `registerIpcHandlers()` 中 `ipcMain.handle('window:isMaximized', ...)` 之后加：

```typescript
  // 任务栏图标红点徽章（仅 Windows 支持 overlay icon）
  ipcMain.handle('app:set-overlay-badge', (_, hasWaiting: boolean) => {
    if (process.platform !== 'win32' || !mainWindow) return
    try {
      if (hasWaiting) {
        mainWindow.setOverlayIcon(nativeImage.createFromDataURL(RED_DOT_DATA_URL), '有终端等待输入')
      } else {
        mainWindow.setOverlayIcon(null, '')
      }
    } catch (error) {
      console.warn('[Main] setOverlayIcon failed:', error)
    }
  })
```

- [ ] **Step 5: 渲染进程聚合 effect**

`src/renderer/App.tsx`：

(a) L1 import 加 `useRef`：

```typescript
import { useState, useCallback, useEffect, useRef } from 'react'
```

(b) `handleTerminalCwdChange` 之后加：

```typescript
  // 任一终端红灯（等待输入）→ 任务栏图标叠加红点；全部消除 → 恢复。
  // 用 ref 去重：只在布尔值翻转时发 IPC，避免每次渲染都发。
  const hasWaitingTerminal = terminals.some(t => t.state === 'waiting_input')
  const prevWaitingRef = useRef(false)
  useEffect(() => {
    if (hasWaitingTerminal !== prevWaitingRef.current) {
      prevWaitingRef.current = hasWaitingTerminal
      window.electron.app.setOverlayBadge(hasWaitingTerminal).catch(() => {})
    }
  }, [hasWaitingTerminal])
```

- [ ] **Step 6: 验证**

Run: `npx vitest run`
Expected: 全部 PASS。

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 7: 提交**

```bash
git add src/shared/constants/channels.ts src/preload/index.ts src/shared/types/electron.d.ts src/main/index.ts src/renderer/App.tsx
git commit -m "feat: 任一终端等待输入时任务栏图标叠加红点徽章

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 文档更新 + 端到端手动验证

**Files:**
- Modify: `CLAUDE.md`（IPC API 代码块、Renderer Components 区、Solved Issues 表）

**Interfaces:**
- Consumes: Tasks 1-6 全部落地
- Produces: 文档与代码一致；三个特性经真实应用验证

- [ ] **Step 1: 更新 CLAUDE.md**

(a) `### IPC API` 代码块的 `// 更新` 之后加：

```typescript
// 应用
window.electron.app.setOverlayBadge(hasWaiting)  // 任务栏图标红点徽章
```

(b) `### Renderer Components` 中 TileLayout 条目改为：

```markdown
**TileLayout** (`src/renderer/components/Layout/TileLayout.tsx`):
- 动态网格布局（`utils/tileLayout.ts` 纯函数）：cols=ceil(sqrt(n))；有空洞时焦点终端占大格（第 1 列跨行）填满，交换而非重排
- **聚焦模式**: 不卸载组件，用 CSS `display: none` 控制显隐
- **最小化**: 同样不卸载，`display: none`；底部 MinimizedBar 胶囊点击恢复
```

并在 ToolsBrowser 条目附近加一行：

```markdown
**MinimizedBar** (`src/renderer/components/Layout/MinimizedBar.tsx`) — 底部最小化任务栏（状态灯+名称+目录胶囊，点击恢复并聚焦）
```

(c) `## Solved Issues` 表末尾加一行：

```markdown
| 标题目录被 claude 输出污染/换目录重启不刷新 | 宽松正则全缓冲扫描猜 cwd | 行首锚定提示符解析 `parsePromptCwd`，无匹配即冻结 |
```

- [ ] **Step 2: 全量回归**

Run: `npx vitest run`
Expected: 全部 PASS。

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 3: 手动验证（npm run dev，逐项打勾）**

标题目录：
1. 新建终端 → `cd` 到另一目录 → 标题（≤5 秒内）更新为新目录
2. 启动 `claude` → 标题保持启动目录；让 claude 输出含大量文件路径的内容（如让它读文件）→ 标题**不**漂移
3. 退出 claude → `cd` 第三个目录 → 再启动 `claude` → 标题显示第三个目录

最小化与布局：
4. 开 3 个终端 → 左侧全高大格 + 右侧 2 个；点击右侧小格 → 与大格互换、第三个不动
5. 最小化 1 个 → 剩余 2 个左右均分；底部任务栏出现胶囊（名称+目录+状态灯）
6. 点击胶囊恢复 → 终端内容完整（滚动历史还在）、恢复者聚焦并进大格
7. 全部最小化 → 显示"所有终端已最小化"提示；逐个恢复正常
8. 聚焦模式中最小化聚焦终端 → 退出聚焦模式回平铺

任务栏红点：
9. 某终端触发等待输入（运行 claude 让它询问权限，或 `choice /m 继续`）→ Windows 任务栏 multicc 图标右下角出现红点
10. 在该终端输入 → 红点消失；把红灯终端最小化 → 红点仍在（胶囊也是红灯）

- [ ] **Step 4: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md 同步标题目录解析/最小化布局/任务栏红点

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
