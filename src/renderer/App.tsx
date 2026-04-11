import { useState, useCallback, useEffect } from 'react'
import { TitleBar } from './components/TitleBar/TitleBar'
import { TileLayout } from './components/Layout/TileLayout'
import { ChatHistoryPanel } from './components/chat'
import { ConfigBrowser } from './components/config'
import { ToolsBrowser } from './components/tools'
import { UpdateNotification } from './components/update/UpdateNotification'
import { useTheme, type Theme } from './hooks/useTheme'
import { v4 as uuidv4 } from 'uuid'
import type { ChatSource } from '@shared/types/chat.types'
import type { CustomCommand } from '@shared/types/tools.types'

export interface TerminalInstance {
  id: string
  name: string
  cwd: string
  isFocused: boolean
}

function App() {
  const [terminals, setTerminals] = useState<TerminalInstance[]>([])
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [showChatHistory, setShowChatHistory] = useState(false)
  const [showConfigBrowser, setShowConfigBrowser] = useState(false)
  const [showToolsBrowser, setShowToolsBrowser] = useState(false)
  const { theme, toggleTheme } = useTheme()

  // 创建新终端
  const createTerminal = useCallback((cwd?: string) => {
    console.log('[App] createTerminal called, cwd:', cwd)
    const id = uuidv4()
    const terminal: TerminalInstance = {
      id,
      name: `终端 ${terminals.length + 1}`,
      cwd: cwd || '',
      isFocused: true
    }
    console.log('[App] new terminal:', terminal)
    setTerminals(prev => [...prev, terminal])
    setFocusedId(id)
    return id
  }, [terminals.length])

  // 关闭终端
  const closeTerminal = useCallback((id: string) => {
    setTerminals(prev => {
      const filtered = prev.filter(t => t.id !== id)
      // 如果关闭的是当前聚焦的终端，切换到第一个
      if (focusedId === id && filtered.length > 0) {
        setFocusedId(filtered[0].id)
      } else if (filtered.length === 0) {
        setFocusedId(null)
      }
      return filtered
    })
  }, [focusedId])

  // 聚焦终端
  const focusTerminal = useCallback((id: string) => {
    setFocusedId(id)
    const terminal = terminals.find(t => t.id === id)
    if (terminal) {
      setTerminals(prev =>
        prev.map(t => ({ ...t, isFocused: t.id === id }))
      )
    }
  }, [terminals])

  // 切换聚焦模式
  const toggleFocusMode = useCallback(() => {
    setFocusMode(prev => !prev)
  }, [])

  // 切换终端聚焦模式（toggle 行为）
  const toggleFocusModeForTerminal = useCallback((id: string) => {
    // 如果当前已在聚焦模式且聚焦的是这个终端，退出聚焦模式
    if (focusMode && focusedId === id) {
      setFocusMode(false)
    } else {
      // 否则进入聚焦模式并聚焦这个终端
      setFocusedId(id)
      setFocusMode(true)
    }
  }, [focusMode, focusedId])

  // 重命名终端
  const renameTerminal = useCallback((id: string, name: string) => {
    setTerminals(prev =>
      prev.map(t => t.id === id ? { ...t, name } : t)
    )
  }, [])

  // 初始化：创建第一个终端
  useEffect(() => {
    if (terminals.length === 0) {
      createTerminal()
    }
  }, [])

  const focusedTerminal = terminals.find(t => t.id === focusedId)

  // Handle resume session from chat history
  const handleResumeSession = useCallback(async (info: { sessionId: string; cwd: string; source: ChatSource; customTitle?: string }) => {
    console.log('[App] Resume session:', info)

    // Create new terminal with the session's cwd
    const id = uuidv4()
    const terminal: TerminalInstance = {
      id,
      name: info.customTitle || `Session ${info.sessionId.slice(0, 8)}`,
      cwd: info.cwd,
      isFocused: true,
    }

    setTerminals(prev => [...prev, terminal])
    setFocusedId(id)
    setShowChatHistory(false)

    // Wait for TerminalPane useEffect to create PTY via IPC
    // PTY spawn is synchronous in main process; 100ms is enough for IPC round-trip + React render
    await new Promise(resolve => setTimeout(resolve, 100))

    const escapedCwd = info.cwd.replace(/([ ()&|;<>$`"'"'"'\\])/g, '\\$1')
    const resumeCmd = info.source === 'codex'
      ? `codex resume ${info.sessionId}`
      : `claude --resume ${info.sessionId}`
    window.electron.terminal.write(id, `cd ${escapedCwd} && ${resumeCmd}\n`)
  }, [])

  // Handle run custom command
  const handleRunCustomCommand = useCallback(async (cmd: CustomCommand) => {
    console.log('[App] Run custom command:', cmd)

    // Create new terminal
    const id = uuidv4()
    const terminal: TerminalInstance = {
      id,
      name: cmd.name,
      cwd: cmd.cwd || '',
      isFocused: true,
    }

    setTerminals(prev => [...prev, terminal])
    setFocusedId(id)
    setShowToolsBrowser(false)

    // Wait for TerminalPane useEffect to create PTY via IPC
    // PTY spawn is synchronous in main process; 100ms is enough for IPC round-trip + React render
    await new Promise(resolve => setTimeout(resolve, 100))

    if (cmd.cwd) {
      const escapedCwd = cmd.cwd.replace(/([ ()&|;<>$`"'"'"'\\])/g, '\\$1')
      window.electron.terminal.write(id, `cd ${escapedCwd} && ${cmd.command}\n`)
    } else {
      window.electron.terminal.write(id, `${cmd.command}\n`)
    }
  }, [])

  // Keyboard shortcut for chat history (Ctrl+H), config browser (Ctrl+Shift+S), and tools browser (Ctrl+Shift+T)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'h') {
        e.preventDefault()
        setShowChatHistory(prev => !prev)
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'S') {
        e.preventDefault()
        setShowConfigBrowser(prev => !prev)
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        setShowToolsBrowser(prev => !prev)
      }
      if (e.key === 'Escape') {
        if (showChatHistory) setShowChatHistory(false)
        if (showConfigBrowser) setShowConfigBrowser(false)
        if (showToolsBrowser) setShowToolsBrowser(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showChatHistory, showConfigBrowser, showToolsBrowser])

  return (
    <div className="app">
      <TitleBar
        focusMode={focusMode}
        onToggleFocusMode={toggleFocusMode}
        onCreateTerminal={createTerminal}
        onToggleChatHistory={() => setShowChatHistory(prev => !prev)}
        showChatHistory={showChatHistory}
        onToggleConfigBrowser={() => setShowConfigBrowser(prev => !prev)}
        showConfigBrowser={showConfigBrowser}
        onToggleToolsBrowser={() => setShowToolsBrowser(prev => !prev)}
        showToolsBrowser={showToolsBrowser}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {/* Chat History Panel Overlay */}
      {showChatHistory && (
        <ChatHistoryPanel
          onClose={() => setShowChatHistory(false)}
          onResumeSession={handleResumeSession}
        />
      )}

      {/* Config Browser Overlay */}
      {showConfigBrowser && (
        <ConfigBrowser
          onClose={() => setShowConfigBrowser(false)}
        />
      )}

      {/* Tools Browser Overlay */}
      {showToolsBrowser && (
        <ToolsBrowser
          onClose={() => setShowToolsBrowser(false)}
          onRunCommand={handleRunCustomCommand}
        />
      )}

      {/* Update Notification */}
      <UpdateNotification />

      <div className="app-body">
        {/* 主内容区 */}
        <main className={`main-content ${focusMode ? 'focus-mode' : ''}`}>
          {/* 平铺布局 - 始终渲染，通过CSS控制显示 */}
          <TileLayout
            terminals={terminals}
            focusedId={focusedId}
            onCloseTerminal={closeTerminal}
            onRenameTerminal={renameTerminal}
            onFocusTerminal={focusTerminal}
            focusMode={focusMode}
            onToggleFocusModeForTerminal={toggleFocusModeForTerminal}
            theme={theme}
          />

          {/* 空状态 */}
          {terminals.length === 0 && (
            <div className="empty-state">
              <p>没有打开的终端</p>
              <button onClick={() => createTerminal()}>新建终端</button>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
