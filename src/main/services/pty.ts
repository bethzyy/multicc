import * as pty from '@lydell/node-pty'
import { BrowserWindow, app } from 'electron'
import { exec } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { promisify } from 'util'
import {
  parseOscSequences,
  extractLatestCwd,
  StateChangeDebouncer,
  detectBellSignal,
  detectWaitingInputDetailed,
  resetInputDetector,
  isRealUserInput,
  matchBlockingPrompt,
  computeSelfHealState,
  type TerminalStatus
} from './terminal/OscParser'
import { detectForegroundProcessAsync } from './terminal/WindowsProcessDetector'
import { OutputRateMonitor } from './terminal/OutputRateMonitor'
import { parsePromptCwd } from './terminal/PromptCwdParser'
import { ResizeGovernor } from './terminal/ResizeGovernor'
import { killProcessTree } from './terminal/ProcessKiller'

const execAsync = promisify(exec)

// ── 原始 PTY I/O 调试日志（默认关闭，排查 CJK 插空格/光标错位等问题用）──
// 启用：设置环境变量 MULTICC_PTY_LOG=1 再启动应用（如 start.bat 里 set MULTICC_PTY_LOG=1）。
// 日志位置：%APPDATA%/multicc/pty-debug.log。
// IN  = 渲染端发给 PTY 的用户输入（如键入/IME 提交的字节）。
// OUT = PTY/子进程回显给渲染端的输出（去重之前的完整流）。
// 空格显示为 ␠、ESC 显示为 \e，便于一眼看出"莫名空格"到底来自输入还是回显。
const PTY_LOG_ENABLED = process.env.MULTICC_PTY_LOG === '1'
let ptyLogPath: string | null = null
function ptyLogFile(): string {
  if (!ptyLogPath) {
    try {
      ptyLogPath = path.join(app.getPath('userData'), 'pty-debug.log')
    } catch {
      ptyLogPath = path.join(process.cwd(), 'pty-debug.log')
    }
  }
  return ptyLogPath
}
function escapeForLog(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    if (ch === '\x1b') out += '\\e'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\n') out += '\\n'
    else if (ch === ' ') out += '␠'
    else if (code < 0x20 || code === 0x7f) out += '\\x' + code.toString(16).padStart(2, '0')
    else out += ch
  }
  return out
}
function ptyDebugLog(direction: 'IN' | 'OUT', id: string, data: string): void {
  if (!PTY_LOG_ENABLED) return
  try {
    fs.appendFileSync(ptyLogFile(), `[${direction} ${id} len=${data.length}] ${escapeForLog(data)}\n`)
  } catch {
    // 日志失败不影响终端
  }
}
// 把 PTY 拿到的尺寸（create / resize 时的 cols×rows）也写进同一个日志文件，
// 便于把"PTY 实际宽度"与"Claude OUT 字节里按某宽度寻址"做对照（排查 CJK 插空格根因）。
function ptyDebugMeta(id: string, msg: string): void {
  if (!PTY_LOG_ENABLED) return
  try {
    fs.appendFileSync(ptyLogFile(), `[META ${id}] ${msg}\n`)
  } catch {
    // 日志失败不影响终端
  }
}
// 红绿灯状态机日志（同样受 MULTICC_PTY_LOG=1 控制）。
// 记录每次状态迁移与等待输入检测的命中原因，排查"该红不红/该绿不绿"时
// 直接看 %APPDATA%/multicc/pty-debug.log 里的 [STATE ...] 行，不靠猜。
function ptyStateLog(id: string, msg: string): void {
  if (!PTY_LOG_ENABLED) return
  try {
    fs.appendFileSync(ptyLogFile(), `[STATE ${id}] ${msg}\n`)
  } catch {
    // 日志失败不影响终端
  }
}

interface PtyInstance {
  pty: pty.IPty
  id: string
  bufferChunks: string[]    // Array-based buffer (avoids string concat GC pressure)
  bufferLength: number      // Tracked incrementally
  cwd: string | null
  state: TerminalStatus     // running/busy=绿，waiting_input=红，idle=灰
  lastOutputAt: number      // 最近一次收到输出的时间戳（自愈：静默→灰的判据）
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
  private static readonly MAX_BATCH_SIZE = 64 * 1024  // 64KB max per IPC flush

  // 自适应输出处理（Layer 1+2）
  private rateMonitors: Map<string, OutputRateMonitor> = new Map()
  private oscParseBuffers: Map<string, string> = new Map()
  private oscParseTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private static readonly HEAVY_OSC_PARSE_MS = 200  // 重负载时 OSC 解析间隔
  private static readonly MAX_OSC_BUFFER_SIZE = 500_000  // 500KB OSC 累积上限

  // 进程检测节流（Layer 4）
  private lastDetectionTime: Map<string, number> = new Map()
  private static readonly MIN_DETECTION_INTERVAL_MS = 3000  // 最少 3 秒间隔

  // Resize 治理（去重 + 节流 + 疑似无响应守卫）——防 ConPTY 阻塞 RPC 冻结主线程
  // 背景见 ResizeGovernor.ts 头注释（2026-07-11 AppHangXProcB1 事件）
  private resizeGovernors: Map<string, ResizeGovernor> = new Map()
  private resizeFlushTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

  // 前台进程检测开关（默认关闭）
  // 关闭原因：detectForegroundProcessAsync / tasklist 会反复 spawn 子进程，
  // 但其产出的 terminal:state / terminal:process 事件目前没有任何渲染端消费者，
  // 长时间运行会造成内存/句柄缓慢增长。cwd 显示仍由 parsePromptCwd 驱动。
  // 日后若要做 busy/前台进程 UI，将此开关置 true 并补上渲染端监听即可。
  private static readonly FOREGROUND_DETECTION_ENABLED: boolean = false

  // 统一轮询调度器（Phase 1 优化：解决 WMI 查询风暴）
  private globalPollTimer?: ReturnType<typeof setInterval>
  private pollQueue: string[] = []  // 终端 ID 队列
  private currentPollIndex = 0
  private static readonly POLL_INTERVAL_MS = 5000  // 从 2 秒增加到 5 秒

  // 状态自愈扫描器：把红灯从「粘滞陷阱」改成「电平自愈」。
  // 每 tick 遍历所有终端，按 computeSelfHealState 决策：阻塞框消失→复位、静默→回中性灰。
  // 独立于 5s 轮询（那是 round-robin 单个终端，太慢）；只做时间戳比较 + 一次缓冲尾正则，很轻。
  private idleSweepTimer?: ReturnType<typeof setInterval>
  private static readonly IDLE_SWEEP_MS = 1500      // 扫描间隔
  private static readonly IDLE_AFTER_MS = 4000      // 静默多久算「空闲」→ 中性灰

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
   * v2: 添加 64KB 大小上限，超限立即 flush
   */
  private batchSendData(id: string, data: string): void {
    const existing = this.dataBatchBuffers.get(id) || ''
    const combined = existing + data
    this.dataBatchBuffers.set(id, combined)

    // 超过大小上限立即 flush
    if (combined.length >= PtyService.MAX_BATCH_SIZE) {
      this.flushBatch(id)
      return
    }

    if (!this.dataBatchTimers.has(id)) {
      this.dataBatchTimers.set(id, setTimeout(() => {
        this.flushBatch(id)
      }, PtyService.DATA_BATCH_MS))
    }
  }

  /**
   * 刷新指定终端的 IPC 数据缓冲
   */
  private flushBatch(id: string): void {
    const timer = this.dataBatchTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.dataBatchTimers.delete(id)
    }

    const batched = this.dataBatchBuffers.get(id)
    this.dataBatchBuffers.delete(id)
    if (batched) {
      // per-terminal 通道：仅该终端的 TerminalPane 监听，消除 O(N) 扇出
      this.safeSend(`terminal:data:${id}`, batched)
    }
  }

  /**
   * 从 buffer 数组中取尾部数据（给 parsePromptCwd 用，它只需要最后几行）
   */
  private getBufferTail(instance: PtyInstance, maxChars: number = 5000): string {
    const chunks = instance.bufferChunks
    if (chunks.length === 0) return ''

    let result = ''
    for (let i = chunks.length - 1; i >= 0 && result.length < maxChars; i--) {
      result = chunks[i] + result
    }
    return result
  }

  /**
   * 裁剪 buffer 到目标大小（保留最新的数据）
   */
  private compactBuffer(instance: PtyInstance): void {
    const targetSize = 50_000
    let kept = 0
    let cutIndex = instance.bufferChunks.length
    for (let i = instance.bufferChunks.length - 1; i >= 0; i--) {
      kept += instance.bufferChunks[i].length
      if (kept >= targetSize) {
        cutIndex = i
        break
      }
    }
    if (cutIndex > 0) {
      instance.bufferChunks = instance.bufferChunks.slice(cutIndex)
    }
    instance.bufferLength = kept
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
   * 启动状态自愈扫描器（红灯电平自愈 + 静默回中性灰）。
   * 遍历所有实例，用「最近输出时间」和「缓冲尾是否有持续阻塞框」交给 computeSelfHealState 决策。
   * 关键：本扫描【绝不制造红灯】——红灯只由 processTerminalOutput 的输出边沿检测点亮；这里只负责
   * 让红灯在阻塞框消失/安静后自愈，以及让跑完/空闲的终端回到中性灰。
   */
  private startIdleSweeper() {
    if (this.idleSweepTimer) return
    this.idleSweepTimer = setInterval(() => {
      if (this.isShuttingDown || this.instances.size === 0) return
      const now = Date.now()
      for (const [id, instance] of this.instances) {
        const blockingVisible = matchBlockingPrompt(this.getBufferTail(instance, 2000))
        const target = computeSelfHealState({
          current: instance.state,
          blockingVisible,
          msSinceLastOutput: now - instance.lastOutputAt,
          idleAfterMs: PtyService.IDLE_AFTER_MS,
        })
        if (target !== instance.state) {
          if (target === 'running' || target === 'idle') resetInputDetector(id)
          this.setState(id, instance, target, 'idle-sweep')
        }
      }
    }, PtyService.IDLE_SWEEP_MS)
  }

  /**
   * 停止状态自愈扫描器
   */
  private stopIdleSweeper() {
    if (this.idleSweepTimer) {
      clearInterval(this.idleSweepTimer)
      this.idleSweepTimer = undefined
    }
  }

  /**
   * 统一状态发送：更新 instance.state 并经 50ms 防抖推送 terminal:state:<id>。
   * 输出路径与自愈扫描器共用；相同状态直接返回，避免无谓 IPC。
   */
  private setState(id: string, instance: PtyInstance, newState: TerminalStatus, reason: string): void {
    if (instance.state === newState) return
    ptyStateLog(id, `${instance.state} -> ${newState} (${reason})`)
    instance.state = newState
    const debouncer = this.stateDebouncers.get(id)
    if (!debouncer) return
    debouncer.notify(newState, (s) => {
      this.safeSend(`terminal:state:${id}`, s)
    })
  }

  /**
   * 安全销毁一个 PTY：先异步 taskkill 整棵进程树并确认根进程退出，再调 pty.kill()。
   * pty.kill() 在 ConPTY 模式下是主线程阻塞调用，僵死子进程会把主线程堵死
   * （2026-07-11 AppHangXProcB1 事件）；进程树确认死亡后再调用则不会等任何人。
   * 未能确认退出时跳过 pty.kill()——宁可泄漏一份 conpty 句柄，不可冒险冻结主线程。
   */
  private async killPtySafely(ptyProcess: pty.IPty): Promise<void> {
    const pid = ptyProcess.pid
    const confirmed = await killProcessTree(pid).catch(() => false)
    if (confirmed) {
      try {
        ptyProcess.kill()
      } catch {
        // 进程已退出时 kill 可能抛错，忽略
      }
    } else {
      console.warn('[PTY] 进程树未能确认退出，跳过 pty.kill() 以避免主线程阻塞. pid:', pid)
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

      // 优先 ConPTY（支持 24-bit 真彩色）；失败时回退 winpty（颜色降到 16 色）。
      // 历史背景：Electron 40 主进程下 ConPTY 曾返回 ERROR_ACCESS_DENIED (error 5)，
      // 当时被迫强制 winpty，但 winpty 会把 RGB 压成 16 色，导致 Claude Code 等
      // 子进程的真彩色 UI（如 mascot）颜色失真。改成 try/fallback 而不是硬切死一种。
      const baseOptions = {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: workingDir,
        env: {
          ...envWithoutClaudeCode,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          // 强制 Claude Code 用"经典渲染器"，把对话留在终端原生回滚缓冲里（而非备用屏 alt-screen）。
          // 备用屏没有回滚 → 没有滚动条、滚不动历史。经典渲染器让内容滚进 xterm scrollback。
          // 代价：经典渲染器在重绘时会有轻微闪烁（备用屏模式正是为消除闪烁而生）。
          CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1'
        }
      }
      let ptyProcess: pty.IPty
      try {
        // useConptyDll: 使用 node-pty 自带的新 conpty.dll，而非 Windows 内置的老 conpty。
        // Win10(如 19045)内置 conpty 在重排「TUI 光标寻址 + CJK 宽字符」时会插入多余 \x08 退格，
        // 导致 Claude Code 输入框首个中文字符后凭空多出一个空格、并伴随光标残块。
        // 新 dll 修复此问题，且仍保留 ConPTY 的 24-bit 真彩色（winpty 回退会把真彩色压成 16 色）。
        // 注意：打包时必须把 @lydell/node-pty-win32-* 的 prebuilds 解包出 asar（见 package.json asarUnpack），
        // 否则运行时加载不到 conpty.dll/OpenConsole.exe，会异常并回退 winpty。
        ptyProcess = pty.spawn(shell, [], { ...baseOptions, useConpty: true, useConptyDll: true })
        console.log('[PTY] Backend: ConPTY (true color, bundled conpty.dll)')
      } catch (conptyErr) {
        const msg = conptyErr instanceof Error ? conptyErr.message : String(conptyErr)
        console.warn('[PTY] ConPTY failed, falling back to winpty:', msg)
        ptyProcess = pty.spawn(shell, [], { ...baseOptions, useConpty: false })
        console.log('[PTY] Backend: winpty (16-color fallback)')
      }

      console.log('[PTY] Process created, PID:', ptyProcess.pid)
      ptyDebugMeta(id, `create cols=${cols} rows=${rows} pid=${ptyProcess.pid}`)

      // Create state debouncer for this terminal
      const debouncer = new StateChangeDebouncer(50)
      this.stateDebouncers.set(id, debouncer)

      // Create rate monitor for this terminal
      const rateMonitor = new OutputRateMonitor()
      this.rateMonitors.set(id, rateMonitor)

      // Create resize governor for this terminal
      this.resizeGovernors.set(id, new ResizeGovernor())

      // 监听输出 — 自适应处理
      ptyProcess.onData((data: string) => {
        if (this.isShuttingDown) return
        ptyDebugLog('OUT', id, data)

        // 有输出 = 控制台宿主活着：解除 resize 疑似无响应守卫，补发挂起的 resize
        const governor = this.resizeGovernors.get(id)
        if (governor) {
          governor.markAlive()
          if (governor.hasPending) this.scheduleResizeFlush(id)
        }

        const instance = this.instances.get(id)
        if (!instance) {
          this.batchSendData(id, data)
          return
        }

        // 记录最近输出时间——自愈扫描器据此判断「静默→中性灰」
        instance.lastOutputAt = Date.now()

        // --- Buffer management (array-based) ---
        instance.bufferChunks.push(data)
        instance.bufferLength += data.length
        if (instance.bufferLength > 100_000) {
          this.compactBuffer(instance)
        }

        // --- Rate monitoring ---
        rateMonitor.recordChunk(data.length)

        // --- OSC processing: adaptive ---
        // 注意：oscParseBuffers 仅供 processTerminalOutput 解析 cwd/标题/状态，
        // 是 parse-only 缓冲，不喂渲染进程——发往渲染进程的始终是下方
        // batchSendData(id, data) 的原始 chunk。此处的 slice 截断最坏只丢一次
        // cwd 解析，不会损坏终端显示。
        if (rateMonitor.isHeavyOutput) {
          // 重负载模式：累积数据，定时解析
          const buf = this.oscParseBuffers.get(id) || ''
          const combined = buf.length + data.length > PtyService.MAX_OSC_BUFFER_SIZE
            ? (buf + data).slice(-PtyService.MAX_OSC_BUFFER_SIZE)
            : buf + data
          this.oscParseBuffers.set(id, combined)
          if (!this.oscParseTimers.has(id)) {
            this.oscParseTimers.set(id, setTimeout(() => {
              const accumulated = this.oscParseBuffers.get(id)
              this.oscParseBuffers.delete(id)
              this.oscParseTimers.delete(id)
              if (accumulated) {
                this.processTerminalOutput(id, accumulated, instance)
              }
            }, PtyService.HEAVY_OSC_PARSE_MS))
          }
        } else {
          // 正常模式：每 chunk 解析（现有行为）
          this.processTerminalOutput(id, data, instance)
        }

        // --- 数据传输走合并缓冲 ---
        this.batchSendData(id, data)
      })

      // 监听退出
      ptyProcess.onExit(({ exitCode, signal }) => {
        if (this.isShuttingDown) return  // 关闭时不再发送事件
        // destroy() 主动 kill 时也会触发本回调；destroy 已删除实例并清理过，
        // 这里据此跳过，避免二次清理与多余的 terminal:exit。仅处理"进程自发退出"。
        if (!this.instances.has(id)) return
        console.log('[PTY] Process exited:', id, 'code:', exitCode, 'signal:', signal)
        // 发送 idle 状态（让前端显示灰色灯）。退出是终态，不需要防抖，直接发送。
        ptyStateLog(id, `${this.instances.get(id)?.state ?? '?'} -> idle (process-exit)`)
        this.safeSend(`terminal:state:${id}`, 'idle')
        // 进程自然退出：先 cleanupTerminalResources（内含 flushBatch，把退出前最后一行
        // 输出发给渲染端）再发 exit，保证最后输出先于「终端已关闭」显示。此处不杀进程（已自行退出）。
        this.cleanupTerminalResources(id)
        this.safeSend(`terminal:exit:${id}`, { exitCode, signal })
        resetInputDetector(id)
        this.instances.delete(id)
      })

      this.instances.set(id, {
        pty: ptyProcess,
        id,
        bufferChunks: [],
        bufferLength: 0,
        cwd: workingDir,
        state: 'running',
        lastOutputAt: Date.now(),
        foregroundProcess: null,
        foregroundProcessPid: null,
        lastPolledPid: null
      })

      // 立即发送初始 cwd 到渲染进程（修复路径不显示问题）
      this.safeSend(`terminal:cwd:${id}`, workingDir)

      // 添加到统一轮询队列（Phase 1 优化：替代独立定时器）
      this.pollQueue.push(id)
      this.startGlobalPoller()
      this.startIdleSweeper()

      console.log('[PTY] Total instances:', this.instances.size)

      return true
    } catch (error) {
      console.error('[PTY] Failed to create:', error)
      return false
    }
  }

  /**
   * Process terminal output for state detection
   * v5: 参考 muxvo manager.ts — 防抖 + Running-only WaitingInput 检测
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
        this.safeSend(`terminal:cwd:${id}`, newCwd)
      }
    }

    // 无防抖器（异常情况）直接跳过状态处理（状态迁移统一走 this.setState）
    if (!this.stateDebouncers.has(id)) return

    // 用本 chunk 处理前的状态做「报警 vs 自愈」的分支判定，避免同一 chunk 内先点红又被复位抵消
    const prevState = instance.state

    // 命令状态检测（OSC133）：命令开始→busy(绿)。命令结束/提示符就绪不在此强制切换——
    // 交给自愈扫描器按「静默」统一收敛到中性灰，避免与下面的报警/复位在同一 chunk 抢状态。
    const osc133 = sequences.filter(s => s.type === 'osc133')
    const commandStarted = osc133.some(s => s.value === 'B' || s.value === 'C')
    if (commandStarted) {
      instance.foregroundProcess = 'pending'
      this.setState(id, instance, 'busy', 'osc133:commandStart')

      // 前台进程检测（默认关闭，见 FOREGROUND_DETECTION_ENABLED）
      if (PtyService.FOREGROUND_DETECTION_ENABLED) {
        const monitor = this.rateMonitors.get(id)
        const lastDetect = this.lastDetectionTime.get(id) || 0
        const now = Date.now()
        const tooRecent = (now - lastDetect) < PtyService.MIN_DETECTION_INTERVAL_MS
        const heavyOutput = monitor?.isHeavyOutput ?? false

        if (!this.detectingPids.has(id) && !heavyOutput && !tooRecent) {
          this.lastDetectionTime.set(id, now)
          this.detectForegroundProcessAsyncHandler(id, instance)
        }
      }
    }

    // 报警边沿 vs 自愈复位（分离处理，互不抵消）
    if (prevState !== 'waiting_input') {
      // 报警触发：BEL 或等待文本命中 → 点红（渲染端据此响铃一次）。
      // 一次性提醒（shell 的 pause / 任务完成响铃）也在此点红，随后由自愈逻辑（blockingVisible/静默）复位。
      const hasBell = detectBellSignal(data)
      const detection = detectWaitingInputDetailed(data, id)
      if (hasBell || detection.matched) {
        resetInputDetector(id)
        this.setState(id, instance, 'waiting_input', hasBell ? 'bell' : `text:${detection.reason}`)
      } else if (prevState === 'idle') {
        // 之前是灰（静默过），现在又来新输出且非等待 → 活动恢复，回到绿
        this.setState(id, instance, 'running', 'idle->running:output')
      }
    } else {
      // 当前红灯，且这是【后续】新活动（触发点红的那个 chunk prevState 不是 waiting，不会走到这）：
      // 屏幕上已无持续阻塞框 → 自动复位为绿（新活动自动复位）；真实批准框仍在则保持红。
      const blockingVisible = matchBlockingPrompt(this.getBufferTail(instance, 2000))
      if (!blockingVisible) {
        resetInputDetector(id)
        this.setState(id, instance, 'running', 'waiting->running:no-blocking')
      }
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
   * v7 统一轮询 + 智能跳过（Phase 1 & 2 优化）
   * v8 使用 getBufferTail 替代整个 buffer 字符串
   */
  private async pollCwd(id: string): Promise<void> {
    // 关闭时跳过轮询，避免阻塞
    if (this.isShuttingDown) return

    const instance = this.instances.get(id)
    if (!instance || !instance.pty.pid) return

    // 前台进程检测（默认关闭，见 FOREGROUND_DETECTION_ENABLED）
    // 关闭时跳过所有 WMI / tasklist 调用，直接走 buffer 解析更新 cwd
    if (PtyService.FOREGROUND_DETECTION_ENABLED) {
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
    }

    // 没有前台进程，正常更新路径 — 使用 getBufferTail 替代整个 buffer
    const cwd = parsePromptCwd(this.getBufferTail(instance))
    if (cwd && cwd !== instance.cwd && this.isValidCwdPath(cwd)) {
      console.log('[PTY] CWD updated from', instance.cwd, 'to', cwd)
      instance.cwd = cwd
      this.safeSend(`terminal:cwd:${id}`, cwd)
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
    ptyDebugLog('IN', id, data)
    const instance = this.instances.get(id)
    if (instance) {
      // 用户输入时从 waiting_input 切回 running（参考 muxvo manager.ts）。
      // 仅在 data 含真实键入时解除红灯：点击/聚焦 pane 时 TUI(?1004h/鼠标追踪)会经
      // xterm.onData 自动发出 focus/鼠标上报，这些不是敲键，不应让红灯变绿。
      if (instance.state === 'waiting_input' && isRealUserInput(data)) {
        resetInputDetector(id)
        this.setState(id, instance, 'running', 'user-input')
      }
      instance.pty.write(data)
    } else {
      console.log('[PTY] write failed - instance not found:', id)
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const instance = this.instances.get(id)
    if (!instance) return
    // 钳制到安全下限：拒绝 0 / NaN / 负数，避免极端尺寸把 conpty 弄崩导致进程退出
    const safeCols = Math.max(1, Math.floor(Number(cols)) || 1)
    const safeRows = Math.max(1, Math.floor(Number(rows)) || 1)

    // 经 ResizeGovernor 治理：去重 + 节流 + 疑似无响应守卫
    // （ConPTY resize 是主线程阻塞 RPC，宿主僵死时会冻结整个应用）
    let governor = this.resizeGovernors.get(id)
    if (!governor) {
      governor = new ResizeGovernor()
      this.resizeGovernors.set(id, governor)
    }
    const action = governor.request(safeCols, safeRows, Date.now())
    ptyDebugMeta(id, `resize cols=${safeCols} rows=${safeRows} action=${action}`)
    if (action === 'apply') {
      this.applyResize(id, instance, governor, safeCols, safeRows)
    } else if (action === 'defer') {
      this.scheduleResizeFlush(id)
    }
    // 'skip'：与已生效尺寸相同，什么都不做
  }

  /** 执行原生 resize 并回报耗时；超阈值时 Governor 进入 suspect，暂停后续 resize */
  private applyResize(
    id: string,
    instance: PtyInstance,
    governor: ResizeGovernor,
    cols: number,
    rows: number
  ): void {
    const start = Date.now()
    try {
      instance.pty.resize(cols, rows)
    } catch {
      // 进程可能已退出；静默忽略，避免影响主流程
    }
    const duration = Date.now() - start
    governor.recordApply(cols, rows, start, duration)
    if (governor.isSuspect) {
      console.warn(
        `[PTY] resize 耗时 ${duration}ms（终端 ${id}）—— 控制台宿主疑似无响应，` +
        '暂停该终端后续 resize，待其恢复输出后自动补发'
      )
    }
  }

  /** 调度尾随 flush：throttleMs 后应用最新挂起尺寸（每终端同时最多一个定时器） */
  private scheduleResizeFlush(id: string): void {
    if (this.resizeFlushTimers.has(id)) return
    const delay = this.resizeGovernors.get(id)?.flushDelayMs ?? 150
    this.resizeFlushTimers.set(id, setTimeout(() => {
      this.resizeFlushTimers.delete(id)
      if (this.isShuttingDown) return
      const instance = this.instances.get(id)
      const governor = this.resizeGovernors.get(id)
      if (!instance || !governor) return
      const dims = governor.flush()
      if (dims) {
        this.applyResize(id, instance, governor, dims.cols, dims.rows)
      }
    }, delay))
  }

  /**
   * 统一清理单个终端的簿记资源（不含杀进程）
   * 供 destroy()（用户关闭）和 onExit()（进程自然退出）共用，
   * 避免自然退出时遗漏清理导致 pollQueue / 各类 Map 孤立累积
   */
  private cleanupTerminalResources(id: string): void {
    // 从轮询队列中移除
    const index = this.pollQueue.indexOf(id)
    if (index !== -1) {
      this.pollQueue.splice(index, 1)
      if (this.currentPollIndex >= index && this.currentPollIndex > 0) {
        this.currentPollIndex--
      }
    }

    // 清理数据合并缓冲（同时发送残留数据并清掉自身的 timer/buffer）
    this.flushBatch(id)

    // 清理 OSC 解析缓冲
    const oscTimer = this.oscParseTimers.get(id)
    if (oscTimer) {
      clearTimeout(oscTimer)
      this.oscParseTimers.delete(id)
    }
    this.oscParseBuffers.delete(id)

    // 清理速率监控
    this.rateMonitors.delete(id)

    // 清理 resize 治理器与挂起的 flush 定时器
    const resizeTimer = this.resizeFlushTimers.get(id)
    if (resizeTimer) {
      clearTimeout(resizeTimer)
      this.resizeFlushTimers.delete(id)
    }
    this.resizeGovernors.delete(id)

    // 清理进程检测时间记录
    this.lastDetectionTime.delete(id)

    // 清理并发检测标记
    this.detectingPids.delete(id)

    // 清理状态防抖器（reset 清掉待触发的 50ms timer，避免对已删实例的回调）
    const debouncer = this.stateDebouncers.get(id)
    if (debouncer) {
      debouncer.reset()
      this.stateDebouncers.delete(id)
    }

    // 如果没有终端了，停止全局轮询器（必须在移除队列项之后判断）
    if (this.pollQueue.length === 0) {
      this.stopGlobalPoller()
    }
  }

  destroy(id: string): void {
    const instance = this.instances.get(id)
    if (instance) {
      // 统一簿记清理
      this.cleanupTerminalResources(id)

      // 先删实例：onExit 回调据此跳过"进程自发退出"分支，不发多余 terminal:exit
      this.instances.delete(id)

      // 异步安全销毁：taskkill 进程树 → 确认退出 → pty.kill()（不阻塞主线程）
      void this.killPtySafely(instance.pty)

      console.log('[PTY] Terminal destroyed:', id)
    }
  }

  async destroyAll(): Promise<void> {
    this.isShuttingDown = true

    // 停止统一轮询调度器 + 状态自愈扫描器
    this.stopGlobalPoller()
    this.stopIdleSweeper()
    this.pollQueue = []
    this.currentPollIndex = 0

    // 清理所有数据合并缓冲
    for (const timer of this.dataBatchTimers.values()) {
      clearTimeout(timer)
    }
    this.dataBatchTimers.clear()
    this.dataBatchBuffers.clear()

    // 清理所有 OSC 解析缓冲
    for (const timer of this.oscParseTimers.values()) {
      clearTimeout(timer)
    }
    this.oscParseTimers.clear()
    this.oscParseBuffers.clear()

    // 清理速率监控
    this.rateMonitors.clear()
    this.detectingPids.clear()
    this.lastDetectionTime.clear()

    // 清理 resize 治理
    for (const timer of this.resizeFlushTimers.values()) {
      clearTimeout(timer)
    }
    this.resizeFlushTimers.clear()
    this.resizeGovernors.clear()

    // 并行安全销毁所有 PTY：taskkill 进程树 → 确认退出 → pty.kill()
    // （index.ts before-quit 有 3s 强退兜底，killProcessTree 默认 2.5s 超时在其之内）
    const instances = Array.from(this.instances.values())
    await Promise.all(instances.map(instance => this.killPtySafely(instance.pty)))

    this.instances.clear()
    this.stateDebouncers.clear()
    console.log('[PTY] All terminals destroyed')
  }

  getBuffer(id: string): string {
    return this.instances.get(id)?.bufferChunks.join('') || ''
  }

  hasInstance(id: string): boolean {
    return this.instances.has(id)
  }
}
