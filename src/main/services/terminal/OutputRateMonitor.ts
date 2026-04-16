/**
 * Output Rate Monitor
 *
 * Tracks per-terminal output rate (bytes/sec) and exposes a "heavy output" flag
 * for adaptive throttling in the PTY data pipeline.
 *
 * Uses hysteresis to prevent oscillation around the threshold:
 * - Enter heavy mode when rate > HEAVY_THRESHOLD_BPS (200 KB/s)
 * - Exit heavy mode when rate < NORMAL_THRESHOLD_BPS (50 KB/s)
 */

export class OutputRateMonitor {
  private bytesInWindow = 0
  private windowStart = Date.now()
  private currentBytesPerSecond = 0
  private _isHeavyOutput = false

  /** Enter heavy mode above this rate (200 KB/s) */
  static readonly HEAVY_THRESHOLD_BPS = 200_000
  /** Exit heavy mode below this rate (50 KB/s) — hysteresis gap prevents oscillation */
  static readonly NORMAL_THRESHOLD_BPS = 50_000
  /** Measurement window duration */
  static readonly WINDOW_MS = 1000

  /** Record an incoming data chunk. Call on every ptyProcess.onData event. */
  recordChunk(byteLength: number): void {
    const now = Date.now()
    const elapsed = now - this.windowStart

    if (elapsed >= OutputRateMonitor.WINDOW_MS) {
      // Compute rate for the completed window
      this.currentBytesPerSecond = (this.bytesInWindow / elapsed) * 1000
      this.bytesInWindow = 0
      this.windowStart = now

      // Hysteresis: different thresholds for entering vs exiting
      if (!this._isHeavyOutput && this.currentBytesPerSecond > OutputRateMonitor.HEAVY_THRESHOLD_BPS) {
        this._isHeavyOutput = true
        console.log(`[RateMonitor] Entered heavy output mode: ${Math.round(this.currentBytesPerSecond / 1024)} KB/s`)
      } else if (this._isHeavyOutput && this.currentBytesPerSecond < OutputRateMonitor.NORMAL_THRESHOLD_BPS) {
        this._isHeavyOutput = false
        console.log(`[RateMonitor] Exited heavy output mode: ${Math.round(this.currentBytesPerSecond / 1024)} KB/s`)
      }
    }

    this.bytesInWindow += byteLength
  }

  get isHeavyOutput(): boolean {
    return this._isHeavyOutput
  }

  get bytesPerSecond(): number {
    return this.currentBytesPerSecond
  }

  reset(): void {
    this.bytesInWindow = 0
    this.windowStart = Date.now()
    this.currentBytesPerSecond = 0
    this._isHeavyOutput = false
  }
}
