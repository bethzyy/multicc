import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, appendFile, mkdir, copyFile, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  WorktreeInfo,
  WorktreeErrorCode,
  WorktreeStatus,
} from '@shared/types/worktree.types'
import { isSamePath } from '@shared/utils/path'

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: 15_000,
    windowsHide: true,
  })
  return stdout.trim()
}

/** 带错误码的操作错误，IPC 层透传 code 供 UI 做针对性提示 */
export class WorktreeError extends Error {
  constructor(
    public readonly code: WorktreeErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'WorktreeError'
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 分支名可用于 rev-list/merged 比较（排除 detached/未知占位值） */
function isRealBranch(branch: string): boolean {
  return !!branch && branch !== 'HEAD' && !branch.startsWith('(')
}

function parseWorktreeList(output: string, repoPath: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = []
  const blocks = output.split('\n\n').filter(Boolean)
  for (const block of blocks) {
    const lines = block.split('\n')
    let path = ''
    let branch = ''
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length)
      } else if (line.startsWith('branch ')) {
        branch = line.slice('branch '.length).replace('refs/heads/', '')
      } else if (line === 'detached') {
        branch = '(detached)'
      }
    }
    if (path) {
      worktrees.push({
        path,
        branch: branch || '(unknown)',
        // git 保证主 worktree 排第一；isSamePath 兼容正反斜杠/盘符大小写
        isMain: worktrees.length === 0 || isSamePath(path, repoPath),
        isMerged: false,
      })
    }
  }
  return worktrees
}

/**
 * 把 .worktrees/ 写入 .git/info/exclude（纯本地忽略），
 * 而不是修改用户被跟踪的 .gitignore（会弄脏工作区）。
 */
async function ensureExclude(repoPath: string): Promise<void> {
  const gitCommonDir = await git(repoPath, ['rev-parse', '--git-common-dir'])
  const infoDir = join(resolve(repoPath, gitCommonDir), 'info')
  const excludePath = join(infoDir, 'exclude')
  const entry = '/.worktrees/'

  let content = ''
  try {
    content = await readFile(excludePath, 'utf-8')
  } catch {
    /* 文件不存在，稍后创建 */
  }
  const covered = content
    .split('\n')
    .some((line) => ['/.worktrees/', '.worktrees/', '.worktrees'].includes(line.trim()))
  if (covered) return

  await mkdir(infoDir, { recursive: true })
  const prefix = content && !content.endsWith('\n') ? '\n' : ''
  await appendFile(excludePath, `${prefix}${entry}\n`)
}

function nextWorktreeNumber(
  worktrees: WorktreeInfo[],
  gitBranches: string[] = [],
  existingDirs: string[] = []
): number {
  const pattern = /^(wt|worktree)-\d+$/
  const toNum = (s: string): number => parseInt(s.replace(/^(wt|worktree)-/, ''), 10)
  const all = [
    ...new Set(
      [...worktrees.map((wt) => wt.branch), ...gitBranches, ...existingDirs]
        .filter((s) => pattern.test(s))
        .map(toNum)
    ),
  ]
  if (all.length === 0) return 1
  return Math.max(...all) + 1
}

export class WorktreeManager {
  /** 主 worktree 路径 = worktree list 第一条（git 保证），从任意 worktree/子目录内均可反查 */
  private async mainRepoOf(path: string): Promise<string> {
    const out = await git(path, ['worktree', 'list', '--porcelain'])
    const first = out.split('\n').find((l) => l.startsWith('worktree '))
    if (!first) throw new WorktreeError('GIT_ERROR', 'Cannot locate main worktree')
    return first.slice('worktree '.length)
  }

  async detectRepo(
    cwd: string
  ): Promise<{ isRepo: boolean; repoPath?: string; branch?: string }> {
    let repoPath: string
    try {
      repoPath = await git(cwd, ['rev-parse', '--show-toplevel'])
    } catch {
      return { isRepo: false }
    }
    try {
      // 比 --git-common-dir 推导更可靠：后者返回的相对路径基准是 cwd，
      // 且 resolve(gitDir, '..') 假设 .git 位于仓库根（submodule/GIT_DIR 场景失效）
      repoPath = await this.mainRepoOf(cwd)
    } catch {
      /* 回退 --show-toplevel 结果 */
    }
    let branch: string | undefined
    try {
      branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
    } catch {
      /* 空仓库无提交 */
    }
    return { isRepo: true, repoPath, branch }
  }

  /** 列出所有 worktree；git 失败时抛错（由 IPC 层转为 { error } 返回，UI 可区分"无 worktree"与"出错"） */
  async list(repoPath: string): Promise<WorktreeInfo[]> {
    const output = await git(repoPath, ['worktree', 'list', '--porcelain'])
    const worktrees = parseWorktreeList(output, repoPath)
    const mainWt = worktrees.find((wt) => wt.isMain)
    const mainBranch = mainWt && isRealBranch(mainWt.branch) ? mainWt.branch : null

    if (mainBranch) {
      try {
        const merged = await git(repoPath, ['branch', '--merged', mainBranch])
        const mergedBranches = merged
          .split('\n')
          .map((b) => b.replace(/^[*+]?\s+/, '').trim())
          .filter(Boolean)
        for (const wt of worktrees) {
          wt.isMerged = !wt.isMain && mergedBranches.includes(wt.branch)
        }
      } catch {
        /* ignore */
      }
    }

    // 每个非 main worktree 补充脏文件数与 ahead/behind（单条失败不影响整体）
    await Promise.all(
      worktrees
        .filter((wt) => !wt.isMain)
        .map(async (wt) => {
          try {
            const dirty = await git(wt.path, ['status', '--porcelain'])
            wt.dirtyCount = dirty ? dirty.split('\n').filter(Boolean).length : 0
          } catch {
            /* ignore */
          }
          if (mainBranch && isRealBranch(wt.branch) && wt.branch !== mainBranch) {
            try {
              const counts = await git(repoPath, [
                'rev-list',
                '--left-right',
                '--count',
                `${mainBranch}...${wt.branch}`,
              ])
              const [behind, ahead] = counts.split(/\s+/).map((n) => parseInt(n, 10))
              if (!Number.isNaN(behind)) wt.behind = behind
              if (!Number.isNaN(ahead)) wt.ahead = ahead
            } catch {
              /* ignore */
            }
          }
        })
    )
    return worktrees
  }

  /** 删除前的风险评估：脏文件数 + 未合并进主分支的提交数 */
  async getStatus(worktreePath: string): Promise<WorktreeStatus> {
    const dirty = await git(worktreePath, ['status', '--porcelain'])
    const dirtyCount = dirty ? dirty.split('\n').filter(Boolean).length : 0

    let branch = ''
    try {
      branch = await git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    } catch {
      /* ignore */
    }

    let unmergedCount = 0
    try {
      const repoPath = await this.mainRepoOf(worktreePath)
      const mainBranch = await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
      if (isRealBranch(branch) && isRealBranch(mainBranch) && branch !== mainBranch) {
        const count = await git(worktreePath, [
          'rev-list',
          '--count',
          `${mainBranch}..${branch}`,
        ])
        unmergedCount = parseInt(count, 10) || 0
      }
    } catch {
      /* ignore */
    }
    return { dirtyCount, unmergedCount, branch }
  }

  /**
   * 新建 worktree（分支 wt-N，基于主 worktree 当前 HEAD），
   * 并把 copyFiles 中存在于仓库根、且新 worktree 缺失的文件拷过去（如 .env）。
   */
  async create(
    repoPath: string,
    copyFiles: string[] = []
  ): Promise<{ worktreePath: string; branch: string }> {
    try {
      await ensureExclude(repoPath)
    } catch (err) {
      console.warn('[Worktree] ensureExclude failed:', errMessage(err))
    }
    try {
      await git(repoPath, ['worktree', 'prune'])
    } catch {
      /* ignore */
    }

    const existing = await this.list(repoPath)
    let gitBranches: string[] = []
    try {
      const branchOutput = await git(repoPath, ['branch', '--list', 'wt-*'])
      gitBranches = branchOutput
        .split('\n')
        .map((b) => b.replace(/^[*+]?\s+/, '').trim())
        .filter(Boolean)
    } catch {
      /* ignore */
    }

    const worktreesDir = join(repoPath, '.worktrees')
    let existingDirs: string[] = []
    try {
      const entries = await readdir(worktreesDir, { withFileTypes: true })
      existingDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      /* 目录可能不存在 */
    }

    const num = nextWorktreeNumber(existing, gitBranches, existingDirs)
    const branch = `wt-${num}`
    const worktreePath = join(worktreesDir, branch)

    await git(repoPath, ['worktree', 'add', '-b', branch, worktreePath])

    for (const file of copyFiles) {
      // 只接受根目录下的裸文件名，拒绝路径穿越
      if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) continue
      try {
        // COPYFILE_EXCL：被跟踪文件 checkout 时已存在，不覆盖
        await copyFile(join(repoPath, file), join(worktreePath, file), constants.COPYFILE_EXCL)
      } catch {
        /* 源不存在或目标已存在 */
      }
    }

    return { worktreePath, branch }
  }

  async rename(worktreePath: string, newBranchName: string): Promise<void> {
    await git(worktreePath, ['check-ref-format', '--branch', newBranchName])
    const oldBranch = await git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (oldBranch === newBranchName) return
    await git(worktreePath, ['branch', '-m', oldBranch, newBranchName])
  }

  /**
   * 删除 worktree。默认不 force：有未提交改动时抛 DIRTY，由 UI 确认后再以 force 重试。
   * force 删除（用户已确认）连同分支一起强删；普通删除只做安全删（-d，未合并则保留分支）。
   */
  async remove(worktreePath: string, force?: boolean): Promise<void> {
    const repoPath = await this.mainRepoOf(worktreePath)
    if (isSamePath(repoPath, worktreePath)) {
      throw new WorktreeError('GIT_ERROR', 'Cannot remove the main worktree')
    }

    let branch: string | null = null
    try {
      branch = await git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    } catch {
      /* ignore */
    }

    const args = ['worktree', 'remove']
    if (force) args.push('--force')
    args.push(worktreePath)
    try {
      await git(repoPath, args)
    } catch (err) {
      const msg = errMessage(err)
      if (/contains modified or untracked files/i.test(msg)) {
        throw new WorktreeError('DIRTY', msg)
      }
      if (/EBUSY|being used by another process|resource busy|permission denied|unable to remove|directory not empty/i.test(msg)) {
        throw new WorktreeError('LOCKED', msg)
      }
      throw new WorktreeError('GIT_ERROR', msg)
    }

    if (branch && isRealBranch(branch)) {
      try {
        await git(repoPath, ['branch', force ? '-D' : '-d', branch])
      } catch {
        /* 未合并且非 force：保留分支 */
      }
    }
  }

  /**
   * 把 worktree 分支 squash merge 回主分支（保守版）：
   * 双方必须干净；冲突时自动 reset --merge 回滚并抛 CONFLICT。
   * 返回 merged=false 表示无差异（早已合并）。
   */
  async mergeToMain(worktreePath: string): Promise<{ merged: boolean; mainBranch: string }> {
    const repoPath = await this.mainRepoOf(worktreePath)
    if (isSamePath(repoPath, worktreePath)) {
      throw new WorktreeError('GIT_ERROR', 'Cannot merge the main worktree into itself')
    }
    if (await git(repoPath, ['status', '--porcelain'])) {
      throw new WorktreeError('MAIN_DIRTY', 'Main worktree has uncommitted changes')
    }
    if (await git(worktreePath, ['status', '--porcelain'])) {
      throw new WorktreeError('WT_DIRTY', 'Worktree has uncommitted changes, commit them first')
    }

    const branch = await git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const mainBranch = await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (!isRealBranch(branch) || !isRealBranch(mainBranch)) {
      throw new WorktreeError('DETACHED', 'Detached HEAD, cannot merge')
    }

    try {
      await git(repoPath, ['merge', '--squash', branch])
    } catch (err) {
      try {
        await git(repoPath, ['reset', '--merge'])
      } catch {
        /* ignore */
      }
      throw new WorktreeError('CONFLICT', errMessage(err))
    }

    const staged = await git(repoPath, ['status', '--porcelain'])
    if (!staged) return { merged: false, mainBranch }

    try {
      await git(repoPath, ['commit', '-m', `squash merge ${branch}`])
    } catch (err) {
      // commit 失败（如缺 user.name）时回滚暂存区，保持主仓库干净
      try {
        await git(repoPath, ['reset', '--merge'])
      } catch {
        /* ignore */
      }
      throw new WorktreeError('GIT_ERROR', errMessage(err))
    }
    return { merged: true, mainBranch }
  }
}
