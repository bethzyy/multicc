/**
 * Marketplace IPC Handlers
 *
 * Handles IPC communication for ClawHub marketplace functionality.
 * Routes: marketplace:search, marketplace:browse, marketplace:detail, etc.
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants/channels';
import {
  browseSkills,
  searchSkills,
  getSkillDetail,
  getSkillFile,
  getScanResult,
} from '../services/marketplace/ClawHubApi';
import {
  install,
  uninstall,
  isInstalled,
  getInstalledSlugs,
} from '../services/marketplace/SkillInstaller';

/**
 * Register all marketplace IPC handlers
 */
export function registerMarketplaceHandlers(): void {
  // Search skills
  ipcMain.handle(
    IPC_CHANNELS.MARKETPLACE.SEARCH,
    async (_event, query: string, limit?: number) => {
      try {
        const result = await searchSkills(query, limit);
        return { success: true, data: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  );

  // Browse skills (paginated)
  ipcMain.handle(
    IPC_CHANNELS.MARKETPLACE.BROWSE,
    async (_event, cursor?: string, limit?: number) => {
      try {
        const result = await browseSkills({ cursor, limit });
        return { success: true, data: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  );

  // Get skill detail
  ipcMain.handle(
    IPC_CHANNELS.MARKETPLACE.DETAIL,
    async (_event, slug: string) => {
      try {
        const [detail, fileContent, scanResult] = await Promise.all([
          getSkillDetail(slug),
          getSkillFile(slug, 'SKILL.md').catch(() => null),
          getScanResult(slug).catch(() => null),
        ]);
        return {
          success: true,
          data: {
            ...detail,
            skillMdContent: fileContent,
            scanResult,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  );

  // Install skill
  ipcMain.handle(
    IPC_CHANNELS.MARKETPLACE.INSTALL,
    async (_event, slug: string, overwrite?: boolean) => {
      try {
        const result = await install(slug, overwrite);
        return { success: true, data: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  );

  // Uninstall skill
  ipcMain.handle(
    IPC_CHANNELS.MARKETPLACE.UNINSTALL,
    async (_event, skillName: string) => {
      try {
        const result = uninstall(skillName);
        return { success: true, data: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  );

  // Get installed skill slugs
  ipcMain.handle(
    IPC_CHANNELS.MARKETPLACE.INSTALLED,
    async () => {
      try {
        const slugs = getInstalledSlugs();
        return { success: true, data: { slugs } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  );

  console.log('[Marketplace] Handlers registered');
}
