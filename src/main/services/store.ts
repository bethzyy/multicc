import { app } from 'electron'
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
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
    this.saveStore(this.storeCache)
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

  private saveStore(store: Map<string, unknown>): void {
    try {
      const obj = Object.fromEntries(store)
      writeFileSync(this.storePath, JSON.stringify(obj, null, 2))
    } catch (error) {
      console.error('[Store] Failed to save store:', error)
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
