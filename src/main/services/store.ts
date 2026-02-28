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

  constructor() {
    this.sessionsPath = join(app.getPath('userData'), 'sessions')
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
    return Date.now().toString(36) + Math.random().toString(36).substr(2)
  }
}
