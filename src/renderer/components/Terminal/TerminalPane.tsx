import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { SearchAddon } from 'xterm-addon-search'
import { WebglAddon } from 'xterm-addon-webgl'
import 'xterm/css/xterm.css'
import { TerminalInstance } from '../../App'
import { getXTermTheme } from '../../hooks/useTheme'

interface TerminalPaneProps {
  terminal: TerminalInstance
  onClose: () => void
  onRename: (name: string) => void
  onFocus: () => void
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

// 格式化路径显示：显示最后两级
function formatCwd(cwd: string | null): string {
  if (!cwd) return ''

  const normalizedCwd = cwd.replace(/\\/g, '/')
  const parts = normalizedCwd.split('/')
  const filtered = parts.filter(p => p)
  if (filtered.length <= 2) return cwd
  return '.../' + filtered.slice(-2).join('/')
}

export function TerminalPane({
  terminal,
  onClose,
  onRename,
  onFocus,
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
    const MAX_WRITE_PER_FRAME = 512 * 1024  // 512KB per frame max

    const flushWrites = () => {
      rafId = 0
      if (pendingData && !isDisposed) {
        // 极端压力下截断，保留最新数据
        if (pendingData.length > MAX_WRITE_PER_FRAME) {
          pendingData = pendingData.slice(-MAX_WRITE_PER_FRAME)
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
      window.electron.terminal.write(terminal.id, data)
    })

    // 监听终端大小变化
    xterm.onResize(({ cols, rows }) => {
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
    })

    // 监听终端路径变化
    const unsubscribeCwd = window.electron.terminal.onCwd(terminal.id, (cwd) => {
      setCurrentCwd(cwd)
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
              <span className="terminal-icon">⬡</span>
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

        <div className="terminal-actions">
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
    </div>
  )
}
