import { describe, it, expect } from 'vitest'
import {
  detectWaitingInput,
  detectWaitingInputDetailed,
  resetInputDetector,
} from '../../src/main/services/terminal/OscParser'

/**
 * 滚动缓冲行为测试。
 *
 * Claude Code 的 TUI 常把一个提示框拆成几十个小 chunk 逐次吐出，
 * detectWaitingInputDetailed 用 per-terminal 滚动缓冲把碎片拼起来再匹配。
 * 这里覆盖：跨 chunk 拼接、命中后清空、终端间隔离、手动 reset。
 *
 * 注意：滚动缓冲是模块级 Map，按 terminalId 隔离，每个用例用不同 id 避免互相污染。
 */

describe('detectWaitingInputDetailed — 滚动缓冲', () => {
  it('单个 chunk 里就出现完整提示 → 立即命中', () => {
    const id = 'roll-single'
    const r = detectWaitingInputDetailed('Do you want to proceed?\n❯ 1. Yes\n  2. No', id)
    expect(r.matched).toBe(true)
    expect(r.reason).toBe('numbered+question')
  })

  it('提示被拆成多个 chunk → 拼齐后才命中', () => {
    const id = 'roll-split'
    // 前几个 chunk 各自都不足以命中
    expect(detectWaitingInput('╭─────────────╮\n', id)).toBe(false)
    expect(detectWaitingInput('│ Continue?   │\n', id)).toBe(false)
    // 出现 ❯ N. 选项后，缓冲里已同时有问句 + 选择器 → 命中
    expect(detectWaitingInput('│ ❯ 1. Yes    │\n', id)).toBe(true)
  })

  it('命中后缓冲被清空 → 紧接着的无关输出不会立刻又命中', () => {
    const id = 'roll-clear'
    expect(detectWaitingInput('Proceed? (y/n)', id)).toBe(true)
    // 缓冲已清空，普通输出不该再判为等待
    expect(detectWaitingInput('done.\n', id)).toBe(false)
  })

  it('不同 terminalId 的缓冲相互隔离', () => {
    const a = 'roll-iso-a'
    const b = 'roll-iso-b'
    expect(detectWaitingInput('Continue?\n', a)).toBe(false)
    // b 收到选项不应借用 a 缓冲里的问句
    expect(detectWaitingInput('❯ 1. Yes\n', b)).toBe(false)
    // a 自己收到选项才命中
    expect(detectWaitingInput('❯ 1. Yes\n', a)).toBe(true)
  })

  it('resetInputDetector 清空指定终端缓冲', () => {
    const id = 'roll-reset'
    expect(detectWaitingInput('Continue?\n', id)).toBe(false)
    resetInputDetector(id)
    // reset 后问句已丢失，单独的选项不该命中
    expect(detectWaitingInput('❯ 1. Yes\n', id)).toBe(false)
  })

  it('超长输出滚动截断后，新到的完整提示仍能命中', () => {
    const id = 'roll-overflow'
    // 先灌入远超 ROLLING_MAX(2000) 的噪声
    expect(detectWaitingInput('x'.repeat(5000), id)).toBe(false)
    // 之后到来的完整提示（同一 chunk 内自洽）仍应命中
    expect(detectWaitingInput('Do you want to proceed?\n❯ 1. Yes\n', id)).toBe(true)
  })
})
