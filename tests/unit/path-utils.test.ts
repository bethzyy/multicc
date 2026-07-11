import { describe, it, expect } from 'vitest'
import { normalizePath, isSamePath, isPathInside } from '../../src/shared/utils/path'

/**
 * 路径比较工具测试。背景：git 输出正斜杠路径（C:/D/...），Windows PTY 上报
 * 反斜杠路径（C:\D\...），直接字符串比较永远不等——worktree "current" 徽章
 * 曾因此在 Windows 上完全失效。这些用例保护跨来源路径比较的正确性。
 */

describe('normalizePath', () => {
  it('反斜杠统一为正斜杠（git 输出 vs PTY 上报能够互相比较）', () => {
    expect(normalizePath('C:\\D\\proj\\sub')).toBe('C:/D/proj/sub')
  })

  it('末尾斜杠被去除（同一目录带不带尾斜杠必须视为相同）', () => {
    expect(normalizePath('C:/D/proj/')).toBe('C:/D/proj')
    expect(normalizePath('C:\\D\\proj\\')).toBe('C:/D/proj')
  })

  it('根路径 "/" 不被削成空串', () => {
    expect(normalizePath('/')).toBe('/')
  })
})

describe('isSamePath', () => {
  it('正反斜杠混合的同一路径判定相等', () => {
    expect(isSamePath('C:\\D\\proj', 'C:/D/proj')).toBe(true)
  })

  it('Windows 盘符路径大小写不敏感（git 可能输出 c:/，PTY 上报 C:\\）', () => {
    expect(isSamePath('c:/d/proj', 'C:\\D\\PROJ')).toBe(true)
  })

  it('非盘符路径（Unix 风格）保持大小写敏感', () => {
    expect(isSamePath('/home/User', '/home/user')).toBe(false)
  })

  it('不同路径判定不等', () => {
    expect(isSamePath('C:/D/proj-a', 'C:/D/proj-b')).toBe(false)
  })
})

describe('isPathInside', () => {
  it('子目录在父目录内（worktree 内的终端 cwd 要能匹配到该 worktree）', () => {
    expect(isPathInside('C:\\D\\proj\\.worktrees\\wt-1\\src', 'C:/D/proj/.worktrees/wt-1')).toBe(true)
  })

  it('路径等于自身也算 inside（终端 cwd 正好是 worktree 根）', () => {
    expect(isPathInside('C:/D/proj', 'C:\\D\\proj')).toBe(true)
  })

  it('同前缀的兄弟目录不能误判为 inside（C:/foo-bar 不在 C:/foo 内）——曾是 startsWith 裸比较的经典漏洞', () => {
    expect(isPathInside('C:/D/proj-backup', 'C:/D/proj')).toBe(false)
  })

  it('父目录不在子目录内（方向不能反）', () => {
    expect(isPathInside('C:/D/proj', 'C:/D/proj/.worktrees/wt-1')).toBe(false)
  })
})
