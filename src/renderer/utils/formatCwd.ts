// 格式化路径显示：显示最后两级
export function formatCwd(cwd: string | null): string {
  if (!cwd) return ''

  const normalizedCwd = cwd.replace(/\\/g, '/')
  const parts = normalizedCwd.split('/')
  const filtered = parts.filter(p => p)
  if (filtered.length <= 2) return cwd
  return '.../' + filtered.slice(-2).join('/')
}
