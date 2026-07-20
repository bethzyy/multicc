/**
 * 等待输入检测（红绿灯）回归用例库
 * =====================================
 *
 * 这是 `matchWaitingInputText`（报警触发）与 `matchBlockingPrompt`（红灯是否持续）的"事实表"。
 * 每个用例描述一段终端输出，以及它"应不应该把灯变红 / 是不是持续阻塞框"。新增回归用例时，
 * **只需往下面的数组追加一项**，不用改测试代码——`waiting-input.test.ts` / `blocking-prompt.test.ts`
 * 会自动逐项断言。
 *
 * 维护约定：
 * - 复现到一个"该红不红 / 该绿不绿 / 红灯不灭"的真实场景时，把那段输出（去敏感信息后）
 *   原样贴成一个新用例，`expectMatch`/`expectBlocking` 填期望结果，`note` 写清来源/现象。
 * - `input` 里可以包含真实的 ANSI 转义码（用 \x1b）与边框字符（│ ❯ 等），
 *   越接近真实 PTY 字节越好——检测逻辑本就要在这些噪声里工作。
 * - `expectMatch`：是否**触发报警**（点亮红灯 + 响铃那一下）。
 * - `expectBlocking`：屏幕上是否有**持续的阻塞式提示框**（决定红灯是否**保持**）。
 *   两者可以不同：shell 的 `press any key`、任务完成响铃等属于"一次性提醒"——
 *   `expectMatch=true`（响一声）但 `expectBlocking=false`（不该一直红，安静后自愈成灰）。
 */

export interface WaitingInputCase {
  name: string
  input: string
  /** 期望：是否触发报警（点亮红灯 + 响铃那一下），对应 matchWaitingInputText */
  expectMatch: boolean
  /** 可选：期望命中的具体规则原因（matchWaitingInputText 的 reason 字段） */
  expectReason?: string
  /** 期望：屏幕上是否有持续阻塞式提示框（决定红灯是否保持），对应 matchBlockingPrompt */
  expectBlocking: boolean
  /** 备注：用例来源 / 现象 / 为什么这样期望 */
  note?: string
}

// ── 应该变红（等待输入）的场景 ───────────────────────────────────────────────
export const POSITIVE_CASES: WaitingInputCase[] = [
  {
    name: 'Claude Code 文件编辑批准框（带边框，问句在框内）',
    input: [
      '╭────────────────────────────────────────────────────╮',
      '│ Do you want to make this edit to OscParser.ts?       │',
      '│                                                      │',
      '│ ❯ 1. Yes                                             │',
      '│   2. Yes, allow all edits this session               │',
      '│   3. No, and tell Claude what to do differently      │',
      '╰────────────────────────────────────────────────────╯',
    ].join('\n'),
    expectMatch: true,
    expectReason: 'numbered+question',
    expectBlocking: true,
    note: '核心回归点：边框 │ 让旧的 /\\?\\s*$/m 匹配失败，曾导致一直绿灯；真实批准框应持续红',
  },
  {
    name: 'Claude Code 命令执行批准框（含 Esc to cancel）',
    input: [
      '╭──────────────────────────────────────────────╮',
      '│ Bash command                                  │',
      '│ npm run build                                 │',
      '│ Do you want to proceed?                       │',
      '│ ❯ 1. Yes                                      │',
      '│   2. No                                       │',
      '╰──────────────────────────────────────────────╯',
      '  Esc to cancel',
    ].join('\n'),
    expectMatch: true,
    expectReason: 'esc-cancel',
    expectBlocking: true,
    note: 'Esc to cancel 是最高优先级强信号，属于持续阻塞框',
  },
  {
    name: '带 ANSI 颜色码的批准框（先 stripAnsi 再去边框）',
    input:
      '\x1b[2m╭───────────────╮\x1b[0m\n' +
      '\x1b[1m│ Continue?     │\x1b[0m\n' +
      '\x1b[36m│ ❯ 1. Yes      │\x1b[0m\n' +
      '\x1b[36m│   2. No       │\x1b[0m\n' +
      '\x1b[2m╰───────────────╯\x1b[0m',
    expectMatch: true,
    expectReason: 'numbered+question',
    expectBlocking: true,
    note: 'ANSI 包裹的边框，验证 stripAnsi + normalizeBorders 协同',
  },
  {
    name: '问句与选项跨行（问句不在选项同一行）',
    input: 'Which option do you prefer?\n\n❯ 1. Fast\n  2. Safe',
    expectMatch: true,
    expectReason: 'numbered+question',
    expectBlocking: true,
  },
  {
    name: '通用 (y/n) 提示',
    input: 'Overwrite existing file? (y/n) ',
    expectMatch: true,
    expectReason: 'generic:1',
    expectBlocking: true,
    note: '(y/n) 是真正等你选择的持续提示',
  },
  {
    name: '通用 [Y/n] 提示',
    input: 'Proceed with install [Y/n] ',
    expectMatch: true,
    expectReason: 'generic:2',
    expectBlocking: true,
  },
  {
    name: 'press any key to continue',
    input: '-- More --\nPress any key to continue',
    expectMatch: true,
    expectReason: 'generic:3',
    expectBlocking: false,
    note: '一次性提醒（shell/pager 的 pause）：响一声即可，不该一直红，安静后自愈成灰',
  },
  {
    name: 'Enter to continue',
    input: 'Review complete. Press Enter to continue',
    expectMatch: true,
    expectReason: 'generic:4',
    expectBlocking: false,
    note: '同上，一次性提醒，非持续阻塞框',
  },
  {
    name: '问号开头的选择提示 "? Select ...:"',
    input: '? Select an option:',
    expectMatch: true,
    expectReason: 'generic:0',
    expectBlocking: false,
    note: '触发报警，但缺 ❯N./y-n 这类强锚点，作一次性提醒处理，不长期摁红',
  },
]

// ── 不应该变红（正常运行 / 误报陷阱）的场景 ─────────────────────────────────
export const NEGATIVE_CASES: WaitingInputCase[] = [
  {
    name: 'Claude Code 工作中的 spinner（esc to interrupt）',
    input: '✶ Thinking… (12s · esc to interrupt)',
    expectMatch: false,
    expectBlocking: false,
    note: '关键负向：busy 但不是等待输入；不能因为有 esc/中断字样就变红',
  },
  {
    name: '百分比进度条',
    input: 'Downloading...  50%',
    expectMatch: false,
    expectBlocking: false,
    note: '无任何提示模式命中（reason=none）；不该误报为红灯',
  },
  {
    name: '[n/m] 进度计数',
    input: 'Running tests [3/10] passed',
    expectMatch: false,
    expectReason: 'excluded',
    expectBlocking: false,
  },
  {
    name: '日志行（INFO/WARN/ERROR）',
    input: 'INFO  server started on port 3000',
    expectMatch: false,
    expectReason: 'excluded',
    expectBlocking: false,
  },
  {
    name: '普通输出里出现问号但无选择器',
    input: 'Hmm, what could be causing this? Let me check the logs.',
    expectMatch: false,
    expectBlocking: false,
    note: '只有问号、没有 ❯N./y-n，不应误报',
  },
  {
    name: '纯数字菜单但没有问句',
    input: '❯ 1. Apple\n  2. Banana\n  3. Cherry',
    expectMatch: false,
    expectBlocking: false,
    note: '当前为保守策略：无问句的纯列表不算等待输入，避免对渲染列表误报',
  },
  {
    name: '空白输出',
    input: '   \n\n  ',
    expectMatch: false,
    expectBlocking: false,
  },
  {
    name: '尾部是进度计数但前面有旧问句（排除项只看尾部 300 字符）',
    input: 'Do you want to proceed?\n❯ 1. Yes\n' + 'x'.repeat(280) + '\nRunning [99/100]',
    expectMatch: false,
    expectReason: 'excluded',
    expectBlocking: true,
    note:
      '锁定"排除项基于 tail"的设计：尾部 [n/m] 进度会压过前面问句，故不【触发】报警(expectMatch=false)；' +
      '但 matchBlockingPrompt 不做尾部排除——文本里确有 "proceed? ❯ 1." 阻塞框，' +
      '故 expectBlocking=true。这只影响"已经红了要不要保持"，不会凭空点红（红灯只由报警触发产生）',
  },
]

export const ALL_CASES: WaitingInputCase[] = [...POSITIVE_CASES, ...NEGATIVE_CASES]
