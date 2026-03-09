/**
 * Auto Update Manager
 *
 * Manages automatic application updates using electron-updater.
 * Supports:
 * - Manual update check
 * - Automatic background updates
 * - Download progress tracking
 * - Install prompts
 */

import { autoUpdater, UpdateInfo } from 'electron-updater';
import { BrowserWindow, dialog, Notification } from 'electron';

export interface UpdateProgress {
  bytesPerSecond: number;
  percent: number;
  total: number;
  transferred: number;
}

export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  error: string | null;
  info: UpdateInfo | null;
  progress: UpdateProgress | null;
}

type UpdateCallback = (status: UpdateStatus) => void;

/**
 * Create update manager instance
 */
export function createUpdateManager(window: BrowserWindow) {
  const callbacks = new Set<UpdateCallback>();
  let status: UpdateStatus = {
    checking: false,
    available: false,
    downloading: false,
    downloaded: false,
    error: null,
    info: null,
    progress: null,
  };

  // Configure auto-updater
  autoUpdater.autoDownload = false; // Don't auto-download, let user decide
  autoUpdater.autoInstallOnAppQuit = true; // Install on quit

  // Notify callbacks of status change
  function notifyCallbacks(): void {
    for (const callback of callbacks) {
      try {
        callback(status);
      } catch (error) {
        console.error('[UpdateManager] Callback error:', error);
      }
    }
    // Also send to renderer
    if (!window.isDestroyed()) {
      window.webContents.send('update:status', status);
    }
  }

  // Update status helper
  function updateStatus(partial: Partial<UpdateStatus>): void {
    status = { ...status, ...partial };
    notifyCallbacks();
  }

  // Event: Checking for update
  autoUpdater.on('checking-for-update', () => {
    console.log('[UpdateManager] Checking for update...');
    updateStatus({ checking: true, error: null });
  });

  // Event: Update available
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log('[UpdateManager] Update available:', info.version);
    updateStatus({
      checking: false,
      available: true,
      info,
    });

    // Show notification
    new Notification({
      title: '发现新版本',
      body: `MultiCC ${info.version} 已发布，点击下载`,
    }).show();
  });

  // Event: No update available
  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    console.log('[UpdateManager] No update available');
    updateStatus({
      checking: false,
      available: false,
      info,
    });
  });

  // Event: Download progress
  autoUpdater.on('download-progress', (progressInfo) => {
    console.log(`[UpdateManager] Download: ${progressInfo.percent.toFixed(1)}%`);
    updateStatus({
      downloading: true,
      progress: {
        bytesPerSecond: progressInfo.bytesPerSecond,
        percent: progressInfo.percent,
        total: progressInfo.total,
        transferred: progressInfo.transferred,
      },
    });
  });

  // Event: Update downloaded
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    console.log('[UpdateManager] Update downloaded:', info.version);
    updateStatus({
      downloading: false,
      downloaded: true,
      info,
      progress: null,
    });

    // Show install prompt
    dialog
      .showMessageBox(window, {
        type: 'info',
        title: '更新就绪',
        message: `MultiCC ${info.version} 已下载完成`,
        detail: '是否立即重启并安装更新？',
        buttons: ['立即重启', '稍后安装'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  // Event: Error
  autoUpdater.on('error', (error: Error) => {
    console.error('[UpdateManager] Error:', error);
    updateStatus({
      checking: false,
      downloading: false,
      error: error.message,
    });
  });

  return {
    /**
     * Check for updates
     */
    async checkForUpdates(): Promise<UpdateInfo | null> {
      try {
        const result = await autoUpdater.checkForUpdates();
        return result?.updateInfo || null;
      } catch (error) {
        console.error('[UpdateManager] Check failed:', error);
        updateStatus({
          checking: false,
          error: error instanceof Error ? error.message : 'Check failed',
        });
        return null;
      }
    },

    /**
     * Download update
     */
    async downloadUpdate(): Promise<boolean> {
      if (!status.available) {
        console.warn('[UpdateManager] No update available to download');
        return false;
      }

      try {
        updateStatus({ downloading: true, error: null });
        await autoUpdater.downloadUpdate();
        return true;
      } catch (error) {
        console.error('[UpdateManager] Download failed:', error);
        updateStatus({
          downloading: false,
          error: error instanceof Error ? error.message : 'Download failed',
        });
        return false;
      }
    },

    /**
     * Install update and restart
     */
    installUpdate(): void {
      if (!status.downloaded) {
        console.warn('[UpdateManager] No update downloaded to install');
        return;
      }
      autoUpdater.quitAndInstall();
    },

    /**
     * Get current status
     */
    getStatus(): UpdateStatus {
      return { ...status };
    },

    /**
     * Subscribe to status changes
     */
    onStatusChange(callback: UpdateCallback): () => void {
      callbacks.add(callback);
      // Immediately notify with current status
      callback(status);
      return () => {
        callbacks.delete(callback);
      };
    },

    /**
     * Enable/disable auto-download
     */
    setAutoDownload(enabled: boolean): void {
      autoUpdater.autoDownload = enabled;
    },

    /**
     * Enable/disable auto-install on quit
     */
    setAutoInstallOnAppQuit(enabled: boolean): void {
      autoUpdater.autoInstallOnAppQuit = enabled;
    },
  };
}

export type UpdateManager = ReturnType<typeof createUpdateManager>;
