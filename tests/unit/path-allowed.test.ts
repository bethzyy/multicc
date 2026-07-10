import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { homedir } from 'os'
import { isPathAllowed } from '../../src/main/utils/security'

describe('isPathAllowed', () => {
  const home = homedir()

  it('允许 ~/.claude 下的文件', () => {
    expect(isPathAllowed(join(home, '.claude', 'skills', 'foo', 'SKILL.md'))).toBe(true)
    expect(isPathAllowed(join(home, '.claude', 'CLAUDE.md'))).toBe(true)
  })

  it('允许 ~/.multicc 下的文件', () => {
    expect(isPathAllowed(join(home, '.multicc', 'settings.json'))).toBe(true)
  })

  it('拒绝白名单外的普通路径', () => {
    expect(isPathAllowed('C:\\Windows\\System32\\config\\SAM')).toBe(false)
    expect(isPathAllowed(join(home, 'Documents', 'secret.txt'))).toBe(false)
  })

  it('拒绝同前缀的兄弟目录（.claude-evil）', () => {
    expect(isPathAllowed(join(home, '.claude-evil', 'x.txt'))).toBe(false)
    expect(isPathAllowed(join(home, '.claudex', 'skills', 'x'))).toBe(false)
  })

  it('允许项目级 .claude/skills 子树', () => {
    expect(isPathAllowed('D:\\proj\\.claude\\skills\\foo\\SKILL.md')).toBe(true)
    expect(isPathAllowed('D:\\proj\\.claude\\skills')).toBe(true)
  })

  it('允许项目级 .claude/mcp.json 与 .claude/CLAUDE.md', () => {
    expect(isPathAllowed('D:\\proj\\.claude\\mcp.json')).toBe(true)
    expect(isPathAllowed('D:\\proj\\.claude\\CLAUDE.md')).toBe(true)
  })

  it('拒绝 .claude 段的子串伪装', () => {
    // .claude/skillsXYZ 不是 skills 子树
    expect(isPathAllowed('D:\\proj\\.claude\\skillsXYZ\\x.txt')).toBe(false)
    // foo.claude 不是 .claude 目录段
    expect(isPathAllowed('D:\\proj\\foo.claude\\skills\\x.txt')).toBe(false)
    // mcp.json 后还有子路径
    expect(isPathAllowed('D:\\proj\\.claude\\mcp.json.bak')).toBe(false)
  })

  it('Windows 下大小写不敏感', () => {
    if (process.platform === 'win32') {
      expect(isPathAllowed(join(home.toUpperCase(), '.CLAUDE', 'skills', 'foo'))).toBe(true)
    }
  })
})
