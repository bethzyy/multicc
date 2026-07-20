import { describe, it, expect } from 'vitest'
import { matchBlockingPrompt } from '../../src/main/services/terminal/OscParser'
import { ALL_CASES } from '../fixtures/waiting-input-cases'

/**
 * matchBlockingPrompt——判断"屏幕上是否有持续的阻塞式提示框"，决定红灯是否【保持】。
 *
 * 数据驱动：用例复用 tests/fixtures/waiting-input-cases.ts 的 expectBlocking 字段。
 * 与 matchWaitingInputText（报警触发）刻意分家：一次性提醒（press any key / enter to
 * continue / "? …:"）会触发报警但 expectBlocking=false，交给自愈逻辑安静后灭灯。
 */
describe('matchBlockingPrompt — 屏幕上是否有持续阻塞式提示框（决定红灯是否保持）', () => {
  for (const c of ALL_CASES) {
    it(`${c.name} → ${c.expectBlocking ? '阻塞(保持红)' : '非阻塞'}`, () => {
      expect(
        matchBlockingPrompt(c.input),
        `「${c.name}」期望 blocking=${c.expectBlocking}`
      ).toBe(c.expectBlocking)
    })
  }
})
