/**
 * Scrollback 去重器 — 检测并跳过 XTerm scrollback 中的重复内容块。
 *
 * 根因：MultiCC 强制设置 CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 让 Claude Code
 * 使用经典渲染器（内容可滚入 scrollback）。但经典渲染器在流式输出、状态更新时
 * 通过光标移动重绘内容，将旧版本推入 scrollback，导致向上滚动时看到镜像式重复。
 * Windows ConPTY 也存在已知的输出回声 bug，可能同样导致重复。
 *
 * 策略：维护最近写入行的 hash 环形缓冲区。当新数据中连续 ≥8 行与缓冲区匹配、
 * 且总匹配率 ≥80% 时，跳过该次写入。不设时间窗口限制——Claude Code 的 re-render
 * 间隔通常数秒甚至数十秒，时间窗口会导致去重完全失效。
 */

/**
 * 提取一段数据中"最后一个"光标显隐控制码（DECTCEM）。
 *
 * 去重器丢弃整块重复写入时，会连同块内的 ?25l(隐藏光标)/?25h(显示光标) 一起丢掉。
 * 但光标可见性是终端的 *状态*：若先写入的帧把光标留在隐藏态，而随后携带 ?25h 的帧
 * 又被判为重复丢弃，光标就会永久消失（"有时光标不见了"的根因）。
 *
 * 丢弃前调用本函数取出块内最后一次显隐意图补写回终端，即可让光标可见性与应用真实
 * 意图保持同步——重复的可见文本仍被抑制，但状态码不再丢失。
 * 返回 '' 表示该块不含光标显隐码，无需补写。
 */
export function lastCursorVisibility(data: string): string {
  const hide = data.lastIndexOf('\x1b[?25l')
  const show = data.lastIndexOf('\x1b[?25h')
  if (hide < 0 && show < 0) return ''
  return show > hide ? '\x1b[?25h' : '\x1b[?25l'
}

/**
 * 检测"丢弃会导致终端状态失步"的控制序列。
 *
 * 经典渲染模式（DISABLE_ALTERNATE_SCREEN=1）下 Claude Code 通过光标移动+擦除原地重绘
 * 输入框，ConPTY 再合成为带绝对定位（CUP/EL/ED）的差异帧。这类帧的可见文本与上一帧
 * 高度重复（边框线 ──── hash 全部相同），会被判重——但帧内的定位/擦除序列是
 * *屏幕状态*：丢弃一帧，xterm 的屏幕就与 ConPTY 内部模型失步，后续差异帧落在错误的
 * 行上，残留边框永远清不掉（输入框错乱的根因）。
 *
 * 含本类序列的帧一律不可丢弃。刻意排除（仍可安全丢弃）：m(SGR 颜色)、q(光标形状，
 * 纯外观)、OSC（ConPTY 频繁发窗口标题，标记它会让去重彻底失效，丢失仅影响标题）、
 * 裸 ?25h/?25l（DECTCEM 由 lastCursorVisibility 补写）、CR/LF/BS、纯文本。
 */
const STATEFUL_PATTERNS: RegExp[] = [
  // CSI 状态类终结字节（精确枚举，勿用 [a-zA-Z] 减排除法）：
  // A/B/C/D 光标移动, E/F CNL/CPL, G CHA, H CUP, f HVP, d VPA, e VPR,
  // ` HPA, a HPR, J ED, K EL, L IL, M DL, P DCH, @ ICH, X ECH, S SU, T SD,
  // r DECSTBM, s/u 保存/恢复光标, n DSR(\x1b[6n 布局探测，丢了应用会卡等回应),
  // h/l 非私有模式(如 \x1b[4h IRM), t 窗口操作
  /\x1b\[[0-9;]*[ABCDEFGHJKLMPSTX@`adefhlnrstu]/,
  // DEC 私有模式 set/reset，豁免裸 ?25h/?25l；多参数形式（如 \x1b[?25;2026h）
  // 不命中豁免 → 正确判为 stateful
  /\x1b\[\?(?!25[hl])[0-9;]+[hl]/,
  // ESC 7/8 DECSC/DECRC, D IND, E NEL, H HTS, M RI, c RIS, =/> 键盘模式
  /\x1b[78DEHMc=>]/,
  // 字符集指定（\x1b(0 进入 DEC 画线字符集，\x1b(B 退出——丢失会字形错乱）
  /\x1b[()*+]/,
]

export function containsStatefulSequences(data: string): boolean {
  if (!data.includes('\x1b')) return false // 快速路径：纯文本
  return STATEFUL_PATTERNS.some((re) => re.test(data))
}

export class ScrollbackDeduplicator {
  private lineHashes: string[] = []
  private readonly maxSize: number
  private readonly minLines: number
  private readonly matchThreshold: number

  constructor(opts?: {
    maxSize?: number
    minLines?: number
    matchThreshold?: number
  }) {
    this.maxSize = opts?.maxSize ?? 1000
    this.minLines = opts?.minLines ?? 8
    this.matchThreshold = opts?.matchThreshold ?? 0.8
  }

  /** 剥离 ANSI/OSC 转义序列，只保留可见文本 */
  private stripAnsi(s: string): string {
    return s
      .replace(/\x1b\[[0-9;?]*[a-zA-Z@`]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b\][^\x1b]*\x1b\\/g, '')
      .replace(/\x1b[()][AB012]/g, '')
      .replace(/\x1b[>=<]/g, '')
      .replace(/\r/g, '')
  }

  /** 快速字符串 hash（非密码学安全，仅用于去重比较） */
  private hash(line: string): string {
    let h = 0
    const t = line.trim()
    if (!t) return ''
    for (let i = 0; i < t.length; i++) {
      h = ((h << 5) - h) + t.charCodeAt(i)
      h |= 0
    }
    return h.toString(36)
  }

  /**
   * 判断 data 帧是否应丢弃（不写入 xterm）。
   *
   * 永不丢弃：含状态控制序列的帧（containsStatefulSequences——丢了屏幕失步）、
   * 用户刚输入回显窗口内的帧（recentlyTyped）、调用方标记不可靠的帧（unsafe，
   * 如被截断过——前段可能含状态序列、hash 连续性也不可靠）。
   *
   * 记录规则："实际会写入屏幕的帧才记 hash"——被丢弃帧的新行从未上屏，
   * 记了会导致该内容未来首次真实写入被误判重复（内容丢失）。
   *
   * 阈值调节杆（本版未动，stateful 守卫改变了到达判重的帧群体，先观察再调）：
   * 降低 maxSize（如 300）可缩小"同一命令跑两次被误丢"的窗口，代价是长间隔
   * 去重变弱。
   */
  shouldDrop(data: string, opts: { recentlyTyped: boolean; unsafe?: boolean }): boolean {
    const clean = this.stripAnsi(data)
    const lines = clean.split('\n').map(l => l.trim()).filter(l => l.length > 0)

    // 纯匹配判定（无副作用）
    let dup = false
    if (lines.length >= this.minLines) {
      const set = new Set(this.lineHashes)
      let maxConsec = 0
      let curConsec = 0
      let totalMatch = 0
      const hashes = lines.map(l => this.hash(l))

      for (const h of hashes) {
        if (h && set.has(h)) {
          curConsec++
          totalMatch++
          if (curConsec > maxConsec) maxConsec = curConsec
        } else {
          curConsec = 0
        }
      }

      dup =
        maxConsec >= this.minLines &&
        totalMatch / hashes.length >= this.matchThreshold
    }

    const drop =
      dup &&
      !opts.recentlyTyped &&
      !opts.unsafe &&
      !containsStatefulSequences(data)

    // 会写入屏幕的帧记入缓冲。dup 但被守卫放行的帧：其未匹配的新行已上屏需记录；
    // 已匹配行重复入环（Set 比对无影响，仅占环容量）——可接受。
    if (!drop) {
      this.addLines(lines)
    }

    return drop
  }

  private addLines(lines: string[]): void {
    for (const l of lines) {
      const h = this.hash(l)
      if (h) this.lineHashes.push(h)
    }
    if (this.lineHashes.length > this.maxSize) {
      this.lineHashes = this.lineHashes.slice(-this.maxSize)
    }
  }

  reset(): void {
    this.lineHashes = []
  }
}
