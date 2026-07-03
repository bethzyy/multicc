/**
 * 从终端缓冲区尾部解析"提示符"所在目录。
 *
 * 只匹配行首锚定的提示符格式（cmd / PowerShell / Git Bash / WSL），
 * `>` 之后允许跟用户键入的命令——命令回显行（如 `D:\new>claude`）
 * 本身就记录了该命令的启动目录。
 *
 * claude 等 TUI 运行期间的输出行（缩进、边框字符、行尾路径）不会产生匹配；
 * 调用方收到 null 时保持现值——cwd 因此自然冻结在命令启动时的目录，
 * 命令退出后提示符重新出现才恢复跟踪。
 *
 * 纯函数、无 IO：目录存在性等校验由调用方（PtyService.isValidCwdPath）兜底。
 */

// 逐行清理：OSC、CSI、其余控制字符（\n 已被 split 消耗，\r 落入 CTRL_RE）
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g
const CSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g
const CTRL_RE = /[\x00-\x09\x0b-\x1f\x7f]/g

function cleanLine(line: string): string {
  return line.replace(OSC_RE, '').replace(CSI_RE, '').replace(CTRL_RE, '')
}

// 提示符模式（全部行首锚定；捕获组 1 = 目录）
const PROMPT_PATTERNS: RegExp[] = [
  // PowerShell: PS D:\path> [命令]
  /^PS\s+([A-Za-z]:\\[^>\n]*?)>/,
  // cmd.exe: D:\path> [命令]（> 不是合法路径字符，捕获无歧义）
  /^([A-Za-z]:\\[^<>|?*"\n]*?)>/,
  // Git Bash: user@host MINGW64 /d/path
  /^[\w.-]+@[\w.-]+\s+MINGW\d+\s+(\/\S*)/,
  // WSL: user@host:/path$
  /^[\w.-]+@[\w.-]+:(\/[^\n$]*)\$/,
]

export function parsePromptCwd(bufferTail: string): string | null {
  let lastMatch: string | null = null
  for (const rawLine of bufferTail.split('\n')) {
    const line = cleanLine(rawLine)
    if (!line) continue
    for (const pattern of PROMPT_PATTERNS) {
      const m = pattern.exec(line)
      if (m) {
        const path = m[1].trim()
        if (path) lastMatch = path
        break
      }
    }
  }
  return lastMatch
}
