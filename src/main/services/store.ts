import { app } from 'electron'
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, renameSync } from 'fs'
import { writeFile, rename } from 'fs/promises'
import { join } from 'path'

export interface Session {
  id: string
  name: string
  cwd: string
  createdAt: number
  updatedAt: number
  history: SessionEntry[]
}

export interface SessionEntry {
  timestamp: number
  type: 'input' | 'output'
  content: string
}

export class StoreService {
  private sessionsPath: string
  private storePath: string
  private storeCache: Map<string, unknown> | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private savePending = false

  constructor() {
    const dataDir = app.getPath('userData')
    this.sessionsPath = join(dataDir, 'sessions')
    this.storePath = join(dataDir, 'store.json')
    this.ensureSessionsDir()
  }

  private ensureSessionsDir(): void {
    if (!existsSync(this.sessionsPath)) {
      mkdirSync(this.sessionsPath, { recursive: true })
    }
  }

  private getSessionPath(id: string): string {
    return join(this.sessionsPath, `${id}.json`)
  }

  /**
   * Generic key-value get
   */
  get(key: string): unknown {
    if (!this.storeCache) {
      this.storeCache = this.loadStore()
    }
    return this.storeCache.get(key)
  }

  /**
   * Generic key-value set
   */
  set(key: string, value: unknown): void {
    if (!this.storeCache) {
      this.storeCache = this.loadStore()
    }
    this.storeCache.set(key, value)
    this.scheduleSave()
  }

  /**
   * Generic key-value delete
   */
  delete(key: string): void {
    if (!this.storeCache) {
      this.storeCache = this.loadStore()
    }
    if (this.storeCache.delete(key)) {
      this.scheduleSave()
    }
  }

  /**
   * List all keys
   */
  keys(): string[] {
    if (!this.storeCache) {
      this.storeCache = this.loadStore()
    }
    return [...this.storeCache.keys()]
  }

  private loadStore(): Map<string, unknown> {
    try {
      if (existsSync(this.storePath)) {
        const data = readFileSync(this.storePath, 'utf-8')
        const obj = JSON.parse(data)
        return new Map(Object.entries(obj))
      }
    } catch (error) {
      console.error('[Store] Failed to load store:', error)
    }
    return new Map()
  }

  /**
   * 防抖异步写盘：200ms 内的多次 set/delete 合并为一次写，
   * 避免每次操作都同步重写整个 store.json 阻塞主线程。
   */
  private scheduleSave(): void {
    this.savePending = true
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.flushStore()
    }, 200)
  }

  private async flushStore(): Promise<void> {
    if (!this.savePending || !this.storeCache) return
    this.savePending = false
    try {
      const obj = Object.fromEntries(this.storeCache)
      // 原子写：先写临时文件再 rename，避免中途崩溃留下半截 JSON
      const tempPath = `${this.storePath}.tmp`
      await writeFile(tempPath, JSON.stringify(obj, null, 2), 'utf-8')
      await rename(tempPath, this.storePath)
    } catch (error) {
      console.error('[Store] Failed to save store:', error)
    }
  }

  /**
   * 退出前同步兜底写盘（before-quit 时调用）
   */
  flushSync(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.savePending || !this.storeCache) return
    this.savePending = false
    try {
      const obj = Object.fromEntries(this.storeCache)
      const tempPath = `${this.storePath}.tmp`
      writeFileSync(tempPath, JSON.stringify(obj, null, 2))
      renameSync(tempPath, this.storePath)
    } catch (error) {
      console.error('[Store] Failed to flush store:', error)
    }
  }

  saveSession(session: Session): boolean {
    try {
      session.updatedAt = Date.now()
      const path = this.getSessionPath(session.id)
      writeFileSync(path, JSON.stringify(session, null, 2))
      return true
    } catch (error) {
      console.error('Failed to save session:', error)
      return false
    }
  }

  loadSession(id: string): Session | null {
    try {
      const path = this.getSessionPath(id)
      if (existsSync(path)) {
        const data = readFileSync(path, 'utf-8')
        return JSON.parse(data)
      }
      return null
    } catch (error) {
      console.error('Failed to load session:', error)
      return null
    }
  }

  listSessions(): Session[] {
    try {
      const files = readdirSync(this.sessionsPath)
      const sessions: Session[] = []

      for (const file of files) {
        if (file.endsWith('.json')) {
          const id = file.slice(0, -5)
          const session = this.loadSession(id)
          if (session) {
            sessions.push(session)
          }
        }
      }

      // 按更新时间降序排序
      return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    } catch (error) {
      console.error('Failed to list sessions:', error)
      return []
    }
  }

  deleteSession(id: string): boolean {
    try {
      const path = this.getSessionPath(id)
      if (existsSync(path)) {
        unlinkSync(path)
      }
      return true
    } catch (error) {
      console.error('Failed to delete session:', error)
      return false
    }
  }

  createSession(name: string, cwd: string): Session {
    return {
      id: this.generateId(),
      name,
      cwd,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      history: []
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2)
  }
}
