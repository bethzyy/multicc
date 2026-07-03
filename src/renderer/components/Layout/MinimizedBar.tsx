import { TerminalInstance } from '../../App'
import { formatCwd } from '../../utils/formatCwd'
import { statusDotClass } from '../../utils/statusDotClass'

interface MinimizedBarProps {
  terminals: TerminalInstance[]
  onRestore: (id: string) => void
}

/**
 * 底部最小化任务栏：每个最小化终端一个胶囊（状态灯 + 名称 + 目录），
 * 点击恢复并聚焦。无最小化终端时不渲染、不占空间。
 */
export function MinimizedBar({ terminals, onRestore }: MinimizedBarProps) {
  if (terminals.length === 0) return null

  return (
    <div className="minimized-bar">
      {terminals.map(t => (
        <button
          key={t.id}
          className="minimized-chip"
          onClick={() => onRestore(t.id)}
          title={t.cwd || t.name}
        >
          <span className={`terminal-status-dot ${statusDotClass(t.state)}`} />
          <span className="minimized-chip-name">{t.name}</span>
          {t.cwd && <span className="minimized-chip-cwd">{formatCwd(t.cwd)}</span>}
        </button>
      ))}
    </div>
  )
}
