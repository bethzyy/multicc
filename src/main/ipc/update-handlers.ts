/**
 * Update IPC Handlers
 *
 * Handles IPC communication for auto-update functionality.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { createUpdateManager, type UpdateStatus, type UpdateManager } from '../services/update/UpdateManager';

let updateManager: UpdateManager | null = null;

/**
 * Register all update IPC handlers
 */
export function registerUpdateHandlers(window: BrowserWindow): void {
  // Initialize update manager
  updateManager = createUpdateManager(window);

  // Check for updates
  ipcMain.handle('update:check', async () => {
    if (!updateManager) return { success: false, error: 'Update manager not initialized' };
    try {
      const info = await updateManager.checkForUpdates();
      return { success: true, info };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Check failed' };
    }
  });

  // Download update
  ipcMain.handle('update:download', async () => {
    if (!updateManager) return { success: false, error: 'Update manager not initialized' };
    try {
      const success = await updateManager.downloadUpdate();
      return { success };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Download failed' };
    }
  });

  // Install update
  ipcMain.handle('update:install', async () => {
    if (!updateManager) return { success: false, error: 'Update manager not initialized' };
    try {
      updateManager.installUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Install failed' };
    }
  });

  // Get status
  ipcMain.handle('update:get-status', async (): Promise<{ status: UpdateStatus }> => {
    if (!updateManager) {
      return {
        status: {
          checking: false,
          available: false,
          downloading: false,
          downloaded: false,
          error: 'Update manager not initialized',
          info: null,
          progress: null,
        },
      };
    }
    return { status: updateManager.getStatus() };
  });

  // Forward status changes to renderer
  updateManager.onStatusChange((status) => {
    if (!window.isDestroyed()) {
      window.webContents.send('update:status', status);
    }
  });
}

/**
 * Get update manager instance
 */
export function getUpdateManager(): UpdateManager | null {
  return updateManager;
}
