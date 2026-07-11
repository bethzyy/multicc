import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorktreeManager, WorktreeError } from '../../src/main/services/worktree/WorktreeManager'
import { isSamePath } from '../../src/shared/utils/path'

/**
 * WorktreeManager 集成测试：在临时目录里跑真实 git 仓库，断言对外行为。
 * 不 mock git —— 这些用例保护的正是"和真实 git 的交互契约"。
 *
 * 每个 describe 块拥有独立的临时仓库（互不污染）；
 * 仓库带一个已 gitignore 的 .env（模拟真实项目的 setup 拷贝场景）。
 */

interface Fixture {
  tmp: string
  repo: string
  sh: (cmd: string, cwd?: string) => string
}

async function makeRepo(): Promise<Fixture> {
  const tmp = await mkdtemp(join(tmpdir(), 'multicc-wt-test-'))
  const repo = join(tmp, 'myproj')
  await mkdir(repo)
  const sh = (cmd: string, cwd: string = repo): string =>
    execSync(cmd, { cwd, stdio: 'pipe' }).toString().trim()

  sh('git init -b main')
  sh('git config user.email test@test.com')
  sh('git config user.name tester')
  await writeFile(join(repo, 'a.txt'), 'line1\nline2\n')
  await writeFile(join(repo, '.env'), 'SECRET=1\n')
  await writeFile(join(repo, '.gitignore'), 'node_modules/\n.env\n')
  sh('git add a.txt .gitignore')
  sh('git commit -m init')
  return { tmp, repo, sh }
}

async function cleanup(fx: Fixture): Promise<void> {
  // Windows 上 git 进程刚退出时目录可能短暂被锁，重试删除
  await rm(fx.tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

const mgr = new WorktreeManager()

async function expectWorktreeError(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p
    expect.unreachable(`expected WorktreeError(${code}) but nothing was thrown`)
  } catch (err) {
    expect(err).toBeInstanceOf(WorktreeError)
    expect((err as WorktreeError).code).toBe(code)
  }
}

describe('仓库探测：detectRepo 必须从任何位置都定位到主仓库', () => {
  let fx: Fixture
  let wtPath: string
  beforeAll(async () => {
    fx = await makeRepo()
    await mkdir(join(fx.repo, 'subdir'))
    const created = await mgr.create(fx.repo, [])
    wtPath = created.worktreePath
  })
  afterAll(() => cleanup(fx))

  it('非 git 目录返回 isRepo:false，UI 据此隐藏 worktree 入口', async () => {
    const result = await mgr.detectRepo(fx.tmp)
    expect(result.isRepo).toBe(false)
  })

  it('从仓库子目录探测时 repoPath 必须是仓库根（--git-common-dir 相对路径基准是 cwd，曾因此出错）', async () => {
    const result = await mgr.detectRepo(join(fx.repo, 'subdir'))
    expect(result.isRepo).toBe(true)
    expect(isSamePath(result.repoPath!, fx.repo)).toBe(true)
    expect(result.branch).toBe('main')
  })

  it('从 worktree 内部探测时 repoPath 必须反查回主仓库，而不是 worktree 自身', async () => {
    const result = await mgr.detectRepo(wtPath)
    expect(result.isRepo).toBe(true)
    expect(isSamePath(result.repoPath!, fx.repo)).toBe(true)
  })
})

describe('创建与 setup：新 worktree 要能直接开工，且不污染主仓库', () => {
  let fx: Fixture
  let wtPath: string
  let branch: string
  beforeAll(async () => {
    fx = await makeRepo()
    const created = await mgr.create(fx.repo, ['.env', '../evil', 'not-exist.txt'])
    wtPath = created.worktreePath
    branch = created.branch
  })
  afterAll(() => cleanup(fx))

  it('首个 worktree 命名 wt-1，目录在 <repo>/.worktrees/ 下', () => {
    expect(branch).toBe('wt-1')
    expect(existsSync(wtPath)).toBe(true)
    expect(wtPath.replace(/\\/g, '/')).toContain('/.worktrees/wt-1')
  })

  it('copyFiles 中的 .env 被拷入新 worktree（否则依赖 .env 的项目跑不起来）', () => {
    expect(existsSync(join(wtPath, '.env'))).toBe(true)
  })

  it('copyFiles 中含路径穿越（../evil）或不存在的文件时静默跳过，不写到仓库外', () => {
    expect(existsSync(join(fx.repo, '..', 'evil'))).toBe(false)
    expect(existsSync(join(wtPath, 'not-exist.txt'))).toBe(false)
  })

  it('忽略规则写入 .git/info/exclude（纯本地），用户被跟踪的 .gitignore 不被修改', async () => {
    const exclude = await readFile(join(fx.repo, '.git', 'info', 'exclude'), 'utf-8')
    expect(exclude).toContain('/.worktrees/')
    const gitignore = await readFile(join(fx.repo, '.gitignore'), 'utf-8')
    expect(gitignore).toBe('node_modules/\n.env\n')
  })

  it('创建 worktree 后主仓库工作区保持干净（不产生任何待提交改动）', () => {
    expect(fx.sh('git status --porcelain')).toBe('')
  })

  it('list 能看到 main + wt-1，新 worktree 状态为干净、与主分支无差异', async () => {
    const list = await mgr.list(fx.repo)
    expect(list).toHaveLength(2)
    expect(list[0].isMain).toBe(true)
    const wt = list.find((w) => w.branch === 'wt-1')!
    expect(wt).toBeDefined()
    expect(wt.dirtyCount).toBe(0)
    expect(wt.ahead).toBe(0)
    expect(wt.behind).toBe(0)
  })
})

describe('状态评估与安全删除：未提交改动绝不能被一键删掉', () => {
  let fx: Fixture
  let wtPath: string
  beforeAll(async () => {
    fx = await makeRepo()
    const created = await mgr.create(fx.repo, [])
    wtPath = created.worktreePath
    await writeFile(join(wtPath, 'dirty.txt'), 'uncommitted work')
  })
  afterAll(() => cleanup(fx))

  it('getStatus 报告脏文件数，供 UI 在删除前展示风险', async () => {
    const status = await mgr.getStatus(wtPath)
    expect(status.dirtyCount).toBe(1)
    expect(status.unmergedCount).toBe(0)
    expect(status.branch).toBe('wt-1')
  })

  it('worktree 有未提交改动时，非 force 删除必须抛 DIRTY 而不是直接删（防一键丢数据）', async () => {
    await expectWorktreeError(mgr.remove(wtPath, false), 'DIRTY')
    expect(existsSync(wtPath)).toBe(true)
  })

  it('用户确认后的 force 删除要连带清理分支，不留孤儿分支', async () => {
    await mgr.remove(wtPath, true)
    expect(existsSync(wtPath)).toBe(false)
    expect(fx.sh('git branch --list wt-1')).toBe('')
  })

  it('删除主 worktree 必须被拒绝（GIT_ERROR），无论是否 force', async () => {
    await expectWorktreeError(mgr.remove(fx.repo, true), 'GIT_ERROR')
    expect(existsSync(fx.repo)).toBe(true)
  })
})

describe('squash 合并回主分支：只在双方干净时进行，冲突必须完整回滚', () => {
  let fx: Fixture
  let wtPath: string
  beforeAll(async () => {
    fx = await makeRepo()
    const created = await mgr.create(fx.repo, [])
    wtPath = created.worktreePath
    await writeFile(join(wtPath, 'feature.txt'), 'new feature\n')
    fx.sh('git add feature.txt', wtPath)
    fx.sh('git commit -m feat', wtPath)
  })
  afterAll(() => cleanup(fx))

  it('worktree 提交后 getStatus.unmergedCount 与 list 的 ahead 都应为 1（删除确认与 UI 徽章依赖它们）', async () => {
    const status = await mgr.getStatus(wtPath)
    expect(status.unmergedCount).toBe(1)
    const list = await mgr.list(fx.repo)
    const wt = list.find((w) => !w.isMain)!
    expect(wt.ahead).toBe(1)
    expect(wt.behind).toBe(0)
  })

  it('干净状态下合并成功：主分支得到一个 squash 提交，包含 worktree 的改动', async () => {
    const result = await mgr.mergeToMain(wtPath)
    expect(result.merged).toBe(true)
    expect(result.mainBranch).toBe('main')
    expect(existsSync(join(fx.repo, 'feature.txt'))).toBe(true)
    expect(fx.sh('git log --oneline -1')).toContain('squash merge')
    expect(fx.sh('git status --porcelain')).toBe('')
  })

  it('无差异时再次合并返回 merged:false 而不是报错（幂等，UI 提示"无需合并"）', async () => {
    const result = await mgr.mergeToMain(wtPath)
    expect(result.merged).toBe(false)
  })

  it('主 worktree 有未提交改动时合并必须抛 MAIN_DIRTY（防止把用户正在做的事搅进合并）', async () => {
    await writeFile(join(fx.repo, 'a.txt'), 'main dirty change\nline2\n')
    await expectWorktreeError(mgr.mergeToMain(wtPath), 'MAIN_DIRTY')
    fx.sh('git checkout -- a.txt')
  })

  it('待合并 worktree 有未提交改动时必须抛 WT_DIRTY（提示先 commit）', async () => {
    await writeFile(join(wtPath, 'wip.txt'), 'work in progress')
    await expectWorktreeError(mgr.mergeToMain(wtPath), 'WT_DIRTY')
    await rm(join(wtPath, 'wip.txt'))
  })

  it('合并冲突时抛 CONFLICT 且主仓库被完整回滚（不能留下半合并的暂存区）', async () => {
    await writeFile(join(wtPath, 'a.txt'), 'worktree version\nline2\n')
    fx.sh('git add a.txt', wtPath)
    fx.sh('git commit -m wt-change', wtPath)
    await writeFile(join(fx.repo, 'a.txt'), 'main version\nline2\n')
    fx.sh('git add a.txt')
    fx.sh('git commit -m main-change')

    await expectWorktreeError(mgr.mergeToMain(wtPath), 'CONFLICT')
    expect(fx.sh('git status --porcelain')).toBe('')
  })
})

describe('编号分配：wt-N 不能与现存 worktree/分支/目录冲突', () => {
  let fx: Fixture
  beforeAll(async () => {
    fx = await makeRepo()
  })
  afterAll(() => cleanup(fx))

  it('连续创建得到递增编号 wt-1、wt-2', async () => {
    const c1 = await mgr.create(fx.repo, [])
    const c2 = await mgr.create(fx.repo, [])
    expect(c1.branch).toBe('wt-1')
    expect(c2.branch).toBe('wt-2')
  })

  it('存在残留同名分支（worktree 已删但分支还在）时，编号必须跳过它避免创建失败', async () => {
    // 造一个孤儿分支 wt-5：只有分支没有 worktree
    fx.sh('git branch wt-5')
    const c = await mgr.create(fx.repo, [])
    expect(c.branch).toBe('wt-6')
  })
})
