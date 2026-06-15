/**
 * OSC Sequence Parser
 *
 * Parses OSC (Operating System Command) escape sequences from terminal output.
 * Used for:
 * - CWD detection (OSC 7, OSC 9;9)
 * - Shell integration (OSC 133)
 * - Bell detection (waiting for input)
 *
 * Exported functions:
 * - parseOscSequences - Parse all OSC sequences from terminal output
 * - extractLatestCwd - Get the latest CWD from terminal output
 * - detectWaitingForInput - Detect if shell is waiting for input
 * - detectCommandState - Detect command execution state
 * - StateChangeDebouncer - Debounce state changes
 */

/** OSC sequence types we care about */
export type OscSequenceType =
  | 'osc7'      // CWD: ESC ] 7 ; file://hostname/path BEL
  | 'osc99'     // CWD: ESC ] 9 ; 9 ; cwd BEL (Windows Terminal)
  | 'osc133'    // Shell integration: ESC ] 133 ; A/B/C/D BEL
  | 'bell'      // BEL character (0x07)
  | 'other';    // Other OSC sequences

export interface OscSequence {
  type: OscSequenceType;
  value?: string;
  timestamp: number;
}

/** Shell integration markers (OSC 133) */
export type ShellIntegrationMarker =
  | 'A'  // Mark start of prompt
  | 'B'  // Mark start of command line
  | 'C'  // Mark start of command output
  | 'D'  // Mark end of command
  | 'P'  // Mark pre-execution
  | 'K'; // Mark keyboard input

/**
 * Parse terminal data for OSC sequences
 * Returns all detected sequences
 */
export function parseOscSequences(data: string): OscSequence[] {
  const sequences: OscSequence[] = [];
  const timestamp = Date.now();

  // Check for bell characters (waiting for input indicator)
  if (data.includes('\x07')) {
    sequences.push({ type: 'bell', timestamp });
  }

  // OSC 7: CWD detection
  // ESC ] 7 ; file://hostname/path BEL or ST
  const osc7Regex = /\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)[\x07\x1b\\]/g;
  let match;
  while ((match = osc7Regex.exec(data)) !== null) {
    try {
      const cwd = decodeURIComponent(match[1]);
      sequences.push({ type: 'osc7', value: cwd, timestamp });
    } catch {
      // Ignore decode errors
    }
  }

  // OSC 9;9: Windows Terminal CWD
  // ESC ] 9 ; 9 ; cwd BEL
  const osc99Regex = /\x1b\]9;9;([^\x07\x1b]+)[\x07\x1b\\]/g;
  while ((match = osc99Regex.exec(data)) !== null) {
    try {
      const cwd = decodeURIComponent(match[1]);
      sequences.push({ type: 'osc99', value: cwd, timestamp });
    } catch {
      // Ignore decode errors
    }
  }

  // OSC 133: Shell integration (command boundaries)
  // ESC ] 133 ; A/B/C/D ; optional_params BEL
  const osc133Regex = /\x1b\]133;([ABCDPK])(?:;[^\x07\x1b]*)?[\x07\x1b\\]/g;
  while ((match = osc133Regex.exec(data)) !== null) {
    sequences.push({ type: 'osc133', value: match[1], timestamp });
  }

  return sequences;
}

/**
 * Extract the latest CWD from terminal output
 * Prioritizes OSC 9;9 (Windows Terminal) over OSC 7
 */
export function extractLatestCwd(data: string): string | null {
  const sequences = parseOscSequences(data);

  // Prefer OSC 9;9 (Windows Terminal)
  const osc99 = sequences.filter(s => s.type === 'osc99').pop();
  if (osc99?.value) return osc99.value;

  // Fall back to OSC 7
  const osc7 = sequences.filter(s => s.type === 'osc7').pop();
  return osc7?.value || null;
}

/**
 * Detect if shell is waiting for input
 * Based on OSC 133 markers and bell characters
 */
export function detectWaitingForInput(data: string): {
  isWaiting: boolean;
  reason: 'bell' | 'prompt' | 'none';
} {
  const sequences = parseOscSequences(data);

  // Check for bell (often used to notify input ready)
  if (sequences.some(s => s.type === 'bell')) {
    return { isWaiting: true, reason: 'bell' };
  }

  // Check for OSC 133 A (mark start of prompt)
  // This indicates the shell is ready for input
  if (sequences.some(s => s.type === 'osc133' && s.value === 'A')) {
    return { isWaiting: true, reason: 'prompt' };
  }

  return { isWaiting: false, reason: 'none' };
}

/**
 * Detect command execution state from OSC 133 sequences
 */
export function detectCommandState(data: string): {
  commandStarted: boolean;
  commandEnded: boolean;
  isPromptReady: boolean;
} {
  const sequences = parseOscSequences(data);
  const osc133 = sequences.filter(s => s.type === 'osc133');

  return {
    commandStarted: osc133.some(s => s.value === 'B' || s.value === 'C'),
    commandEnded: osc133.some(s => s.value === 'D'),
    isPromptReady: osc133.some(s => s.value === 'A'),
  };
}

/**
 * Detect standalone BEL character in raw PTY data.
 * BEL (\x07) is used by CLI tools to signal attention (permission prompt, etc.).
 * Must exclude BEL used as OSC terminator — ported from muxvo input-detector.ts.
 */
export function detectBellSignal(data: string): boolean {
  const withoutOsc = data.replace(/\x1b\][^\x07\x1b]*\x07/g, '')
  return withoutOsc.includes('\x07')
}

/**
 * WaitingInput detection — ported from muxvo input-detector.ts
 *
 * Uses per-terminal rolling buffers to handle prompts split across output chunks.
 * Without rolling buffer, Claude Code's TUI output (which splits a single prompt
 * across dozens of small data chunks) would never match any pattern.
 */

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07\x1b]*[\x07]|\x1b\].*?\x1b\\|\x1b[()][AB012]|\x1b\[[\?]?[0-9;]*[hlm]/g

function stripAnsi(str: string): string {
  const noAnsi = str.replace(ANSI_RE, '')
  return noAnsi.replace(/\r\n/g, '\n').replace(/[^\n]*\r([^\n\r]+)/g, '$1').replace(/\r/g, '')
}

// Precise signal: "Esc to cancel" is unique to Claude Code approval prompts
const ESC_CANCEL_PATTERN = /Esc\s*to\s*cancel/

// Combo: question line + numbered selector = interactive prompt
const QUESTION_LINE_PATTERN = /\?\s*$/m
const NUMBERED_OPTION_PATTERN = /❯\s*\d+\./

// Generic interactive prompt patterns
const GENERIC_PATTERNS = [
  /^\s*\?\s+.+[:：]\s*$/m,    // "? Select an option:"
  /\([yYnN]\/[yYnN]\)/,      // "(y/n)"
  /\[[yYnN]\/[yYnN]\]/,      // "[y/N]"
  /press\s*(any\s*)?key/i,   // "press any key"
  /enter\s*to\s*continue/i,  // "Enter to continue"
]

// Exclude patterns: avoid false positives on progress bars etc.
const EXCLUDE_PATTERNS = [
  /^\s*\d+[%％]/,       // Progress bar: "50%"
  /\[\d+\/\d+\]/,       // Progress: "[3/10]"
  /^(INFO|WARN|ERROR|DEBUG)/i, // Log lines
]

/**
 * 去边框归一化：Claude Code 等 TUI 的提示框用 │┃║| 把每行包起来，
 * 例如 "│ Do you want to proceed?      │"，问号后面还有空格 + 边框，
 * 导致 /\?\s*$/m 等行尾锚定的模式永远匹配不到。这里去掉每行首尾的
 * 边框字符与空白，使问句能真正落在行尾。
 */
function normalizeBorders(clean: string): string {
  return clean
    .split('\n')
    .map(line => line.replace(/^[\s│┃║|]+/, '').replace(/[\s│┃║|]+$/, ''))
    .join('\n')
}

/** detectWaitingInput 的判定结果，reason 标明命中/未命中的具体原因，便于日志排查与测试断言 */
export interface WaitingInputResult {
  matched: boolean
  /** 'esc-cancel' | 'numbered+question' | 'question-line+numbered' | `generic:${i}` | 'excluded' | 'none' */
  reason: string
}

/**
 * 纯函数版等待输入判定——不依赖滚动缓冲/terminalId，输入一段（可含 ANSI 的）原始文本，
 * 返回是否命中及命中原因。所有正则匹配逻辑集中于此，便于单元测试覆盖各种提示框格式。
 */
export function matchWaitingInputText(rawText: string): WaitingInputResult {
  const normalized = normalizeBorders(stripAnsi(rawText))

  // 1. "Esc to cancel" (Claude Code specific, highest precision)
  if (ESC_CANCEL_PATTERN.test(normalized)) {
    return { matched: true, reason: 'esc-cancel' }
  }

  // Check exclusions only against the tail (recent output)
  const tail = normalized.slice(-300)
  for (const exclude of EXCLUDE_PATTERNS) {
    if (exclude.test(tail)) return { matched: false, reason: 'excluded' }
  }

  // 2. 数字选择器 + 问句。强信号 "❯ N." 是交互式菜单（Claude Code 批准框等）
  // 的典型特征，只要同时出现"任意位置的问号"即判定——覆盖问句与选项不在同一行、
  // 或问句被边框拆行的情况，不再要求问号严格落在行尾。
  if (NUMBERED_OPTION_PATTERN.test(normalized) && /\?/.test(normalized)) {
    return { matched: true, reason: 'numbered+question' }
  }

  // 2b. 兼容旧逻辑：行尾问句 + 数字选择器
  if (QUESTION_LINE_PATTERN.test(normalized) && NUMBERED_OPTION_PATTERN.test(normalized)) {
    return { matched: true, reason: 'question-line+numbered' }
  }

  // 3. Generic patterns
  for (let i = 0; i < GENERIC_PATTERNS.length; i++) {
    if (GENERIC_PATTERNS[i].test(normalized)) {
      return { matched: true, reason: `generic:${i}` }
    }
  }

  return { matched: false, reason: 'none' }
}

// Per-terminal rolling buffers (same as muxvo)
const inputBuffers = new Map<string, string>()
const ROLLING_MAX = 2000

/**
 * 带滚动缓冲的等待输入检测（返回详细结果，供日志记录命中原因）。
 * 滚动缓冲用于处理被拆成多个 chunk 的提示框——Claude Code 的 TUI 输出常把
 * 单个提示框拆成几十个小 chunk，没有滚动缓冲就永远凑不齐完整提示去匹配。
 */
export function detectWaitingInputDetailed(data: string, terminalId: string): WaitingInputResult {
  const key = terminalId

  // Append to per-terminal rolling buffer
  const prev = inputBuffers.get(key) ?? ''
  let updated = prev + data
  if (updated.length > ROLLING_MAX) {
    updated = updated.slice(updated.length - ROLLING_MAX)
  }
  inputBuffers.set(key, updated)

  const result = matchWaitingInputText(updated)
  if (result.matched) {
    inputBuffers.delete(key)
  }
  return result
}

/** 带滚动缓冲的等待输入检测（布尔版，保持原有调用方兼容） */
export function detectWaitingInput(data: string, terminalId: string): boolean {
  return detectWaitingInputDetailed(data, terminalId).matched
}

/** Reset the rolling buffer for a specific terminal */
export function resetInputDetector(terminalId: string): void {
  inputBuffers.delete(terminalId)
}

/**
 * Debounced state change notifier
 * Prevents rapid state changes from causing UI flicker
 */
export class StateChangeDebouncer {
  private lastState: string = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly delayMs: number;

  constructor(delayMs: number = 50) {
    this.delayMs = delayMs;
  }

  notify(newState: string, callback: (state: string) => void): void {
    if (newState === this.lastState) return;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      if (newState !== this.lastState) {
        this.lastState = newState;
        callback(newState);
      }
      this.timer = null;
    }, this.delayMs);
  }

  reset(): void {
    this.lastState = '';
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
