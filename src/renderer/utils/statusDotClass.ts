// 终端状态 -> 状态灯 CSS 类名的映射（三态：等待输入 / 运行中 / 空闲）
export function statusDotClass(state: string | undefined): string {
  if (state === 'waiting_input') return 'waiting'
  if (state === 'running' || state === 'busy') return 'running'
  return 'idle'
}
