/**
 * Chat Export Service
 *
 * Export chat sessions to Markdown or JSON format.
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import type { SessionMessage } from '@shared/types/chat.types';

/**
 * Export session to Markdown format
 */
export function exportToMarkdown(
  messages: SessionMessage[],
  title: string
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`Exported: ${new Date().toISOString()}`);
  lines.push('');

  // Messages
  for (const msg of messages) {
    const timestamp = msg.timestamp
      ? new Date(msg.timestamp).toLocaleString()
      : '';

    if (msg.type === 'user') {
      lines.push(`## User (${timestamp})`);
      lines.push('');
      const content = typeof msg.content === 'string' ? msg.content : '';
      lines.push(content);
      lines.push('');
    } else if (msg.type === 'assistant') {
      lines.push(`## Assistant (${timestamp})`);
      lines.push('');

      if (typeof msg.content === 'string') {
        lines.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            lines.push(block.text);
            lines.push('');
          } else if (block.type === 'tool_use') {
            lines.push(`**Tool: ${block.name || 'unknown'}**`);
            lines.push('```json');
            lines.push(JSON.stringify(block.input, null, 2));
            lines.push('```');
            lines.push('');
          } else if (block.type === 'tool_result') {
            lines.push('**Result:**');
            lines.push('```');
            lines.push(
              typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content, null, 2)
            );
            lines.push('```');
            lines.push('');
          }
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Export session to JSON format
 */
export function exportToJson(messages: SessionMessage[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      messages,
    },
    null,
    2
  );
}

/**
 * Get export output directory
 */
export function getExportDir(): string {
  return path.join(homedir(), '.multicc', 'exports');
}

/**
 * Export session to file
 * Returns the output file path
 */
export async function exportSession(
  messages: SessionMessage[],
  title: string,
  format: 'markdown' | 'json',
  customFilename?: string
): Promise<string> {
  const exportDir = getExportDir();

  // Ensure export directory exists
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  // Generate filename
  const safeTitle = title
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')
    .slice(0, 50);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const extension = format === 'markdown' ? 'md' : 'json';
  const filename =
    customFilename || `${safeTitle}_${timestamp}.${extension}`;
  const outputPath = path.join(exportDir, filename);

  // Generate content
  const content =
    format === 'markdown'
      ? exportToMarkdown(messages, title)
      : exportToJson(messages);

  // Write file
  fs.writeFileSync(outputPath, content, 'utf-8');

  return outputPath;
}
