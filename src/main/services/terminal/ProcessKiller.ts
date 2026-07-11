/**
 * 进程树终结器（不依赖 electron，可集成测试）
 *
 * 背景：node-pty 的 pty.kill() 在 ConPTY 模式下是主线程上对控制台宿主的阻塞调用，
 * 遇到僵死子进程可能永久阻塞主线程（2026-07-11 AppHangXProcB1 事件的头号嫌疑之一）。
 *
 * 加固策略：关终端时先用异步 taskkill /T /F 干掉整棵进程树，并轮询确认根进程
 * 确实退出，之后再调 pty.kill() 释放 ConPTY 资源——此时进程树已死，
 * ConPTY teardown 不会再等任何人。若限时内无法确认退出，调用方应跳过 pty.kill()
 * （宁可泄漏一份 conpty 句柄，不可让主线程冒险阻塞）。
 *
 * 仅支持 Windows（taskkill）；multicc 本身是 Windows 专属应用。
 */

import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** 进程是否存在（signal 0 探测，Windows 下同样有效） */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 强制终止整棵进程树并确认根进程退出。
 * 返回 true = 已确认退出（此后调 pty.kill() 是安全的）；
 * 返回 false = 限时内未能确认（调用方不应再做任何可能阻塞的同步调用）。
 */
export async function killProcessTree(pid: number, timeoutMs = 2500): Promise<boolean> {
  if (!isProcessAlive(pid)) return true

  try {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      timeout: timeoutMs,
      windowsHide: true
    })
  } catch {
    // taskkill 非零退出：进程可能刚好自行退出、或个别子进程拒绝访问。
    // 不在此判定成败，以下面的存在性轮询为准。
  }

  const deadline = Date.now() + timeoutMs
  while (isProcessAlive(pid)) {
    if (Date.now() >= deadline) return false
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return true
}
