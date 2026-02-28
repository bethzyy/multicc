import { useEffect, useRef } from 'react'
import { TerminalPane } from '../Terminal/TerminalPane'
import { TerminalInstance } from '../../App'

interface TileLayoutProps {
  terminals: TerminalInstance[]
  focusedId: string | null
  onCloseTerminal: (id: string) => void
  onRenameTerminal: (id: string, name: string) => void
  onFocusTerminal: (id: string) => void
}

export function TileLayout({
  terminals,
  focusedId,
  onCloseTerminal,
  onRenameTerminal,
  onFocusTerminal
}: TileLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // 计算网格布局
  const getGridStyle = () => {
    const count = terminals.length

    if (count === 0) return {}
    if (count === 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' }
    if (count === 2) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' }
    if (count === 3) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }
    if (count === 4) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }

    // 5个或更多：动态计算
    const cols = Math.ceil(Math.sqrt(count))
    const rows = Math.ceil(count / cols)
    return {
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gridTemplateRows: `repeat(${rows}, 1fr)`
    }
  }

  return (
    <div
      ref={containerRef}
      className="tile-layout"
      style={getGridStyle()}
    >
      {terminals.map(terminal => (
        <TerminalPane
          key={terminal.id}
          terminal={terminal}
          onClose={() => onCloseTerminal(terminal.id)}
          onRename={(name) => onRenameTerminal(terminal.id, name)}
          isFocused={terminal.id === focusedId}
        />
      ))}
    </div>
  )
}
