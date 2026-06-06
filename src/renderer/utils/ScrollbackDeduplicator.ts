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
   * 判断 data 是否为重复内容，应跳过写入。
   * 同时将新行 hash 记入缓冲区（无论是否重复）。
   */
  isDuplicate(data: string): boolean {
    const clean = this.stripAnsi(data)
    const lines = clean.split('\n').map(l => l.trim()).filter(l => l.length > 0)

    // 行数不足 → 跳过去重检查
    if (lines.length < this.minLines) {
      this.addLines(lines)
      return false
    }

    // 逐行与 hash 集合比对
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

    const isDup =
      maxConsec >= this.minLines &&
      totalMatch / hashes.length >= this.matchThreshold

    // 非重复内容才需要记入缓冲（重复的已在里面了）
    if (!isDup) {
      this.addLines(lines)
    }

    return isDup
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
