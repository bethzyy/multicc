/**
 * MarkdownContent - Renders markdown text as formatted HTML
 *
 * Uses react-markdown + remark-gfm for GitHub-flavored markdown.
 * Dark theme styling via MarkdownContent.css.
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './MarkdownContent.css';

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
