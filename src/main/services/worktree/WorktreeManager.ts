import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, appendFile, access, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { WorktreeInfo } from '@shared/types/worktree.types'

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: 15_000,
    windowsHide: true,
  })
  return stdout.trim()
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
        isMain: path === repoPath,
        isMerged: false,
      })
    }
  }
  return worktrees
}

async function ensureGitignore(repoPath: string): Promise<void> {
  const gitignorePath = join(repoPath, '.gitignore')
  const entry = '.worktrees/'
  try {
    await access(gitignorePath)
    const content = await readFile(gitignorePath, 'utf-8')
    if (content.includes(entry)) return
    const prefix = content.endsWith('\n') ? '' : '\n'
    await appendFile(gitignorePath, `${prefix}${entry}\n`)
  } catch {
    await appendFile(gitignorePath, `${entry}\n`)
  }
}

function nextWorktreeNumber(
  worktrees: WorktreeInfo[],
  gitBranches: string[] = [],
  existingDirs: string[] = []
): number {
  const fromWorktrees = worktrees
    .map((wt) => wt.branch)
    .filter((b) => /^(wt|worktree)-\d+$/.test(b))
    .map((b) => parseInt(b.replace(/^(wt|worktree)-/, ''), 10))
  const fromGit = gitBranches
    .filter((b) => /^(wt|worktree)-\d+$/.test(b))
    .map((b) => parseInt(b.replace(/^(wt|worktree)-/, ''), 10))
  const fromDirs = existingDirs
    .filter((d) => /^(wt|worktree)-\d+$/.test(d))
    .map((d) => parseInt(d.replace(/^(wt|worktree)-/, ''), 10))
  const all = [...new Set([...fromWorktrees, ...fromGit, ...fromDirs])]
  if (all.length === 0) return 1
  return Math.max(...all) + 1
}

export class WorktreeManager {
  async detectRepo(
    cwd: string
  ): Promise<{ isRepo: boolean; repoPath?: string; branch?: string }> {
    try {
      let repoPath = await git(cwd, ['rev-parse', '--show-toplevel'])
      try {
        const gitCommonDir = await git(cwd, ['rev-parse', '--git-common-dir'])
        const absGitDir = resolve(cwd, gitCommonDir)
        const mainRepo = resolve(absGitDir, '..')
        if (mainRepo !== repoPath) {
          repoPath = mainRepo
        }
      } catch { /* fallback to --show-toplevel */ }
      let branch: string | undefined
      try {
        branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
      } catch { /* no commits yet */ }
      return { isRepo: true, repoPath, branch }
    } catch {
      return { isRepo: false }
    }
  }

  async list(repoPath: string): Promise<WorktreeInfo[]> {
    try {
      const output = await git(repoPath, ['worktree', 'list', '--porcelain'])
      const worktrees = parseWorktreeList(output, repoPath)
      const mainWt = worktrees.find((wt) => wt.isMain)
      if (mainWt) {
        try {
          const merged = await git(repoPath, ['branch', '--merged', mainWt.branch])
          const mergedBranches = merged
            .split('\n')
            .map((b) => b.replace(/^[*+]?\s+/, '').trim())
            .filter(Boolean)
          for (const wt of worktrees) {
            wt.isMerged = !wt.isMain && mergedBranches.includes(wt.branch)
          }
        } catch { /* ignore */ }
      }
      return worktrees
    } catch {
      return []
    }
  }

  async create(
    repoPath: string
  ): Promise<{ worktreePath: string; branch: string }> {
    await ensureGitignore(repoPath)
    try { await git(repoPath, ['worktree', 'prune']) } catch { /* ignore */ }

    const existing = await this.list(repoPath)
    let gitBranches: string[] = []
    try {
      const branchOutput = await git(repoPath, ['branch', '--list', 'wt-*'])
      gitBranches = branchOutput
        .split('\n')
        .map((b) => b.replace(/^[*+]?\s+/, '').trim())
        .filter(Boolean)
    } catch { /* ignore */ }

    const worktreesDir = join(repoPath, '.worktrees')
    let existingDirs: string[] = []
    try {
      const entries = await readdir(worktreesDir, { withFileTypes: true })
      existingDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch { /* directory may not exist */ }

    const num = nextWorktreeNumber(existing, gitBranches, existingDirs)
    const branch = `wt-${num}`
    const worktreePath = join(repoPath, '.worktrees', branch)

    await git(repoPath, ['worktree', 'add', '-b', branch, worktreePath])
    return { worktreePath, branch }
  }

  async rename(worktreePath: string, newBranchName: string): Promise<void> {
    await git(worktreePath, ['check-ref-format', '--branch', newBranchName])
    const oldBranch = await git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (oldBranch === newBranchName) return
    await git(worktreePath, ['branch', '-m', oldBranch, newBranchName])
  }

  async remove(worktreePath: string, force?: boolean): Promise<void> {
    let mainRepo: string
    try {
      const gitDir = await git(worktreePath, ['rev-parse', '--git-common-dir'])
      const absGitDir = resolve(worktreePath, gitDir)
      mainRepo = resolve(absGitDir, '..')
    } catch {
      mainRepo = await git(worktreePath, ['rev-parse', '--show-toplevel'])
    }

    let branch: string | null = null
    try {
      branch = await git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    } catch { /* ignore */ }

    const args = ['worktree', 'remove', worktreePath]
    if (force) args.push('--force')
    await git(mainRepo, args)

    if (branch && /^(wt|worktree)-\d+$/.test(branch)) {
      try {
        await git(mainRepo, ['branch', '-D', branch])
      } catch { /* branch may already be deleted */ }
    }
  }
}
