import { describe, it, expect } from 'vitest'
import { computeSelfHealState, type TerminalStatus } from '../../src/main/services/terminal/OscParser'

/**
 * computeSelfHealState——「边沿触发报警 + 电平自愈」里的电平决策纯函数。
 *
 * 覆盖两条核心需求：
 * - Q1 空闲回到中性灰：非阻塞且静默超阈值 → idle
 * - Q2 新活动自动复位：红灯且阻塞框已消失且有新活动 → running
 * 以及最关键的安全性：本函数【绝不制造红灯】——即便 blockingVisible=true 但当前非红灯，
 * 也不会点红（红灯只由输出边沿检测产生），避免残留在缓冲里的旧框文本反复点红。
 */

const IDLE = 4000

interface Case {
  name: string
  current: TerminalStatus
  blockingVisible: boolean
  msSinceLastOutput: number
  expected: TerminalStatus
}

const CASES: Case[] = [
  // ── waiting_input（红灯）分支 ──
  {
    name: '红灯 + 阻塞框仍在 → 保持红（真实批准框未答，不能误灭）',
    current: 'waiting_input', blockingVisible: true, msSinceLastOutput: 999999, expected: 'waiting_input',
  },
  {
    name: '红灯 + 无阻塞框 + 已静默 → 灰（响铃/pause 一次性提醒安静后自愈）[Q1]',
    current: 'waiting_input', blockingVisible: false, msSinceLastOutput: IDLE, expected: 'idle',
  },
  {
    name: '红灯 + 无阻塞框 + 有新活动 → 绿（新活动自动复位）[Q2]',
    current: 'waiting_input', blockingVisible: false, msSinceLastOutput: 100, expected: 'running',
  },

  // ── 非红灯：静默 → 灰（Q1）──
  {
    name: 'busy + 静默 → 灰（Claude 跑完停在空闲提示符回到中性灰）[Q1]',
    current: 'busy', blockingVisible: false, msSinceLastOutput: IDLE, expected: 'idle',
  },
  {
    name: 'running + 静默 → 灰',
    current: 'running', blockingVisible: false, msSinceLastOutput: IDLE + 1, expected: 'idle',
  },
  {
    name: 'idle + 持续静默 → 保持灰',
    current: 'idle', blockingVisible: false, msSinceLastOutput: 999999, expected: 'idle',
  },

  // ── 非红灯：未静默 → 维持 ──
  {
    name: 'busy + 近期有输出 → 维持绿(busy)',
    current: 'busy', blockingVisible: false, msSinceLastOutput: 100, expected: 'busy',
  },
  {
    name: 'running + 近期有输出 → 维持绿(running)',
    current: 'running', blockingVisible: false, msSinceLastOutput: 100, expected: 'running',
  },

  // ── 安全性：非红灯态即便"阻塞框文本残留在缓冲"，也绝不凭空点红 ──
  {
    name: '非红灯 + blockingVisible=true（残留框文本）+ 未静默 → 不制造红灯，维持绿',
    current: 'running', blockingVisible: true, msSinceLastOutput: 100, expected: 'running',
  },
  {
    name: '非红灯 + blockingVisible=true + 静默 → 走静默灰，仍不制造红灯',
    current: 'busy', blockingVisible: true, msSinceLastOutput: IDLE, expected: 'idle',
  },
]

describe('computeSelfHealState — 自愈状态决策（电平）', () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(
        computeSelfHealState({
          current: c.current,
          blockingVisible: c.blockingVisible,
          msSinceLastOutput: c.msSinceLastOutput,
          idleAfterMs: IDLE,
        })
      ).toBe(c.expected)
    })
  }
})
