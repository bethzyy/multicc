import { useState, useCallback, useEffect, useRef } from 'react'
import { TitleBar } from './components/TitleBar/TitleBar'
import { TileLayout } from './components/Layout/TileLayout'
import { MinimizedBar } from './components/Layout/MinimizedBar'
import { ChatHistoryPanel } from './components/chat'
import { ConfigBrowser } from './components/config'
import { ToolsBrowser } from './components/tools'
import { UpdateNotification } from './components/update/UpdateNotification'
import { useTheme, type Theme } from './hooks/useTheme'
import { playNotificationSound } from './utils/notificationSound'
import { v4 as uuidv4 } from 'uuid'
import type { ChatSource } from '@shared/types/chat.types'
import type { CustomCommand } from '@shared/types/tools.types'

export interface TerminalInstance {
  id: string
  name: string
  cwd: string
  state?: 'running' | 'waiting_input' | 'busy' | 'idle'
  minimized?: boolean
}

function App() {
  const [terminals, setTerminals] = useState<TerminalInstance[]>([])
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [showChatHistory, setShowChatHistory] = useState(false)
  const [showConfigBrowser, setShowConfigBrowser] = useState(false)
  const [showToolsBrowser, setShowToolsBrowser] = useState(false)
  const { theme, toggleTheme } = useTheme()

  // 提示音：记录每个终端上一次的状态，只在"进入 waiting_input"的跃迁时响铃；
  // 3 秒全局冷却防多终端连响。开关读自 ~/.multicc/settings.json 的 soundNotification（默认开）。
  const lastStatesRef = useRef<Map<string, string>>(new Map())
  const lastBeepAtRef = useRef(0)
  const soundEnabledRef = useRef(true)
  useEffect(() => {
    window.electron.resources.getSettings()
      .then((result: { settings: Record<string, unknown> }) => {
        soundEnabledRef.current = result.settings.soundNotification !== false
      })
      .catch(() => {})
  }, [])

  // 创建新终端
  const createTerminal = useCallback((cwd?: string) => {
    console.log('[App] createTerminal called, cwd:', cwd)
    const id = uuidv4()
    const terminal: TerminalInstance = {
      id,
      name: `终端 ${terminals.length + 1}`,
      cwd: cwd || '',
      state: 'running'
    }
    console.log('[App] new terminal:', terminal)
    setTerminals(prev => [...prev, terminal])
    setFocusedId(id)
    return id
  }, [terminals.length])

  // 关闭终端
  const closeTerminal = useCallback((id: string) => {
    lastStatesRef.current.delete(id)
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

  // 最小化终端
  const minimizeTerminal = useCallback((id: string) => {
    setTerminals(prev => prev.map(t => t.id === id ? { ...t, minimized: true } : t))
    // 最小化的是当前焦点终端时，焦点移交给第一个可见终端
    // 读当前 terminals（而非 setTerminals 的 prev），避免在 updater 内部调用其它状态 setter
    if (focusedId === id) {
      const nextVisible = terminals.find(t => t.id !== id && !t.minimized)
      setFocusedId(nextVisible ? nextVisible.id : null)
    }
    // 在聚焦模式中最小化聚焦终端时，退出聚焦模式回到平铺
    if (focusMode && focusedId === id) {
      setFocusMode(false)
    }
  }, [focusedId, focusMode, terminals])

  // 恢复最小化的终端：移到数组末尾（orderForLayout 按数组顺序布局，
  // 所以视觉上自然排在最后位置），并设为焦点。
  const restoreTerminal = useCallback((id: string) => {
    setTerminals(prev => {
      const target = prev.find(t => t.id === id)
      if (!target) return prev
      const filtered = prev.filter(t => t.id !== id)
      return [...filtered, { ...target, minimized: false }]
    })
    setFocusedId(id)
    setFocusMode(false)
  }, [])

  // 聚焦终端
  // 唯一真相是 focusedId；isFocused prop 在 TileLayout 中由 (terminal.id === focusedId) 派生，
  // 不再维护 TerminalInstance.isFocused 字段，避免双源真相的不一致。
  const focusTerminal = useCallback((id: string) => {
    setFocusedId(id)
  }, [])

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

    // If terminal is in a worktree, sync rename to git branch
    if (name) {
      const terminal = terminals.find(t => t.id === id)
      const cwd = terminal?.cwd || ''
      if (cwd.includes('/.worktrees/') || cwd.includes('\\.worktrees\\')) {
        const branchName = name
          .replace(/\s+/g, '-')
          .replace(/[~^:?*[\]\\]/g, '')
          .replace(/\.{2,}/g, '.')
          .replace(/\.lock$/i, '')
          .replace(/^-+|-+$/g, '')
        if (branchName) {
          window.electron.worktree.rename(cwd, branchName)
            .catch((e: unknown) => console.warn('[worktree] rename failed:', e))
        }
      }
    }
  }, [terminals])

  // 终端状态变化
  const handleTerminalStateChange = useCallback((id: string, state: string) => {
    const prevState = lastStatesRef.current.get(id)
    lastStatesRef.current.set(id, state)
    if (state === 'waiting_input' && prevState !== 'waiting_input' && soundEnabledRef.current) {
      const now = Date.now()
      if (now - lastBeepAtRef.current >= 3000) {
        lastBeepAtRef.current = now
        playNotificationSound()
      }
    }
    setTerminals(prev =>
      prev.map(t => t.id === id ? { ...t, state: state as TerminalInstance['state'] } : t)
    )
  }, [])

  // 终端 cwd 变化
  const handleTerminalCwdChange = useCallback((id: string, cwd: string) => {
    setTerminals(prev =>
      prev.map(t => t.id === id ? { ...t, cwd } : t)
    )
  }, [])

  // 任一终端红灯（等待输入）→ 任务栏图标叠加红点；全部消除 → 恢复。
  // 用 ref 去重：只在布尔值翻转时发 IPC，避免每次渲染都发。
  const hasWaitingTerminal = terminals.some(t => t.state === 'waiting_input')
  const prevWaitingRef = useRef(false)
  useEffect(() => {
    if (hasWaitingTerminal !== prevWaitingRef.current) {
      prevWaitingRef.current = hasWaitingTerminal
      window.electron.app.setOverlayBadge(hasWaitingTerminal).catch(() => {})
    }
  }, [hasWaitingTerminal])

  // 在 worktree 路径创建新终端
  const openWorktreeTerminal = useCallback((path: string) => {
    createTerminal(path)
  }, [createTerminal])

  // 初始化：创建第一个终端
  useEffect(() => {
    if (terminals.length === 0) {
      createTerminal()
    }
  }, [])

  const focusedTerminal = terminals.find(t => t.id === focusedId)
  const minimizedTerminals = terminals.filter(t => t.minimized)
  const allMinimized = terminals.length > 0 && minimizedTerminals.length === terminals.length

  // Handle resume session from chat history
  const handleResumeSession = useCallback(async (info: { sessionId: string; cwd: string; source: ChatSource; customTitle?: string }) => {
    console.log('[App] Resume session:', info)

    // Create new terminal with the session's cwd
    const id = uuidv4()
    const terminal: TerminalInstance = {
      id,
      name: info.customTitle || `Session ${info.sessionId.slice(0, 8)}`,
      cwd: info.cwd,
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
          cwd={focusedTerminal?.cwd}
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
            onMinimizeTerminal={minimizeTerminal}
            onTerminalStateChange={handleTerminalStateChange}
            onTerminalCwdChange={handleTerminalCwdChange}
            onOpenWorktree={openWorktreeTerminal}
            focusMode={focusMode}
            onToggleFocusModeForTerminal={toggleFocusModeForTerminal}
            theme={theme}
          />

          {/* 全部最小化时的提示（覆盖在网格区上方） */}
          {allMinimized && (
            <div className="all-minimized-hint">
              <p>所有终端已最小化，点击下方任务栏恢复</p>
            </div>
          )}

          {/* 空状态 */}
          {terminals.length === 0 && (
            <div className="empty-state">
              <p>没有打开的终端</p>
              <button onClick={() => createTerminal()}>新建终端</button>
            </div>
          )}

          {/* 底部最小化任务栏 */}
          <MinimizedBar terminals={minimizedTerminals} onRestore={restoreTerminal} />
        </main>
      </div>
    </div>
  )
}

export default App
