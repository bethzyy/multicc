/**
 * Skill Installer
 *
 * Installs/uninstalls skills from ClawHub to ~/.claude/skills/.
 * Security: slug validation, path traversal prevention, safe file writes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { getSkillDetail, getSkillFile } from './ClawHubApi';
import type { InstallResult } from '@shared/types/config.types';

/** Only allow lowercase letters, digits, and hyphens */
const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

/** Get the local skills installation directory */
function getInstallDir(): string {
  return path.join(homedir(), '.claude', 'skills');
}

/** Validate slug to prevent path traversal */
function validateSlug(slug: string): void {
  if (!SAFE_SLUG_RE.test(slug)) {
    throw new Error(`Invalid slug: "${slug}". Only lowercase letters, digits, and hyphens allowed.`);
  }
}

/** Verify a resolved path is inside the skills directory */
function ensureInsideSkillsDir(resolvedPath: string, skillsDir: string): void {
  if (!resolvedPath.startsWith(skillsDir + path.sep) && resolvedPath !== skillsDir) {
    throw new Error(`Path traversal detected: ${resolvedPath} is outside ${skillsDir}`);
  }
}

/**
 * Install a skill from ClawHub.
 *
 * Flow:
 * 1. Validate slug
 * 2. Check if already installed
 * 3. Fetch skill detail + SKILL.md content
 * 4. Create directory and write files
 */
export async function install(slug: string, overwrite = false): Promise<InstallResult> {
  validateSlug(slug);

  const skillsDir = getInstallDir();
  const skillDir = path.resolve(skillsDir, slug);
  ensureInsideSkillsDir(skillDir, skillsDir);

  // Check existing installation
  if (fs.existsSync(skillDir) && !overwrite) {
    return {
      success: false,
      path: skillDir,
      alreadyExists: true,
      error: `Skill "${slug}" is already installed. Use overwrite=true to replace.`,
    };
  }

  try {
    // Fetch skill detail for metadata
    const detail = await getSkillDetail(slug);
    if (!detail.skill) {
      return { success: false, path: '', error: `Skill "${slug}" not found on ClawHub.` };
    }

    // Fetch SKILL.md content
    let skillMdContent: string;
    try {
      skillMdContent = await getSkillFile(slug, 'SKILL.md');
    } catch {
      return { success: false, path: '', error: `Failed to fetch SKILL.md for "${slug}".` };
    }

    // Create directory
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }
    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }

    // Write SKILL.md (atomic write via temp file)
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    const tempPath = `${skillMdPath}.tmp`;
    fs.writeFileSync(tempPath, skillMdContent, 'utf-8');
    fs.renameSync(tempPath, skillMdPath);

    return { success: true, path: skillDir };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, path: '', error: message };
  }
}

/**
 * Uninstall a skill by removing its directory.
 */
export function uninstall(skillName: string): InstallResult {
  validateSlug(skillName);

  const skillsDir = getInstallDir();
  const skillDir = path.resolve(skillsDir, skillName);
  ensureInsideSkillsDir(skillDir, skillsDir);

  if (!fs.existsSync(skillDir)) {
    return { success: false, path: '', error: `Skill "${skillName}" is not installed.` };
  }

  try {
    fs.rmSync(skillDir, { recursive: true, force: true });
    return { success: true, path: skillDir };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, path: '', error: message };
  }
}

/**
 * Check if a skill is installed locally.
 */
export function isInstalled(slug: string): boolean {
  validateSlug(slug);
  const skillDir = path.join(getInstallDir(), slug);
  return fs.existsSync(skillDir);
}

/**
 * Get list of installed skill directory names.
 */
export function getInstalledSlugs(): string[] {
  const skillsDir = getInstallDir();
  if (!fs.existsSync(skillsDir)) return [];

  try {
    return fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && SAFE_SLUG_RE.test(d.name))
      .map((d) => d.name);
  } catch {
    return [];
  }
}
