import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { PtyService } from './services/pty'
import { ConfigService } from './services/config'
import { StoreService } from './services/store'
import { registerChatHandlers } from './ipc/chat-handlers'
import { registerConfigHandlers } from './ipc/config-handlers'
import { registerUpdateHandlers } from './ipc/update-handlers'
import { registerToolsHandlers } from './ipc/tools-handlers'
import { registerMarketplaceHandlers } from './ipc/marketplace-handlers'
import { isValidWorkingDir, isUrlSafe } from './utils/security'

// 禁用 GPU 缓存警告
app.commandLine.appendSwitch('disable-gpu-cache')
app.commandLine.appendSwitch('disable-software-rasterizer')

// H10: 全局错误处理
process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error)
  // 不退出进程，只记录。Electron native 崩溃会自行退出
})

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason)
  // 不退出进程，只记录
})

let mainWindow: BrowserWindow | null = null
let ptyService: PtyService
let configService: ConfigService
let storeService: StoreService

// 开发环境检测
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false, // 无边框窗口
    titleBarStyle: 'hidden',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: join(__dirname, '../../resources/icon.ico')
  })

  // 加载页面
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    // 生产环境设置 CSP
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "font-src 'self' data:; " +
            "img-src 'self' data: https:; " +
            "connect-src 'self' https://open.bigmodel.cn https://api.github.com; " +
            "worker-src 'self' blob:"
          ]
        }
      })
    })
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 外部链接用默认浏览器打开（校验 URL 协议）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isUrlSafe(url)) {
      shell.openExternal(url)
    } else {
      console.warn('[Security] Blocked unsafe URL:', url)
    }
    return { action: 'deny' }
  })
}

// 初始化服务
function initServices() {
  storeService = new StoreService()
  configService = new ConfigService(storeService)
  ptyService = new PtyService(mainWindow!)
}

// 注册 IPC 处理器
function registerIpcHandlers() {
  // 窗口控制
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized())

  // 终端操作
  ipcMain.handle('terminal:create', (_, { id, cols, rows, cwd }) => {
    try {
      // C2: 参数验证
      if (!id || typeof id !== 'string') {
        console.warn('[Main] terminal:create rejected: invalid id')
        return false
      }
      if (!Number.isInteger(cols) || cols < 1 || cols > 500 ||
          !Number.isInteger(rows) || rows < 1 || rows > 500) {
        console.warn('[Main] terminal:create rejected: invalid cols/rows', { cols, rows })
        return false
      }
      if (cwd && !isValidWorkingDir(cwd)) {
        console.warn('[Main] terminal:create rejected: invalid cwd', { cwd })
        return false
      }
      console.log('[Main] terminal:create called:', { id, cols, rows, cwd })
      return ptyService.create(id, cols, rows, cwd)
    } catch (error) {
      console.error('[Main] terminal:create error:', error)
      return false
    }
  })

  ipcMain.on('terminal:write', (_, { id, data }) => {
    try {
      if (!id || typeof id !== 'string' || !ptyService.hasInstance(id)) return
      if (typeof data !== 'string') return
      ptyService.write(id, data)
    } catch (error) {
      console.error('[Main] terminal:write error:', error)
    }
  })

  ipcMain.handle('terminal:resize', (_, { id, cols, rows }) => {
    try {
      ptyService.resize(id, cols, rows)
    } catch (error) {
      console.error('[Main] terminal:resize error:', error)
    }
  })

  ipcMain.handle('terminal:destroy', (_, { id }) => {
    try {
      ptyService.destroy(id)
    } catch (error) {
      console.error('[Main] terminal:destroy error:', error)
    }
  })

  // 配置管理
  ipcMain.handle('config:getClaudePath', () => configService.getClaudePath())
  ipcMain.handle('config:setClaudePath', (_, path) => configService.setClaudePath(path))
  ipcMain.handle('config:getWorkingDirs', () => configService.getWorkingDirs())
  ipcMain.handle('config:addWorkingDir', (_, path) => configService.addWorkingDir(path))
  ipcMain.handle('config:removeWorkingDir', (_, path) => configService.removeWorkingDir(path))

  // 会话存档
  ipcMain.handle('session:save', (_, session) => storeService.saveSession(session))
  ipcMain.handle('session:load', (_, id) => storeService.loadSession(id))
  ipcMain.handle('session:list', () => storeService.listSessions())
  ipcMain.handle('session:delete', (_, id) => storeService.deleteSession(id))

  // 聊天历史 (新增)
  registerChatHandlers(mainWindow!)

  // 配置/Skills/MCP (新增)
  registerConfigHandlers(mainWindow!)

  // ClawHub Marketplace (新增)
  registerMarketplaceHandlers()

  // CLI 工具管理 (新增)
  registerToolsHandlers(mainWindow!, storeService)

  // 自动更新 (生产环境)
  if (!isDev) {
    registerUpdateHandlers(mainWindow!)
  }
}

// 应用就绪
app.whenReady().then(() => {
  createWindow()
  initServices()
  registerIpcHandlers()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// 关闭所有窗口时退出 (Windows & Linux)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 清理资源（带超时保护）
app.on('before-quit', (event) => {
  if (!ptyService) return

  // 先阻止默认行为，异步清理
  event.preventDefault()

  // 设置 3 秒超时保护
  const forceQuitTimer = setTimeout(() => {
    console.warn('[App] Force quit after timeout')
    app.exit(0)
  }, 3000)

  // 销毁所有终端（async，await 完成后再退出）
  ptyService.destroyAll().then(() => {
    clearTimeout(forceQuitTimer)
    app.exit(0)
  }).catch((err) => {
    console.warn('[App] Error during cleanup:', err)
    clearTimeout(forceQuitTimer)
    app.exit(0)
  })
})
