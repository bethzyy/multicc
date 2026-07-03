/**
 * parsePromptCwd 数据驱动用例。
 * 新增回归场景请改这里，不要改测试断言代码（与 waiting-input-cases 同约定）。
 */
export interface PromptCwdCase {
  name: string
  input: string
  expected: string | null
}

export const PROMPT_CWD_CASES: PromptCwdCase[] = [
  {
    name: 'cmd 空闲提示符',
    input: 'Microsoft Windows [版本 10.0.19045]\r\n\r\nD:\\Gitrepo\\multicc>',
    expected: 'D:\\Gitrepo\\multicc',
  },
  {
    name: 'cmd 命令回显（启动 claude 的行记录启动目录）',
    input: 'D:\\new>claude\r\n',
    expected: 'D:\\new',
  },
  {
    name: '多条提示符取最后一条（cd 后再启动）',
    input: 'D:\\old>cd D:\\new\r\nD:\\new>claude\r\n',
    expected: 'D:\\new',
  },
  {
    name: '盘符根目录',
    input: 'C:\\>',
    expected: 'C:\\',
  },
  {
    name: 'PowerShell 提示符',
    input: 'PS D:\\Gitrepo\\multicc> ',
    expected: 'D:\\Gitrepo\\multicc',
  },
  {
    name: '带 ANSI 颜色的提示符',
    input: '\x1b[32mD:\\Gitrepo\\multicc>\x1b[0m',
    expected: 'D:\\Gitrepo\\multicc',
  },
  {
    name: '带光标控制序列前缀的提示符（conpty 重绘）',
    input: '\x1b[?25h\x1b[2KD:\\proj>',
    expected: 'D:\\proj',
  },
  {
    name: 'Git Bash 提示符',
    input: 'user@host MINGW64 /d/Gitrepo/multicc\r\n$ ',
    expected: '/d/Gitrepo/multicc',
  },
  {
    name: 'WSL 提示符',
    input: 'user@ubuntu:/home/u/proj$ ',
    expected: '/home/u/proj',
  },
  // ── 以下都是旧解析器的误报源，必须返回 null ──
  {
    name: 'claude TUI 输出中的缩进文件路径 + 输入框',
    input: '  Read D:\\Gitrepo\\multicc\\src\\main\\index.ts\r\n│ > try "fix the bug" │\r\n',
    expected: null,
  },
  {
    name: 'claude 输出的行尾路径',
    input: 'Reading file D:\\foo\\bar.ts\r\nDone.\r\n',
    expected: null,
  },
  {
    name: 'box-drawing 边框行',
    input: '╭──────╮\r\n│ hello │\r\n╰──────╯\r\n',
    expected: null,
  },
  {
    name: '箭头/URL 不误报',
    input: 'see docs -> https://example.com\r\n',
    expected: null,
  },
  {
    name: '空缓冲',
    input: '',
    expected: null,
  },
]
