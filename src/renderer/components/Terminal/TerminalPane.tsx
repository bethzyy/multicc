import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { SearchAddon } from 'xterm-addon-search'
import { WebglAddon } from 'xterm-addon-webgl'
import 'xterm/css/xterm.css'
import { TerminalInstance } from '../../App'
import { getXTermTheme } from '../../hooks/useTheme'
import { ScrollbackDeduplicator, lastCursorVisibility, containsStatefulSequences } from '../../utils/ScrollbackDeduplicator'
import { formatCwd } from '../../utils/formatCwd'
import { statusDotClass } from '../../utils/statusDotClass'
import { WorktreePopover } from '../Worktree/WorktreePopover'

interface TerminalPaneProps {
  terminal: TerminalInstance
  onClose: () => void
  onRename: (name: string) => void
  onFocus: () => void
  onMinimize: () => void
  onStateChange: (state: string) => void
  onCwdChange: (cwd: string) => void
  onOpenWorktree: (path: string) => void
  isFocused: boolean
  isInFocusMode?: boolean
  onToggleFocusMode?: () => void
  theme?: 'dark' | 'light'
}

// 读取可配置的 scrollback 行数
// 默认 5000（与原版一致的已验证值）。注意：scrollback 过小会把较早的会话内容挤出缓冲、
// 永久不可见——Claude Code 这类啰嗦 TUI 会话两三轮就可能超过数千行，故不要轻易调低。
// 可通过 localStorage 键 'multicc.scrollback' 覆盖（同步读取，不阻塞 XTerm 同步创建）。
const DEFAULT_SCROLLBACK = 5000
function getScrollback(): number {
  try {
    const raw = Number(localStorage.getItem('multicc.scrollback'))
    if (Number.isFinite(raw) && raw > 0) return raw
  } catch {
    // localStorage 不可用时回退默认值
  }
  return DEFAULT_SCROLLBACK
}

// 去重开关（A/B 排查用）。ScrollbackDeduplicator 通过"整块丢弃重复写入"抑制经典渲染器
// 把旧帧推进 scrollback 造成的镜像重复；但整块丢弃会连带丢掉块内的光标移动/显隐控制码，
// 怀疑会造成光标错位（如 ↑ 调历史命令显示位置跑到上面）等渲染异常。
// 默认开启；在 DevTools Console 执行 localStorage.setItem('multicc.dedup','off') 后重建终端即可关闭，
// 用于验证某渲染异常是否由去重导致。
function getDedupEnabled(): boolean {
  try {
    return localStorage.getItem('multicc.dedup') !== 'off'
  } catch {
    return true
  }
}

// 从 cwd 路径检测 worktree 项目信息
function getWorktreeInfo(cwd: string): { projectName: string } | null {
  const markerPos = cwd.indexOf('/.worktrees/')
  const markerPosWin = cwd.indexOf('\\.worktrees\\')
  const idx = markerPos >= 0 ? markerPos : markerPosWin
  if (idx < 0) return null
  const separator = markerPos >= 0 ? '/' : '\\'
  const projectPath = cwd.substring(0, idx)
  const projectName = projectPath.split(separator).pop() || ''
  return projectName ? { projectName } : null
}

export function TerminalPane({
  terminal,
  onClose,
  onRename,
  onFocus,
  onMinimize,
  onStateChange,
  onCwdChange,
  onOpenWorktree,
  isFocused,
  isInFocusMode = false,
  onToggleFocusMode,
  theme = 'dark'
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(terminal.name)
  const [currentCwd, setCurrentCwd] = useState<string | null>(terminal.cwd || null)
  const [isGitRepo, setIsGitRepo] = useState(false)
  const [showWorktreePopover, setShowWorktreePopover] = useState(false)
  const [worktreeAnchorRect, setWorktreeAnchorRect] = useState<{ top: number; left: number } | null>(null)
  const worktreeBtnRef = useRef<HTMLButtonElement>(null)

  // 初始化终端
  useEffect(() => {
    console.log('[TerminalPane] useEffect called, terminal.id:', terminal.id)
    const container = containerRef.current
    if (!container) {
      console.log('[TerminalPane] container is null!')
      return
    }

    // 创建 XTerm 实例
    const xterm = new XTerm({
      // 关闭光标闪烁：claude 会狂发 ?25h(显示光标)+移动光标，开启闪烁重绘循环时
      // xterm 容易在旧位置留下幽灵光标残块。关掉闪烁可减少光标重绘、规避残影。
      cursorBlink: false,
      cursorStyle: 'bar',
      fontSize: 14,
      // 中文必须用等宽的 CJK 回退字体（NSimSun/新宋体 全 Windows 自带，且汉字恰为半角的 2 倍宽），
      // 否则中文落到非等宽回退字体上，宽度与 xterm 按 Consolas 算出的格子不符，导致光标错位/残留白块。
      fontFamily: 'Consolas, "NSimSun", "Courier New", monospace',
      theme: getXTermTheme(theme),
      allowProposedApi: true,
      // 关闭透明：WebGL 渲染器在 allowTransparency:true 时单元格清除不彻底，
      // 会留下中文/宽字符的光标残影拖尾。终端有纯色背景，不需要透明。
      allowTransparency: false,
      disableStdin: false,
      scrollback: getScrollback(),   // 可配置（默认 5000），防止无限累积 + 控制多终端内存
      fastScrollModifier: 'alt',
      fastScrollSensitivity: 5,
    })

    // 配置右键菜单选项
    xterm.options.rightClickSelectsWord = true
    xterm.options.altClickMovesCursor = false

    // 加载插件
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    const searchAddon = new SearchAddon()

    xterm.loadAddon(fitAddon)
    xterm.loadAddon(webLinksAddon)
    xterm.loadAddon(searchAddon)

    // 打开终端
    xterm.open(container)

    // WebGL 渲染器开关。旧版 xterm-addon-webgl(0.16) 有"幽灵光标"bug：移动后不清除上一帧光标，
    // 留下双光标/残块（中英文都犯）。CJK 宽度已由 NSimSun 字体修复、闪烁已由经典渲染器解决，
    // 故先关闭 WebGL 用 DOM 渲染器验证光标是否干净。若 DOM 干净则无需 WebGL。
    const ENABLE_WEBGL = false
    let webglAddon: WebglAddon | null = null
    if (ENABLE_WEBGL) {
      try {
        webglAddon = new WebglAddon()
        // GPU 上下文丢失时自动释放，xterm 回退到 DOM 渲染器
        webglAddon.onContextLoss(() => {
          webglAddon?.dispose()
          webglAddon = null
        })
        xterm.loadAddon(webglAddon)
      } catch (e) {
        console.warn('[TerminalPane] WebGL 渲染器初始化失败，回退到默认渲染器:', e)
        webglAddon = null
      }
    }

    // 保存引用
    xtermRef.current = xterm
    fitAddonRef.current = fitAddon

    // 延迟 fit，确保终端已完全渲染
    requestAnimationFrame(() => {
      // 容器不可见（尺寸为 0，如聚焦模式下新建的隐藏 pane）时跳过 fit，避免算出畸形 cols/rows
      const rect = container.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        try {
          fitAddon.fit()
        } catch (e) {
          console.warn('Fit failed:', e)
        }
      }
      // 自动聚焦终端
      xterm.focus()
    })

    // 创建 PTY 进程
    const { cols, rows } = xterm
    window.electron.terminal.create(terminal.id, cols, rows, terminal.cwd)

    // 监听终端数据（来自主进程）
    // 使用 requestAnimationFrame 批处理写入，防止重负载时渲染器被淹没
    let pendingData = ''
    let rafId = 0
    let isDisposed = false
    // 纯保险阀：rAF 间隔仅 ~16ms，2MB/帧 ≈ 128MB/s 持续输出才会触发
    const MAX_WRITE_PER_FRAME = 2 * 1024 * 1024
    const deduplicator = new ScrollbackDeduplicator()
    const dedupEnabled = getDedupEnabled()
    // 去重决策日志开关（A/B 排查用）：localStorage.setItem('multicc.deduplog','on')
    const dedupLogEnabled = localStorage.getItem('multicc.deduplog') === 'on'

    // 用户刚输入后的"回显保护窗口"。去重器只该压制流式输出造成的重复 scrollback，
    // 绝不能丢弃用户输入/删除的回显——否则编辑多行输入时整块重绘被判重丢弃，
    // 会出现"打了字不显示/删了字没删掉/光标错位"。键入后 INPUT_ECHO_WINDOW_MS 内
    // 到达的输出几乎必然是这次编辑的交互回显，期间一律照写不去重。
    const INPUT_ECHO_WINDOW_MS = 250
    let lastInputAt = 0

    const flushWrites = () => {
      rafId = 0
      if (pendingData && !isDisposed) {
        // 极端压力下截断，保留最新数据。切点必须落在安全边界：盲 slice 可能把
        // ANSI 序列 / UTF-16 代理对从中间切断，产生畸形输出。
        let wasTruncated = false
        if (pendingData.length > MAX_WRITE_PER_FRAME) {
          wasTruncated = true
          let cut = pendingData.length - MAX_WRITE_PER_FRAME
          // 优先切在 \n 之后：转义序列实际不跨 \n，\n 也不会是代理对的一半
          const nl = pendingData.indexOf('\n', cut)
          if (nl !== -1 && nl - cut < 64 * 1024) {
            cut = nl + 1
          } else {
            // 回退1：不切断代理对（低位代理 0xDC00-0xDFFF 说明切在了一对中间）
            const c = pendingData.charCodeAt(cut)
            if (c >= 0xdc00 && c <= 0xdfff) cut++
            // 回退2：跳到下一个 ESC，从完整序列的开头继续
            const esc = pendingData.indexOf('\x1b', cut)
            if (esc !== -1 && esc - cut < 4096) cut = esc
          }
          pendingData = pendingData.slice(cut)
        }
        // 检测 scrollback 重复内容并跳过写入（dedupEnabled=false 时整体跳过去重，便于 A/B 排查）
        if (dedupEnabled) {
          const recentlyTyped = (performance.now() - lastInputAt) < INPUT_ECHO_WINDOW_MS
          // shouldDrop 内部对含状态控制序列（光标定位/擦除等）的帧一律放行——
          // 丢弃这类帧会让 xterm 屏幕与 ConPTY 模型失步，是输入框错乱的根因。
          const drop = deduplicator.shouldDrop(pendingData, { recentlyTyped, unsafe: wasTruncated })
          if (dedupLogEnabled) {
            const verdict = drop
              ? 'dropped'
              : wasTruncated
                ? 'kept:truncated'
                : recentlyTyped
                  ? 'kept:typed'
                  : containsStatefulSequences(pendingData)
                    ? 'kept:stateful'
                    : 'kept:new'
            console.debug(`[dedup:${terminal.id}] ${verdict} len=${pendingData.length}`)
          }
          if (drop) {
            // 重复帧整块丢弃会连同块内的光标显隐码(?25l/?25h)一起丢掉，导致光标
            // 显隐状态与应用意图失步（典型表现：光标偶发性永久消失）。丢弃前补写块内
            // 最后一次光标显隐意图，确保光标可见性始终正确，同时仍抑制重复文本。
            const cursorSeq = lastCursorVisibility(pendingData)
            if (cursorSeq) {
              try {
                xterm.write(cursorSeq)
              } catch {
                // xterm 可能已销毁
              }
            }
            pendingData = ''
            return
          }
        }
        try {
          xterm.write(pendingData)
        } catch {
          // xterm 可能已销毁
        }
        pendingData = ''
      }
    }

    const unsubscribe = window.electron.terminal.onData(terminal.id, (data) => {
      pendingData += data
      if (!rafId) {
        rafId = requestAnimationFrame(flushWrites)
      }
    })

    // 监听用户输入（发送到主进程）
    xterm.onData((data) => {
      // 记录最近输入时刻，开启回显保护窗口（见 flushWrites 去重逻辑）
      lastInputAt = performance.now()
      window.electron.terminal.write(terminal.id, data)
    })

    // 监听终端大小变化
    xterm.onResize(({ cols, rows }) => {
      // resize 后 ConPTY 全量重绘、行内容按新宽度重排，旧宽度的行 hash 已失效，
      // 留着只会误判/占容量
      deduplicator.reset()
      window.electron.terminal.resize(terminal.id, cols, rows)
    })

    // 容器尺寸变化（含窗口缩放、聚焦模式切换）统一由 ResizeObserver 处理，
    // 不再额外注册 per-terminal 的 window 'resize' 监听（N 个终端会重复触发 fit）
    const resizeObserver = new ResizeObserver(() => {
      // 隐藏 pane（聚焦模式 display:none）尺寸为 0，跳过无效 fit + 多余 resize IPC
      const rect = container.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      try {
        fitAddon.fit()
        // fit 后立即滚动到底部，防止内容跳到上面
        requestAnimationFrame(() => {
          xterm.scrollToBottom()
        })
      } catch (e) {
        console.warn('ResizeObserver fit failed:', e)
      }
    })
    resizeObserver.observe(container)

    // 监听终端退出
    const unsubscribeExit = window.electron.terminal.onExit(terminal.id, (info) => {
      // 诊断：把退出码/信号直接打在终端里，便于排查"自发关闭"（0=正常退出，非0=异常/崩溃）
      const detail = info && typeof info.exitCode === 'number'
        ? ` (exitCode=${info.exitCode}${info.signal != null ? `, signal=${info.signal}` : ''})`
        : ''
      xterm.write(`\r\n\x1b[33m终端已关闭${detail}\x1b[0m\r\n`)
      // 通知父组件状态变为 idle（让状态圆点变灰）
      onStateChange('idle')
    })

    // 监听终端路径变化
    const unsubscribeCwd = window.electron.terminal.onCwd(terminal.id, (cwd) => {
      setCurrentCwd(cwd)
      onCwdChange(cwd)
    })

    // 监听终端状态变化
    const unsubscribeState = window.electron.terminal.onState(terminal.id, (state) => {
      onStateChange(state)
    })

    // 处理复制粘贴
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+C：有选中文字则复制，否则发送中断信号
      if (e.ctrlKey && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        const selection = xterm.getSelection()
        console.log('[Terminal] Ctrl+C pressed, selection:', selection)
        if (selection && selection.length > 0) {
          navigator.clipboard.writeText(selection).then(() => {
            console.log('[Terminal] Copied to clipboard:', selection)
            xterm.clearSelection()
          }).catch(err => {
            console.error('[Terminal] Copy failed:', err)
          })
          e.preventDefault()
          e.stopPropagation()
          return
        }
        // 没有选中文字，允许 Ctrl+C 作为中断信号
        console.log('[Terminal] No selection, allowing Ctrl+C as interrupt')
      }

      // Ctrl+V：使用 XTerm.js 的 paste API 正确处理粘贴
      if (e.ctrlKey && !e.shiftKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault()
        e.stopPropagation()
        navigator.clipboard.readText().then(text => {
          if (text) {
            console.log('[Terminal] Pasting text via xterm.paste():', text.length, 'chars')
            xterm.paste(text)
          }
        }).catch(err => {
          console.error('[Terminal] Paste failed:', err)
        })
        return
      }
    }

    // 右键菜单：复制/粘贴
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      const selection = xterm.getSelection()
      if (selection) {
        navigator.clipboard.writeText(selection)
      } else {
        navigator.clipboard.readText().then(text => {
          if (text) {
            console.log('[Terminal] Right-click paste via xterm.paste():', text.length, 'chars')
            xterm.paste(text)
          }
        })
      }
    }

    // 点击终端时聚焦
    const handleClick = () => {
      xterm.focus()
      onFocus()
    }

    container.addEventListener('click', handleClick)
    // 使用捕获阶段，确保在 XTerm 内部处理之前拦截 Ctrl+C
    container.addEventListener('keydown', handleKeyDown, { capture: true })
    container.addEventListener('contextmenu', handleContextMenu)

    // 清理函数
    return () => {
      // 标记已销毁，防止 rAF 回调写入已销毁的 xterm
      isDisposed = true
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
      unsubscribe()
      unsubscribeExit()
      unsubscribeCwd()
      unsubscribeState()
      resizeObserver.disconnect()
      container.removeEventListener('click', handleClick)
      container.removeEventListener('keydown', handleKeyDown, { capture: true })
      container.removeEventListener('contextmenu', handleContextMenu)
      window.electron.terminal.destroy(terminal.id)
      try {
        webglAddon?.dispose()
      } catch {
        // WebGL 上下文可能已丢失
      }
      xterm.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
    // 仅依赖 terminal.id：cwd 只用作创建时的初始值，不应作为重建触发器。
    // 否则一旦 terminal.cwd 变化就会 dispose+重建终端，丢失全部内容并冒出「终端已关闭」。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminal.id])

  // 聚焦时自动调整大小、聚焦终端、滚动到底部
  useEffect(() => {
    if (isFocused && fitAddonRef.current && xtermRef.current) {
      setTimeout(() => {
        // 容器不可见（尺寸为 0）时跳过 fit，避免无效几何计算
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect || rect.width === 0 || rect.height === 0) return
        try {
          fitAddonRef.current?.fit()
          xtermRef.current?.focus()
          // fit 后滚动到底部
          requestAnimationFrame(() => {
            xtermRef.current?.scrollToBottom()
          })
        } catch (e) {
          console.warn('Focus fit failed:', e)
        }
      }, 0)
    }
  }, [isFocused])

  // 主题变化时更新 XTerm 主题
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = getXTermTheme(theme)
    }
  }, [theme])

  // 检测 cwd 是否在 git 仓库中
  useEffect(() => {
    if (!currentCwd) { setIsGitRepo(false); return }
    let cancelled = false
    window.electron.worktree.detectRepo(currentCwd).then((result) => {
      if (!cancelled) setIsGitRepo(result.isRepo)
    }).catch(() => {
      if (!cancelled) setIsGitRepo(false)
    })
    return () => { cancelled = true }
  }, [currentCwd])

  // 处理重命名
  const handleRename = () => {
    if (editName.trim() && editName !== terminal.name) {
      onRename(editName.trim())
    }
    setIsEditing(false)
  }

  // 处理双击标题
  const handleDoubleClick = () => {
    setEditName(terminal.name)
    setIsEditing(true)
  }

  return (
    <div className={`terminal-pane ${isFocused ? 'focused' : ''}`}>
      {/* 终端标题栏 */}
      <div className="terminal-header">
        <div className="terminal-title" onDoubleClick={handleDoubleClick}>
          {isEditing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename()
                if (e.key === 'Escape') {
                  setEditName(terminal.name)
                  setIsEditing(false)
                }
              }}
              autoFocus
              className="rename-input"
            />
          ) : (
            <>
              <span className={`terminal-status-dot ${statusDotClass(terminal.state)}`} />
              {/* Worktree 项目徽章 */}
              {currentCwd && getWorktreeInfo(currentCwd) && (
                <span className="terminal-worktree-badge">
                  {getWorktreeInfo(currentCwd)!.projectName}
                </span>
              )}
              {currentCwd ? (
                <>
                  <span className="terminal-cwd" title={currentCwd}>
                    {formatCwd(currentCwd)}
                  </span>
                  <span className="terminal-separator">·</span>
                </>
              ) : null}
              <span className="terminal-name">{terminal.name}</span>
            </>
          )}
        </div>

        {/* WaitingInput 红色徽章 */}
        {terminal.state === 'waiting_input' && (
          <span className="terminal-waiting-badge">1</span>
        )}

        <div className="terminal-actions">
          {/* Worktree 按钮 */}
          {isGitRepo && (
            <button
              ref={worktreeBtnRef}
              className="terminal-action-btn worktree-btn"
              onClick={(e) => {
                e.stopPropagation()
                if (worktreeBtnRef.current) {
                  const rect = worktreeBtnRef.current.getBoundingClientRect()
                  setWorktreeAnchorRect({ top: rect.bottom + 4, left: rect.left })
                  setShowWorktreePopover(prev => !prev)
                }
              }}
              title="Git Worktree"
            >
              &#xE0A0;
            </button>
          )}
          {/* 文件浏览器按钮 */}
          {currentCwd && (
            <button
              className="terminal-action-btn file-btn"
              onClick={(e) => {
                e.stopPropagation()
                window.electron.shell.openPath(currentCwd)
              }}
              title="在资源管理器中打开"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7c0-1.1.9-2 2-2h4l2 2h8c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V7z" fillOpacity="0.2" />
                <path d="M3 7c0-1.1.9-2 2-2h4l2 2h8c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V7z" fill="none" strokeWidth="1.5" />
              </svg>
            </button>
          )}
          {/* 最小化按钮 */}
          <button
            className="terminal-action-btn minimize-btn"
            onClick={(e) => {
              e.stopPropagation()
              onMinimize()
            }}
            title="最小化"
          >
            ─
          </button>
          {/* 聚焦按钮 */}
          {onToggleFocusMode && (
            <button
              className={`terminal-action-btn focus-btn ${isInFocusMode ? 'active' : ''}`}
              onClick={onToggleFocusMode}
              title={isInFocusMode ? '退出聚焦模式' : '聚焦模式'}
            >
              {isInFocusMode ? '⊞' : '◎'}
            </button>
          )}
          {/* 关闭按钮 */}
          <button
            className="terminal-action-btn close-btn"
            onClick={onClose}
            title="关闭终端"
          >
            ×
          </button>
        </div>
      </div>

      {/* 终端容器 */}
      <div
        className="terminal-container"
        ref={containerRef}
        tabIndex={0}
      />

      {/* Worktree Popover */}
      {isGitRepo && showWorktreePopover && currentCwd && (
        <WorktreePopover
          terminalCwd={currentCwd}
          open={showWorktreePopover}
          anchorRect={worktreeAnchorRect}
          onClose={() => { setShowWorktreePopover(false); setWorktreeAnchorRect(null) }}
          onOpenWorktree={(path) => {
            onOpenWorktree(path)
            setShowWorktreePopover(false)
          }}
        />
      )}
    </div>
  )
}
