/**
 * Update Notification Component
 *
 * Displays update status with progress bar and action buttons.
 */

import { useState, useEffect, useCallback } from 'react'
import './UpdateNotification.css'

interface UpdateInfo {
  version: string
  releaseDate: string
}

interface UpdateProgress {
  bytesPerSecond: number
  percent: number
  total: number
  transferred: number
}

interface UpdateStatus {
  checking: boolean
  available: boolean
  downloading: boolean
  downloaded: boolean
  error: string | null
  info: UpdateInfo | null
  progress: UpdateProgress | null
}

export function UpdateNotification() {
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState<UpdateStatus>({
    checking: false,
    available: false,
    downloading: false,
    downloaded: false,
    error: null,
    info: null,
    progress: null
  })

  useEffect(() => {
    // 监听更新状态变化
    const unsubscribe = window.electron.update.onStatus((newStatus) => {
      setStatus(newStatus)

      // 有更新可用时显示通知
      if (newStatus.available || newStatus.downloading || newStatus.downloaded) {
        setVisible(true)
      }

      // 检查中显示通知
      if (newStatus.checking) {
        setVisible(true)
      }

      // 错误时显示
      if (newStatus.error) {
        setVisible(true)
      }
    })

    // 获取初始状态
    window.electron.update.getStatus().then(({ status: initialStatus }) => {
      if (initialStatus.available || initialStatus.downloaded) {
        setStatus(initialStatus)
        setVisible(true)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const handleCheckUpdate = useCallback(async () => {
    try {
      await window.electron.update.check()
    } catch (error) {
      console.error('Check update failed:', error)
    }
  }, [])

  const handleDownload = useCallback(async () => {
    try {
      await window.electron.update.download()
    } catch (error) {
      console.error('Download update failed:', error)
    }
  }, [])

  const handleInstall = useCallback(async () => {
    try {
      await window.electron.update.install()
    } catch (error) {
      console.error('Install update failed:', error)
    }
  }, [])

  const handleClose = useCallback(() => {
    // 下载完成后不能关闭
    if (!status.downloaded) {
      setVisible(false)
    }
  }, [status.downloaded])

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  const formatSpeed = (bytesPerSecond: number): string => {
    return `${formatBytes(bytesPerSecond)}/s`
  }

  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString)
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    } catch {
      return dateString
    }
  }

  if (!visible) {
    return null
  }

  const getStateClass = (): string => {
    if (status.error) return 'update-notification--error'
    if (status.downloaded) return 'update-notification--downloaded'
    if (status.checking) return 'update-notification--checking'
    return ''
  }

  const getIcon = (): string => {
    if (status.error) return '⚠️'
    if (status.downloaded) return '✅'
    if (status.checking) return '🔄'
    if (status.downloading) return '📥'
    if (status.available) return '🎉'
    return '📦'
  }

  const getTitle = (): string => {
    if (status.error) return '更新失败'
    if (status.downloaded) return '更新已就绪'
    if (status.checking) return '检查更新中...'
    if (status.downloading) return '下载更新中...'
    if (status.available) return '发现新版本'
    return '软件更新'
  }

  return (
    <div className={`update-notification ${getStateClass()}`}>
      <div className="update-notification__header">
        <span className="update-notification__icon">{getIcon()}</span>
        <span className="update-notification__title">{getTitle()}</span>
        {!status.downloaded && (
          <button
            className="update-notification__close"
            onClick={handleClose}
            aria-label="关闭"
          >
            ✕
          </button>
        )}
      </div>

      <div className="update-notification__body">
        {status.checking && (
          <p>正在检查更新，请稍候...</p>
        )}

        {status.available && status.info && !status.downloading && !status.downloaded && (
          <p>
            发现新版本 <span className="update-notification__version">v{status.info.version}</span>
            {' '}(发布于 {formatDate(status.info.releaseDate)})
          </p>
        )}

        {status.downloading && status.progress && (
          <div className="update-notification__progress">
            <div className="update-notification__progress-bar">
              <div
                className="update-notification__progress-fill"
                style={{ width: `${status.progress.percent}%` }}
              />
            </div>
            <div className="update-notification__progress-text">
              <span>{formatBytes(status.progress.transferred)} / {formatBytes(status.progress.total)}</span>
              <span>{formatSpeed(status.progress.bytesPerSecond)}</span>
            </div>
          </div>
        )}

        {status.downloaded && status.info && (
          <p>
            版本 <span className="update-notification__version">v{status.info.version}</span> 已下载完成，
            重启应用以完成安装。
          </p>
        )}

        {status.error && (
          <p style={{ color: '#f14c4c' }}>{status.error}</p>
        )}
      </div>

      <div className="update-notification__actions">
        {!status.checking && !status.available && !status.downloading && !status.downloaded && (
          <button
            className="update-notification__button update-notification__button--primary"
            onClick={handleCheckUpdate}
          >
            检查更新
          </button>
        )}

        {status.available && !status.downloading && !status.downloaded && (
          <>
            <button
              className="update-notification__button update-notification__button--secondary"
              onClick={handleClose}
            >
              稍后提醒
            </button>
            <button
              className="update-notification__button update-notification__button--primary"
              onClick={handleDownload}
            >
              立即下载
            </button>
          </>
        )}

        {status.downloading && (
          <button
            className="update-notification__button update-notification__button--primary"
            disabled
          >
            下载中...
          </button>
        )}

        {status.downloaded && (
          <>
            <button
              className="update-notification__button update-notification__button--secondary"
              onClick={() => setVisible(false)}
            >
              稍后重启
            </button>
            <button
              className="update-notification__button update-notification__button--primary"
              onClick={handleInstall}
            >
              立即重启
            </button>
          </>
        )}

        {status.error && (
          <>
            <button
              className="update-notification__button update-notification__button--secondary"
              onClick={handleClose}
            >
              关闭
            </button>
            <button
              className="update-notification__button update-notification__button--primary"
              onClick={handleCheckUpdate}
            >
              重试
            </button>
          </>
        )}
      </div>
    </div>
  )
}
