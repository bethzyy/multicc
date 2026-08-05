import { describe, it, expect } from 'vitest'
import type { Terminal as TerminalType } from 'xterm-headless'
import { getWindowsPtyOptions, CONPTY_HAS_REFLOW_BUILD } from '../../src/renderer/utils/xtermWindowsPty'

// xterm-headless 的 isNode 检测在 Node≥21（自带 navigator 全局）下误判为浏览器，
// 模块加载时会摸 window——垫一个最小 window 再动态导入（无 requestIdleCallback，
// 它会正确回退到 setTimeout 队列）。
;(globalThis as { window?: unknown }).window ??= globalThis
const { Terminal } = await import('xterm-headless')

/**
 * "resize 后内容重复 + 排版错乱"回归测试（2026-07-29 截图问题的根治验证）。
 *
 * 机制（取证见 src/renderer/utils/xtermWindowsPty.ts 头注释）：
 * - ConPTY 在 resize 后按自己的模型全量重印视口，且它的 scrollback 不可变；
 * - xterm 默认（Unix 语义）在行数变多时把 scrollback 旧行拉回视口；
 * - 两者叠加 → 重印覆盖被拉回的旧行 → 同一内容出现两份，一份被覆盖成乱版。
 *
 * 用真实 xterm（headless，与渲染端同版本 5.3.0）重演该时序，
 * 断言 TerminalPane 的 windowsPty 配置使 ConPTY 重印保持幂等。
 */

const COLS = 80
const ROWS = 24
const TOTAL_LINES = 40 // 超过视口高度，确保有内容进 scrollback

function makeTerm(withWindowsPty: boolean): Terminal {
  return new Terminal({
    cols: COLS,
    rows: ROWS,
    scrollback: 1000,
    allowProposedApi: true, // windowsPty 在 xterm 5.3 是 proposed API（TerminalPane 同样开启）
    ...(withWindowsPty ? { windowsPty: getWindowsPtyOptions('conpty') } : {}),
  })
}

function write(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve))
}

/** 生成第 n 行的标记文本（含 CJK，模拟真实场景的宽字符内容） */
function marker(n: number): string {
  return `内容行-${String(n).padStart(2, '0')} 表格边框测试`
}

/** 全缓冲区（scrollback + 视口）中包含指定文本的行数 */
function countOccurrences(term: Terminal, text: string): number {
  const buf = term.buffer.active
  let count = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf.getLine(i)?.translateToString(true).includes(text)) count++
  }
  return count
}

/** 写入 TOTAL_LINES 行内容（部分滚入 scrollback），返回写入后的 baseY */
async function fillContent(term: Terminal): Promise<number> {
  for (let n = 1; n <= TOTAL_LINES; n++) {
    await write(term, marker(n) + '\r\n')
  }
  return term.buffer.active.baseY
}

/**
 * 模拟 ConPTY resize 后的全量重印帧。
 * ConPTY 的模型：行数 24→40 时视口 = 原可见内容 + 补空行（scrollback 不可变），
 * 随后发出 \e[H 归位 + 逐行重写的重印帧（帧结构取自真实日志中的重印帧，
 * 见 tests/fixtures/terminal/full-repaint.txt）。
 * @param firstVisible resize 前视口第一行的行号（1-based 内容行号）
 */
function conptyRepaintFrame(firstVisible: number): string {
  const parts: string[] = ['\x1b[H']
  for (let n = firstVisible; n <= TOTAL_LINES; n++) {
    parts.push('\x1b[2K' + marker(n) + '\r\n')
  }
  return parts.join('')
}

describe('xterm windowsPty 适配（ConPTY resize 重印幂等性）', () => {
  it('行数变多 + ConPTY 全量重印后，每行内容在全缓冲区只出现一次（防"重复+乱版"回归）', async () => {
    const term = makeTerm(true)
    const baseYBefore = await fillContent(term)
    expect(baseYBefore).toBeGreaterThan(0) // 前置：确实有内容在 scrollback

    // resize 前视口第一行 = baseY 处的内容行
    const firstVisible = baseYBefore + 1

    term.resize(COLS, TOTAL_LINES) // 行数 24→40（聚焦模式/关闭相邻终端的典型场景）
    await write(term, conptyRepaintFrame(firstVisible))

    for (let n = 1; n <= TOTAL_LINES; n++) {
      expect(countOccurrences(term, marker(n)), `行 ${n} 应恰好出现一次`).toBe(1)
    }
    term.dispose()
  })

  it('未设 windowsPty 时同一时序必然产生重复行——记录缺陷机制，若 xterm 升级后此测试失败，须重新评估 windowsPty 的必要性', async () => {
    const term = makeTerm(false)
    const baseYBefore = await fillContent(term)
    const firstVisible = baseYBefore + 1

    term.resize(COLS, TOTAL_LINES)
    await write(term, conptyRepaintFrame(firstVisible))

    const duplicated = Array.from({ length: TOTAL_LINES }, (_, i) => i + 1)
      .filter((n) => countOccurrences(term, marker(n)) > 1)
    expect(duplicated.length, '默认 Unix 语义下应能观测到重复行').toBeGreaterThan(0)
    term.dispose()
  })

  it('conpty 后端参数必须表示"现代 conpty"（≥21376，跟随捆绑 conpty.dll 而非宿主 OS）', () => {
    const opts = getWindowsPtyOptions('conpty')
    expect(opts.backend).toBe('conpty')
    expect(opts.buildNumber).toBeGreaterThanOrEqual(CONPTY_HAS_REFLOW_BUILD)
  })

  it('winpty 回退时后端标记必须是 winpty（xterm 据此禁用 reflow，避免与屏幕抓取器重印打架）', () => {
    const opts = getWindowsPtyOptions('winpty', 19045)
    expect(opts.backend).toBe('winpty')
    expect(opts.buildNumber).toBe(19045)
  })
})
