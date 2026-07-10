/**
 * 等待输入提示音
 *
 * 用 Web Audio API 振荡器合成短促双音"叮"声（880Hz→660Hz，约 0.45s），
 * 无需音频资源文件，也不涉及 CSP media-src。
 */

let ctx: AudioContext | null = null

export function playNotificationSound(): void {
  try {
    if (!ctx) {
      ctx = new AudioContext()
    }
    // AudioContext 可能因页面策略处于 suspended 状态
    if (ctx.state === 'suspended') {
      void ctx.resume()
    }
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, t0)
    osc.frequency.setValueAtTime(660, t0 + 0.15)
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + 0.45)
  } catch (e) {
    console.warn('[Sound] play failed:', e)
  }
}
