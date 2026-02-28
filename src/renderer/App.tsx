import { useState, useCallback, useEffect } from 'react'
import { TitleBar } from './components/TitleBar/TitleBar'
import { TileLayout } from './components/Layout/TileLayout'
import { v4 as uuidv4 } from 'uuid'

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

  // 创建新终端
  const createTerminal = useCallback((cwd?: string) => {
    console.log('[App] createTerminal called, cwd:', cwd)
    const id = uuidv4()
    const terminal: TerminalInstance = {
      id,
      name: `终端 ${terminals.length + 1}`,
      cwd: cwd || ''
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

  return (
    <div className="app">
      <TitleBar
        focusMode={focusMode}
        onToggleFocusMode={toggleFocusMode}
        onCreateTerminal={createTerminal}
      />

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
