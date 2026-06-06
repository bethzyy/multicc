import { ipcMain } from 'electron'
import { WorktreeManager } from '../services/worktree/WorktreeManager'
import { IPC_CHANNELS } from '@shared/constants/channels'

export function registerWorktreeHandlers(): void {
  const manager = new WorktreeManager()

  ipcMain.handle(IPC_CHANNELS.WORKTREE.DETECT_REPO, async (_event, cwd: string) => {
    try {
      const result = await manager.detectRepo(cwd)
      return result
    } catch (err) {
      console.error('[Worktree] detectRepo error:', err)
      return { isRepo: false }
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKTREE.LIST, async (_event, repoPath: string) => {
    try {
      const worktrees = await manager.list(repoPath)
      return worktrees
    } catch (err) {
      console.error('[Worktree] list error:', err)
      return []
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKTREE.CREATE, async (_event, repoPath: string) => {
    try {
      const result = await manager.create(repoPath)
      return { success: true, worktreePath: result.worktreePath, branch: result.branch }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[Worktree] create error:', message)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.WORKTREE.RENAME,
    async (_event, worktreePath: string, newBranch: string) => {
      try {
        await manager.rename(worktreePath, newBranch)
        return { success: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[Worktree] rename error:', message)
        return { success: false, error: message }
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WORKTREE.REMOVE,
    async (_event, worktreePath: string, force?: boolean) => {
      try {
        await manager.remove(worktreePath, force)
        return { success: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[Worktree] remove error:', message)
        return { success: false, error: message }
      }
    }
  )
}
