export interface WorktreeInfo {
  path: string
  branch: string
  isMain: boolean
  /** 基于 branch --merged 检测；squash-merge 工作流下检测不到（已知局限） */
  isMerged: boolean
  /** 未提交（含未跟踪）文件数；main worktree 不统计 */
  dirtyCount?: number
  /** 相对主分支领先的提交数 */
  ahead?: number
  /** 相对主分支落后的提交数 */
  behind?: number
}

/** worktree 操作的结构化错误码，UI 据此给出针对性提示 */
export type WorktreeErrorCode =
  | 'DIRTY'        // worktree 有未提交改动，需 force
  | 'LOCKED'       // 目录被占用（如有终端在其中运行）
  | 'MAIN_DIRTY'   // 主 worktree 有未提交改动，无法合并
  | 'WT_DIRTY'     // 待合并 worktree 有未提交改动，需先 commit
  | 'CONFLICT'     // squash merge 冲突（已自动回滚）
  | 'DETACHED'     // detached HEAD，无法操作分支
  | 'GIT_ERROR'    // 其它 git 错误

export interface WorktreeStatus {
  dirtyCount: number
  /** 分支上尚未合并进主分支的提交数 */
  unmergedCount: number
  branch: string
}

/** 新建 worktree 后的初始化配置（config.json 的 worktreeSetup 字段） */
export interface WorktreeSetup {
  /** 从主仓库根目录拷贝到新 worktree 的文件（仅拷贝存在且目标缺失的，如 .env） */
  copyFiles: string[]
  /** 在新 worktree 的终端中自动执行的命令（如 npm install --ignore-scripts） */
  setupCommand?: string
}
