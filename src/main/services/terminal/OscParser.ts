/**
 * OSC Sequence Parser
 *
 * Parses OSC (Operating System Command) escape sequences from terminal output.
 * Used for:
 * - CWD detection (OSC 7, OSC 9;9)
 * - Shell integration (OSC 133)
 * - Bell detection (waiting for input)
 *
 * Exported functions:
 * - parseOscSequences - Parse all OSC sequences from terminal output
 * - extractLatestCwd - Get the latest CWD from terminal output
 * - detectWaitingForInput - Detect if shell is waiting for input
 * - detectCommandState - Detect command execution state
 * - StateChangeDebouncer - Debounce state changes
 */

/** OSC sequence types we care about */
export type OscSequenceType =
  | 'osc7'      // CWD: ESC ] 7 ; file://hostname/path BEL
  | 'osc99'     // CWD: ESC ] 9 ; 9 ; cwd BEL (Windows Terminal)
  | 'osc133'    // Shell integration: ESC ] 133 ; A/B/C/D BEL
  | 'bell'      // BEL character (0x07)
  | 'other';    // Other OSC sequences

export interface OscSequence {
  type: OscSequenceType;
  value?: string;
  timestamp: number;
}

/** Shell integration markers (OSC 133) */
export type ShellIntegrationMarker =
  | 'A'  // Mark start of prompt
  | 'B'  // Mark start of command line
  | 'C'  // Mark start of command output
  | 'D'  // Mark end of command
  | 'P'  // Mark pre-execution
  | 'K'; // Mark keyboard input

/**
 * Parse terminal data for OSC sequences
 * Returns all detected sequences
 */
export function parseOscSequences(data: string): OscSequence[] {
  const sequences: OscSequence[] = [];
  const timestamp = Date.now();

  // Check for bell characters (waiting for input indicator)
  if (data.includes('\x07')) {
    sequences.push({ type: 'bell', timestamp });
  }

  // OSC 7: CWD detection
  // ESC ] 7 ; file://hostname/path BEL or ST
  const osc7Regex = /\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)[\x07\x1b\\]/g;
  let match;
  while ((match = osc7Regex.exec(data)) !== null) {
    try {
      const cwd = decodeURIComponent(match[1]);
      sequences.push({ type: 'osc7', value: cwd, timestamp });
    } catch {
      // Ignore decode errors
    }
  }

  // OSC 9;9: Windows Terminal CWD
  // ESC ] 9 ; 9 ; cwd BEL
  const osc99Regex = /\x1b\]9;9;([^\x07\x1b]+)[\x07\x1b\\]/g;
  while ((match = osc99Regex.exec(data)) !== null) {
    try {
      const cwd = decodeURIComponent(match[1]);
      sequences.push({ type: 'osc99', value: cwd, timestamp });
    } catch {
      // Ignore decode errors
    }
  }

  // OSC 133: Shell integration (command boundaries)
  // ESC ] 133 ; A/B/C/D ; optional_params BEL
  const osc133Regex = /\x1b\]133;([ABCDPK])(?:;[^\x07\x1b]*)?[\x07\x1b\\]/g;
  while ((match = osc133Regex.exec(data)) !== null) {
    sequences.push({ type: 'osc133', value: match[1], timestamp });
  }

  return sequences;
}

/**
 * Extract the latest CWD from terminal output
 * Prioritizes OSC 9;9 (Windows Terminal) over OSC 7
 */
export function extractLatestCwd(data: string): string | null {
  const sequences = parseOscSequences(data);

  // Prefer OSC 9;9 (Windows Terminal)
  const osc99 = sequences.filter(s => s.type === 'osc99').pop();
  if (osc99?.value) return osc99.value;

  // Fall back to OSC 7
  const osc7 = sequences.filter(s => s.type === 'osc7').pop();
  return osc7?.value || null;
}

/**
 * Detect if shell is waiting for input
 * Based on OSC 133 markers and bell characters
 */
export function detectWaitingForInput(data: string): {
  isWaiting: boolean;
  reason: 'bell' | 'prompt' | 'none';
} {
  const sequences = parseOscSequences(data);

  // Check for bell (often used to notify input ready)
  if (sequences.some(s => s.type === 'bell')) {
    return { isWaiting: true, reason: 'bell' };
  }

  // Check for OSC 133 A (mark start of prompt)
  // This indicates the shell is ready for input
  if (sequences.some(s => s.type === 'osc133' && s.value === 'A')) {
    return { isWaiting: true, reason: 'prompt' };
  }

  return { isWaiting: false, reason: 'none' };
}

/**
 * Detect command execution state from OSC 133 sequences
 */
export function detectCommandState(data: string): {
  commandStarted: boolean;
  commandEnded: boolean;
  isPromptReady: boolean;
} {
  const sequences = parseOscSequences(data);
  const osc133 = sequences.filter(s => s.type === 'osc133');

  return {
    commandStarted: osc133.some(s => s.value === 'B' || s.value === 'C'),
    commandEnded: osc133.some(s => s.value === 'D'),
    isPromptReady: osc133.some(s => s.value === 'A'),
  };
}

/**
 * Pattern detection for common "waiting for input" indicators
 * Used as fallback when OSC sequences are not available
 */
export function detectWaitingPatterns(data: string): boolean {
  const waitingPatterns = [
    // Common prompts
    /\n[>$#]\s*$/m,           // Unix-style prompts
    /\nPS\s+[A-Z]:\\.*>\s*$/m, // PowerShell prompts
    /\n>>>?\s*$/m,            // Python REPL
    /\nIn \[\d+\]:\s*$/m,     // IPython/Jupyter
    /\n>>\s*$/m,              // Node.js REPL
    /:\s*$/m,                 // Vim command mode
    /\?\s*$/m,                // Question prompts
    /Press .* to continue/i,  // Continue prompts
    /Enter .*:/i,             // Input prompts
  ];

  return waitingPatterns.some(pattern => pattern.test(data));
}

/**
 * Debounced state change notifier
 * Prevents rapid state changes from causing UI flicker
 */
export class StateChangeDebouncer {
  private lastState: string = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly delayMs: number;

  constructor(delayMs: number = 50) {
    this.delayMs = delayMs;
  }

  notify(newState: string, callback: (state: string) => void): void {
    if (newState === this.lastState) return;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      if (newState !== this.lastState) {
        this.lastState = newState;
        callback(newState);
      }
      this.timer = null;
    }, this.delayMs);
  }

  reset(): void {
    this.lastState = '';
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
