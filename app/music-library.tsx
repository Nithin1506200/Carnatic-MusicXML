import {
  lazy,
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { documents, homeHtml, scoreCount, scoreGroups } from "./generated-content";
import {
  entrySubtitle,
  humanizeSlug,
  isScoreId,
  loadCatalog,
  scoreContentUrl,
  scoreGroupLabel,
  scoreGroupOf,
  type Catalog,
  type CatalogEntry,
} from "./catalog";
import {
  highlightSegments,
  loadSearch,
  MATCH_FIELD_LABELS,
  warmSearch,
  type SearchEngine,
  type SearchHit,
} from "./search";

const MuseScoreViewer = lazy(() => import("../components/musescore-viewer"));
const NotationPlayground = lazy(() => import("./notation-playground"));
const ConverterCases = lazy(() => import("./converter-cases"));

/** Tool pages that live outside the generated document list. */
const TOOL_IDS = new Set(["playground", "cases"]);

/**
 * The library shell. Only the handful of non-score documents are known at
 * load time (`documents`); scores are listed from the lazily fetched catalog
 * and found through the lazily built search index, and every document's
 * page content is fetched when it opens. Nothing here scales with the
 * number of scores except the catalog request itself.
 */

type DocumentSummary = (typeof documents)[number];
type NotationView = "both" | "swaras" | "sahitya";

/** One generated page: `public/generated-content/<id>.json`. */
interface DocumentContent {
  id: string;
  title: string;
  category: string;
  sourcePath: string;
  html: string;
  headings: { id: string; text: string; level: number }[];
  metadata: Record<string, unknown>;
  scoreSource: string | null;
}

/** What the page header needs before (or without) the page content. */
interface DocumentHeader {
  id: string;
  title: string;
  category: string;
  excerpt: string;
}

const documentCategoryOrder = ["Start here", "Learn", "Reference", "Project"];
const documentsById = new Map<string, DocumentSummary>(
  documents.map((document) => [document.id, document]),
);
const homeSummary = documentsById.get("home") ?? documents[0];

const initialHome: DocumentContent = {
  id: "home",
  title: homeSummary.title,
  category: homeSummary.category,
  sourcePath: homeSummary.sourcePath,
  html: homeHtml,
  headings: [],
  metadata: {},
  scoreSource: null,
};

/** Page-content cache, bounded so a long browsing session stays small. */
const CONTENT_CACHE_LIMIT = 40;
const contentCache = new Map<string, Promise<DocumentContent>>();

const contentUrlFor = (id: string) =>
  documentsById.get(id)?.contentUrl ?? scoreContentUrl(id);

const loadDocumentContent = (id: string) => {
  const cached = contentCache.get(id);
  if (cached) return cached;

  const request = fetch(contentUrlFor(id))
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Document request failed (${response.status})`);
      }
      return response.json() as Promise<Partial<DocumentContent>>;
    })
    .then((content) => {
      if (typeof content.html !== "string") {
        throw new Error("Generated document has no HTML content");
      }
      return {
        id,
        title: content.title ?? humanizeSlug(id),
        category: content.category ?? (isScoreId(id) ? "Scores" : "Learn"),
        sourcePath: content.sourcePath ?? "",
        html: content.html,
        headings: content.headings ?? [],
        metadata: content.metadata ?? {},
        scoreSource: content.scoreSource ?? null,
      } satisfies DocumentContent;
    })
    .catch((error: unknown) => {
      contentCache.delete(id);
      throw error;
    });
  contentCache.set(id, request);
  if (contentCache.size > CONTENT_CACHE_LIMIT) {
    const oldest = contentCache.keys().next().value;
    if (oldest !== undefined) contentCache.delete(oldest);
  }
  return request;
};

/** The document id the URL names, when it is one this app can show. */
const documentIdFromLocation = () => {
  const id = new URLSearchParams(window.location.search).get("doc");
  if (id && (TOOL_IDS.has(id) || documentsById.has(id) || isScoreId(id))) {
    return id;
  }
  return "home";
};

const displayMetadataValue = (value: unknown) =>
  Array.isArray(value) ? value.join(" · ") : String(value);

/** Quick-access entries shown in the palette before anything is typed. */
const quickAccess: SearchHit[] = documents.slice(0, 8).map((document) => ({
  id: document.id,
  title: document.title,
  category: document.category,
  subtitle: document.excerpt,
  contentUrl: document.contentUrl,
  score: 0,
  terms: [],
  fields: [],
}));

/** Text with the matched search terms wrapped in <mark>. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!text) return null;
  return (
    <>
      {highlightSegments(text, terms).map((segment, index) =>
        segment.hit ? <mark key={index}>{segment.text}</mark> : segment.text,
      )}
    </>
  );
}

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m21 21-4.35-4.35m2.1-5.4a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" />
  </svg>
);

const MenuIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

const GROUP_PAGE_INITIAL = 30;
const GROUP_PAGE_STEP = 50;

interface ScoreGroupNavProps {
  group: (typeof scoreGroups)[number];
  expanded: boolean;
  entries: CatalogEntry[] | null;
  catalogError: string | null;
  activeId: string;
  onToggle: () => void;
  onOpen: (id: string) => void;
}

/** One collapsible score group in the sidebar: filter, page, open. */
function ScoreGroupNav({
  group,
  expanded,
  entries,
  catalogError,
  activeId,
  onToggle,
  onOpen,
}: ScoreGroupNavProps) {
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(GROUP_PAGE_INITIAL);
  const deferredFilter = useDeferredValue(filter);

  const visible = useMemo(() => {
    if (!entries) return [];
    const needle = deferredFilter.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      `${entry.title} ${entry.raga} ${entry.composer} ${entry.tala}`
        .toLowerCase()
        .includes(needle),
    );
  }, [entries, deferredFilter]);

  const shown = visible.slice(0, limit);
  const remaining = visible.length - shown.length;
  const panelId = `score-group-${group.key}`;

  return (
    <div className={`score-group ${expanded ? "is-open" : ""}`}>
      <button
        type="button"
        className="score-group-toggle"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <i aria-hidden="true" />
        <span>{group.label}</span>
        <small>{group.count}</small>
      </button>
      {expanded && (
        <div id={panelId} className="score-group-body">
          {group.count > GROUP_PAGE_INITIAL && (
            <input
              type="search"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setLimit(GROUP_PAGE_INITIAL);
              }}
              placeholder={`Filter ${group.count} scores…`}
              aria-label={`Filter ${group.label}`}
            />
          )}
          {catalogError ? (
            <p className="score-group-state" role="alert">{catalogError}</p>
          ) : !entries ? (
            <p className="score-group-state" aria-live="polite">Loading scores…</p>
          ) : visible.length === 0 ? (
            <p className="score-group-state">
              {entries.length === 0 ? "No scores yet." : "No scores match."}
            </p>
          ) : (
            shown.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={entry.id === activeId ? "active" : ""}
                onClick={() => onOpen(entry.id)}
                title={entrySubtitle(entry) || undefined}
              >
                <span>{entry.title}</span>
                {entry.id === activeId && <i aria-hidden="true" />}
              </button>
            ))
          )}
          {remaining > 0 && (
            <button
              type="button"
              className="score-group-more"
              onClick={() => setLimit((value) => value + GROUP_PAGE_STEP)}
            >
              Show {Math.min(remaining, GROUP_PAGE_STEP)} more
              <small>{remaining} left</small>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function MusicLibrary() {
  const [activeId, setActiveId] = useState<string>(documentIdFromLocation);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const toggleSidebar = () => {
    const collapsed = !sidebarCollapsed;
    setSidebarCollapsed(collapsed);
    try {
      localStorage.setItem("sidebar-collapsed", String(collapsed));
    } catch {
      // The menu still works when storage is unavailable.
    }
  };
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [tablePreview, setTablePreview] = useState<{
    html: string;
    title: string;
    label: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [notationView, setNotationView] = useState<NotationView>("both");
  const [notationOverviewOpen, setNotationOverviewOpen] = useState(false);
  const [engravedScore, setEngravedScore] = useState<{
    source: string;
    title: string;
  } | null>(null);
  const [notationSectionIndex, setNotationSectionIndex] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const notationScroll = useRef<HTMLDivElement>(null);
  const [activeDoc, setActiveDoc] = useState<DocumentContent | null>(initialHome);
  const [previewDoc, setPreviewDoc] = useState<DocumentContent | null>(null);
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  // The active score's group starts open; the user can collapse it later.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(isScoreId(activeId) ? [scoreGroupOf(activeId)] : []),
  );
  const [engine, setEngine] = useState<SearchEngine | null>(null);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  // The catalog and search index each load once, on first demand.
  const catalogRequested = useRef(false);
  const ensureCatalog = () => {
    if (catalogRequested.current) return;
    catalogRequested.current = true;
    loadCatalog()
      .then((loaded) => {
        setCatalog(loaded);
        setCatalogError(null);
      })
      .catch((error: unknown) => {
        console.error("Catalog failed to load:", error);
        catalogRequested.current = false;
        setCatalogError("The score list could not be loaded.");
      });
  };

  const searchRequested = useRef(false);
  const ensureSearch = () => {
    if (searchRequested.current) return;
    searchRequested.current = true;
    setSearchState("loading");
    loadSearch()
      .then((loaded) => {
        setEngine(loaded);
        setSearchState("ready");
      })
      .catch((error: unknown) => {
        console.error("Search index failed to load:", error);
        searchRequested.current = false;
        setSearchState("error");
      });
  };

  const openSearch = () => {
    setSearchOpen(true);
    ensureSearch();
  };

  /** Shows a document and opens its score group when it is a score. */
  const showDocument = (id: string) => {
    setActiveId(id);
    setNotationView("both");
    if (isScoreId(id)) {
      const group = scoreGroupOf(id);
      setExpandedGroups((current) =>
        current.has(group) ? current : new Set(current).add(group),
      );
      ensureCatalog();
    }
  };
  // Latest-callback refs for the window listeners registered once below.
  const showDocumentRef = useRef(showDocument);
  useEffect(() => {
    showDocumentRef.current = showDocument;
  });

  useEffect(() => {
    const syncFromLocation = () => showDocumentRef.current(documentIdFromLocation());
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);

  const openSearchRef = useRef(openSearch);
  useEffect(() => {
    openSearchRef.current = openSearch;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if ((event.key === "/" && !typing) || ((event.metaKey || event.ctrlKey) && event.key === "k")) {
        event.preventDefault();
        openSearchRef.current();
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setTablePreview(null);
        setPreviewId(null);
        setNotationOverviewOpen(false);
        setEngravedScore(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (searchOpen) window.setTimeout(() => searchInput.current?.focus(), 60);
  }, [searchOpen]);

  // The search index builds in the background so the palette answers at
  // once; opening it early just waits for the same promise.
  useEffect(() => {
    warmSearch();
  }, []);

  // A deep link straight to a score needs the catalog for its group list.
  useEffect(() => {
    if (isScoreId(activeId)) ensureCatalog();
    // ensureCatalog is a ref-guarded loader, not reactive state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    ensureCatalog();
  };

  // Page content for the active document and the preview, fetched on demand.
  useEffect(() => {
    if (TOOL_IDS.has(activeId)) return;
    let cancelled = false;
    void loadDocumentContent(activeId)
      .then((content) => {
        if (cancelled) return;
        setActiveDoc(content);
        setLoadErrors((current) => {
          if (!(activeId in current)) return current;
          const next = { ...current };
          delete next[activeId];
          return next;
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error(`Failed to load ${activeId}:`, error);
        setLoadErrors((current) => ({
          ...current,
          [activeId]: "This document could not be loaded.",
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    if (!previewId) return;
    let cancelled = false;
    void loadDocumentContent(previewId)
      .then((content) => {
        if (!cancelled) setPreviewDoc(content);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error(`Failed to load ${previewId}:`, error);
        setLoadErrors((current) => ({
          ...current,
          [previewId]: "This document could not be loaded.",
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [previewId]);

  useEffect(() => {
    if (!previewId && !tablePreview && !notationOverviewOpen && !engravedScore) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [previewId, tablePreview, notationOverviewOpen, engravedScore]);

  const documentGroups = useMemo(
    () =>
      documentCategoryOrder
        .map((category) => ({
          category,
          items: documents.filter((document) => document.category === category),
        }))
        .filter((group) => group.items.length),
    [],
  );

  const headerFor = (id: string, content: DocumentContent | null): DocumentHeader => {
    const summary = documentsById.get(id);
    if (summary) return summary;
    const entry = catalog?.byId.get(id);
    return {
      id,
      title: content?.title ?? entry?.title ?? humanizeSlug(id),
      category: content?.category ?? (isScoreId(id) ? "Scores" : "Learn"),
      excerpt: entry ? entrySubtitle(entry) : "",
    };
  };

  const activeHtml = activeDoc?.id === activeId ? activeDoc.html : "";
  const active = {
    ...headerFor(activeId, activeDoc),
    html: activeHtml,
    headings: activeDoc?.id === activeId ? activeDoc.headings : [],
    metadata: activeDoc?.id === activeId ? activeDoc.metadata : {},
  };
  const preview = previewId
    ? {
        ...headerFor(previewId, previewDoc),
        html: previewDoc?.id === previewId ? previewDoc.html : "",
      }
    : undefined;

  const results = useMemo<SearchHit[]>(() => {
    if (!deferredQuery.trim()) return quickAccess;
    if (!engine) return [];
    return engine.search(deferredQuery, 10);
  }, [engine, deferredQuery]);

  const navigate = (id: string, heading?: string) => {
    showDocument(id);
    setMobileOpen(false);
    setSearchOpen(false);
    setNotationOverviewOpen(false);
    setQuery("");
    const url = id === "home" ? window.location.pathname : `?doc=${encodeURIComponent(id)}`;
    window.history.pushState({}, "", heading ? `${url}#${heading}` : url);
    window.setTimeout(() => {
      if (heading) document.getElementById(heading)?.scrollIntoView({ behavior: "smooth" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    }, 30);
  };

  const handleMarkdownClick = (event: React.MouseEvent<HTMLElement>) => {
    const element = event.target as HTMLElement;
    const notationOverview = element.closest<HTMLElement>("[data-notation-overview]");
    if (notationOverview) {
      setNotationView("both");
      setNotationSectionIndex(0);
      setNotationOverviewOpen(true);
      return;
    }

    const engravedTrigger = element.closest<HTMLElement>("[data-engraved-score]");
    if (engravedTrigger?.dataset.engravedScore) {
      setEngravedScore({
        source: engravedTrigger.dataset.engravedScore,
        title: preview?.title ?? active.title,
      });
      return;
    }

    const musicSection = element.closest<HTMLElement>("[data-music-section]");
    if (musicSection) {
      setTablePreview({
        html: musicSection.outerHTML,
        title: musicSection.dataset.title || "Music section",
        label: "Notation section",
      });
      return;
    }

    const table = element.closest("table");
    if (table) {
      let sibling = table.previousElementSibling;
      while (sibling && !sibling.matches("h2, h3, h4")) {
        sibling = sibling.previousElementSibling;
      }
      setTablePreview({
        html: table.outerHTML,
        title: sibling?.textContent?.replace(/#$/, "").trim() || "Swara table",
        label: "Notation table",
      });
      return;
    }

    const anchor = element.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    if (href.startsWith("?doc=")) {
      event.preventDefault();
      const url = new URL(href, window.location.href);
      const targetId = url.searchParams.get("doc") ?? "home";
      if (isScoreId(targetId)) {
        setPreviewId(targetId);
      } else {
        navigate(targetId, url.hash.slice(1) || undefined);
      }
    }
  };

  const metadata = Object.entries(active.metadata).filter(
    ([key]) => !["title", "alternate_titles", "keywords"].includes(key),
  );
  const notationOverviewHtml = useMemo(
    () =>
      (activeHtml.match(/<div class="music-section"[\s\S]*?<\/div>/g) ?? []).join(""),
    [activeHtml],
  );
  const notationSectionKinds = [
    ...notationOverviewHtml.matchAll(/data-notation-kind="([^"]+)"/g),
  ].map((match) => match[1]);
  const notationSectionCount =
    notationView === "sahitya"
      ? notationSectionKinds.filter((kind) => kind === "lyrics").length
      : notationSectionKinds.length;

  const visibleNotationSections = () =>
    Array.from(
      notationScroll.current?.querySelectorAll<HTMLElement>(".music-section") ?? [],
    ).filter((section) => section.offsetParent !== null);

  const showNotationSection = (index: number) => {
    const sections = visibleNotationSections();
    if (!sections.length) return;
    const nextIndex = Math.max(0, Math.min(index, sections.length - 1));
    sections[nextIndex].scrollIntoView({
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    });
    setNotationSectionIndex(nextIndex);
  };

  const changeNotationView = (view: NotationView) => {
    setNotationView(view);
    setNotationSectionIndex(0);
    window.requestAnimationFrame(() => {
      notationScroll.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const resultLabel = !query
    ? "Quick access"
    : searchState === "error"
      ? "Search unavailable"
      : !engine
        ? "Preparing search…"
        : `${results.length} match${results.length === 1 ? "" : "es"}`;

  return (
    <div className={`site-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open menu" aria-expanded={mobileOpen} aria-controls="library-sidebar">
          <MenuIcon />
        </button>
        <div className="brand-area">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
            title={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
            aria-expanded={!sidebarCollapsed}
            aria-controls="library-sidebar"
          >
            <MenuIcon />
          </button>
          <button className="brand" onClick={() => navigate("home")} aria-label="Swara Adhyaaya home">
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>
              <strong>Swara Adhyaaya</strong>
              <small>Carnatic saxophone library</small>
            </span>
          </button>
        </div>
        <button className="search-trigger" onClick={openSearch}>
          <SearchIcon />
          <span>Search every lesson, raga, tala…</span>
          <kbd>⌘ K</kbd>
        </button>
        <span className="written-sa">Written Sa · G</span>
      </header>

      <aside id="library-sidebar" className={`sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="sidebar-mobile-head">
          <span>Library</span>
          <button onClick={() => setMobileOpen(false)} aria-label="Close menu">×</button>
        </div>
        <div className="sidebar-intro">
          <span className="eyebrow">Learning path</span>
          <p>From first swaras to complete compositions, arranged for E-flat alto saxophone.</p>
        </div>
        <nav aria-label="Library">
          {documentGroups.map((group) => (
            <section key={group.category} className="nav-group">
              <h2>{group.category}</h2>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={item.id === active.id ? "active" : ""}
                  onClick={() => navigate(item.id)}
                >
                  <span>{item.title}</span>
                  {item.id === active.id && <i aria-hidden="true" />}
                </button>
              ))}
            </section>
          ))}
          <section className="nav-group nav-scores">
            <h2>
              Scores <small>{scoreCount}</small>
            </h2>
            {scoreGroups.map((group) => (
              <ScoreGroupNav
                key={group.key}
                group={group}
                expanded={expandedGroups.has(group.key)}
                entries={catalog?.byGroup.get(group.key) ?? null}
                catalogError={catalogError}
                activeId={activeId}
                onToggle={() => toggleGroup(group.key)}
                onOpen={navigate}
              />
            ))}
          </section>
          <section className="nav-group">
            <h2>Tools</h2>
            <button
              className={activeId === "playground" ? "active" : ""}
              onClick={() => navigate("playground")}
            >
              <span>Notation playground</span>
              {activeId === "playground" && <i aria-hidden="true" />}
            </button>
            <button
              className={activeId === "cases" ? "active" : ""}
              onClick={() => navigate("cases")}
            >
              <span>Converter test cases</span>
              {activeId === "cases" && <i aria-hidden="true" />}
            </button>
          </section>
        </nav>
        <div className="sidebar-foot">
          <span className="octave-example"><em>Ṇ</em> S <strong>Ṡ</strong></span>
          <span>Mandra · Madhya · Tara</span>
        </div>
      </aside>

      {mobileOpen && <button className="scrim nav-scrim" onClick={() => setMobileOpen(false)} aria-label="Close menu" />}

      <main className="main">
        {activeId === "home" && (
          <section className="hero">
            <div>
              <span className="eyebrow">A living notation library</span>
              <h1>Learn Carnatic music.<br /><em>Play it on saxophone.</em></h1>
              <p>
                Structured lessons, aligned swaras, and tala-aware notation—built directly from
                this repository’s Markdown.
              </p>
              <div className="hero-actions">
                <button onClick={() => navigate("scores/02_basics/sarale_varase_to_alankaaras")}>
                  Begin Swara Adhyaaya <span>→</span>
                </button>
                <button className="quiet" onClick={openSearch}>
                  Explore the library
                </button>
              </div>
            </div>
            <div className="hero-card" aria-label="Notation preview">
              <span className="raga-label">Mayamalavagowla</span>
              <div className="swara-line">
                <span>S</span><span>R₁</span><span>G₃</span><span>M₁</span>
                <span>P</span><span>D₁</span><span>N₃</span><strong>Ṡ</strong>
              </div>
              <div className="tala-line"><i /><i /><i /><i className="break" /><i /><i className="break" /><i /><i /></div>
              <p>Arohana · written Sa = G</p>
            </div>
          </section>
        )}

        {activeId === "playground" && (
          <div className="content-layout playground-layout">
            <Suspense
              fallback={
                <div className="document-state" aria-live="polite">
                  Loading playground…
                </div>
              }
            >
              <NotationPlayground />
            </Suspense>
          </div>
        )}

        {activeId === "cases" && (
          <div className="content-layout">
            <Suspense
              fallback={
                <div className="document-state" aria-live="polite">
                  Loading test cases…
                </div>
              }
            >
              <ConverterCases />
            </Suspense>
          </div>
        )}

        {!TOOL_IDS.has(activeId) && (
        <div className="content-layout">
          <article className="document">
            {active.id !== "home" && (
              <header className="document-head">
                <span className="eyebrow">
                  {isScoreId(active.id)
                    ? scoreGroupLabel(scoreGroupOf(active.id))
                    : active.category}
                </span>
                <h1>{active.title}</h1>
                {active.category !== "Scores" && <p>{active.excerpt}</p>}
                {metadata.length > 0 && (
                  <div className="metadata">
                    {metadata.slice(0, 8).map(([key, value]) => (
                      <span key={key}>
                        <small>{key.replaceAll("_", " ")}</small>
                        <strong>{displayMetadataValue(value)}</strong>
                      </span>
                    ))}
                  </div>
                )}
              </header>
            )}
            {loadErrors[active.id] ? (
              <div className="document-state" role="alert">{loadErrors[active.id]}</div>
            ) : active.html ? (
              <div
                className="markdown notation-view-both"
                onClick={handleMarkdownClick}
                dangerouslySetInnerHTML={{ __html: active.html }}
              />
            ) : (
              <div className="document-state" aria-live="polite">Loading document…</div>
            )}
          </article>

          {active.headings.length > 2 && (
            <aside className="on-this-page">
              <span>On this page</span>
              {active.headings
                .filter((heading) => heading.level <= 3)
                .map((heading) => (
                  <a
                    key={heading.id}
                    href={`#${heading.id}`}
                    className={`level-${heading.level}`}
                  >
                    {heading.text}
                  </a>
                ))}
            </aside>
          )}
        </div>
        )}
      </main>

      {searchOpen && (
        <div className="search-layer" role="dialog" aria-modal="true" aria-label="Global search">
          <button className="scrim" onClick={() => setSearchOpen(false)} aria-label="Close search" />
          <section className="search-panel">
            <div className="search-box">
              <SearchIcon />
              <input
                ref={searchInput}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search lessons, scores, ragas, talas, composers…"
                aria-label="Search the library"
              />
              <kbd>Esc</kbd>
            </div>
            <div className="search-results">
              <span className="result-label" aria-live="polite">{resultLabel}</span>
              {results.map((item) => (
                <button key={item.id} onClick={() => navigate(item.id)}>
                  <span className="result-icon">{item.category.slice(0, 1)}</span>
                  <span>
                    <strong>
                      <Highlight text={item.title} terms={item.terms} />
                    </strong>
                    <small>
                      {item.category === "Scores"
                        ? scoreGroupLabel(scoreGroupOf(item.id))
                        : item.category}
                      {item.subtitle && (
                        <>
                          {" · "}
                          <Highlight text={item.subtitle} terms={item.terms} />
                        </>
                      )}
                    </small>
                    {item.context && (
                      <small className="result-context">
                        <em>{MATCH_FIELD_LABELS[item.context.field]}</em>
                        <Highlight text={item.context.text} terms={item.terms} />
                      </small>
                    )}
                    {item.fields.length > 0 && (
                      <span className="result-fields" aria-label="Matched in">
                        {item.fields.map((field) => (
                          <em key={field}>{MATCH_FIELD_LABELS[field]}</em>
                        ))}
                      </span>
                    )}
                  </span>
                  <b>↵</b>
                </button>
              ))}
              {results.length === 0 && query && engine && (
                <div className="empty-search">
                  <strong>No matching lesson yet.</strong>
                  <span>Try a raga, tala, composer, or score title.</span>
                </div>
              )}
              {searchState === "error" && (
                <div className="empty-search" role="alert">
                  <strong>Search could not load.</strong>
                  <span>Reload the page to try again.</span>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {preview && (
        <div className="score-preview-layer" role="dialog" aria-modal="true" aria-labelledby="score-preview-title">
          <button className="scrim" onClick={() => setPreviewId(null)} aria-label="Close score preview" />
          <section className="score-preview">
            <header className="score-preview-head">
              <div>
                <span className="eyebrow">Score preview · 72%</span>
                <h2 id="score-preview-title">{preview.title}</h2>
              </div>
              <div className="score-preview-actions">
                <button
                  className="open-score"
                  onClick={() => {
                    setPreviewId(null);
                    navigate(preview.id);
                  }}
                >
                  Open full page
                </button>
                <button className="close-preview" onClick={() => setPreviewId(null)} aria-label="Close score preview">
                  ×
                </button>
              </div>
            </header>
            <div className="score-preview-scroll">
              {loadErrors[preview.id] ? (
                <div className="document-state" role="alert">{loadErrors[preview.id]}</div>
              ) : preview.html ? (
                <article
                  className="markdown score-preview-content notation-view-both"
                  onClick={handleMarkdownClick}
                  dangerouslySetInnerHTML={{ __html: preview.html }}
                />
              ) : (
                <div className="document-state" aria-live="polite">Loading score…</div>
              )}
            </div>
          </section>
        </div>
      )}

      {tablePreview && (
        <div className="table-preview-layer" role="dialog" aria-modal="true" aria-labelledby="table-preview-title">
          <button className="scrim" onClick={() => setTablePreview(null)} aria-label="Close table preview" />
          <section className="table-preview">
            <header className="table-preview-head">
              <div>
                <span className="eyebrow">{tablePreview.label}</span>
                <h2 id="table-preview-title">{tablePreview.title}</h2>
              </div>
              <button onClick={() => setTablePreview(null)} aria-label="Close table preview">×</button>
            </header>
            <div className="table-preview-scroll">
              <div
                className="markdown table-preview-content notation-view-both"
                dangerouslySetInnerHTML={{ __html: tablePreview.html }}
              />
            </div>
          </section>
        </div>
      )}

      {engravedScore && (
        <div
          className="engraved-score-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="engraved-score-title"
        >
          <button
            className="scrim"
            onClick={() => setEngravedScore(null)}
            aria-label="Close engraved score"
          />
          <section className="engraved-score-dialog">
            <header className="engraved-score-head">
              <div>
                <span className="eyebrow">Western notation · MuseScore</span>
                <h2 id="engraved-score-title">{engravedScore.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setEngravedScore(null)}
                aria-label="Close engraved score"
              >
                ×
              </button>
            </header>
            <div className="engraved-score-body">
              <Suspense fallback={<div className="document-state">Loading score viewer…</div>}>
                <MuseScoreViewer
                  key={engravedScore.source}
                  source={engravedScore.source}
                  title={engravedScore.title}
                />
              </Suspense>
            </div>
          </section>
        </div>
      )}

      {notationOverviewOpen && (
        <div
          className="notation-overview-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="notation-overview-title"
        >
          <button
            className="scrim"
            onClick={() => setNotationOverviewOpen(false)}
            aria-label="Close notation view"
          />
          <section className="notation-overview">
            <header className="notation-overview-head">
              <div>
                <span className="eyebrow">Complete notation</span>
                <h2 id="notation-overview-title">{active.title}</h2>
              </div>
              <div className="notation-overview-actions">
                <div className="notation-snap-actions" aria-label="Section navigation">
                  <button
                    type="button"
                    onClick={() => showNotationSection(notationSectionIndex - 1)}
                    disabled={notationSectionIndex === 0}
                    aria-label="Previous section"
                  >
                    ↑
                  </button>
                  <span>
                    {Math.min(notationSectionIndex + 1, notationSectionCount)} /{" "}
                    {notationSectionCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => showNotationSection(notationSectionIndex + 1)}
                    disabled={notationSectionIndex >= notationSectionCount - 1}
                    aria-label="Next section"
                  >
                    ↓
                  </button>
                </div>
                <div className="notation-view-switch" role="group" aria-label="Notation view">
                  {(["both", "swaras", "sahitya"] as const).map((view) => (
                    <button
                      key={view}
                      type="button"
                      className={notationView === view ? "active" : ""}
                      aria-pressed={notationView === view}
                      onClick={() => changeNotationView(view)}
                    >
                      {view === "both"
                        ? "Both"
                        : view === "swaras"
                          ? "Swaras"
                          : "Sahitya"}
                    </button>
                  ))}
                </div>
                <button
                  className="close-overview"
                  onClick={() => setNotationOverviewOpen(false)}
                  aria-label="Close notation view"
                >
                  ×
                </button>
              </div>
            </header>
            <div
              ref={notationScroll}
              className="notation-overview-scroll"
              onScroll={(event) => {
                const sections = visibleNotationSections();
                if (!sections.length) return;
                const top = event.currentTarget.scrollTop;
                const closest = sections.reduce(
                  (best, section, index) =>
                    Math.abs(section.offsetTop - top) <
                    Math.abs(sections[best].offsetTop - top)
                      ? index
                      : best,
                  0,
                );
                setNotationSectionIndex(closest);
              }}
            >
              <div
                className={`markdown notation-overview-content notation-view-${notationView}`}
                dangerouslySetInnerHTML={{ __html: notationOverviewHtml }}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
