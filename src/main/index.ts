import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { PtyService } from './services/pty'
import { ConfigService } from './services/config'
import { StoreService } from './services/store'

// 禁用 GPU 缓存警告
app.commandLine.appendSwitch('disable-gpu-cache')
app.commandLine.appendSwitch('disable-software-rasterizer')

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
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 外部链接用默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
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
    return ptyService.create(id, cols, rows, cwd)
  })

  ipcMain.on('terminal:write', (_, { id, data }) => {
    ptyService.write(id, data)
  })

  ipcMain.handle('terminal:resize', (_, { id, cols, rows }) => {
    ptyService.resize(id, cols, rows)
  })

  ipcMain.handle('terminal:destroy', (_, { id }) => {
    ptyService.destroy(id)
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

// 清理资源
app.on('before-quit', () => {
  ptyService?.destroyAll()
})
