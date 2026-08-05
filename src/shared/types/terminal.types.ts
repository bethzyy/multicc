/**
 * 终端 IPC 共享类型
 */

/**
 * terminal:create 的返回值。
 * backend/osBuild 供渲染端配置 xterm 的 windowsPty 适配参数
 * （conpty.dll 加载失败回退 winpty 时，xterm 须禁用 reflow——
 * 见 renderer/utils/xtermWindowsPty.ts）。
 */
export interface TerminalCreateResult {
  ok: boolean
  /** 实际生效的 PTY 后端；ok=false 时缺省 */
  backend?: 'conpty' | 'winpty'
  /** 宿主 OS build 号（如 19045）；winpty 回退时 xterm 的 buildNumber 用它 */
  osBuild?: number
}
