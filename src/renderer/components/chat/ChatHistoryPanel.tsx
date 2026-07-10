/**
 * ChatHistoryPanel - Three-column container
 *
 * Layout: ProjectList (220px) | SessionList (340px) | SessionDetail (flex)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { List } from 'react-window';
import type { ProjectInfo, SessionSummary, SessionMessage, ChatSource } from '@shared/types/chat.types';
import './ChatHistoryPanel.css';

/** Archive banner component */
function ArchiveBanner({ onDismiss }: { onDismiss: () => void }) {
  const [archiveEnabled, setArchiveEnabled] = useState(true);
  const [archiveProgress, setArchiveProgress] = useState<{ synced: number; total: number } | null>(null);

  useEffect(() => {
    window.electron.chat.getArchiveEnabled()
      .then((result) => setArchiveEnabled(result.enabled))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!window.electron.chat.onArchiveProgress) return;
    const unsub = window.electron.chat.onArchiveProgress((data) => {
      if (data.synced >= data.total) {
        setTimeout(() => setArchiveProgress(null), 2000);
      }
      setArchiveProgress(data);
    });
    return () => { unsub?.(); };
  }, []);

  const handleToggle = useCallback(() => {
    const next = !archiveEnabled;
    setArchiveEnabled(next);
    window.electron.chat.setArchiveEnabled(next).catch(() => {});
  }, [archiveEnabled]);

  return (
    <div className="chat-archive-banner">
      <span className="chat-archive-banner__text">
        {archiveProgress && archiveProgress.total > 0
          ? `Archiving... ${archiveProgress.synced}/${archiveProgress.total}`
          : 'Chat history is automatically archived to preserve sessions beyond Claude Code\'s 30-day limit.'}
      </span>
      <div className="chat-archive-banner__actions">
        <label className="chat-archive-toggle">
          <input
            type="checkbox"
            checked={archiveEnabled}
            onChange={handleToggle}
          />
          <span>{archiveEnabled ? 'Archive On' : 'Archive Off'}</span>
        </label>
        <button className="chat-archive-banner__close" onClick={onDismiss}>
          &times;
        </button>
      </div>
    </div>
  );
}

/** Project list component */
function ProjectList({
  projects,
  selectedProjectHash,
  onSelectProject,
  totalSessionCount,
}: {
  projects: ProjectInfo[];
  selectedProjectHash: string | null;
  onSelectProject: (projectHash: string | null) => void;
  totalSessionCount: number;
}) {
  return (
    <div className="project-list">
      <div className="project-list__header">Projects ({projects.length})</div>

      <div
        className={`project-list__item ${selectedProjectHash === null ? 'project-list__item--selected' : ''}`}
        onClick={() => onSelectProject(null)}
      >
        <span className="project-list__icon">📁</span>
        <span className="project-list__name">All Projects</span>
        <span className="project-list__count">{totalSessionCount}</span>
      </div>

      {projects.map((project) => (
        <div
          key={project.projectHash}
          className={`project-list__item ${selectedProjectHash === project.projectHash ? 'project-list__item--selected' : ''}`}
          onClick={() => onSelectProject(project.projectHash)}
        >
          <span className="project-list__icon">📂</span>
          <span className="project-list__name" title={project.displayPath}>
            {project.displayName}
          </span>
          <span className="project-list__count">{project.sessionCount}</span>
        </div>
      ))}
    </div>
  );
}

/** Session card row for virtual list (react-window v2 API) */
function SessionCardRow({
  index,
  style,
  sessions,
  selectedId,
  onSelect,
}: {
  index: number;
  style: React.CSSProperties;
  sessions: SessionSummary[];
  selectedId: string | null;
  onSelect: (sessionId: string) => void;
}) {
  const session = sessions[index];
  if (!session) return null;

  const isSelected = selectedId === session.sessionId;

  return (
    <div
      style={style}
      className={`session-card ${isSelected ? 'session-card--selected' : ''}`}
      onClick={() => onSelect(session.sessionId)}
    >
      <div className="session-card__title">
        {session.customTitle || session.title}
      </div>
      <div className="session-card__preview">
        {session.cwd || 'No working directory'}
      </div>
      <div className="session-card__footer">
        <span>{new Date(session.lastModified).toLocaleDateString()}</span>
        <span className={`session-card__source ${session.archiveOnly ? 'session-card__source--archive' : ''}`}>
          {session.archiveOnly ? 'Archive Only' : session.source || 'claude-code'}
        </span>
      </div>
    </div>
  );
}

/** Session list component with virtual scrolling */
function SessionList({
  sessions,
  selectedId,
  onSelect,
  searchQuery,
  onSearchChange,
  searching,
}: {
  sessions: SessionSummary[];
  selectedId: string | null;
  onSelect: (sessionId: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searching: boolean;
}) {
  const [listApi, setListApi] = useState<{ scrollToRow: (args: { index: number; align?: string }) => void } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(400);

  // Update list height on resize
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Subtract header and search heights (approx 100px)
        setListHeight(entry.contentRect.height - 100);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Scroll to selected session
  useEffect(() => {
    if (selectedId && listApi) {
      const index = sessions.findIndex((s) => s.sessionId === selectedId);
      if (index >= 0) {
        listApi.scrollToRow({ index, align: 'smart' });
      }
    }
  }, [selectedId, sessions, listApi]);

  return (
    <div className="session-list" ref={containerRef}>
      <div className="session-list__search">
        <input
          type="text"
          className="session-list__search-input"
          placeholder="Search sessions..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="session-list__header">
        {searching ? 'Searching...' : searchQuery ? `Results (${sessions.length})` : `Sessions (${sessions.length})`}
      </div>

      <div className="session-list__items">
        {sessions.length === 0 ? (
          <div style={{ padding: '16px', color: '#6d6d6d', textAlign: 'center' }}>
            {searchQuery ? 'No matching sessions found' : 'No sessions yet'}
          </div>
        ) : (
          <List
            listRef={setListApi}
            rowComponent={SessionCardRow}
            rowCount={sessions.length}
            rowHeight={88}
            rowProps={{
              sessions,
              selectedId,
              onSelect,
            }}
            style={{ height: listHeight, width: '100%' }}
            overscanCount={5}
          />
        )}
      </div>
    </div>
  );
}

/** 详情视图单次渲染的消息条数上限（增量加载，避免长会话全量渲染卡顿） */
const DETAIL_RENDER_CHUNK = 200;

/** Session detail component */
function SessionDetail({
  messages,
  loading,
  sessionId,
  session,
  onResumeSession,
}: {
  messages: SessionMessage[];
  loading: boolean;
  sessionId: string | null;
  session: SessionSummary | null;
  onResumeSession?: (info: { sessionId: string; cwd: string; source: ChatSource; customTitle?: string }) => void;
}) {
  // 默认只渲染最后 DETAIL_RENDER_CHUNK 条，点"加载更早"递增；切换会话时重置
  const [visibleCount, setVisibleCount] = useState(DETAIL_RENDER_CHUNK);
  useEffect(() => {
    setVisibleCount(DETAIL_RENDER_CHUNK);
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="session-detail__empty">
        <span>Select a session to view details</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="session-detail">
        <div className="session-detail__empty">
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  const canResume = session && (session.cwd || messages.some((m) => m.cwd));

  return (
    <div className="session-detail">
      {session && (
        <div className="session-detail__header">
          <div>
            <div className="session-detail__title">
              {session.customTitle || session.title}
            </div>
            <div className="session-detail__meta">
              {session.cwd && <span>📁 {session.cwd}</span>}
              {' • '}
              <span>{messages.length} messages</span>
            </div>
          </div>
          <div className="session-detail__actions">
            {canResume && onResumeSession && (
              <button
                className="session-detail__button session-detail__button--primary"
                onClick={() =>
                  onResumeSession({
                    sessionId: session.sessionId,
                    cwd: session.cwd || messages.find((m) => m.cwd)?.cwd || '',
                    source: session.source || 'claude-code',
                    customTitle: session.customTitle,
                  })
                }
              >
                Resume Session
              </button>
            )}
            <button
              className="session-detail__button"
              onClick={() => {
                window.electron.chat.export(
                  session.projectHash,
                  session.sessionId,
                  'markdown',
                  session.customTitle || session.title
                ).then((result) => {
                  window.electron.chat.revealFile(result.outputPath);
                }).catch(console.error);
              }}
            >
              Export
            </button>
          </div>
        </div>
      )}

      <div className="session-detail__messages">
        {messages.length > visibleCount && (
          <button
            className="session-detail__button"
            style={{ display: 'block', margin: '8px auto' }}
            onClick={() => setVisibleCount((c) => c + DETAIL_RENDER_CHUNK)}
          >
            Load earlier messages ({messages.length - visibleCount} more)
          </button>
        )}
        {messages.length === 0 ? (
          <div style={{ color: '#6d6d6d', textAlign: 'center', padding: '16px' }}>
            No messages in this session
          </div>
        ) : (
          messages.slice(Math.max(0, messages.length - visibleCount)).map((msg) => (
            <div key={msg.uuid} className={`message message--${msg.type}`}>
              <div className="message__role">{msg.type}</div>
              <div className="message__content">
                {typeof msg.content === 'string' ? (
                  msg.content
                ) : (
                  msg.content.map((block, i) => (
                    <div key={i}>
                      {block.type === 'text' && <span>{block.text}</span>}
                      {block.type === 'tool_use' && (
                        <div className="tool-block">
                          <div className="tool-block__header">
                            <span className="tool-block__name">{block.name}</span>
                          </div>
                          <pre className="tool-block__content">
                            {JSON.stringify(block.input, null, 2)}
                          </pre>
                        </div>
                      )}
                      {block.type === 'tool_result' && (
                        <div className="tool-block">
                          <div className="tool-block__header">
                            <span>Result</span>
                          </div>
                          <pre className="tool-block__content">
                            {typeof block.content === 'string'
                              ? block.content
                              : JSON.stringify(block.content, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
              {msg.timestamp && (
                <div className="message__timestamp">
                  {new Date(msg.timestamp).toLocaleString()}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Main ChatHistoryPanel component */
interface ChatHistoryPanelProps {
  onClose: () => void;
  onResumeSession?: (info: { sessionId: string; cwd: string; source: ChatSource; customTitle?: string }) => void;
}

export function ChatHistoryPanel({ onClose, onResumeSession }: ChatHistoryPanelProps) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProjectHash, setSelectedProjectHash] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem('multicc-archive-notice-dismissed') === 'true'
  );

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);

  // Fetch projects on mount
  useEffect(() => {
    setProjectsLoading(true);
    window.electron.chat.getProjects()
      .then((result) => setProjects(result.projects || []))
      .catch(console.error)
      .finally(() => setProjectsLoading(false));
  }, []);

  // Fetch sessions after projects are loaded
  useEffect(() => {
    if (projectsLoading) return;
    setSessionsLoading(true);
    window.electron.chat.getSessions(selectedProjectHash)
      .then((result) => setSessions(result.sessions || []))
      .catch(console.error)
      .finally(() => setSessionsLoading(false));
  }, [selectedProjectHash, projectsLoading]);

  // Fetch session detail
  useEffect(() => {
    if (!selectedSessionId) {
      setMessages([]);
      return;
    }

    const session = sessions.find((s) => s.sessionId === selectedSessionId);
    if (!session) return;

    setLoading(true);
    window.electron.chat.getSession(session.projectHash, selectedSessionId)
      .then((result) => setMessages(result.messages || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedSessionId, sessions]);

  // Search effect
  useEffect(() => {
    if (!searchQuery.trim()) return;

    setSearching(true);
    const timer = setTimeout(() => {
      window.electron.chat.search(searchQuery.trim())
        .then((result) => {
          // For now, just filter sessions by search results
          const resultIds = new Set(result.results.map((r) => r.sessionId));
          // Could enhance to show snippets
        })
        .catch(console.error)
        .finally(() => setSearching(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleDismissBanner = useCallback(() => {
    localStorage.setItem('multicc-archive-notice-dismissed', 'true');
    setBannerDismissed(true);
  }, []);

  const handleSelectProject = useCallback((projectHash: string | null) => {
    setSelectedProjectHash(projectHash);
    setSelectedSessionId(null);
    setMessages([]);
  }, []);

  const totalSessionCount = projects.reduce((sum, p) => sum + p.sessionCount, 0);

  // Get selected session for detail view
  const selectedSession = sessions.find((s) => s.sessionId === selectedSessionId) || null;

  return (
    <div className="chat-history-panel">
      {!bannerDismissed && <ArchiveBanner onDismiss={handleDismissBanner} />}

      <div className="chat-history-panel__columns">
        <div className="chat-history-panel__left">
          {projectsLoading && projects.length === 0 ? (
            <div className="panel-skeleton">
              <div className="panel-skeleton__header" />
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="panel-skeleton__item">
                  <div className="panel-skeleton__dot" />
                  <div className="panel-skeleton__text" />
                  <div className="panel-skeleton__badge" />
                </div>
              ))}
            </div>
          ) : (
            <ProjectList
              projects={projects}
              selectedProjectHash={selectedProjectHash}
              onSelectProject={handleSelectProject}
              totalSessionCount={totalSessionCount}
            />
          )}
        </div>

        <div className="chat-history-panel__middle">
          {sessionsLoading && sessions.length === 0 ? (
            <div className="panel-skeleton">
              <div className="panel-skeleton__header" />
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="panel-skeleton__card">
                  <div className="panel-skeleton__title" />
                  <div className="panel-skeleton__preview" />
                  <div className="panel-skeleton__footer" />
                </div>
              ))}
            </div>
          ) : (
            <SessionList
              sessions={sessions}
              selectedId={selectedSessionId}
              onSelect={setSelectedSessionId}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              searching={searching}
            />
          )}
        </div>

        <div className="chat-history-panel__right">
          <SessionDetail
            messages={messages}
            loading={loading}
            sessionId={selectedSessionId}
            session={selectedSession}
            onResumeSession={onResumeSession}
          />
        </div>
      </div>
    </div>
  );
}
