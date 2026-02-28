import { spawn, ChildProcess } from 'child_process'
import { BrowserWindow } from 'electron'

interface PtyInstance {
  process: ChildProcess
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
      // 使用 cmd.exe（更简单可靠）
      const shell = process.env.COMSPEC || 'cmd.exe'
      const workingDir = cwd || process.cwd()

      console.log(`Creating PTY ${id}: ${shell} in ${workingDir}`)

      const childProcess = spawn(shell, [], {
        cwd: workingDir,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          COLUMNS: cols.toString(),
          LINES: rows.toString()
        },
        stdio: ['pipe', 'pipe', 'pipe']
      })

      // 监听标准输出
      childProcess.stdout?.on('data', (data: Buffer) => {
        const str = data.toString('utf8')
        const instance = this.instances.get(id)
        if (instance) {
          instance.buffer += str
          if (instance.buffer.length > 100000) {
            instance.buffer = instance.buffer.slice(-50000)
          }
        }
        this.window.webContents.send('terminal:data', { id, data: str })
      })

      // 监听标准错误
      childProcess.stderr?.on('data', (data: Buffer) => {
        const str = data.toString('utf8')
        this.window.webContents.send('terminal:data', { id, data: str })
      })

      // 监听进程退出
      childProcess.on('close', (code) => {
        console.log(`PTY ${id} exited with code ${code}`)
        this.window.webContents.send('terminal:exit', { id, exitCode: code || 0 })
        this.instances.delete(id)
      })

      childProcess.on('error', (err) => {
        console.error('PTY process error:', err)
        this.window.webContents.send('terminal:data', {
          id,
          data: `\x1b[31mError: ${err.message}\x1b[0m\r\n`
        })
      })

      this.instances.set(id, {
        process: childProcess,
        id,
        buffer: ''
      })

      console.log(`PTY ${id} created successfully`)
      return true
    } catch (error) {
      console.error('Failed to create PTY:', error)
      return false
    }
  }

  write(id: string, data: string): void {
    const instance = this.instances.get(id)
    if (instance && instance.process.stdin) {
      console.log(`PTY ${id} write: ${JSON.stringify(data)}`)
      instance.process.stdin.write(data)
    } else {
      console.log(`PTY ${id} not found or stdin not available`)
    }
  }

  resize(id: string, cols: number, rows: number): void {
    // child_process 不支持动态调整大小
    console.log(`PTY ${id} resize: ${cols}x${rows} (not supported)`)
  }

  destroy(id: string): void {
    const instance = this.instances.get(id)
    if (instance) {
      console.log(`Destroying PTY ${id}`)
      instance.process.kill()
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
