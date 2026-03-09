import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { SearchAddon } from 'xterm-addon-search'
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

// multicc 目录路径
const MULTICC_DIR = 'C:/D/CAIE_tool/MyAIProduct/multicc'

// 格式化路径显示：相对 multicc 目录
function formatCwd(cwd: string | null): string {
  if (!cwd) return ''

  // 统一使用正斜杠
  const normalizedCwd = cwd.replace(/\\/g, '/')
  const normalizedMulticc = MULTICC_DIR.replace(/\\/g, '/')

  // 如果在 multicc 目录下，显示相对路径
  if (normalizedCwd.startsWith(normalizedMulticc)) {
    const relative = normalizedCwd.slice(normalizedMulticc.length)
    if (relative === '' || relative === '/') return '.'
    return '.' + relative  // 例如: ./src/renderer
  }

  // 不在 multicc 目录下，显示最后两级
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
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: getXTermTheme(theme),
      allowProposedApi: true,
      allowTransparency: true,
      // 禁用默认的 Ctrl+C 复制行为，让我们自己处理
      disableStdin: false
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

    // 保存引用
    xtermRef.current = xterm
    fitAddonRef.current = fitAddon

    // 延迟 fit，确保终端已完全渲染
    requestAnimationFrame(() => {
      try {
        fitAddon.fit()
      } catch (e) {
        console.warn('Fit failed:', e)
      }
      // 自动聚焦终端
      xterm.focus()
    })

    // 创建 PTY 进程
    const { cols, rows } = xterm
    window.electron.terminal.create(terminal.id, cols, rows, terminal.cwd)

    // 监听终端数据（来自主进程）
    const unsubscribe = window.electron.terminal.onData((id, data) => {
      if (id === terminal.id) {
        xterm.write(data)
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

    // 监听窗口大小变化
    const handleResize = () => {
      try {
        fitAddon.fit()
      } catch (e) {
        console.warn('Resize fit failed:', e)
      }
    }
    window.addEventListener('resize', handleResize)

    // 使用 ResizeObserver 监听容器大小变化（聚焦模式切换等）
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
      } catch (e) {
        console.warn('ResizeObserver fit failed:', e)
      }
    })
    resizeObserver.observe(container)

    // 监听终端退出
    const unsubscribeExit = window.electron.terminal.onExit((id) => {
      if (id === terminal.id) {
        xterm.write('\r\n\x1b[33m终端已关闭\x1b[0m\r\n')
      }
    })

    // 监听终端路径变化
    const unsubscribeCwd = window.electron.terminal.onCwd((id, cwd) => {
      if (id === terminal.id) {
        setCurrentCwd(cwd)
      }
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
      // Ctrl+V：粘贴
      if (e.ctrlKey && !e.shiftKey && (e.key === 'v' || e.key === 'V')) {
        console.log('[Terminal] Ctrl+V pressed, pasting...')
        navigator.clipboard.readText().then(text => {
          console.log('[Terminal] Pasting text:', text)
          window.electron.terminal.write(terminal.id, text)
        }).catch(err => {
          console.error('[Terminal] Paste failed:', err)
        })
        e.preventDefault()
        e.stopPropagation()
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
          window.electron.terminal.write(terminal.id, text)
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
      unsubscribe()
      unsubscribeExit()
      unsubscribeCwd()
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      container.removeEventListener('click', handleClick)
      container.removeEventListener('keydown', handleKeyDown, { capture: true })
      container.removeEventListener('contextmenu', handleContextMenu)
      window.electron.terminal.destroy(terminal.id)
      xterm.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [terminal.id, terminal.cwd])

  // 聚焦时自动调整大小并聚焦终端
  useEffect(() => {
    if (isFocused && fitAddonRef.current && xtermRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit()
          xtermRef.current?.focus()
        } catch (e) {
          console.warn('Focus fit failed:', e)
        }
      }, 0)
    }
  }, [isFocused])

  // 聚焦时滚动到底部
  useEffect(() => {
    if (isFocused && xtermRef.current) {
      // 延迟执行，确保终端已完成渲染
      requestAnimationFrame(() => {
        xtermRef.current?.scrollToBottom()
      })
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
