import { describe, it, expect } from 'vitest'
import { ResizeGovernor } from '../../src/main/services/terminal/ResizeGovernor'

/**
 * ResizeGovernor 测试。背景：ConPTY 的 resize 是主线程上对控制台宿主的阻塞 RPC，
 * 2026-07-11 主进程 AppHangXProcB1 卡死事件的头号嫌疑。Governor 通过
 * 去重/节流/疑似无响应守卫三层防护降低主线程再次被堵死的概率，
 * 这些用例保护该防护逻辑本身的正确性。
 */

const THROTTLE = 150
const SUSPECT = 500

function makeGovernor() {
  return new ResizeGovernor({ throttleMs: THROTTLE, suspectThresholdMs: SUSPECT })
}

describe('ResizeGovernor 去重', () => {
  it('首次请求返回 apply（无历史尺寸时必须立即生效，否则新终端首帧尺寸错误）', () => {
    const gov = makeGovernor()
    expect(gov.request(120, 30, 1000)).toBe('apply')
  })

  it('与已生效尺寸相同的请求返回 skip（平铺布局切换会对每个终端重发相同尺寸，重复的原生 RPC 纯属风险）', () => {
    const gov = makeGovernor()
    expect(gov.request(120, 30, 1000)).toBe('apply')
    gov.recordApply(120, 30, 1000, 5)
    expect(gov.request(120, 30, 5000)).toBe('skip')
  })

  it('skip 时连带丢弃更早挂起的中间尺寸（目标已达成，补发中间尺寸只会造成来回抖动）', () => {
    const gov = makeGovernor()
    gov.request(120, 30, 1000)
    gov.recordApply(120, 30, 1000, 5)
    expect(gov.request(100, 25, 1050)).toBe('defer')  // 节流窗口内挂起
    expect(gov.request(120, 30, 1060)).toBe('skip')   // 又回到已生效尺寸
    expect(gov.flush()).toBeNull()
    expect(gov.hasPending).toBe(false)
  })
})

describe('ResizeGovernor 节流', () => {
  it('节流窗口内的连续请求返回 defer，flush 只放行最新尺寸（窗口拖动风暴合并为一次尾随应用）', () => {
    const gov = makeGovernor()
    gov.request(120, 30, 1000)
    gov.recordApply(120, 30, 1000, 5)
    expect(gov.request(110, 28, 1010)).toBe('defer')
    expect(gov.request(100, 26, 1020)).toBe('defer')
    expect(gov.request(90, 24, 1030)).toBe('defer')
    expect(gov.flush()).toEqual({ cols: 90, rows: 24 })
    expect(gov.flush()).toBeNull()  // pending 已取走，不重复放行
  })

  it('节流窗口外的新尺寸请求返回 apply（稳态下单次 resize 不应被人为延迟）', () => {
    const gov = makeGovernor()
    gov.request(120, 30, 1000)
    gov.recordApply(120, 30, 1000, 5)
    expect(gov.request(100, 26, 1000 + THROTTLE + 1)).toBe('apply')
  })
})

describe('ResizeGovernor 疑似无响应守卫', () => {
  it('原生 resize 耗时超阈值后进入 suspect，后续请求一律 defer 且 flush 不放行（防主线程再次被 ConPTY 阻塞 RPC 堵死）', () => {
    const gov = makeGovernor()
    gov.request(120, 30, 1000)
    gov.recordApply(120, 30, 1000, SUSPECT)  // 恰好达到阈值即判定
    expect(gov.isSuspect).toBe(true)
    expect(gov.request(100, 26, 10_000)).toBe('defer')  // 即使早已出节流窗口
    expect(gov.flush()).toBeNull()
    expect(gov.hasPending).toBe(true)  // 尺寸未丢，等宿主恢复后补发
  })

  it('markAlive 解除 suspect 后 flush 放行挂起尺寸（终端恢复输出证明宿主活着，自动补发保证尺寸最终一致）', () => {
    const gov = makeGovernor()
    gov.request(120, 30, 1000)
    gov.recordApply(120, 30, 1000, SUSPECT + 100)
    gov.request(100, 26, 2000)
    gov.markAlive()
    expect(gov.isSuspect).toBe(false)
    expect(gov.flush()).toEqual({ cols: 100, rows: 26 })
  })

  it('耗时正常的 resize 不触发 suspect（正常 RPC 在几十毫秒内完成，不应误伤）', () => {
    const gov = makeGovernor()
    gov.request(120, 30, 1000)
    gov.recordApply(120, 30, 1000, SUSPECT - 1)
    expect(gov.isSuspect).toBe(false)
  })
})
