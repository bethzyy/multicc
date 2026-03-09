/**
 * ConfigBrowser - Two-column layout for Skills and MCP servers
 *
 * Layout: ResourceList | ResourceDetail
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { List } from 'react-window';
import type {
  ConfigResource,
  ResourceContent,
  McpConfigInfo,
  ClaudeMdInfo,
} from '@shared/types/config.types';
import './ConfigBrowser.css';

type TabType = 'skills' | 'mcp' | 'claude-md';

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

  const filteredResources = resources.filter((r) => {
    if (filter === 'skills') return r.type === 'skill';
    if (filter === 'mcp') return r.type === 'mcp-config';
    if (filter === 'claude-md') return r.type === 'claude-md';
    return true;
  });

  // Update list height on resize
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Subtract header height (approx 40px)
        setListHeight(entry.contentRect.height - 40);
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
          {filter === 'skills' && 'Install skills in ~/.claude/skills/'}
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

/** Resource detail component */
function ResourceDetail({
  resource,
  content,
  loading,
}: {
  resource: ConfigResource | null;
  content: ResourceContent | null;
  loading: boolean;
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
        {content?.content || 'No content available'}
      </div>
    </div>
  );
}

/** Main ConfigBrowser component */
interface ConfigBrowserProps {
  onClose: () => void;
}

export function ConfigBrowser({ onClose }: ConfigBrowserProps) {
  const [activeTab, setActiveTab] = useState<TabType>('skills');
  const [resources, setResources] = useState<ConfigResource[]>([]);
  const [selectedResource, setSelectedResource] = useState<ConfigResource | null>(null);
  const [content, setContent] = useState<ResourceContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [resourcesLoading, setResourcesLoading] = useState(true);

  // Fetch resources on mount
  useEffect(() => {
    setResourcesLoading(true);
    window.electron.resources.getResources()
      .then((result) => {
        setResources(result.resources || []);
      })
      .catch(console.error)
      .finally(() => setResourcesLoading(false));
  }, []);

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
  }, []);

  return (
    <div className="config-browser">
      <div className="config-browser__header">
        <span className="config-browser__title">Skills & MCP</span>
        <button className="config-browser__close" onClick={onClose}>
          &times;
        </button>
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
          {resourcesLoading ? (
            <div className="empty-resources">
              <div className="empty-resources__text">Loading...</div>
            </div>
          ) : (
            <ResourceList
              resources={resources}
              selectedPath={selectedResource?.path || null}
              onSelect={handleSelectResource}
              filter={activeTab}
            />
          )}
        </div>

        <div className="config-browser__right">
          <ResourceDetail
            resource={selectedResource}
            content={content}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
}
