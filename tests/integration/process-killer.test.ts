import { describe, it, expect, afterEach } from 'vitest'
import { spawn, ChildProcess } from 'node:child_process'
import { killProcessTree, isProcessAlive } from '../../src/main/services/terminal/ProcessKiller'

/**
 * ProcessKiller 集成测试（真实进程，Windows taskkill）。
 * 背景：关闭终端时先异步 taskkill 进程树并确认退出、再调 pty.kill()，
 * 是防止 ConPTY 阻塞调用冻结主线程的关键路径（2026-07-11 AppHang 事件加固）。
 * 这些用例在真实进程上验证"确认退出"语义——它是"跳过 pty.kill() 保护"的判定依据。
 */

let child: ChildProcess | null = null

afterEach(() => {
  // 兜底清理，防测试失败时留下孤儿进程
  if (child?.pid && isProcessAlive(child.pid)) {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    } catch {
      // 清理失败不影响断言结果
    }
  }
  child = null
})

/** 启动一棵真实进程树：cmd.exe 父进程 + ping 子进程（约 30s 后自然退出） */
function spawnProcessTree(): ChildProcess {
  return spawn('cmd.exe', ['/d', '/s', '/c', 'ping -n 30 127.0.0.1 > nul'], {
    stdio: 'ignore',
    windowsHide: true
  })
}

describe('killProcessTree', () => {
  it('对存活的进程树返回 true 且根进程确实退出（"确认退出"是后续安全调用 pty.kill() 的前提，误报会重新引入主线程阻塞风险）', async () => {
    child = spawnProcessTree()
    const pid = child.pid!
    expect(isProcessAlive(pid)).toBe(true)

    const confirmed = await killProcessTree(pid)

    expect(confirmed).toBe(true)
    expect(isProcessAlive(pid)).toBe(false)
  })

  it('对已退出的进程返回 true（关闭进程已自行退出的终端必须幂等成功，不能报错或卡住）', async () => {
    child = spawnProcessTree()
    const pid = child.pid!
    await killProcessTree(pid)  // 先杀一次
    // 再杀已死进程
    await expect(killProcessTree(pid)).resolves.toBe(true)
  })
})

describe('isProcessAlive', () => {
  it('非法 PID（0/负数/非整数）返回 false（signal 0 对 pid 0 会误发到进程组，必须前置拦截）', () => {
    expect(isProcessAlive(0)).toBe(false)
    expect(isProcessAlive(-1)).toBe(false)
    expect(isProcessAlive(1.5)).toBe(false)
  })
})
