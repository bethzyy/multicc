import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { StoreService } from './store'

export interface AppConfig {
  claudePath: string
  workingDirs: string[]
  theme: 'dark' | 'light'
  fontSize: number
  fontFamily: string
}

const DEFAULT_CONFIG: AppConfig = {
  claudePath: '',
  workingDirs: [],
  theme: 'dark',
  fontSize: 14,
  fontFamily: 'Consolas, "Courier New", monospace'
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

  getFontFamily(): string {
    return this.loadConfig().fontFamily
  }

  setFontFamily(family: string): void {
    const config = this.loadConfig()
    config.fontFamily = family
    this.saveConfig(config)
  }
}
