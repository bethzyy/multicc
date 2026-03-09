import * as pty from '@lydell/node-pty'
import { BrowserWindow } from 'electron'
import { exec, execSync } from 'child_process'
import * as fs from 'fs'
import { promisify } from 'util'
import {
  extractLatestCwd,
  detectWaitingForInput,
  detectCommandState,
  StateChangeDebouncer
} from './terminal/OscParser'
import { detectForegroundProcess, detectForegroundProcessAsync } from './terminal/WindowsProcessDetector'

const execAsync = promisify(exec)

interface PtyInstance {
  pty: pty.IPty
  id: string
  buffer: string
  cwd: string | null
  state: 'running' | 'waiting_input' | 'busy'
  foregroundProcess: string | null
  foregroundProcessPid: number | null  // 缓存进程 PID，用于轻量级存在性检查
  cwdPollTimer?: ReturnType<typeof setInterval>
}

export class PtyService {
  private instances: Map<string, PtyInstance> = new Map()
  private window: BrowserWindow
  private stateDebouncers: Map<string, StateChangeDebouncer> = new Map()
  private isShuttingDown = false  // 关闭标记，防止关闭时执行阻塞操作

  constructor(window: BrowserWindow) {
    this.window = window
  }

  create(id: string, cols: number, rows: number, cwd?: string): boolean {
    try {
      const shell = process.env.COMSPEC || 'cmd.exe'
      // 确保 workingDir 是有效字符串
      const workingDir = (cwd && cwd.length > 0) ? cwd : process.cwd()

      console.log('[PTY] Creating terminal:', { id, shell, cwd: workingDir, cols, rows })

      // 使用 node-pty 创建真正的伪终端
      // 注意：删除 CLAUDECODE 环境变量，允许在 multicc 终端中运行 Claude Code
      const { CLAUDECODE, ...envWithoutClaudeCode } = process.env

      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: cols,
        rows: rows,
        cwd: workingDir,
        env: {
          ...envWithoutClaudeCode,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        }
      })

      console.log('[PTY] Process created, PID:', ptyProcess.pid)

      // Create state debouncer for this terminal
      const debouncer = new StateChangeDebouncer(50)
      this.stateDebouncers.set(id, debouncer)

      // 监听输出
      ptyProcess.onData((data: string) => {
        console.log('[PTY] onData for', id, ':', data.length, 'bytes')
        const instance = this.instances.get(id)
        if (instance) {
          instance.buffer += data
          if (instance.buffer.length > 100000) {
            instance.buffer = instance.buffer.slice(-50000)
          }

          // Parse OSC sequences for state detection
          this.processTerminalOutput(id, data, instance)
        }
        // 确保数据是字符串
        this.window.webContents.send('terminal:data', { id, data: String(data) })
      })

      // 监听退出
      ptyProcess.onExit(({ exitCode }) => {
        console.log('[PTY] Process exited:', id, 'code:', exitCode)
        this.window.webContents.send('terminal:exit', { id, exitCode })
        this.instances.delete(id)
        this.stateDebouncers.delete(id)
      })

      this.instances.set(id, {
        pty: ptyProcess,
        id,
        buffer: '',
        cwd: workingDir,
        state: 'running',
        foregroundProcess: null,
        foregroundProcessPid: null
      })

      // 立即发送初始 cwd 到渲染进程（修复路径不显示问题）
      this.window.webContents.send('terminal:cwd', { id, cwd: workingDir })

      // 启动 cwd 轮询（每 2 秒检测一次）
      const instanceForTimer = this.instances.get(id)!
      instanceForTimer.cwdPollTimer = setInterval(() => {
        this.pollCwd(id)
      }, 2000)

      console.log('[PTY] Total instances:', this.instances.size)

      return true
    } catch (error) {
      console.error('[PTY] Failed to create:', error)
      return false
    }
  }

  /**
   * Process terminal output for state detection
   */
  private processTerminalOutput(id: string, data: string, instance: PtyInstance): void {
    // 只有在没有前台进程时才更新 cwd（避免子进程输出中的乱码）
    if (!instance.foregroundProcess) {
      const newCwd = extractLatestCwd(data)
      // 验证路径是否有效（必须是有效的 Windows 路径格式）
      if (newCwd && newCwd !== instance.cwd && this.isValidCwdPath(newCwd)) {
        instance.cwd = newCwd
        this.window.webContents.send('terminal:cwd', { id, cwd: newCwd })
      }
    }

    // Detect waiting for input
    const waitingState = detectWaitingForInput(data)
    const debouncer = this.stateDebouncers.get(id)
    if (debouncer) {
      const newState = waitingState.isWaiting ? 'waiting_input' : 'running'
      debouncer.notify(newState, (state) => {
        if (instance.state !== state) {
          instance.state = state as 'running' | 'waiting_input' | 'busy'
          this.window.webContents.send('terminal:state', { id, state })
        }
      })
    }

    // Detect command state changes
    const cmdState = detectCommandState(data)
    if (cmdState.commandStarted) {
      instance.state = 'busy'
      // 立即设置标记，阻止 OSC 解析（避免子进程启动期间的乱码）
      instance.foregroundProcess = 'pending'
      this.window.webContents.send('terminal:state', { id, state: 'busy' })

      // Detect foreground process (will update the process name)
      this.detectForegroundProcessAsyncHandler(id, instance)
    }
    if (cmdState.commandEnded || cmdState.isPromptReady) {
      instance.state = 'running'
      instance.foregroundProcess = null  // 清除前台进程，允许更新路径
      instance.foregroundProcessPid = null  // 清除缓存的 PID
      this.window.webContents.send('terminal:state', { id, state: 'running' })
    }
  }

  /**
   * Detect foreground process asynchronously
   * v2: 使用异步检测避免阻塞主线程
   */
  private async detectForegroundProcessAsyncHandler(id: string, instance: PtyInstance): Promise<void> {
    // 关闭时跳过检测
    if (this.isShuttingDown) return

    try {
      const ptyProcess = instance.pty
      if (!ptyProcess.pid) return

      // Wait a moment for the process to start
      await new Promise(resolve => setTimeout(resolve, 100))

      // 再次检查关闭状态
      if (this.isShuttingDown) return

      const processInfo = await detectForegroundProcessAsync(ptyProcess.pid)
      if (processInfo) {
        instance.foregroundProcess = processInfo.name
        instance.foregroundProcessPid = processInfo.pid  // 缓存 PID
        this.window.webContents.send('terminal:process', {
          id,
          process: processInfo.name,
          pid: processInfo.pid,
          cwd: processInfo.cwd
        })
      }
    } catch (error) {
      console.error('[PTY] Error detecting foreground process:', error)
    }
  }

  /**
   * Poll current working directory for a terminal
   * Uses terminal buffer parsing to detect cwd from prompt patterns
   *
   * v4 修复：主动检测前台进程，不依赖 OSC 133 序列
   * - cmd.exe 不支持 OSC 133，所以 commandStarted 永远不会触发
   * - 现在在 pollCwd 中主动调用 detectForegroundProcess() 检测
   * - 如果有前台进程（如 claude），不更新路径，保持启动子进程前的路径
   *
   * v5 性能优化：添加缓存机制
   * - 如果已检测到前台进程，缓存结果，后续 poll 直接使用缓存
   * - 只用轻量级 tasklist 检查进程是否还在运行
   * - 进程结束后才重新进行完整检测
   *
   * v6 异步优化：使用异步检测避免阻塞主线程
   * - pollCwd 改为异步方法
   * - 使用 detectForegroundProcessAsync 替代同步版本
   * - 使用 isProcessRunningAsync 替代同步版本
   */
  private async pollCwd(id: string): Promise<void> {
    // 关闭时跳过轮询，避免阻塞
    if (this.isShuttingDown) return

    const instance = this.instances.get(id)
    if (!instance || !instance.pty.pid) return

    // 如果已经有前台进程在运行，先检查进程是否还存在（轻量级异步检查）
    if (instance.foregroundProcess && instance.foregroundProcess !== 'pending') {
      // 轻量级检查：进程是否还在运行
      const stillRunning = await this.isProcessRunningAsync(instance.foregroundProcessPid)
      if (stillRunning) {
        // 进程还在运行，不需要重新检测，直接返回
        return
      }
      // 进程已结束，清除标记
      console.log('[PTY] Foreground process ended:', instance.foregroundProcess)
      instance.foregroundProcess = null
      instance.foregroundProcessPid = null
    }

    // 没有前台进程或进程已结束，执行异步检测
    const processInfo = await detectForegroundProcessAsync(instance.pty.pid)

    if (processInfo) {
      // 缓存进程信息
      instance.foregroundProcess = processInfo.name
      instance.foregroundProcessPid = processInfo.pid
      this.window.webContents.send('terminal:process', {
        id,
        process: processInfo.name,
        pid: processInfo.pid,
        cwd: processInfo.cwd
      })
      console.log('[PTY] Detected foreground process:', processInfo.name, 'pid:', processInfo.pid)
      return
    }

    // 没有前台进程，正常更新路径
    const cwd = this.parseCwdFromBuffer(instance.buffer)
    if (cwd && cwd !== instance.cwd && this.isValidCwdPath(cwd)) {
      console.log('[PTY] CWD updated from', instance.cwd, 'to', cwd)
      instance.cwd = cwd
      this.window.webContents.send('terminal:cwd', { id, cwd })
    }
  }

  /**
   * 异步版本：轻量级进程存在性检查
   * 使用 tasklist 命令，不阻塞主线程
   */
  private async isProcessRunningAsync(pid: number | null): Promise<boolean> {
    if (!pid) return false
    try {
      const { stdout } = await execAsync(`tasklist /fi "PID eq ${pid}" /nh`, {
        timeout: 1000,
        windowsHide: true
      })
      // 如果进程不存在，输出会是 "INFO: No tasks are running..."
      return !stdout.includes('No tasks are running')
    } catch {
      return false
    }
  }

  /**
   * 同步版本：轻量级进程存在性检查（保留向后兼容）
   * @deprecated 使用 isProcessRunningAsync 替代
   */
  private isProcessRunning(pid: number | null): boolean {
    if (!pid) return false
    try {
      const result = execSync(`tasklist /fi "PID eq ${pid}" /nh`, {
        encoding: 'utf-8',
        timeout: 1000
      })
      return !result.includes('No tasks are running')
    } catch {
      return false
    }
  }

  /**
   * Parse current working directory from terminal buffer
   * Looks for common Windows path patterns in prompt
   */
  private parseCwdFromBuffer(buffer: string): string | null {
    // 获取缓冲区的最后几行（通常包含提示符）
    const lines = buffer.split('\n').slice(-5).join('\n')

    // Windows cmd.exe 提示符模式: "C:\path\to\dir>" 或 "C:\path\to\dir $"
    // PowerShell 模式: "PS C:\path\to\dir>"
    const patterns = [
      // cmd.exe: C:\path> or C:\path $ or C:\path>
      /[A-Za-z]:\\[^\n<>$]*?(?=[\n>$])/g,
      // PowerShell: PS C:\path>
      /PS\s+([A-Za-z]:\\[^\n>]*)/g,
      // Git Bash: user@host MINGW64 /c/path
      /MINGW\d+\s+([\/\\][^\n$]*)/g,
      // WSL: user@host:/path
      /[\w@]+:([\/][^\n$]*)/g,
    ]

    // 查找最后一个匹配的路径
    let lastMatch: string | null = null

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(lines)) !== null) {
        const path = match[1] || match[0]
        // 清理路径
        const cleanPath = this.cleanPath(path)
        if (cleanPath && this.isValidWindowsPath(cleanPath)) {
          lastMatch = cleanPath
        }
      }
    }

    return lastMatch
  }

  /**
   * Clean path string
   * Enhanced to remove all ANSI/OSC sequences and control characters
   */
  private cleanPath(path: string): string {
    return path
      .trim()
      .replace(/[>\s]+$/, '')           // 移除末尾的 > 和空格
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')  // 移除所有 ANSI 转义序列（不只是颜色代码）
      .replace(/\x1b\].*?[\x07\x1b\\]/g, '')  // 移除 OSC 序列
      .replace(/\r/g, '')               // 移除回车
      .replace(/[\x00-\x1f\x7f]/g, '')  // 移除控制字符
  }

  /**
   * Check if path is a valid Windows path
   */
  private isValidWindowsPath(path: string): boolean {
    // Windows 路径格式: C:\path 或 C:/path
    if (/^[A-Za-z]:[\/\\]/.test(path)) {
      return true
    }
    // Unix 风格路径 (WSL, Git Bash)
    if (/^\/[a-zA-Z]/.test(path)) {
      return true
    }
    return false
  }

  /**
   * 验证 CWD 路径是否有效
   * 过滤掉包含 ANSI 转义序列或其他无效字符的路径
   * v2: 增加路径存在性检查，拒绝截断或错误的路径
   */
  private isValidCwdPath(path: string): boolean {
    // 检查是否包含 ANSI 转义序列
    if (/\x1b\[[0-9;]*[a-zA-Z]/.test(path)) {
      return false
    }

    // 检查是否包含控制字符
    if (/[\x00-\x1f\x7f]/.test(path)) {
      return false
    }

    // 检查是否是有效的 Windows 路径格式
    // C:\path 或 C:/path 或 /c/path (Git Bash)
    if (!/^[A-Za-z]:[\/\\]|^[\/][a-zA-Z]/.test(path)) {
      return false
    }

    // 检查路径长度是否合理（Windows 路径最大 260 字符）
    if (path.length > 260) {
      return false
    }

    // 检查路径是否真实存在（防止截断或错误的路径）
    try {
      return fs.existsSync(path)
    } catch {
      return false
    }
  }

  write(id: string, data: string): void {
    const instance = this.instances.get(id)
    if (instance) {
      instance.pty.write(data)
    } else {
      console.log('[PTY] write failed - instance not found:', id)
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const instance = this.instances.get(id)
    if (instance) {
      instance.pty.resize(cols, rows)
    }
  }

  destroy(id: string): void {
    const instance = this.instances.get(id)
    if (instance) {
      // 清除 cwd 轮询定时器
      if (instance.cwdPollTimer) {
        clearInterval(instance.cwdPollTimer)
      }
      instance.pty.kill()
      this.instances.delete(id)
    }
  }

  destroyAll(): void {
    this.isShuttingDown = true

    // 先清除所有定时器（防止关闭时执行阻塞的 execSync）
    const instances = Array.from(this.instances.values())
    for (const instance of instances) {
      if (instance.cwdPollTimer) {
        clearInterval(instance.cwdPollTimer)
      }
    }

    // 再销毁所有 PTY 进程
    for (const instance of instances) {
      instance.pty.kill()
    }

    this.instances.clear()
    console.log('[PTY] All terminals destroyed')
  }

  getBuffer(id: string): string {
    return this.instances.get(id)?.buffer || ''
  }

  hasInstance(id: string): boolean {
    return this.instances.has(id)
  }
}
