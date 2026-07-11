import { ipcMain } from 'electron'
import { WorktreeManager, WorktreeError } from '../services/worktree/WorktreeManager'
import { ConfigService } from '../services/config'
import { IPC_CHANNELS } from '@shared/constants/channels'

function errorResult(err: unknown): { success: false; code?: string; error: string } {
  if (err instanceof WorktreeError) {
    return { success: false, code: err.code, error: err.message }
  }
  return { success: false, error: err instanceof Error ? err.message : String(err) }
}

/** 破坏性/写操作只接受 UI 约定目录（<repo>/.worktrees/<name>）下的路径，拒绝渲染进程传任意路径 */
function isManagedWorktreePath(p: unknown): p is string {
  return typeof p === 'string' && /[\\/]\.worktrees[\\/][^\\/]+/.test(p)
}

export function registerWorktreeHandlers(configService: ConfigService): void {
  const manager = new WorktreeManager()

  ipcMain.handle(IPC_CHANNELS.WORKTREE.DETECT_REPO, async (_event, cwd: string) => {
    try {
      return await manager.detectRepo(cwd)
    } catch (err) {
      console.error('[Worktree] detectRepo error:', err)
      return { isRepo: false }
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKTREE.LIST, async (_event, repoPath: string) => {
    try {
      const worktrees = await manager.list(repoPath)
      return { worktrees, setup: configService.getWorktreeSetup() }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[Worktree] list error:', message)
      return { worktrees: [], error: message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKTREE.CREATE, async (_event, repoPath: string) => {
    try {
      const setup = configService.getWorktreeSetup()
      const result = await manager.create(repoPath, setup.copyFiles)
      return {
        success: true,
        worktreePath: result.worktreePath,
        branch: result.branch,
        setupCommand: setup.setupCommand,
      }
    } catch (err) {
      console.error('[Worktree] create error:', err)
      return errorResult(err)
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.WORKTREE.RENAME,
    async (_event, worktreePath: string, newBranch: string) => {
      if (!isManagedWorktreePath(worktreePath)) {
        return { success: false, error: 'Path is not a managed worktree' }
      }
      try {
        await manager.rename(worktreePath, newBranch)
        return { success: true }
      } catch (err) {
        console.error('[Worktree] rename error:', err)
        return errorResult(err)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WORKTREE.REMOVE,
    async (_event, worktreePath: string, force?: boolean) => {
      if (!isManagedWorktreePath(worktreePath)) {
        return { success: false, error: 'Path is not a managed worktree' }
      }
      try {
        await manager.remove(worktreePath, force)
        return { success: true }
      } catch (err) {
        console.error('[Worktree] remove error:', err)
        return errorResult(err)
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.WORKTREE.GET_STATUS, async (_event, worktreePath: string) => {
    if (!isManagedWorktreePath(worktreePath)) {
      return { success: false, error: 'Path is not a managed worktree' }
    }
    try {
      const status = await manager.getStatus(worktreePath)
      return { success: true, ...status }
    } catch (err) {
      console.error('[Worktree] getStatus error:', err)
      return errorResult(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKTREE.MERGE, async (_event, worktreePath: string) => {
    if (!isManagedWorktreePath(worktreePath)) {
      return { success: false, error: 'Path is not a managed worktree' }
    }
    try {
      const result = await manager.mergeToMain(worktreePath)
      return { success: true, ...result }
    } catch (err) {
      console.error('[Worktree] merge error:', err)
      return errorResult(err)
    }
  })
}
