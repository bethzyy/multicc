/**
 * Resize 治理器（纯逻辑，可单测）
 *
 * 背景：ConPTY 的 resize 是主线程上对控制台宿主（OpenConsole.exe）的阻塞式 RPC。
 * 2026-07-11 的 AppHangXProcB1 卡死事件中，主进程 UI 线程正是在等待另一进程时冻结，
 * 头号嫌疑即重负载输出/宿主僵死时的 pty.resize()/pty.kill()（详见 WER 报告分析）。
 *
 * 三层防护：
 * 1. 去重 —— 与上次已应用尺寸相同的 resize 直接跳过（平铺布局切换会对每个终端重发相同尺寸）；
 * 2. 节流 —— 窗口拖动/布局连续变化时，throttleMs 内的请求合并为一次尾随应用（latest-wins）；
 * 3. 疑似无响应守卫 —— 某次原生 resize 耗时超过 suspectThresholdMs（正常 <50ms），
 *    判定宿主疑似卡死，暂停后续 resize（挂起为 pending），直到该终端再次产生输出
 *    （markAlive，证明宿主活着）才恢复。宁可尺寸暂时不同步，不可让主线程再冒险阻塞。
 *
 * 本类只做决策，不持有定时器/不调用 native —— 由 PtyService 负责调度与应用，
 * 保证可以在 tests/unit 里用注入的时间戳做纯逻辑测试。
 */

export interface ResizeDims {
  cols: number
  rows: number
}

/** request() 的决策结果：apply=立即应用；defer=挂起等 flush；skip=重复尺寸，忽略 */
export type ResizeAction = 'apply' | 'defer' | 'skip'

export class ResizeGovernor {
  private readonly throttleMs: number
  private readonly suspectThresholdMs: number
  private lastApplied: ResizeDims | null = null
  private lastApplyAt = Number.NEGATIVE_INFINITY
  private pending: ResizeDims | null = null
  private suspect = false

  constructor(opts: { throttleMs?: number; suspectThresholdMs?: number } = {}) {
    this.throttleMs = opts.throttleMs ?? 150
    this.suspectThresholdMs = opts.suspectThresholdMs ?? 500
  }

  /** 宿主疑似无响应（上次 resize 耗时超阈值），resize 已暂停 */
  get isSuspect(): boolean {
    return this.suspect
  }

  /** 有挂起未应用的尺寸 */
  get hasPending(): boolean {
    return this.pending !== null
  }

  /** 调度尾随 flush 应使用的延迟 */
  get flushDelayMs(): number {
    return this.throttleMs
  }

  /**
   * 请求一次 resize。
   * 返回 'apply' 时调用方应立即执行原生 resize 并回报 recordApply()；
   * 返回 'defer' 时调用方应在 flushDelayMs 后调用 flush()（若尚未有定时器）。
   */
  request(cols: number, rows: number, now: number): ResizeAction {
    if (this.sameAsApplied(cols, rows)) {
      // 目标尺寸已生效：连带丢弃更早挂起的中间尺寸（latest-wins）
      this.pending = null
      return 'skip'
    }
    if (this.suspect || now - this.lastApplyAt < this.throttleMs) {
      this.pending = { cols, rows }
      return 'defer'
    }
    return 'apply'
  }

  /**
   * 回报一次原生 resize 的实际执行情况。
   * durationMs 超过阈值即进入 suspect 状态，暂停后续 resize 直到 markAlive()。
   */
  recordApply(cols: number, rows: number, appliedAt: number, durationMs: number): void {
    this.lastApplied = { cols, rows }
    this.lastApplyAt = appliedAt
    if (durationMs >= this.suspectThresholdMs) {
      this.suspect = true
    }
    if (this.pending && this.pending.cols === cols && this.pending.rows === rows) {
      this.pending = null
    }
  }

  /** 终端产生了输出 —— 宿主活着，解除 suspect */
  markAlive(): void {
    this.suspect = false
  }

  /**
   * 取出应当应用的挂起尺寸（无可应用时返回 null）。
   * suspect 期间不放行（等 markAlive 后由调用方重新调度）。
   */
  flush(): ResizeDims | null {
    if (this.suspect || !this.pending) return null
    if (this.sameAsApplied(this.pending.cols, this.pending.rows)) {
      this.pending = null
      return null
    }
    const dims = this.pending
    this.pending = null
    return dims
  }

  private sameAsApplied(cols: number, rows: number): boolean {
    return this.lastApplied !== null && this.lastApplied.cols === cols && this.lastApplied.rows === rows
  }
}
