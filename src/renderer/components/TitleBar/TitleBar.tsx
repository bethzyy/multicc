import { useState, useEffect } from 'react'

interface TitleBarProps {
  focusMode: boolean
  onToggleFocusMode: () => void
  onCreateTerminal?: () => void
  onToggleChatHistory?: () => void
  showChatHistory?: boolean
  onToggleConfigBrowser?: () => void
  showConfigBrowser?: boolean
  onToggleToolsBrowser?: () => void
  showToolsBrowser?: boolean
  theme?: 'dark' | 'light'
  onToggleTheme?: () => void
}

export function TitleBar({
  focusMode,
  onToggleFocusMode,
  onCreateTerminal,
  onToggleChatHistory,
  showChatHistory,
  onToggleConfigBrowser,
  showConfigBrowser,
  onToggleToolsBrowser,
  showToolsBrowser,
  theme = 'dark',
  onToggleTheme
}: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false)

  const handleCreateTerminal = () => {
    console.log('[TitleBar] handleCreateTerminal clicked')
    if (onCreateTerminal) {
      onCreateTerminal()
    }
  }

  useEffect(() => {
    // 检查窗口是否最大化
    window.electron.window.isMaximized().then((maximized: boolean) => {
      setIsMaximized(maximized)
    })
  }, [])

  const handleMinimize = () => {
    window.electron.window.minimize()
  }

  const handleMaximize = async () => {
    await window.electron.window.maximize()
    const maximized = await window.electron.window.isMaximized()
    setIsMaximized(maximized)
  }

  const handleClose = () => {
    window.electron.window.close()
  }

  return (
    <div className="title-bar">
      <div className="title-bar-left">
        {/* Logo */}
        <span className="title-bar-logo">MultiCC</span>

        {/* 新建终端按钮 - 移到 Logo 右侧 */}
        {onCreateTerminal && (
          <button
            className="title-bar-btn new-terminal-btn"
            onClick={handleCreateTerminal}
            title="新建终端"
          >
            + 新建
          </button>
        )}
      </div>

      <div className="title-bar-center">
        <span className="title-bar-title">Claude Code 多窗口管理器</span>
      </div>

      <div className="title-bar-right">
        {/* 聊天历史按钮 */}
        {onToggleChatHistory && (
          <button
            className={`title-bar-btn chat-history-btn ${showChatHistory ? 'active' : ''}`}
            onClick={onToggleChatHistory}
            title="聊天历史 (Ctrl+H)"
          >
            📋
          </button>
        )}

        {/* 配置浏览器按钮 */}
        {onToggleConfigBrowser && (
          <button
            className={`title-bar-btn config-browser-btn ${showConfigBrowser ? 'active' : ''}`}
            onClick={onToggleConfigBrowser}
            title="Skills & MCP (Ctrl+Shift+S)"
          >
            ⚙️
          </button>
        )}

        {/* 工具浏览器按钮 */}
        {onToggleToolsBrowser && (
          <button
            className={`title-bar-btn tools-browser-btn ${showToolsBrowser ? 'active' : ''}`}
            onClick={onToggleToolsBrowser}
            title="CLI 工具管理 (Ctrl+Shift+T)"
          >
            🔧
          </button>
        )}

        {/* 聚焦模式切换 */}
        <button
          className={`title-bar-btn focus-mode-btn ${focusMode ? 'active' : ''}`}
          onClick={onToggleFocusMode}
          title={focusMode ? '退出聚焦模式' : '聚焦模式'}
        >
          {focusMode ? '⊞' : '◎'}
        </button>

        {/* 主题切换按钮 */}
        {onToggleTheme && (
          <button
            className="title-bar-btn theme-toggle-btn"
            onClick={onToggleTheme}
            title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        )}

        {/* 窗口控制按钮 */}
        <button className="title-bar-btn minimize" onClick={handleMinimize}>
          ─
        </button>
        <button className="title-bar-btn maximize" onClick={handleMaximize}>
          {isMaximized ? '❐' : '□'}
        </button>
        <button className="title-bar-btn close" onClick={handleClose}>
          ✕
        </button>
      </div>
    </div>
  )
}
