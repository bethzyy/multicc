import * as pty from '@lydell/node-pty'
import { BrowserWindow } from 'electron'
import { exec, execSync } from 'child_process'
import * as fs from 'fs'
import { promisify } from 'util'
import {
  parseOscSequences,
  extractLatestCwd,
  StateChangeDebouncer
} from './terminal/OscParser'
import { detectForegroundProcessAsync, getChildPidsAsync } from './terminal/WindowsProcessDetector'

const execAsync = promisify(exec)

interface PtyInstance {
  pty: pty.IPty
  id: string
  buffer: string
  cwd: string | null
  state: 'running' | 'waiting_input' | 'busy'
  foregroundProcess: string | null
  foregroundProcessPid: number | null  // 缓存进程 PID，用于轻量级存在性检查
  lastPolledPid: number | null  // 上次轮询检测到的进程 PID（用于智能跳过）
}

export class PtyService {
  private instances: Map<string, PtyInstance> = new Map()
  private window: BrowserWindow
  private stateDebouncers: Map<string, StateChangeDebouncer> = new Map()
  private isShuttingDown = false  // 关闭标记，防止关闭时执行阻塞操作
  private detectingPids: Set<string> = new Set()  // 防止并发进程检测
  private dataBatchBuffers: Map<string, string> = new Map()  // 数据合并缓冲
  private dataBatchTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()  // 合并定时器
  private static readonly DATA_BATCH_MS = 16  // ~60fps 合并发送

  // 统一轮询调度器（Phase 1 优化：解决 WMI 查询风暴）
  private globalPollTimer?: ReturnType<typeof setInterval>
  private pollQueue: string[] = []  // 终端 ID 队列
  private currentPollIndex = 0
  private static readonly POLL_INTERVAL_MS = 5000  // 从 2 秒增加到 5 秒

  constructor(window: BrowserWindow) {
    this.window = window
  }

  /**
   * 安全发送 IPC 消息到渲染进程
   * 防止窗口已销毁时 webContents.send 抛异常导致主进程崩溃
   */
  private safeSend(channel: string, ...args: unknown[]): void {
    try {
      if (!this.window.isDestroyed()) {
        this.window.webContents.send(channel, ...args)
      }
    } catch (err) {
      // 窗口已销毁时静默忽略
    }
  }

  /**
   * 合并发送终端数据到渲染进程
   * 16ms 内的多个小 chunk 合并为一次 IPC 调用，减少渲染进程压力
   */
  private batchSendData(id: string, data: string): void {
    const existing = this.dataBatchBuffers.get(id) || ''
    this.dataBatchBuffers.set(id, existing + data)

    if (!this.dataBatchTimers.has(id)) {
      this.dataBatchTimers.set(id, setTimeout(() => {
        const batched = this.dataBatchBuffers.get(id)
        this.dataBatchBuffers.delete(id)
        this.dataBatchTimers.delete(id)
        if (batched) {
          this.safeSend('terminal:data', { id, data: batched })
        }
      }, PtyService.DATA_BATCH_MS))
    }
  }

  /**
   * 启动统一轮询调度器
   * 所有终端共享一个定时器，每次只轮询一个终端，避免同时查询 WMI
   */
  private startGlobalPoller() {
    if (this.globalPollTimer) return

    this.globalPollTimer = setInterval(() => {
      if (this.pollQueue.length === 0 || this.isShuttingDown) return

      // 每次只轮询一个终端（错开 WMI 查询）
      const id = this.pollQueue[this.currentPollIndex]
      this.currentPollIndex = (this.currentPollIndex + 1) % this.pollQueue.length

      // 异步轮询，不阻塞
      this.pollCwd(id).catch(err => {
        console.warn(`[PtyService] Poll error for ${id}:`, err)
      })
    }, PtyService.POLL_INTERVAL_MS)

    console.log('[PTY] Global poller started, interval:', PtyService.POLL_INTERVAL_MS, 'ms')
  }

  /**
   * 停止统一轮询调度器
   */
  private stopGlobalPoller() {
    if (this.globalPollTimer) {
      clearInterval(this.globalPollTimer)
      this.globalPollTimer = undefined
      console.log('[PTY] Global poller stopped')
    }
  }

  /**
   * 递归终止进程树
   * 确保所有子进程都被清理，避免孤儿进程
   */
  private async cleanupProcessTree(pid: number) {
    try {
      const children = await getChildPidsAsync(pid)
      for (const childPid of children) {
        try {
          process.kill(childPid, 'SIGTERM')
          console.log('[PTY] Killed child process:', childPid)
        } catch {
          // 进程可能已不存在
        }
      }
    } catch (err) {
      console.warn('[PTY] Failed to cleanup process tree for', pid, ':', err)
    }
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

      // 监听输出 — 使用合并缓冲减少 IPC 压力
      ptyProcess.onData((data: string) => {
        if (this.isShuttingDown) return
        const instance = this.instances.get(id)
        if (instance) {
          instance.buffer += data
          if (instance.buffer.length > 100000) {
            instance.buffer = instance.buffer.slice(-50000)
          }
          // OSC 解析必须在每个 chunk 上执行（不能合并），用于状态检测
          this.processTerminalOutput(id, data, instance)
        }
        // 数据传输走合并缓冲，减少 IPC 调用频率
        this.batchSendData(id, data)
      })

      // 监听退出
      ptyProcess.onExit(({ exitCode }) => {
        if (this.isShuttingDown) return  // 关闭时不再发送事件
        console.log('[PTY] Process exited:', id, 'code:', exitCode)
        this.safeSend('terminal:exit', { id, exitCode })
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
        foregroundProcessPid: null,
        lastPolledPid: null
      })

      // 立即发送初始 cwd 到渲染进程（修复路径不显示问题）
      this.safeSend('terminal:cwd', { id, cwd: workingDir })

      // 添加到统一轮询队列（Phase 1 优化：替代独立定时器）
      this.pollQueue.push(id)
      this.startGlobalPoller()

      console.log('[PTY] Total instances:', this.instances.size)

      return true
    } catch (error) {
      console.error('[PTY] Failed to create:', error)
      return false
    }
  }

  /**
   * Process terminal output for state detection
   * v2: 单次解析 OSC 序列 + 并发保护，防止重负载下进程检测风暴
   */
  private processTerminalOutput(id: string, data: string, instance: PtyInstance): void {
    // 单次解析所有 OSC 序列，避免重复正则匹配
    const sequences = parseOscSequences(data)

    // CWD 检测：只有在没有前台进程时才更新（避免子进程输出中的乱码）
    if (!instance.foregroundProcess) {
      const osc99 = sequences.filter(s => s.type === 'osc99').pop()
      const osc7 = sequences.filter(s => s.type === 'osc7').pop()
      const newCwd = osc99?.value || osc7?.value || null
      if (newCwd && newCwd !== instance.cwd && this.isValidCwdPath(newCwd)) {
        instance.cwd = newCwd
        this.safeSend('terminal:cwd', { id, cwd: newCwd })
      }
    }

    // 输入等待检测
    const isWaiting = sequences.some(s => s.type === 'bell') ||
                      sequences.some(s => s.type === 'osc133' && s.value === 'A')
    const debouncer = this.stateDebouncers.get(id)
    if (debouncer) {
      const newState = isWaiting ? 'waiting_input' : 'running'
      debouncer.notify(newState, (state) => {
        if (instance.state !== state) {
          instance.state = state as 'running' | 'waiting_input' | 'busy'
          this.safeSend('terminal:state', { id, state })
        }
      })
    }

    // 命令状态检测
    const osc133 = sequences.filter(s => s.type === 'osc133')
    const commandStarted = osc133.some(s => s.value === 'B' || s.value === 'C')
    const commandEnded = osc133.some(s => s.value === 'D')
    const isPromptReady = osc133.some(s => s.value === 'A')

    if (commandStarted) {
      instance.state = 'busy'
      instance.foregroundProcess = 'pending'
      this.safeSend('terminal:state', { id, state: 'busy' })

      // 并发保护：同一终端同时只有一个进程检测
      if (!this.detectingPids.has(id)) {
        this.detectForegroundProcessAsyncHandler(id, instance)
      }
    }
    if (commandEnded || isPromptReady) {
      instance.state = 'running'
      instance.foregroundProcess = null
      instance.foregroundProcessPid = null
      this.safeSend('terminal:state', { id, state: 'running' })
    }
  }

  /**
   * Detect foreground process asynchronously
   * v3: 加并发保护，同一终端同时只有一个检测在跑
   */
  private async detectForegroundProcessAsyncHandler(id: string, instance: PtyInstance): Promise<void> {
    // 关闭时跳过检测
    if (this.isShuttingDown) return
    // 并发保护
    if (this.detectingPids.has(id)) return
    this.detectingPids.add(id)

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
        instance.foregroundProcessPid = processInfo.pid
        this.safeSend('terminal:process', {
          id,
          process: processInfo.name,
          pid: processInfo.pid,
          cwd: processInfo.cwd
        })
      }
    } catch (error) {
      console.error('[PTY] Error detecting foreground process:', error)
    } finally {
      this.detectingPids.delete(id)
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
   *
   * v7 统一轮询 + 智能跳过（Phase 1 & 2 优化）
   * - 所有终端共享一个 5 秒定时器，每次只轮询一个
   * - 如果上次检测的进程 PID 未变，跳过完整检测
   */
  private async pollCwd(id: string): Promise<void> {
    // 关闭时跳过轮询，避免阻塞
    if (this.isShuttingDown) return

    const instance = this.instances.get(id)
    if (!instance || !instance.pty.pid) return

    // Phase 2: 智能跳过 - 如果上次检测到的进程还在运行，跳过完整检测
    if (instance.lastPolledPid) {
      const stillRunning = await this.isProcessRunningAsync(instance.lastPolledPid)
      if (stillRunning) {
        // 进程仍在运行，跳过完整 WMI 检测
        return
      }
      // 进程已结束，清除缓存
      instance.lastPolledPid = null
    }

    // 如果已经有前台进程在运行，先检查进程是否还存在（轻量级异步检查）
    if (instance.foregroundProcess && instance.foregroundProcess !== 'pending') {
      // 轻量级检查：进程是否还在运行
      const stillRunning = await this.isProcessRunningAsync(instance.foregroundProcessPid)
      if (stillRunning) {
        // 进程还在运行，不需要重新检测，直接返回
        // 同时更新 lastPolledPid 用于下次智能跳过
        instance.lastPolledPid = instance.foregroundProcessPid
        return
      }
      // 进程已结束，清除标记
      console.log('[PTY] Foreground process ended:', instance.foregroundProcess)
      instance.foregroundProcess = null
      instance.foregroundProcessPid = null
      instance.lastPolledPid = null
    }

    // 没有前台进程或进程已结束，执行异步检测
    const processInfo = await detectForegroundProcessAsync(instance.pty.pid)

    if (processInfo) {
      // 缓存进程信息
      instance.foregroundProcess = processInfo.name
      instance.foregroundProcessPid = processInfo.pid
      instance.lastPolledPid = processInfo.pid  // Phase 2: 用于下次智能跳过
      this.safeSend('terminal:process', {
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
      this.safeSend('terminal:cwd', { id, cwd })
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
      // 从轮询队列中移除
      const index = this.pollQueue.indexOf(id)
      if (index !== -1) {
        this.pollQueue.splice(index, 1)
        if (this.currentPollIndex >= index && this.currentPollIndex > 0) {
          this.currentPollIndex--
        }
      }

      // 清理数据合并缓冲
      const timer = this.dataBatchTimers.get(id)
      if (timer) {
        clearTimeout(timer)
        this.dataBatchTimers.delete(id)
      }
      this.dataBatchBuffers.delete(id)

      // 如果没有终端了，停止全局轮询器
      if (this.pollQueue.length === 0) {
        this.stopGlobalPoller()
      }

      // 递归终止进程树
      const pid = instance.pty.pid
      this.cleanupProcessTree(pid).catch(() => {})

      instance.pty.kill()
      this.instances.delete(id)
      this.detectingPids.delete(id)
      console.log('[PTY] Terminal destroyed:', id)
    }
  }

  async destroyAll(): Promise<void> {
    this.isShuttingDown = true

    // 停止统一轮询调度器
    this.stopGlobalPoller()
    this.pollQueue = []
    this.currentPollIndex = 0

    // 清理所有数据合并缓冲
    for (const timer of this.dataBatchTimers.values()) {
      clearTimeout(timer)
    }
    this.dataBatchTimers.clear()
    this.dataBatchBuffers.clear()
    this.detectingPids.clear()

    // 递归终止所有进程树（await 完成）
    const instances = Array.from(this.instances.values())
    await Promise.all(
      instances.map(instance => this.cleanupProcessTree(instance.pty.pid).catch(() => {}))
    )

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
