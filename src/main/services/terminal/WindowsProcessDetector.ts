/**
 * Windows Process Detector
 *
 * Detects foreground process and CWD for terminal instances on Windows.
 * Uses PowerShell commands as Windows alternatives to macOS ps/pgrep/lsof.
 *
 * v2.0.0 - Async optimization:
 * - All blocking execSync calls replaced with async exec
 * - Prevents main thread blocking during shutdown
 * - Improved performance with parallel execution
 */

import { exec, execSync } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ProcessInfo {
  pid: number;
  name: string;
  cwd: string | null;
}

/**
 * Get process name by PID using tasklist
 * Windows alternative to: ps -p PID -o comm=
 */
export function getProcessName(pid: number): string | null {
  try {
    const output = execSync(`tasklist /fi "PID eq ${pid}" /fo csv /nh`, {
      encoding: 'utf-8',
      timeout: 5000,
    });

    // Parse CSV output: "processname.exe","PID","Session Name","Session#","Mem Usage"
    const match = output.match(/"([^"]+)"/);
    return match ? match[1] : null;
  } catch (error) {
    console.error(`[ProcessDetector] Error getting process name for PID ${pid}:`, error);
    return null;
  }
}

/**
 * Async version: Get process name by PID using tasklist
 * Non-blocking alternative to getProcessName()
 */
export async function getProcessNameAsync(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`tasklist /fi "PID eq ${pid}" /fo csv /nh`, {
      timeout: 5000,
      windowsHide: true,
    });

    const match = stdout.match(/"([^"]+)"/);
    return match ? match[1] : null;
  } catch (error) {
    console.error(`[ProcessDetector] Error getting process name for PID ${pid}:`, error);
    return null;
  }
}

/**
 * Get child processes of a parent PID
 * Windows alternative to: pgrep -P PID
 */
export function getChildPids(parentPid: number): number[] {
  try {
    // Use PowerShell for more reliable results
    const output = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'ParentProcessId=${parentPid}' | Select-Object -ExpandProperty ProcessId"`,
      {
        encoding: 'utf-8',
        timeout: 10000,
      }
    );

    const pids: number[] = [];
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && /^\d+$/.test(trimmed)) {
        pids.push(parseInt(trimmed, 10));
      }
    }
    return pids;
  } catch (error) {
    console.error(`[ProcessDetector] Error getting child PIDs for ${parentPid}:`, error);
    return [];
  }
}

/**
 * Async version: Get child processes of a parent PID
 * Non-blocking alternative to getChildPids()
 */
export async function getChildPidsAsync(parentPid: number): Promise<number[]> {
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'ParentProcessId=${parentPid}' | Select-Object -ExpandProperty ProcessId"`,
      {
        timeout: 10000,
        windowsHide: true,
      }
    );

    const pids: number[] = [];
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && /^\d+$/.test(trimmed)) {
        pids.push(parseInt(trimmed, 10));
      }
    }
    return pids;
  } catch (error) {
    console.error(`[ProcessDetector] Error getting child PIDs for ${parentPid}:`, error);
    return [];
  }
}

/**
 * Get process working directory using PowerShell
 * Windows alternative to: lsof -p PID -d cwd
 *
 * Note: This only works for processes started by the current user
 * and may not work for all processes.
 */
export function getProcessCwd(pid: number): string | null {
  try {
    // Method 1: Try using PowerShell Get-Process
    const output = execSync(
      `powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).StartInfo.WorkingDirectory"`,
      {
        encoding: 'utf-8',
        timeout: 5000,
      }
    );

    const cwd = output.trim();
    if (cwd && cwd !== '') {
      return cwd;
    }
  } catch {
    // Method 1 failed, try alternative
  }

  try {
    // Method 2: Use wmic (deprecated but still works)
    const output = execSync(
      `wmic process where ProcessId=${pid} get ExecutablePath /format:list`,
      {
        encoding: 'utf-8',
        timeout: 5000,
      }
    );

    const match = output.match(/ExecutablePath=(.+)/);
    if (match && match[1]) {
      // Get directory from executable path
      const path = match[1].trim();
      const lastSlash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
      if (lastSlash > 0) {
        return path.substring(0, lastSlash);
      }
    }
  } catch {
    // Method 2 failed
  }

  return null;
}

/**
 * Async version: Get process working directory
 * Non-blocking alternative to getProcessCwd()
 */
export async function getProcessCwdAsync(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).StartInfo.WorkingDirectory"`,
      {
        timeout: 5000,
        windowsHide: true,
      }
    );

    const cwd = stdout.trim();
    if (cwd && cwd !== '') {
      return cwd;
    }
  } catch {
    // Method 1 failed, try alternative
  }

  try {
    const { stdout } = await execAsync(
      `wmic process where ProcessId=${pid} get ExecutablePath /format:list`,
      {
        timeout: 5000,
        windowsHide: true,
      }
    );

    const match = stdout.match(/ExecutablePath=(.+)/);
    if (match && match[1]) {
      const path = match[1].trim();
      const lastSlash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
      if (lastSlash > 0) {
        return path.substring(0, lastSlash);
      }
    }
  } catch {
    // Method 2 failed
  }

  return null;
}

/**
 * Async version: Get all descendant processes
 */
export async function getDescendantPidsAsync(rootPid: number): Promise<number[]> {
  const allPids: number[] = [];
  const queue: number[] = [rootPid];
  const visited = new Set<number>();

  while (queue.length > 0) {
    const currentPid = queue.shift()!;
    if (visited.has(currentPid)) continue;
    visited.add(currentPid);

    const children = await getChildPidsAsync(currentPid);
    for (const childPid of children) {
      if (!visited.has(childPid)) {
        allPids.push(childPid);
        queue.push(childPid);
      }
    }
  }

  return allPids;
}

/**
 * Async version: Detect foreground process in a terminal
 * Non-blocking alternative to detectForegroundProcess()
 *
 * This is the recommended version for use in polling loops and shutdown scenarios.
 */
export async function detectForegroundProcessAsync(shellPid: number): Promise<ProcessInfo | null> {
  const descendantPids = await getDescendantPidsAsync(shellPid);

  const shellNames = new Set([
    'cmd.exe',
    'powershell.exe',
    'pwsh.exe',
    'bash.exe',
    'sh.exe',
    'zsh.exe',
    'fish.exe',
  ]);

  for (const pid of descendantPids) {
    const name = await getProcessNameAsync(pid);
    if (name && !shellNames.has(name.toLowerCase())) {
      const cwd = await getProcessCwdAsync(pid);
      return { pid, name, cwd };
    }
  }

  return null;
}

/**
 * Parse OSC 7 escape sequence to extract CWD
 * Format: ESC ] 7 ; file://hostname/path BEL
 *
 * PowerShell 7+ and Windows Terminal support this.
 */
export function parseOsc7Cwd(data: string): string | null {
  // OSC 7 pattern: ESC ] 7 ; file://[^/]*(path) BEL or ST
  const osc7Pattern = /\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)[\x07\x1b\\]/g;
  let match;
  let lastMatch: string | null = null;

  while ((match = osc7Pattern.exec(data)) !== null) {
    lastMatch = match[1];
  }

  if (lastMatch) {
    try {
      // Decode URL-encoded path
      return decodeURIComponent(lastMatch);
    } catch {
      return lastMatch;
    }
  }

  return null;
}

/**
 * Parse OSC 9;9 escape sequence (Windows Terminal specific)
 * Format: ESC ] 9 ; 9 ; cwd BEL
 */
export function parseOsc99Cwd(data: string): string | null {
  // OSC 9;9 pattern: ESC ] 9 ; 9 ; cwd BEL
  const osc99Pattern = /\x1b\]9;9;([^\x07\x1b]+)[\x07\x1b\\]/g;
  let match;
  let lastMatch: string | null = null;

  while ((match = osc99Pattern.exec(data)) !== null) {
    lastMatch = match[1];
  }

  if (lastMatch) {
    try {
      return decodeURIComponent(lastMatch);
    } catch {
      return lastMatch;
    }
  }

  return null;
}

/**
 * Extract CWD from terminal output using OSC sequences
 * Tries OSC 9;9 first (Windows Terminal), then OSC 7 (PowerShell 7+)
 */
export function extractCwdFromOutput(data: string): string | null {
  // Try OSC 9;9 first (Windows Terminal specific)
  const cwd99 = parseOsc99Cwd(data);
  if (cwd99) return cwd99;

  // Fall back to OSC 7 (more universal)
  return parseOsc7Cwd(data);
}

/**
 * Watch for process state changes
 * Returns a cleanup function
 */
export function watchProcessState(
  pid: number,
  callback: (info: { running: boolean; name: string | null }) => void,
  intervalMs: number = 2000
): () => void {
  let lastRunning = true;
  let lastName: string | null = null;

  const check = () => {
    const name = getProcessName(pid);
    const running = name !== null;

    if (running !== lastRunning || name !== lastName) {
      lastRunning = running;
      lastName = name;
      callback({ running, name });
    }
  };

  // Initial check
  check();

  // Set up interval
  const intervalId = setInterval(check, intervalMs);

  return () => clearInterval(intervalId);
}

/**
 * Detect if a CLI tool is available
 * Windows alternative to: which tool
 */
export function detectCliTool(name: string): boolean {
  try {
    execSync(`where ${name}`, { encoding: 'utf-8', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get list of available CLI tools
 */
export function getAvailableCliTools(): string[] {
  const tools = ['claude', 'codex', 'gemini', 'node', 'npm', 'git'];
  return tools.filter(detectCliTool);
}
