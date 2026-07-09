import { TerminalPane } from '../Terminal/TerminalPane'
import { TerminalInstance } from '../../App'
import { computeTileLayout, orderForLayout, TileSlot } from '../../utils/tileLayout'

interface TileLayoutProps {
  terminals: TerminalInstance[]
  focusedId: string | null
  onCloseTerminal: (id: string) => void
  onRenameTerminal: (id: string, name: string) => void
  onFocusTerminal: (id: string) => void
  onMinimizeTerminal: (id: string) => void
  onTerminalStateChange: (id: string, state: string) => void
  onTerminalCwdChange: (id: string, cwd: string) => void
  onOpenWorktree: (path: string) => void
  focusMode: boolean
  onToggleFocusModeForTerminal: (id: string) => void
  theme: 'dark' | 'light'
}

export function TileLayout({
  terminals,
  focusedId,
  onCloseTerminal,
  onRenameTerminal,
  onFocusTerminal,
  onMinimizeTerminal,
  onTerminalStateChange,
  onTerminalCwdChange,
  onOpenWorktree,
  focusMode,
  onToggleFocusModeForTerminal,
  theme
}: TileLayoutProps) {
  // 网格只对可见终端计算；最小化终端保持挂载但 display:none（内容零丢失）
  const visibleTerminals = terminals.filter(t => !t.minimized)
  const layout = computeTileLayout(visibleTerminals.length)
  const ordered = orderForLayout(visibleTerminals)
  const slotById = new Map<string, TileSlot>()
  ordered.forEach((t, i) => slotById.set(t.id, layout.slots[i]))

  const gridStyle = layout.cols > 0
    ? {
        gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
        gridTemplateRows: `repeat(${layout.rows}, 1fr)`
      }
    : {}

  return (
    <div
      className={`tile-layout ${focusMode ? 'focus-mode-active' : ''}`}
      style={focusMode ? {} : gridStyle}
    >
      {terminals.map(terminal => {
        const slot = slotById.get(terminal.id)
        const wrapperClass = [
          'terminal-wrapper',
          focusMode ? (terminal.id === focusedId ? 'focused-visible' : 'hidden') : '',
          terminal.minimized ? 'minimized' : ''
        ].filter(Boolean).join(' ')
        return (
          <div
            key={terminal.id}
            className={wrapperClass}
            style={!focusMode && slot ? {
              gridRow: `${slot.row} / span ${slot.rowSpan}`,
              gridColumn: `${slot.col} / span ${slot.colSpan}`
            } : undefined}
          >
            <TerminalPane
              terminal={terminal}
              onClose={() => onCloseTerminal(terminal.id)}
              onRename={(name) => onRenameTerminal(terminal.id, name)}
              onFocus={() => onFocusTerminal(terminal.id)}
              onMinimize={() => onMinimizeTerminal(terminal.id)}
              onStateChange={(state) => onTerminalStateChange(terminal.id, state)}
              onCwdChange={(cwd) => onTerminalCwdChange(terminal.id, cwd)}
              onOpenWorktree={onOpenWorktree}
              isFocused={terminal.id === focusedId}
              isInFocusMode={focusMode && terminal.id === focusedId}
              onToggleFocusMode={() => onToggleFocusModeForTerminal(terminal.id)}
              theme={theme}
            />
          </div>
        )
      })}
    </div>
  )
}
