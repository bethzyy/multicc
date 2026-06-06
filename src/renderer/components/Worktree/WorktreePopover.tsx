import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { WorktreeInfo } from '@shared/types/worktree.types'
import './WorktreePopover.css'

interface Props {
  terminalCwd: string
  open: boolean
  anchorRect: { top: number; left: number } | null
  onClose: () => void
  onOpenWorktree: (path: string) => void
}

export function WorktreePopover({
  terminalCwd,
  open,
  anchorRect,
  onClose,
  onOpenWorktree,
}: Props) {
  const popupRef = useRef<HTMLDivElement>(null)
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const detectResult = await window.electron.worktree.detectRepo(terminalCwd)
        if (cancelled) return
        if (!detectResult.isRepo) {
          setError('Not a git repository')
          setLoading(false)
          return
        }
        const repo = detectResult.repoPath!
        setRepoPath(repo)

        const list = await window.electron.worktree.list(repo)
        if (cancelled) return
        setWorktrees(list)
      } catch (e) {
        if (!cancelled) setError(String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [open, terminalCwd])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [open, onClose])

  const handleCreate = useCallback(async () => {
    if (!repoPath || creating) return
    setCreating(true)
    setError(null)
    try {
      const result = await window.electron.worktree.create(repoPath)
      if (result.success && result.worktreePath) {
        onOpenWorktree(result.worktreePath)
        onClose()
        const list = await window.electron.worktree.list(repoPath)
        setWorktrees(list)
      } else {
        setError(result.error || 'Failed to create worktree')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }, [repoPath, creating, onOpenWorktree, onClose])

  const handleDelete = useCallback(async (wt: WorktreeInfo) => {
    if (!repoPath) return
    setError(null)
    try {
      const result = await window.electron.worktree.remove(wt.path, true)
      if (result.success) {
        const list = await window.electron.worktree.list(repoPath)
        setWorktrees(list)
      } else {
        setError(result.error || 'Failed to delete worktree')
      }
    } catch (e) {
      setError(String(e))
    }
  }, [repoPath])

  const handleWorktreeClick = useCallback(async (wt: WorktreeInfo) => {
    onOpenWorktree(wt.path)
    onClose()
  }, [onOpenWorktree, onClose])

  if (!open || !anchorRect) return null

  const popoverWidth = 280
  let top = anchorRect.top
  let left = anchorRect.left

  if (left + popoverWidth > window.innerWidth) {
    left = window.innerWidth - popoverWidth - 8
  }
  if (left < 8) left = 8

  const currentWorktree = worktrees.find(
    (wt) => terminalCwd === wt.path || terminalCwd.startsWith(wt.path + '/') || terminalCwd.startsWith(wt.path + '\\')
  )

  const mainBranch = worktrees.find(wt => wt.isMain)?.branch || 'main'

  return createPortal(
    <div className="worktree-popover-overlay" onClick={onClose}>
      <div
        className="worktree-popover"
        ref={popupRef}
        style={{ top, left }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="worktree-popover__header">Worktrees</div>

        {!loading && !error && repoPath && (
          <>
            <button
              className="worktree-popover__create"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? 'Creating...' : `+ New Worktree (from ${mainBranch})`}
            </button>
            <div className="worktree-popover__divider" />
          </>
        )}

        {loading && (
          <div className="worktree-popover__loading">Loading...</div>
        )}

        {error && (
          <div className="worktree-popover__error">{error}</div>
        )}

        {!loading && !error && (
          <div className="worktree-popover__list">
            {[...worktrees.filter(wt => wt.isMain), ...worktrees.filter(wt => !wt.isMain).reverse()].map((wt) => {
              const isCurrent = currentWorktree?.path === wt.path
              return (
                <button
                  key={wt.path}
                  className={`worktree-popover__item${isCurrent ? ' worktree-popover__item--current' : ''}`}
                  onClick={() => handleWorktreeClick(wt)}
                  title={wt.path}
                >
                  <span className={`worktree-popover__dot${wt.isMain ? ' worktree-popover__dot--main' : ''}`} />
                  <span className="worktree-popover__branch">{wt.branch}</span>
                  {isCurrent && <span className="worktree-popover__badge worktree-popover__badge--current">current</span>}
                  {wt.isMerged && !wt.isMain && (
                    <span className="worktree-popover__badge worktree-popover__badge--merged">merged</span>
                  )}
                  {!wt.isMain && (
                    <button
                      className="worktree-popover__delete"
                      onClick={(e) => { e.stopPropagation(); handleDelete(wt) }}
                      title="Delete worktree"
                    >
                      &#x2715;
                    </button>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
