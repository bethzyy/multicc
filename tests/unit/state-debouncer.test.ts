import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StateChangeDebouncer } from '../../src/main/services/terminal/OscParser'

/**
 * StateChangeDebouncer——状态防抖。50ms 内的抖动只发最终态，避免 UI 闪烁。
 * 关键回归点：50ms 内 A→B→A（净变化为零）时，必须取消待发的陈旧 B emit，
 * 否则 B 会凭空发出——这正是"press any key 点红后立刻自愈却仍卡红灯"的根源之一。
 */
describe('StateChangeDebouncer — 状态防抖', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('单次变更：延迟后发出一次', () => {
    const d = new StateChangeDebouncer(50)
    const seen: string[] = []
    d.notify('running', s => seen.push(s))
    expect(seen).toEqual([])   // 尚未到点
    vi.advanceTimersByTime(50)
    expect(seen).toEqual(['running'])
  })

  it('50ms 内 running→waiting_input→running（净零）：不得发出陈旧的 waiting_input', () => {
    const d = new StateChangeDebouncer(50)
    const seen: string[] = []
    d.notify('running', s => seen.push(s))
    vi.advanceTimersByTime(50)
    expect(seen).toEqual(['running'])

    // 全在一个防抖窗口内来回
    d.notify('waiting_input', s => seen.push(s))
    vi.advanceTimersByTime(10)
    d.notify('running', s => seen.push(s))  // 回到 lastState → 应取消待发的 waiting_input
    vi.advanceTimersByTime(100)
    expect(seen).toEqual(['running'])        // 关键：红灯不得凭空亮起
  })

  it('50ms 内 busy→waiting_input→idle：只发出最终态 idle', () => {
    const d = new StateChangeDebouncer(50)
    const seen: string[] = []
    d.notify('busy', s => seen.push(s))
    vi.advanceTimersByTime(10)
    d.notify('waiting_input', s => seen.push(s))
    vi.advanceTimersByTime(10)
    d.notify('idle', s => seen.push(s))
    vi.advanceTimersByTime(50)
    expect(seen).toEqual(['idle'])
  })
})
