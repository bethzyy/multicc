import * as pty from '@lydell/node-pty'
import { BrowserWindow } from 'electron'

interface PtyInstance {
  pty: pty.IPty
  id: string
  buffer: string
}

export class PtyService {
  private instances: Map<string, PtyInstance> = new Map()
  private window: BrowserWindow

  constructor(window: BrowserWindow) {
    this.window = window
  }

  create(id: string, cols: number, rows: number, cwd?: string): boolean {
    try {
      const shell = process.env.COMSPEC || 'cmd.exe'
      // 确保 workingDir 是有效字符串
      const workingDir = (cwd && cwd.length > 0) ? cwd : process.cwd()

      console.log('[PTY] Creating terminal:', { id, shell, cwd: workingDir, cols, rows })

      // 使用 node-pty 创建真正的伪终端
      // 注意：删除 CLAUDECODE 环境变量，允许在 multicc 终端中运行 Claude Code
      const { CLAUDECODE, ...envWithoutClaudeCode } = process.env

      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: cols,
        rows: rows,
        cwd: workingDir,
        env: {
          ...envWithoutClaudeCode,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        }
      })

      console.log('[PTY] Process created, PID:', ptyProcess.pid)

      // 监听输出
      ptyProcess.onData((data: string) => {
        console.log('[PTY] onData for', id, ':', data.length, 'bytes')
        const instance = this.instances.get(id)
        if (instance) {
          instance.buffer += data
          if (instance.buffer.length > 100000) {
            instance.buffer = instance.buffer.slice(-50000)
          }
        }
        // 确保数据是字符串
        this.window.webContents.send('terminal:data', { id, data: String(data) })
      })

      // 监听退出
      ptyProcess.onExit(({ exitCode }) => {
        console.log('[PTY] Process exited:', id, 'code:', exitCode)
        this.window.webContents.send('terminal:exit', { id, exitCode })
        this.instances.delete(id)
      })

      this.instances.set(id, {
        pty: ptyProcess,
        id,
        buffer: ''
      })

      console.log('[PTY] Total instances:', this.instances.size)

      return true
    } catch (error) {
      console.error('[PTY] Failed to create:', error)
      return false
    }
  }

  write(id: string, data: string): void {
    const instance = this.instances.get(id)
    if (instance) {
      instance.pty.write(data)
    } else {
      console.log('[PTY] write failed - instance not found:', id)
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const instance = this.instances.get(id)
    if (instance) {
      instance.pty.resize(cols, rows)
    }
  }

  destroy(id: string): void {
    const instance = this.instances.get(id)
    if (instance) {
      instance.pty.kill()
      this.instances.delete(id)
    }
  }

  destroyAll(): void {
    for (const [id] of this.instances) {
      this.destroy(id)
    }
  }

  getBuffer(id: string): string {
    return this.instances.get(id)?.buffer || ''
  }

  hasInstance(id: string): boolean {
    return this.instances.has(id)
  }
}
