import { contextBridge, ipcRenderer } from 'electron'

// 暴露给渲染进程的 API
const electronAPI = {
  // 窗口控制
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  },

  // 终端操作
  terminal: {
    create: (id: string, cols: number, rows: number, cwd?: string) => {
      // 确保 cwd 是有效值
      const safeCwd = cwd || ''
      return ipcRenderer.invoke('terminal:create', { id, cols, rows, cwd: safeCwd })
    },

    write: (id: string, data: string) =>
      ipcRenderer.send('terminal:write', { id, data }),

    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', { id, cols, rows }),

    destroy: (id: string) =>
      ipcRenderer.invoke('terminal:destroy', { id }),

    onData: (callback: (id: string, data: string) => void) => {
      const handler = (_: unknown, { id, data }: { id: string; data: string }) => callback(id, data)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    },

    onExit: (callback: (id: string, exitCode: number) => void) => {
      const handler = (_: unknown, { id, exitCode }: { id: string; exitCode: number }) => callback(id, exitCode)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    }
  },

  // 配置管理
  config: {
    getClaudePath: () => ipcRenderer.invoke('config:getClaudePath'),
    setClaudePath: (path: string) => ipcRenderer.invoke('config:setClaudePath', path),
    getWorkingDirs: () => ipcRenderer.invoke('config:getWorkingDirs'),
    addWorkingDir: (path: string) => ipcRenderer.invoke('config:addWorkingDir', path),
    removeWorkingDir: (path: string) => ipcRenderer.invoke('config:removeWorkingDir', path)
  },

  // 会话存档
  session: {
    save: (session: unknown) => ipcRenderer.invoke('session:save', session),
    load: (id: string) => ipcRenderer.invoke('session:load', id),
    list: () => ipcRenderer.invoke('session:list'),
    delete: (id: string) => ipcRenderer.invoke('session:delete', id)
  }
}

// 暴露到 window.electron
contextBridge.exposeInMainWorld('electron', electronAPI)

// TypeScript 类型声明
export type ElectronAPI = typeof electronAPI
