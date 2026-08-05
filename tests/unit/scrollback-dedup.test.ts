import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  ScrollbackDeduplicator,
  containsStatefulSequences,
  lastCursorVisibility,
  isDedupEnabled,
} from '../../src/renderer/utils/ScrollbackDeduplicator'

/**
 * ScrollbackDeduplicator 特征测试 —— 用真实 PTY 帧钉死两条互斥需求的边界。
 *
 * 历史教训（三轮返工的根因）：
 * 1. 去重器丢弃含定位/擦除序列的帧 → xterm 与 ConPTY 屏幕模型失步 → 输入框错乱；
 * 2. 于是加 containsStatefulSequences 守卫 → 但 ConPTY 输出的所有重绘帧都含
 *    这类序列 → 守卫实际上是全量否决（36k 真实帧回放：检出 152 个重复块，
 *    丢弃 0 个）→ 去重器对 ConPTY 流已无去重作用。
 *
 * 结论：这是设计约束而非 bug——丢帧只对"纯文本重复块"安全。
 * resize 重印导致的可见重复由 xterm 的 windowsPty 适配根治
 * （见 xterm-windows-pty.test.ts），不归去重器管。
 * 这些用例的使命：任何人再动守卫/去重逻辑时，两条需求都必须显式过一遍。
 *
 * 2026-08-05 起去重默认禁用（见下方"去重默认关闭"用例组与
 * ScrollbackDeduplicator.ts 头注释）：类本身的语义用例保留，供显式开启
 * （'multicc.dedup'='on'）的排查场景回归。
 */

/** 解码 pty-debug.log 的转义格式（\e=ESC \r=CR \n=LF ␠=空格 \xNN=控制字节） */
function unescapeLogLine(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '␠') { out += ' '; continue }
    if (c !== '\\') { out += c; continue }
    const n = s[i + 1]
    if (n === 'e') { out += '\x1b'; i++; continue }
    if (n === 'r') { out += '\r'; i++; continue }
    if (n === 'n') { out += '\n'; i++; continue }
    if (n === 'x' && /^[0-9a-f]{2}$/.test(s.slice(i + 2, i + 4))) {
      out += String.fromCharCode(parseInt(s.slice(i + 2, i + 4), 16)); i += 3; continue
    }
    out += c
  }
  return out
}

function loadFixtureFrames(name: string): string[] {
  const raw = readFileSync(join(__dirname, '..', 'fixtures', 'terminal', name), 'utf8')
  return raw.split('\n').filter((l) => l.length > 0 && !l.startsWith('#')).map(unescapeLogLine)
}

const NOT_TYPED = { recentlyTyped: false }

describe('stateful 守卫（真实帧）——丢弃这些帧会导致屏幕失步，必须保留', () => {
  it('Claude Code spinner 心跳帧即使文本与历史完全重复也不得丢弃（丢弃=spinner 冻结+光标寻址失步）', () => {
    const frames = loadFixtureFrames('spinner-burst.txt')
    expect(frames.length).toBeGreaterThanOrEqual(20)
    const dedup = new ScrollbackDeduplicator()
    // 把整个突发合并成一个大帧喂两次——第二次的行 hash 100% 命中历史
    const burst = frames.join('')
    expect(dedup.shouldDrop(burst, NOT_TYPED)).toBe(false)
    expect(dedup.shouldDrop(burst, NOT_TYPED)).toBe(false)
  })

  it('ConPTY 全量重印帧（\\e[H+逐行\\e[2K）不得丢弃（重印是 resize 后 xterm 与 ConPTY 重新对齐的唯一手段）', () => {
    const [repaint] = loadFixtureFrames('full-repaint.txt')
    expect(containsStatefulSequences(repaint)).toBe(true)
    const dedup = new ScrollbackDeduplicator()
    expect(dedup.shouldDrop(repaint, NOT_TYPED)).toBe(false)
    expect(dedup.shouldDrop(repaint, NOT_TYPED)).toBe(false) // 内容全部命中历史也不丢
  })

  it('真实帧全部含 stateful 序列——印证"ConPTY 流上守卫=全量否决"是常态而非边缘情况', () => {
    const frames = [...loadFixtureFrames('spinner-burst.txt'), ...loadFixtureFrames('full-repaint.txt')]
    for (const f of frames) {
      expect(containsStatefulSequences(f)).toBe(true)
    }
  })
})

describe('纯文本去重——类自身语义（仅在显式开启时生效；2026-08-05 起默认禁用）', () => {
  const textBlock = Array.from({ length: 10 }, (_, i) => `第${i}行 纯文本内容 duplicated-line-${i}`).join('\r\n') + '\r\n'

  it('≥8 行纯文本重复块第二次写入必须丢弃（这是去重器存在的意义，守卫不得误伤）', () => {
    const dedup = new ScrollbackDeduplicator()
    expect(dedup.shouldDrop(textBlock, NOT_TYPED)).toBe(false) // 首次：新内容
    expect(dedup.shouldDrop(textBlock, NOT_TYPED)).toBe(true)  // 重复：丢弃
  })

  it('用户输入回显窗口内不去重（编辑多行输入的整块重绘绝不能被判重丢弃）', () => {
    const dedup = new ScrollbackDeduplicator()
    dedup.shouldDrop(textBlock, NOT_TYPED)
    expect(dedup.shouldDrop(textBlock, { recentlyTyped: true })).toBe(false)
  })

  it('unsafe（被截断）帧不去重（前段可能含状态序列，hash 连续性不可靠）', () => {
    const dedup = new ScrollbackDeduplicator()
    dedup.shouldDrop(textBlock, NOT_TYPED)
    expect(dedup.shouldDrop(textBlock, { recentlyTyped: false, unsafe: true })).toBe(false)
  })

  it('reset() 后不再判重（resize 后行内容按新宽度重排，旧 hash 已失效）', () => {
    const dedup = new ScrollbackDeduplicator()
    dedup.shouldDrop(textBlock, NOT_TYPED)
    dedup.reset()
    expect(dedup.shouldDrop(textBlock, NOT_TYPED)).toBe(false)
  })
})

describe('去重默认关闭（2026-08-05 取证：现代栈已无镜像重复，误杀真实输出的风险大于收益）', () => {
  // 背景：滚动条不出现问题的取证发现（capture/capture-long/capture-big 三次真实
  // claude 会话回放）：新 conpty.dll + 现代 claude 经典渲染器下 scrollback 零镜像
  // 重复（去重器的原始问题已消失），而"纯文本 ≥8 行重复即丢"会吞掉合法的重复输出
  // （如连续两次 type 同一文件——第二次输出整块消失，scrollback 也不增长）。
  // 故去重改为 opt-in：localStorage 'multicc.dedup' 显式设 'on' 才启用。
  it("未设置开关时默认禁用（防误杀重复的合法输出，如同一命令跑两次）", () => {
    expect(isDedupEnabled(() => null)).toBe(false)
  })

  it("显式设 'on' 才启用（A/B 排查残留通道）", () => {
    expect(isDedupEnabled(() => 'on')).toBe(true)
  })

  it("历史值 'off' 仍是禁用（旧配置不翻转语义）", () => {
    expect(isDedupEnabled(() => 'off')).toBe(false)
  })

  it('storage 读取抛异常时安全回退为禁用', () => {
    expect(isDedupEnabled(() => { throw new Error('denied') })).toBe(false)
  })
})

describe('光标显隐补写（丢帧时的状态残留提取）', () => {
  it('spinner 帧以 ?25h 收尾——若被丢弃须补写"显示光标"，否则光标永久消失', () => {
    const frames = loadFixtureFrames('spinner-burst.txt')
    const burst = frames.join('')
    expect(lastCursorVisibility(burst)).toBe('\x1b[?25h')
  })

  it('不含显隐码的纯文本帧无需补写', () => {
    expect(lastCursorVisibility('plain text\r\n')).toBe('')
  })
})
