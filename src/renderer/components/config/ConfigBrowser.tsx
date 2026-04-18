/**
 * ConfigBrowser - Two-column layout for Skills and MCP servers
 *
 * Layout: ResourceList | ResourceDetail
 * Skills tab has sub-views: Installed (local) | Marketplace (ClawHub)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { List } from 'react-window';
import type {
  ConfigResource,
  ResourceContent,
  McpConfigInfo,
  ClaudeMdInfo,
} from '@shared/types/config.types';
import { MarketplaceView } from './MarketplaceView';
import { MarkdownContent } from '../shared/MarkdownContent';
import { useToast } from '../shared/ToastContext';
import './ConfigBrowser.css';

type TabType = 'skills' | 'mcp' | 'claude-md';
type SkillViewType = 'installed' | 'marketplace';

/** Marketplace detail API response structure */
interface MarketplaceSkillDetail {
  displayName: string;
  summary: string | null;
  updatedAt: number | null;
}

interface MarketplaceOwner {
  displayName: string | null;
}

interface MarketplaceModeration {
  verdict: string | null;
}

interface MarketplaceScanResult {
  model: string | null;
}

interface MarketplaceDetailResponse {
  skill: MarketplaceSkillDetail | null;
  owner: MarketplaceOwner | null;
  moderation: MarketplaceModeration | null;
  skillMdContent: string | null;
  scanResult: MarketplaceScanResult | null;
}

/** Get icon for resource type */
function getResourceIcon(resource: ConfigResource): string {
  if (resource.type === 'skill') return '⚡';
  if (resource.type === 'mcp-config') return '🔌';
  if (resource.type === 'claude-md') return '📄';
  return '📁';
}

/** Format file size */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Resource row for virtual list (react-window v2 API) */
function ResourceRow({
  index,
  style,
  resources,
  selectedPath,
  onSelect,
}: {
  index: number;
  style: React.CSSProperties;
  resources: ConfigResource[];
  selectedPath: string | null;
  onSelect: (resource: ConfigResource) => void;
}) {
  const resource = resources[index];
  if (!resource) return null;

  const isSelected = selectedPath === resource.path;

  return (
    <div
      style={style}
      className={`resource-item ${isSelected ? 'resource-item--selected' : ''}`}
      onClick={() => onSelect(resource)}
    >
      <div className="resource-item__icon">{getResourceIcon(resource)}</div>
      <div className="resource-item__info">
        <div className="resource-item__name">{resource.displayName}</div>
        <div className="resource-item__desc">{resource.description || resource.path}</div>
      </div>
      {resource.isProjectLevel && (
        <span className="resource-item__badge resource-item__badge--project">Project</span>
      )}
    </div>
  );
}

/** Resource list component with virtual scrolling */
function ResourceList({
  resources,
  selectedPath,
  onSelect,
  filter,
}: {
  resources: ConfigResource[];
  selectedPath: string | null;
  onSelect: (resource: ConfigResource) => void;
  filter: TabType;
}) {
  const [listApi, setListApi] = useState<{ scrollToRow: (args: { index: number; align?: string }) => void } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(400);

  const filteredResources = resources
    .filter((r) => {
      if (filter === 'skills') return r.type === 'skill';
      if (filter === 'mcp') return r.type === 'mcp-config';
      if (filter === 'claude-md') return r.type === 'claude-md';
      return true;
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Update list height on resize
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Subtract header height (approx 40px), minimum 100px
        const height = Math.max(entry.contentRect.height - 40, 100);
        setListHeight(height);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Scroll to selected resource
  useEffect(() => {
    if (selectedPath && listApi) {
      const index = filteredResources.findIndex((r) => r.path === selectedPath);
      if (index >= 0) {
        listApi.scrollToRow({ index, align: 'smart' });
      }
    }
  }, [selectedPath, filteredResources, listApi]);

  if (filteredResources.length === 0) {
    return (
      <div className="empty-resources">
        <div className="empty-resources__icon">
          {filter === 'skills' ? '⚡' : filter === 'mcp' ? '🔌' : '📄'}
        </div>
        <div className="empty-resources__text">
          {filter === 'skills' && 'No skills found'}
          {filter === 'mcp' && 'No MCP servers configured'}
          {filter === 'claude-md' && 'No CLAUDE.md files found'}
        </div>
        <div className="empty-resources__hint">
          {filter === 'skills' && 'Install skills in ~/.claude/skills/ or browse the Marketplace'}
          {filter === 'mcp' && 'Configure servers in ~/.claude/mcp.json'}
          {filter === 'claude-md' && 'Create CLAUDE.md in your project'}
        </div>
      </div>
    );
  }

  return (
    <div className="resource-list" ref={containerRef}>
      <div className="resource-list__header">
        {filter === 'skills' && 'Skills'}
        {filter === 'mcp' && 'MCP Servers'}
        {filter === 'claude-md' && 'CLAUDE.md Files'}
      </div>

      <List
        listRef={setListApi}
        rowComponent={ResourceRow}
        rowCount={filteredResources.length}
        rowHeight={64}
        rowProps={{
          resources: filteredResources,
          selectedPath,
          onSelect,
        }}
        style={{ height: listHeight, width: '100%' }}
        overscanCount={5}
      />
    </div>
  );
}

/** Detail panel for a selected local resource (skill, MCP config, CLAUDE.md) */
function ResourceDetail({
  resource,
  content,
  loading,
  translatedContent,
  showTranslated,
}: {
  resource: ConfigResource | null;
  content: ResourceContent | null;
  loading: boolean;
  translatedContent: string | null;
  showTranslated: boolean;
}) {
  if (!resource) {
    return (
      <div className="resource-detail__empty">
        <span>Select a resource to view details</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="resource-detail">
        <div className="resource-detail__empty">
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  // MCP config with servers
  if (resource.type === 'mcp-config') {
    const mcpConfig = resource as McpConfigInfo;
    return (
      <div className="resource-detail">
        <div className="resource-detail__header">
          <div className="resource-detail__title">{resource.displayName}</div>
          <div className="resource-detail__meta">
            {mcpConfig.servers.length} server{mcpConfig.servers.length !== 1 ? 's' : ''} •{' '}
            {resource.isProjectLevel ? 'Project level' : 'System level'}
          </div>
        </div>

        <div className="mcp-server-list">
          {mcpConfig.servers.map((server) => (
            <div key={server.name} className="mcp-server-item">
              <div className="mcp-server-item__icon">🔌</div>
              <div className="mcp-server-item__info">
                <div className="mcp-server-item__name">{server.name}</div>
                <div className="mcp-server-item__command">
                  {server.command} {server.args?.join(' ')}
                </div>
              </div>
              <span
                className={`mcp-server-item__status ${
                  server.disabled ? 'mcp-server-item__status--disabled' : 'mcp-server-item__status--enabled'
                }`}
              >
                {server.disabled ? 'Disabled' : 'Enabled'}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Skill or CLAUDE.md with content
  const displayContent = showTranslated && translatedContent
    ? translatedContent
    : content?.content || 'No content available';

  return (
    <div className="resource-detail">
      <div className="resource-detail__header">
        <div className="resource-detail__title">{resource.displayName}</div>
        <div className="resource-detail__meta">
          {resource.type === 'skill' && `Skill • ${resource.isProjectLevel ? 'Project' : 'System'}`}
          {resource.type === 'claude-md' && (
            <>
              {formatSize((resource as ClaudeMdInfo).size || 0)} •{' '}
              {resource.isProjectLevel ? 'Project' : 'System'}
            </>
          )}
        </div>
      </div>

      <div className="resource-detail__content">
        <MarkdownContent content={displayContent} />
      </div>
    </div>
  );
}

/** Marketplace detail view for a selected ClawHub skill */
function MarketplaceDetail({ slug, translatedContent, showTranslated, onContentLoaded }: {
  slug: string;
  translatedContent: string | null;
  showTranslated: boolean;
  onContentLoaded?: (content: string) => void;
}) {
  const [detail, setDetail] = useState<MarketplaceDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError('');
    window.electron.marketplace.detail(slug)
      .then((res) => {
        if (res.success && res.data) {
          setDetail(res.data);
          // Lift raw content to parent for translation
          if (res.data.skillMdContent) {
            onContentLoaded?.(res.data.skillMdContent);
          }
        } else {
          setError(res.error || 'Failed to load skill detail');
        }
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="resource-detail">
        <div className="resource-detail__empty"><span>Loading...</span></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="resource-detail">
        <div className="resource-detail__empty"><span>{error}</span></div>
      </div>
    );
  }

  if (!detail) return null;

  const skill = detail.skill;
  const owner = detail.owner;
  const moderation = detail.moderation;
  const skillMdContent = detail.skillMdContent;
  const scanResult = detail.scanResult;

  return (
    <div className="resource-detail">
      <div className="resource-detail__header">
        <div className="resource-detail__title">
          {skill?.displayName || slug}
        </div>
        <div className="resource-detail__meta">
          {owner?.displayName && `by ${owner.displayName}`}
          {skill?.updatedAt && ` • Updated ${new Date(skill.updatedAt).toLocaleDateString()}`}
        </div>
      </div>

      {/* Security badge */}
      {moderation && (
        <div style={{ marginBottom: 12 }}>
          <span className={`security-badge security-badge--${moderation.verdict || 'pending'}`}>
            {moderation.verdict === 'clean' ? '✓ Clean' :
             moderation.verdict === 'suspicious' ? '⚠ Suspicious' :
             moderation.verdict === 'malicious' ? '✕ Malicious' : '? Unknown'}
          </span>
          {scanResult && scanResult?.model && (
            <span style={{ fontSize: 10, color: '#4d4d4d', marginLeft: 8 }}>
              scanned by {scanResult.model}
            </span>
          )}
        </div>
      )}

      {/* Summary */}
      {skill?.summary && (
        <div style={{ fontSize: 13, color: '#9d9d9d', marginBottom: 16 }}>
          {skill.summary}
        </div>
      )}

      {/* SKILL.md content */}
      {skillMdContent && (
        <div className="resource-detail__content">
          <MarkdownContent content={showTranslated && translatedContent ? translatedContent : skillMdContent} />
        </div>
      )}
    </div>
  );
}

/** Main ConfigBrowser component */
interface ConfigBrowserProps {
  onClose: () => void;
  cwd?: string;
}

export function ConfigBrowser({ onClose, cwd }: ConfigBrowserProps) {
  const [activeTab, setActiveTab] = useState<TabType>('skills');
  const [skillView, setSkillView] = useState<SkillViewType>('marketplace');
  const [resources, setResources] = useState<ConfigResource[]>([]);
  const [selectedResource, setSelectedResource] = useState<ConfigResource | null>(null);
  const [selectedMarketplaceSlug, setSelectedMarketplaceSlug] = useState<string | null>(null);
  const [content, setContent] = useState<ResourceContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [marketplaceContent, setMarketplaceContent] = useState<string | null>(null);

  // Translation state (shared by Installed + Marketplace)
  const [translatedContent, setTranslatedContent] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [showTranslated, setShowTranslated] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const { showToast } = useToast();

  // Determine what text is currently displayed (for translation source)
  const currentText = selectedResource
    ? content?.content || null
    : selectedMarketplaceSlug
      ? marketplaceContent
      : null;

  // Has translatable content?
  const hasContent = !!(selectedResource && content?.content) || !!selectedMarketplaceSlug;

  // Fetch resources on mount and when cwd changes
  useEffect(() => {
    setResourcesLoading(true);
    window.electron.resources.getResources(cwd)
      .then((result) => {
        setResources(result.resources || []);
      })
      .catch(console.error)
      .finally(() => setResourcesLoading(false));
  }, [cwd]);

  // Fetch content when resource is selected
  useEffect(() => {
    if (!selectedResource) {
      setContent(null);
      return;
    }

    setLoading(true);
    window.electron.resources.getResourceContent(selectedResource.path)
      .then((result) => {
        setContent(result);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedResource]);

  const handleSelectResource = useCallback((resource: ConfigResource) => {
    setSelectedResource(resource);
    setSelectedMarketplaceSlug(null);
    // Reset translation on selection change
    setTranslatedContent(null);
    setShowTranslated(false);
    setTranslateError(null);
  }, []);

  const handleSelectMarketplaceSkill = useCallback((slug: string) => {
    setSelectedMarketplaceSlug(slug);
    setSelectedResource(null);
    // Reset translation and marketplace content on selection change
    setTranslatedContent(null);
    setShowTranslated(false);
    setMarketplaceContent(null);
    setTranslateError(null);
  }, []);

  // Translate handler
  const handleTranslate = useCallback(async () => {
    setTranslateError(null);

    // Toggle if already translated
    if (translatedContent) {
      setShowTranslated(!showTranslated);
      return;
    }

    // Get the text to translate from React state (not DOM)
    let textToTranslate: string | null = null;
    if (selectedResource) {
      textToTranslate = content?.content || null;
    } else if (selectedMarketplaceSlug) {
      textToTranslate = marketplaceContent;
    }

    if (!textToTranslate) {
      setTranslateError('没有可翻译的内容');
      return;
    }

    setTranslating(true);
    try {
      const result = await window.electron.resources.translate(textToTranslate);

      if (result.success && result.translated) {
        setTranslatedContent(result.translated);
        setShowTranslated(true);
        setTranslateError(null);
      } else {
        const errorMsg = result.error || 'Unknown error';
        console.error('[ConfigBrowser] Translation failed:', errorMsg);
        setTranslateError(errorMsg);
        if (errorMsg.includes('ZHIPU_API_KEY')) {
          showToast('请设置 ZHIPU_API_KEY 环境变量', 'error');
        } else {
          showToast('翻译失败: ' + errorMsg, 'error');
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[ConfigBrowser] Translation error:', errMsg);
      setTranslateError(errMsg);
      showToast('翻译出错，请检查网络连接', 'error');
    } finally {
      setTranslating(false);
    }
  }, [selectedResource, content, selectedMarketplaceSlug, marketplaceContent, translatedContent, showTranslated, showToast]);

  return (
    <div className="config-browser">
      <div className="config-browser__header">
        <span className="config-browser__title">Skills & MCP</span>
        <div className="config-browser__header-actions">
          {hasContent && (
            <button
              className="translate-btn"
              onClick={handleTranslate}
              disabled={translating}
              title={showTranslated ? 'Show original' : 'Translate to Chinese'}
            >
              {translating ? '...' : showTranslated ? 'EN' : '中'}
            </button>
          )}
          {translateError && (
            <span style={{ fontSize: 11, color: '#f44336', maxWidth: 200 }} title={translateError}>
              {translateError.substring(0, 30)}
            </span>
          )}
          <button className="config-browser__close" onClick={onClose}>
            &times;
          </button>
        </div>
      </div>

      <div className="config-browser__tabs">
        <button
          className={`config-browser__tab ${activeTab === 'skills' ? 'config-browser__tab--active' : ''}`}
          onClick={() => setActiveTab('skills')}
        >
          ⚡ Skills
        </button>
        <button
          className={`config-browser__tab ${activeTab === 'mcp' ? 'config-browser__tab--active' : ''}`}
          onClick={() => setActiveTab('mcp')}
        >
          🔌 MCP Servers
        </button>
        <button
          className={`config-browser__tab ${activeTab === 'claude-md' ? 'config-browser__tab--active' : ''}`}
          onClick={() => setActiveTab('claude-md')}
        >
          📄 CLAUDE.md
        </button>
      </div>

      <div className="config-browser__content">
        <div className="config-browser__left">
          {/* Skills tab: sub-view toggle + content */}
          {activeTab === 'skills' && (
            <>
              <div className="skill-view-toggle">
                <button
                  className={`skill-view-toggle__btn ${skillView === 'installed' ? 'skill-view-toggle__btn--active' : ''}`}
                  onClick={() => setSkillView('installed')}
                >
                  Installed
                </button>
                <button
                  className={`skill-view-toggle__btn ${skillView === 'marketplace' ? 'skill-view-toggle__btn--active' : ''}`}
                  onClick={() => setSkillView('marketplace')}
                >
                  🏪 Marketplace
                </button>
              </div>

              {skillView === 'installed' ? (
                resourcesLoading ? (
                  <div className="empty-resources">
                    <div className="empty-resources__text">Loading...</div>
                  </div>
                ) : (
                  <ResourceList
                    resources={resources}
                    selectedPath={selectedResource?.path || null}
                    onSelect={handleSelectResource}
                    filter="skills"
                  />
                )
              ) : (
                <MarketplaceView
                  selectedSlug={selectedMarketplaceSlug}
                  onSelectSkill={handleSelectMarketplaceSkill}
                />
              )}
            </>
          )}

          {/* MCP tab */}
          {activeTab === 'mcp' && (
            resourcesLoading ? (
              <div className="empty-resources">
                <div className="empty-resources__text">Loading...</div>
              </div>
            ) : (
              <ResourceList
                resources={resources}
                selectedPath={selectedResource?.path || null}
                onSelect={handleSelectResource}
                filter="mcp"
              />
            )
          )}

          {/* CLAUDE.md tab */}
          {activeTab === 'claude-md' && (
            resourcesLoading ? (
              <div className="empty-resources">
                <div className="empty-resources__text">Loading...</div>
              </div>
            ) : (
              <ResourceList
                resources={resources}
                selectedPath={selectedResource?.path || null}
                onSelect={handleSelectResource}
                filter="claude-md"
              />
            )
          )}
        </div>

        <div className="config-browser__right">
          {selectedMarketplaceSlug ? (
            <MarketplaceDetail
              slug={selectedMarketplaceSlug}
              translatedContent={translatedContent}
              showTranslated={showTranslated}
              onContentLoaded={setMarketplaceContent}
            />
          ) : (
            <ResourceDetail
              resource={selectedResource}
              content={content}
              loading={loading}
              translatedContent={translatedContent}
              showTranslated={showTranslated}
            />
          )}
        </div>
      </div>
    </div>
  );
}
