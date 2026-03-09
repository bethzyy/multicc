/**
 * CLAUDE.md Editor Component
 *
 * Simple markdown editor for editing CLAUDE.md files
 */

import { useState, useEffect, useCallback } from 'react';
import './ClaudeMdEditor.css';

interface ClaudeMdEditorProps {
  initialContent: string;
  filePath: string;
  onSave: (content: string) => Promise<boolean>;
  onClose: () => void;
  isProjectLevel?: boolean;
}

export function ClaudeMdEditor({
  initialContent,
  filePath,
  onSave,
  onClose,
  isProjectLevel = false,
}: ClaudeMdEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [originalContent, setOriginalContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Track unsaved changes
  useEffect(() => {
    setHasUnsavedChanges(content !== originalContent);
  }, [content, originalContent]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S to save
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      // Escape to close (with confirmation if unsaved)
      if (e.key === 'Escape') {
        if (hasUnsavedChanges) {
          if (confirm('Discard unsaved changes?')) {
            onClose();
          }
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasUnsavedChanges, content, originalContent]);

  const handleSave = useCallback(async () => {
    if (saving) return;

    setSaving(true);
    try {
      const success = await onSave(content);
      if (success) {
        setOriginalContent(content);
        setLastSaved(new Date());
        setHasUnsavedChanges(false);
      }
    } finally {
      setSaving(false);
    }
  }, [content, onSave, saving]);

  const handleReset = useCallback(() => {
    if (confirm('Reset to original content? All changes will be lost.')) {
      setContent(originalContent);
    }
  }, [originalContent]);

  return (
    <div className="claude-md-editor">
      <div className="claude-md-editor__header">
        <div className="claude-md-editor__title">
          <span className="claude-md-editor__icon">📄</span>
          <span>CLAUDE.md Editor</span>
          {isProjectLevel && (
            <span className="claude-md-editor__badge">Project</span>
          )}
        </div>
        <div className="claude-md-editor__status">
          {hasUnsavedChanges && (
            <span className="claude-md-editor__unsaved">Unsaved changes</span>
          )}
          {lastSaved && (
            <span className="claude-md-editor__saved">
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="claude-md-editor__actions">
          <button
            className="claude-md-editor__button claude-md-editor__button--secondary"
            onClick={handleReset}
            disabled={!hasUnsavedChanges}
          >
            Reset
          </button>
          <button
            className="claude-md-editor__button claude-md-editor__button--primary"
            onClick={handleSave}
            disabled={saving || !hasUnsavedChanges}
          >
            {saving ? 'Saving...' : 'Save (Ctrl+S)'}
          </button>
          <button
            className="claude-md-editor__button claude-md-editor__button--ghost"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="claude-md-editor__path">{filePath}</div>

      <div className="claude-md-editor__toolbar">
        <span className="claude-md-editor__hint">
          💡 Press Ctrl+S to save, Esc to close
        </span>
        <span className="claude-md-editor__stats">
          {content.split('\n').length} lines • {content.length} characters
        </span>
      </div>

      <textarea
        className="claude-md-editor__textarea"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="# Project Instructions

Add your custom instructions here...

## Examples
- Coding style preferences
- Project-specific context
- Common commands"
        spellCheck={false}
      />
    </div>
  );
}
