/**
 * 路径比较工具（主/渲染进程共用，不依赖 node:path，浏览器环境可用）。
 *
 * 背景：git 输出正斜杠路径（C:/D/...），而 Windows PTY 上报反斜杠路径（C:\D\...），
 * 直接字符串比较在 Windows 上永远不相等。统一在比较前规范化。
 */

/** 统一为正斜杠、去除末尾斜杠（保留根路径的斜杠） */
export function normalizePath(p: string): string {
  const n = p.replace(/\\/g, '/')
  return n.length > 1 ? n.replace(/\/+$/, '') : n
}

/** Windows 盘符路径大小写不敏感，其余平台保持大小写敏感 */
function comparable(p: string): string {
  const n = normalizePath(p)
  return /^[a-zA-Z]:\//.test(n) ? n.toLowerCase() : n
}

export function isSamePath(a: string, b: string): boolean {
  return comparable(a) === comparable(b)
}

/** child 等于 parent 或位于 parent 目录之内 */
export function isPathInside(child: string, parent: string): boolean {
  const c = comparable(child)
  const p = comparable(parent)
  return c === p || c.startsWith(p + '/')
}
