import { useState, useEffect } from 'react'
import { TerminalInstance } from '../../App'

interface SidebarProps {
  terminals: TerminalInstance[]
  focusedId: string | null
  collapsed: boolean
  onCreateTerminal: (cwd?: string) => string
  onFocusTerminal: (id: string) => void
  onCloseTerminal: (id: string) => void
  onRenameTerminal: (id: string, name: string) => void
}

export function Sidebar({
  terminals,
  focusedId,
  collapsed,
  onCreateTerminal,
  onFocusTerminal,
  onCloseTerminal,
  onRenameTerminal
}: SidebarProps) {
  const [workingDirs, setWorkingDirs] = useState<string[]>([])
  const [sessions, setSessions] = useState<unknown[]>([])

  // 加载工作目录
  useEffect(() => {
    window.electron.config.getWorkingDirs().then((dirs: string[]) => {
      setWorkingDirs(dirs)
    })
  }, [])

  // 创建终端并切换到指定目录
  const handleCreateInDir = (cwd: string) => {
    onCreateTerminal(cwd)
  }

  if (collapsed) {
    return (
      <aside className="sidebar collapsed">
        <button
          className="sidebar-btn"
          onClick={() => onCreateTerminal()}
          title="新建终端"
        >
          +
        </button>
      </aside>
    )
  }

  return (
    <aside className="sidebar">
      {/* 终端列表 */}
      <div className="sidebar-section">
        <h3 className="sidebar-title">终端</h3>
        <ul className="terminal-list">
          {terminals.map(terminal => (
            <li
              key={terminal.id}
              className={`terminal-item ${terminal.id === focusedId ? 'active' : ''}`}
              onClick={() => onFocusTerminal(terminal.id)}
            >
              <span className="terminal-icon">⬡</span>
              <span className="terminal-name">{terminal.name}</span>
              <button
                className="close-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTerminal(terminal.id)
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* 工作目录快捷方式 */}
      {workingDirs.length > 0 && (
        <div className="sidebar-section">
          <h3 className="sidebar-title">工作目录</h3>
          <ul className="dir-list">
            {workingDirs.map((dir, index) => (
              <li
                key={index}
                className="dir-item"
                onClick={() => handleCreateInDir(dir)}
                title={dir}
              >
                📁 {dir.split(/[/\\]/).pop()}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 底部状态 */}
      <div className="sidebar-footer">
        <span className="terminal-count">{terminals.length} 个终端</span>
      </div>
    </aside>
  )
}
