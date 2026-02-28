import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { SearchAddon } from 'xterm-addon-search'
import 'xterm/css/xterm.css'
import { TerminalInstance } from '../../App'

interface TerminalPaneProps {
  terminal: TerminalInstance
  onClose: () => void
  onRename: (name: string) => void
  isFocused: boolean
}

export function TerminalPane({
  terminal,
  onClose,
  onRename,
  isFocused
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(terminal.name)

  // 初始化终端
  useEffect(() => {
    if (!containerRef.current) return

    // 创建 XTerm 实例
    const xterm = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        cursorAccent: '#1e1e1e',
        selection: 'rgba(255, 255, 255, 0.3)',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff'
      },
      allowProposedApi: true,
      allowTransparency: true
    })

    // 加载插件
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    const searchAddon = new SearchAddon()

    xterm.loadAddon(fitAddon)
    xterm.loadAddon(webLinksAddon)
    xterm.loadAddon(searchAddon)

    // 打开终端
    xterm.open(containerRef.current)
    fitAddon.fit()

    xtermRef.current = xterm
    fitAddonRef.current = fitAddon

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
      fitAddon.fit()
    }
    window.addEventListener('resize', handleResize)

    // 监听终端退出
    const unsubscribeExit = window.electron.terminal.onExit((id) => {
      if (id === terminal.id) {
        xterm.write('\r\n\x1b[33m终端已关闭\x1b[0m\r\n')
      }
    })

    // 处理复制：Ctrl+Shift+C 或右键复制
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+C 复制
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        const selection = xterm.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
        }
        e.preventDefault()
      }
      // Ctrl+Shift+V 粘贴
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        navigator.clipboard.readText().then(text => {
          xterm.write(text)
          window.electron.terminal.write(terminal.id, text)
        })
        e.preventDefault()
      }
    }

    // 右键复制
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      const selection = xterm.getSelection()
      if (selection) {
        navigator.clipboard.writeText(selection)
      }
    }

    containerRef.current.addEventListener('keydown', handleKeyDown)
    containerRef.current.addEventListener('contextmenu', handleContextMenu)

    return () => {
      unsubscribe()
      unsubscribeExit()
      window.removeEventListener('resize', handleResize)
      containerRef.current?.removeEventListener('keydown', handleKeyDown)
      containerRef.current?.removeEventListener('contextmenu', handleContextMenu)
      window.electron.terminal.destroy(terminal.id)
      xterm.dispose()
    }
  }, [terminal.id, terminal.cwd])

  // 聚焦时自动调整大小并聚焦终端
  useEffect(() => {
    if (isFocused && fitAddonRef.current && xtermRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit()
        xtermRef.current?.focus()
      }, 0)
    }
  }, [isFocused])

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
              <span className="terminal-name">{terminal.name}</span>
            </>
          )}
        </div>

        <div className="terminal-actions">
          <button
            className="terminal-action-btn"
            onClick={onClose}
            title="关闭终端"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 终端容器 - 添加 tabindex 使其可聚焦 */}
      <div
        className="terminal-container"
        ref={containerRef}
        tabIndex={0}
      />
    </div>
  )
}
