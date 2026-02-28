import { ElectronAPI } from '../preload/index'

declare global {
  interface Window {
    electron: ElectronAPI
  }
}

export {}
