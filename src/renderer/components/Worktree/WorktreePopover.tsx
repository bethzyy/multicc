import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { WorktreeInfo, WorktreeSetup, WorktreeErrorCode } from '@shared/types/worktree.types'
import { isSamePath, isPathInside } from '@shared/utils/path'
import './WorktreePopover.css'

interface Props {
  terminalCwd: string
  open: boolean
  anchorRect: { top: number; left: number } | null
  onClose: () => void
  onOpenWorktree: (path: string, setupCommand?: string) => void
  /** 所有已打开终端的 cwd，用于删除前检测占用 */
  openTerminalCwds: string[]
}

interface ConfirmState {
  type: 'delete' | 'merge'
  path: string
  message: string
}

const ERROR_HINTS: Partial<Record<WorktreeErrorCode, string>> = {
  DIRTY: '有未提交改动，删除需确认',
  LOCKED: '目录被占用，请先关闭其中运行的终端或程序',
  MAIN_DIRTY: '主 worktree 有未提交改动，请先提交或暂存',
  WT_DIRTY: '该 worktree 有未提交改动，请先 commit',
  CONFLICT: '合并冲突，已自动回滚，请手动合并',
  DETACHED: '处于 detached HEAD，无法操作分支',
}

function friendlyError(code?: WorktreeErrorCode, fallback?: string): string {
  return (code && ERROR_HINTS[code]) || fallback || '操作失败'
}

export function WorktreePopover({
  terminalCwd,
  open,
  anchorRect,
  onClose,
  onOpenWorktree,
  openTerminalCwds,
}: Props) {
  const popupRef = useRef<HTMLDivElement>(null)
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [setup, setSetup] = useState<WorktreeSetup | null>(null)
  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async (repo: string) => {
    const res = await window.electron.worktree.list(repo)
    setWorktrees(res.worktrees)
    setSetup(res.setup ?? null)
    if (res.error) setError(res.error)
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError(null)
      setNotice(null)
      setConfirm(null)
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

        const res = await window.electron.worktree.list(repo)
        if (cancelled) return
        setWorktrees(res.worktrees)
        setSetup(res.setup ?? null)
        if (res.error) setError(res.error)
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
    setNotice(null)
    try {
      const result = await window.electron.worktree.create(repoPath)
      if (result.success && result.worktreePath) {
        onOpenWorktree(result.worktreePath, result.setupCommand)
        onClose()
      } else {
        setError(friendlyError(result.code, result.error))
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }, [repoPath, creating, onOpenWorktree, onClose])

  // 第一段：占用检测 + 风险评估。干净则直接删（非 force），有风险则要求确认。
  const handleDelete = useCallback(async (wt: WorktreeInfo) => {
    if (!repoPath || busyPath) return
    setError(null)
    setNotice(null)
    setConfirm(null)

    const openCount = openTerminalCwds.filter((c) => c && isPathInside(c, wt.path)).length
    if (openCount > 0) {
      setError(`该 worktree 中有 ${openCount} 个终端正在运行，请先关闭`)
      return
    }

    setBusyPath(wt.path)
    try {
      const status = await window.electron.worktree.getStatus(wt.path)
      if (!status.success) {
        setError(friendlyError(status.code, status.error))
        return
      }
      const dirty = status.dirtyCount ?? 0
      const unmerged = status.unmergedCount ?? 0
      if (dirty > 0 || unmerged > 0) {
        const parts: string[] = []
        if (dirty > 0) parts.push(`${dirty} 个未提交文件`)
        if (unmerged > 0) parts.push(`${unmerged} 个未合并提交`)
        setConfirm({
          type: 'delete',
          path: wt.path,
          message: `${parts.join('、')}将永久丢失，分支 ${wt.branch} 将被删除`,
        })
        return
      }
      const result = await window.electron.worktree.remove(wt.path, false)
      if (result.success) {
        await refresh(repoPath)
      } else if (result.code === 'DIRTY') {
        // 状态检查与删除之间产生了新改动，转确认流程
        setConfirm({
          type: 'delete',
          path: wt.path,
          message: `未提交改动将永久丢失，分支 ${wt.branch} 将被删除`,
        })
      } else {
        setError(friendlyError(result.code, result.error))
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setBusyPath(null)
    }
  }, [repoPath, busyPath, openTerminalCwds, refresh])

  // 第二段：用户已确认，force 删除并连带删分支
  const confirmDelete = useCallback(async (wt: WorktreeInfo) => {
    if (!repoPath || busyPath) return
    setConfirm(null)
    setBusyPath(wt.path)
    try {
      const result = await window.electron.worktree.remove(wt.path, true)
      if (result.success) {
        await refresh(repoPath)
      } else {
        setError(friendlyError(result.code, result.error))
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setBusyPath(null)
    }
  }, [repoPath, busyPath, refresh])

  const handleMerge = useCallback((wt: WorktreeInfo, mainBranch: string) => {
    setError(null)
    setNotice(null)
    setConfirm({
      type: 'merge',
      path: wt.path,
      message: `Squash merge ${wt.branch} → ${mainBranch}?`,
    })
  }, [])

  const confirmMerge = useCallback(async (wt: WorktreeInfo) => {
    if (!repoPath || busyPath) return
    setConfirm(null)
    setBusyPath(wt.path)
    try {
      const result = await window.electron.worktree.merge(wt.path)
      if (result.success) {
        setNotice(
          result.merged
            ? `已合并 ${wt.branch} → ${result.mainBranch}，可删除该 worktree`
            : `${wt.branch} 与主分支无差异，无需合并`
        )
        await refresh(repoPath)
      } else {
        setError(friendlyError(result.code, result.error))
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setBusyPath(null)
    }
  }, [repoPath, busyPath, refresh])

  const handleWorktreeClick = useCallback((wt: WorktreeInfo) => {
    onOpenWorktree(wt.path)
    onClose()
  }, [onOpenWorktree, onClose])

  if (!open || !anchorRect) return null

  const popoverWidth = 280
  const top = anchorRect.top
  let left = anchorRect.left

  if (left + popoverWidth > window.innerWidth) {
    left = window.innerWidth - popoverWidth - 8
  }
  if (left < 8) left = 8

  const currentWorktree = worktrees.find((wt) => isPathInside(terminalCwd, wt.path))
  const mainBranch = worktrees.find((wt) => wt.isMain)?.branch || 'main'
  const setupHint = setup && (setup.copyFiles.length > 0 || setup.setupCommand)
    ? [
        setup.copyFiles.length > 0 ? `拷贝 ${setup.copyFiles.join(', ')}` : '',
        setup.setupCommand ? `运行 ${setup.setupCommand}` : '',
      ].filter(Boolean).join(' · ')
    : null

  return createPortal(
    <div className="worktree-popover-overlay" onClick={onClose}>
      <div
        className="worktree-popover"
        ref={popupRef}
        style={{ top, left }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="worktree-popover__header">Worktrees</div>

        {!loading && repoPath && (
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
        {notice && (
          <div className="worktree-popover__notice">{notice}</div>
        )}

        {!loading && (
          <div className="worktree-popover__list">
            {[...worktrees.filter(wt => wt.isMain), ...worktrees.filter(wt => !wt.isMain).reverse()].map((wt) => {
              const isCurrent = currentWorktree ? isSamePath(currentWorktree.path, wt.path) : false
              const isBusy = busyPath === wt.path
              const wtConfirm = confirm && isSamePath(confirm.path, wt.path) ? confirm : null
              return (
                <div key={wt.path} className="worktree-popover__entry">
                  <button
                    className={`worktree-popover__item${isCurrent ? ' worktree-popover__item--current' : ''}`}
                    onClick={() => handleWorktreeClick(wt)}
                    disabled={isBusy}
                    title={wt.path}
                  >
                    <span className={`worktree-popover__dot${wt.isMain ? ' worktree-popover__dot--main' : ''}`} />
                    <span className="worktree-popover__branch">{wt.branch}</span>
                    {typeof wt.dirtyCount === 'number' && wt.dirtyCount > 0 && (
                      <span className="worktree-popover__stat worktree-popover__stat--dirty" title="未提交文件数">●{wt.dirtyCount}</span>
                    )}
                    {typeof wt.ahead === 'number' && wt.ahead > 0 && (
                      <span className="worktree-popover__stat" title={`领先 ${mainBranch} 的提交数`}>↑{wt.ahead}</span>
                    )}
                    {typeof wt.behind === 'number' && wt.behind > 0 && (
                      <span className="worktree-popover__stat" title={`落后 ${mainBranch} 的提交数`}>↓{wt.behind}</span>
                    )}
                    {isCurrent && <span className="worktree-popover__badge worktree-popover__badge--current">current</span>}
                    {wt.isMerged && !wt.isMain && (
                      <span className="worktree-popover__badge worktree-popover__badge--merged">merged</span>
                    )}
                    {!wt.isMain && (
                      <>
                        <span
                          role="button"
                          className="worktree-popover__action"
                          onClick={(e) => { e.stopPropagation(); handleMerge(wt, mainBranch) }}
                          title={`Squash merge → ${mainBranch}`}
                        >
                          &#x21E7;
                        </span>
                        <span
                          role="button"
                          className="worktree-popover__action worktree-popover__action--delete"
                          onClick={(e) => { e.stopPropagation(); handleDelete(wt) }}
                          title="Delete worktree"
                        >
                          &#x2715;
                        </span>
                      </>
                    )}
                  </button>
                  {wtConfirm && (
                    <div className="worktree-popover__confirm">
                      <div className="worktree-popover__confirm-msg">{wtConfirm.message}</div>
                      <div className="worktree-popover__confirm-actions">
                        <button
                          className={`worktree-popover__confirm-btn${wtConfirm.type === 'delete' ? ' worktree-popover__confirm-btn--danger' : ''}`}
                          onClick={() => wtConfirm.type === 'delete' ? confirmDelete(wt) : confirmMerge(wt)}
                        >
                          {wtConfirm.type === 'delete' ? '确认删除' : '确认合并'}
                        </button>
                        <button
                          className="worktree-popover__confirm-btn"
                          onClick={() => setConfirm(null)}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!loading && setupHint && (
          <div className="worktree-popover__footer" title="config.json 的 worktreeSetup 字段可自定义">
            新建后: {setupHint}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
