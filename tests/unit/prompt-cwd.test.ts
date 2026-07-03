import { describe, it, expect } from 'vitest'
import { parsePromptCwd } from '../../src/main/services/terminal/PromptCwdParser'
import { PROMPT_CWD_CASES } from '../fixtures/prompt-cwd-cases'

/**
 * 标题目录解析——纯逻辑回归测试。
 * 数据驱动：用例全部来自 tests/fixtures/prompt-cwd-cases.ts。
 */
describe('parsePromptCwd — 行首锚定提示符解析', () => {
  for (const c of PROMPT_CWD_CASES) {
    it(c.name, () => {
      expect(parsePromptCwd(c.input)).toBe(c.expected)
    })
  }
})
