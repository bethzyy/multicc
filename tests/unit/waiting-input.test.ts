import { describe, it, expect } from 'vitest'
import { matchWaitingInputText } from '../../src/main/services/terminal/OscParser'
import { POSITIVE_CASES, NEGATIVE_CASES, type WaitingInputCase } from '../fixtures/waiting-input-cases'

/**
 * 红绿灯等待输入检测——纯逻辑回归测试。
 *
 * 数据驱动：用例全部来自 tests/fixtures/waiting-input-cases.ts。
 * 新增回归场景请改 fixtures，不要改这里的断言代码。
 */

function check(c: WaitingInputCase) {
  const result = matchWaitingInputText(c.input)
  expect(result.matched, `「${c.name}」期望 matched=${c.expectMatch}，实际命中原因=${result.reason}`)
    .toBe(c.expectMatch)
  if (c.expectReason !== undefined) {
    expect(result.reason, `「${c.name}」期望 reason=${c.expectReason}`).toBe(c.expectReason)
  }
}

describe('matchWaitingInputText — 应该判定为等待输入（红灯）', () => {
  for (const c of POSITIVE_CASES) {
    it(c.name, () => check(c))
  }
})

describe('matchWaitingInputText — 不应判定为等待输入（保持绿灯/灰灯）', () => {
  for (const c of NEGATIVE_CASES) {
    it(c.name, () => check(c))
  }
})
