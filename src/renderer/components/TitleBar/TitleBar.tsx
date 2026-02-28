import { useState, useEffect } from 'react'

interface TitleBarProps {
  focusMode: boolean
  onToggleFocusMode: () => void
  onCreateTerminal?: () => void
}

export function TitleBar({
  focusMode,
  onToggleFocusMode,
  onCreateTerminal
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
        {/* 新建终端按钮 */}
        {onCreateTerminal && (
          <button
            className="title-bar-btn new-terminal-btn"
            onClick={handleCreateTerminal}
            title="新建终端"
          >
            + 新建
          </button>
        )}

        {/* Logo */}
        <span className="title-bar-logo">MultiCC</span>
      </div>

      <div className="title-bar-center">
        <span className="title-bar-title">Claude Code 多窗口管理器</span>
      </div>

      <div className="title-bar-right">
        {/* 聚焦模式切换 */}
        <button
          className={`title-bar-btn focus-mode-btn ${focusMode ? 'active' : ''}`}
          onClick={onToggleFocusMode}
          title={focusMode ? '退出聚焦模式' : '聚焦模式'}
        >
          {focusMode ? '⊞' : '◎'}
        </button>

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
