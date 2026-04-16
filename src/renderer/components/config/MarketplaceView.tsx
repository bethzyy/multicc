/**
 * MarketplaceView - Browse and install skills from ClawHub
 *
 * Displays within the Skills tab as a sub-view.
 * Features: search, cursor-based pagination, install/uninstall.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import './MarketplaceView.css';

// Types matching the preload API responses
interface SearchHit {
  score: number;
  slug: string | null;
  displayName: string | null;
  summary: string | null;
  version: string | null;
  updatedAt: number | null;
}

interface SkillListItem {
  slug: string;
  displayName: string;
  summary: string | null;
  tags: Record<string, string>;
  stats: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  latestVersion: { version: string; createdAt: number; changelog: string } | null;
}

type ViewState = 'idle' | 'loading' | 'error';

interface MarketplaceViewProps {
  selectedSlug: string | null;
  onSelectSkill: (slug: string) => void;
}

export function MarketplaceView({ selectedSlug, onSelectSkill }: MarketplaceViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [browseItems, setBrowseItems] = useState<SkillListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<ViewState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [installedSlugs, setInstalledSlugs] = useState<Set<string>>(new Set());
  const [installingSlugs, setInstallingSlugs] = useState<Set<string>>(new Set());
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load installed slugs on mount
  useEffect(() => {
    window.electron.marketplace.installed().then((res) => {
      if (res.success && res.data) {
        setInstalledSlugs(new Set(res.data.slugs));
      }
    }).catch(() => {});
  }, []);

  // Initial browse load
  useEffect(() => {
    loadBrowse();
  }, []);

  /** Browse skills (cursor-based pagination) */
  const loadBrowse = useCallback(async (cursor?: string) => {
    setState('loading');
    try {
      const res = await window.electron.marketplace.browse(cursor, 20);
      if (!res.success) {
        setState('error');
        setErrorMsg(res.error || 'Failed to load skills');
        return;
      }
      if (res.data) {
        if (cursor) {
          setBrowseItems((prev) => [...prev, ...(res.data!.items as SkillListItem[])]);
        } else {
          setBrowseItems(res.data.items as SkillListItem[]);
        }
        setNextCursor(res.data.nextCursor);
      }
      setState('idle');
    } catch {
      setState('error');
      setErrorMsg('Network error');
    }
  }, []);

  /** Search skills */
  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setState('loading');
    try {
      const res = await window.electron.marketplace.search(query, 20);
      if (res.success && res.data) {
        setSearchResults(res.data.results.filter((r) => r.slug !== null));
      }
      setState('idle');
    } catch {
      setState('error');
      setErrorMsg('Search failed');
    }
  }, []);

  /** Handle search input with debounce */
  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!value.trim()) {
      setSearchResults([]);
      return;
    }
    searchTimerRef.current = setTimeout(() => doSearch(value), 400);
  };

  /** Install a skill */
  const handleInstall = async (slug: string) => {
    setInstallingSlugs((prev) => new Set(prev).add(slug));
    try {
      const res = await window.electron.marketplace.install(slug);
      if (res.success && res.data?.success) {
        setInstalledSlugs((prev) => new Set(prev).add(slug));
      } else if (res.data?.alreadyExists) {
        // Overwrite on second attempt
        const res2 = await window.electron.marketplace.install(slug, true);
        if (res2.success && res2.data?.success) {
          setInstalledSlugs((prev) => new Set(prev).add(slug));
        }
      }
    } catch {
      // Silent — button returns to normal
    } finally {
      setInstallingSlugs((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
    }
  };

  /** Uninstall a skill */
  const handleUninstall = async (skillName: string) => {
    setInstallingSlugs((prev) => new Set(prev).add(skillName));
    try {
      const res = await window.electron.marketplace.uninstall(skillName);
      if (res.success && res.data?.success) {
        setInstalledSlugs((prev) => {
          const next = new Set(prev);
          next.delete(skillName);
          return next;
        });
      }
    } finally {
      setInstallingSlugs((prev) => {
        const next = new Set(prev);
        next.delete(skillName);
        return next;
      });
    }
  };

  const isSearching = searchQuery.trim().length > 0;
  const displayItems = isSearching
    ? searchResults.map((r) => ({
        slug: r.slug || '',
        displayName: r.displayName || r.slug || '',
        summary: r.summary,
        version: r.version,
        updatedAt: r.updatedAt,
      }))
    : browseItems.map((item) => ({
        slug: item.slug,
        displayName: item.displayName,
        summary: item.summary,
        version: item.latestVersion?.version,
        updatedAt: item.updatedAt,
        stats: item.stats,
      }));

  return (
    <div className="marketplace-container">
      {/* Search */}
      <div className="marketplace-search">
        <input
          className="marketplace-search__input"
          type="text"
          placeholder="Search ClawHub skills..."
          value={searchQuery}
          onChange={(e) => handleSearchInput(e.target.value)}
        />
      </div>

      {/* Error */}
      {state === 'error' && (
        <div className="marketplace-error">
          {errorMsg}
          <button className="marketplace-error__retry" onClick={() => isSearching ? doSearch(searchQuery) : loadBrowse()}>
            Retry
          </button>
        </div>
      )}

      {/* Loading (first page) */}
      {state === 'loading' && displayItems.length === 0 && (
        <div className="marketplace-loading">
          <div className="marketplace-loading__spinner" />
          <span>Loading skills...</span>
        </div>
      )}

      {/* Skill cards */}
      <div className="marketplace-list">
        {displayItems.map((item) => {
          const isInstalled = installedSlugs.has(item.slug);
          const isInstalling = installingSlugs.has(item.slug);
          const isSelected = selectedSlug === item.slug;

          return (
            <div
              key={item.slug}
              className={`marketplace-card ${isSelected ? 'marketplace-card--selected' : ''}`}
              onClick={() => onSelectSkill(item.slug)}
            >
              <div className="marketplace-card__title-row">
                <span className="marketplace-card__name">{item.displayName}</span>
                {item.version && (
                  <span className="marketplace-card__version">v{item.version}</span>
                )}
              </div>
              {item.summary && (
                <div className="marketplace-card__summary">{item.summary}</div>
              )}
              <div className="marketplace-card__footer">
                {'stats' in item && item.stats && (
                  <>
                    {typeof item.stats.downloads === 'number' && (
                      <span className="marketplace-card__stat">
                        <span className="marketplace-card__stat-icon">&#x1F4E5;</span>
                        {formatCount(item.stats.downloads as number)}
                      </span>
                    )}
                    {typeof item.stats.stars === 'number' && (
                      <span className="marketplace-card__stat">
                        <span className="marketplace-card__stat-icon">&#x2B50;</span>
                        {formatCount(item.stats.stars as number)}
                      </span>
                    )}
                  </>
                )}
                <div className="marketplace-card__actions">
                  {isInstalling ? (
                    <button className="marketplace-card__install-btn marketplace-card__install-btn--installing" disabled>
                      Installing...
                    </button>
                  ) : isInstalled ? (
                    <>
                      <span className="marketplace-card__install-btn marketplace-card__install-btn--installed">
                        Installed
                      </span>
                      <button
                        className="marketplace-card__install-btn marketplace-card__install-btn--uninstall"
                        onClick={(e) => { e.stopPropagation(); handleUninstall(item.slug); }}
                      >
                        Uninstall
                      </button>
                    </>
                  ) : (
                    <button
                      className="marketplace-card__install-btn marketplace-card__install-btn--install"
                      onClick={(e) => { e.stopPropagation(); handleInstall(item.slug); }}
                    >
                      Install
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Load more (browse mode only) */}
      {!isSearching && nextCursor && state !== 'loading' && (
        <div className="marketplace-load-more">
          <button className="marketplace-load-more__btn" onClick={() => loadBrowse(nextCursor)}>
            Load more
          </button>
        </div>
      )}

      {/* Loading more spinner */}
      {state === 'loading' && displayItems.length > 0 && (
        <div className="marketplace-loading">
          <div className="marketplace-loading__spinner" />
        </div>
      )}
    </div>
  );
}

/** Format large numbers (1234 -> 1.2k) */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}
