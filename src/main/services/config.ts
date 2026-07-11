import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { StoreService } from './store'
import type { WorktreeSetup } from '@shared/types/worktree.types'

export interface AppConfig {
  claudePath: string
  workingDirs: string[]
  defaultWorkingDir: string
  theme: 'dark' | 'light'
  fontSize: number
  fontFamily: string
  worktreeSetup: WorktreeSetup
}

const DEFAULT_CONFIG: AppConfig = {
  claudePath: '',
  workingDirs: [],
  defaultWorkingDir: 'E:\\',
  theme: 'dark',
  fontSize: 14,
  fontFamily: 'Consolas, "Courier New", monospace',
  // 新建 worktree 后从主仓库根目录拷贝的文件 / 在新终端自动执行的命令（手改 config.json 自定义）
  worktreeSetup: { copyFiles: ['.env'] }
}

export class ConfigService {
  private store: StoreService
  private configPath: string

  constructor(store: StoreService) {
    this.store = store
    this.configPath = join(app.getPath('userData'), 'config.json')
    this.ensureConfig()
  }

  private ensureConfig(): void {
    if (!existsSync(this.configPath)) {
      this.saveConfig(DEFAULT_CONFIG)
    }
  }

  private loadConfig(): AppConfig {
    try {
      const data = readFileSync(this.configPath, 'utf-8')
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) }
    } catch {
      return DEFAULT_CONFIG
    }
  }

  private saveConfig(config: AppConfig): void {
    writeFileSync(this.configPath, JSON.stringify(config, null, 2))
  }

  getClaudePath(): string {
    return this.loadConfig().claudePath
  }

  setClaudePath(path: string): void {
    const config = this.loadConfig()
    config.claudePath = path
    this.saveConfig(config)
  }

  getWorkingDirs(): string[] {
    return this.loadConfig().workingDirs
  }

  addWorkingDir(path: string): void {
    const config = this.loadConfig()
    if (!config.workingDirs.includes(path)) {
      config.workingDirs.push(path)
      this.saveConfig(config)
    }
  }

  removeWorkingDir(path: string): void {
    const config = this.loadConfig()
    config.workingDirs = config.workingDirs.filter(p => p !== path)
    this.saveConfig(config)
  }

  /**
   * 新建终端的默认工作目录。
   * 若配置的目录不存在（如换机器后 E: 盘缺失），回退到用户主目录，
   * 避免便携版下回退到临时解压目录。
   */
  getDefaultWorkingDir(): string {
    const dir = this.loadConfig().defaultWorkingDir
    if (dir && existsSync(dir)) {
      return dir
    }
    return app.getPath('home')
  }

  setDefaultWorkingDir(path: string): void {
    const config = this.loadConfig()
    config.defaultWorkingDir = path
    this.saveConfig(config)
  }

  getTheme(): 'dark' | 'light' {
    return this.loadConfig().theme
  }

  setTheme(theme: 'dark' | 'light'): void {
    const config = this.loadConfig()
    config.theme = theme
    this.saveConfig(config)
  }

  getFontSize(): number {
    return this.loadConfig().fontSize
  }

  setFontSize(size: number): void {
    const config = this.loadConfig()
    config.fontSize = size
    this.saveConfig(config)
  }

  getWorktreeSetup(): WorktreeSetup {
    const setup = this.loadConfig().worktreeSetup
    return {
      copyFiles: Array.isArray(setup?.copyFiles) ? setup.copyFiles : [],
      setupCommand: typeof setup?.setupCommand === 'string' ? setup.setupCommand : undefined
    }
  }

  getFontFamily(): string {
    return this.loadConfig().fontFamily
  }

  setFontFamily(family: string): void {
    const config = this.loadConfig()
    config.fontFamily = family
    this.saveConfig(config)
  }
}
