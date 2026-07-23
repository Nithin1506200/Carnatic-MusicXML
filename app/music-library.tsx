"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { documents } from "./generated-content";

type DocumentItem = (typeof documents)[number];
type NotationView = "both" | "swaras" | "sahitya";

const categoryOrder = ["Start here", "Learn", "Scores", "Reference", "Project"];

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

export default function MusicLibrary() {
  const [activeId, setActiveId] = useState<string>("home");
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [tablePreview, setTablePreview] = useState<{
    html: string;
    title: string;
    label: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [notationView, setNotationView] = useState<NotationView>("both");
  const [notationOverviewOpen, setNotationOverviewOpen] = useState(false);
  const [notationSectionIndex, setNotationSectionIndex] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const notationScroll = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const syncFromLocation = () => {
      const id = new URLSearchParams(window.location.search).get("doc");
      if (id && documents.some((document) => document.id === id)) {
        setActiveId(id);
        setNotationView("both");
      }
    };
    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if ((event.key === "/" && !typing) || ((event.metaKey || event.ctrlKey) && event.key === "k")) {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setTablePreview(null);
        setPreviewId(null);
        setNotationOverviewOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (searchOpen) window.setTimeout(() => searchInput.current?.focus(), 60);
  }, [searchOpen]);

  const active =
    (documents.find((document) => document.id === activeId) ?? documents[0]) as DocumentItem;
  const preview = previewId
    ? (documents.find((document) => document.id === previewId) as DocumentItem | undefined)
    : undefined;

  useEffect(() => {
    if (!preview && !tablePreview && !notationOverviewOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [preview, tablePreview, notationOverviewOpen]);

  const grouped = useMemo(
    () =>
      categoryOrder
        .map((category) => ({
          category,
          items: documents.filter((document) => document.category === category),
        }))
        .filter((group) => group.items.length),
    [],
  );

  const results = useMemo(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return documents.slice(0, 8);
    return documents
      .map((document) => {
        const title = document.title.toLowerCase();
        const score = terms.reduce(
          (total, term) =>
            total +
            (title.includes(term) ? 8 : 0) +
            (document.headings.some((heading) => heading.text.toLowerCase().includes(term)) ? 4 : 0) +
            (document.searchText.includes(term) ? 1 : 0),
          0,
        );
        return { document, score };
      })
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((result) => result.document);
  }, [query]);

  const navigate = (id: string, heading?: string) => {
    setActiveId(id);
    setNotationView("both");
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
      const target = documents.find((document) => document.id === targetId);
      if (target?.category === "Scores") {
        setPreviewId(targetId);
      } else {
        navigate(targetId, url.hash.slice(1) || undefined);
      }
    }
  };

  const metadata = Object.entries(active.metadata).filter(
    ([key]) => !["title", "alternate_titles"].includes(key),
  );
  const notationOverviewHtml = (
    active.html.match(/<div class="music-section"[\s\S]*?<\/div>/g) ?? []
  ).join("");
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

  return (
    <div className="site-shell">
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open menu">
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
        <button className="search-trigger" onClick={() => setSearchOpen(true)}>
          <SearchIcon />
          <span>Search every lesson, raga, tala…</span>
          <kbd>⌘ K</kbd>
        </button>
        <span className="written-sa">Written Sa · G</span>
      </header>

      <aside className={`sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="sidebar-mobile-head">
          <span>Library</span>
          <button onClick={() => setMobileOpen(false)} aria-label="Close menu">×</button>
        </div>
        <div className="sidebar-intro">
          <span className="eyebrow">Learning path</span>
          <p>From first swaras to complete compositions, arranged for E-flat alto saxophone.</p>
        </div>
        <nav aria-label="Library">
          {grouped.map((group) => (
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
        </nav>
        <div className="sidebar-foot">
          <span className="octave-example"><em>Ṇ</em> S <strong>Ṡ</strong></span>
          <span>Mandra · Madhya · Tara</span>
        </div>
      </aside>

      {mobileOpen && <button className="scrim nav-scrim" onClick={() => setMobileOpen(false)} aria-label="Close menu" />}

      <main className="main">
        {active.id === "home" && (
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
                <button className="quiet" onClick={() => setSearchOpen(true)}>
                  Explore the library
                </button>
              </div>
            </div>
            <div className="hero-card" aria-label="Notation preview">
              <span className="raga-label">Mayamalavagowla</span>
              <div className="swara-line">
                <span>S</span><span>R₁</span><span>G₃</span><span>M₁</span>
                <span>P</span><span>D₁</span><span>N₃</span><strong>Ṡ</strong>
              </div>
              <div className="tala-line"><i /><i /><i /><i className="break" /><i /><i className="break" /><i /><i /></div>
              <p>Arohana · written Sa = G</p>
            </div>
          </section>
        )}

        <div className="content-layout">
          <article className="document">
            {active.id !== "home" && (
              <header className="document-head">
                <span className="eyebrow">{active.category}</span>
                <h1>{active.title}</h1>
                {active.category !== "Scores" && <p>{active.excerpt}</p>}
                {metadata.length > 0 && (
                  <div className="metadata">
                    {metadata.slice(0, 8).map(([key, value]) => (
                      <span key={key}>
                        <small>{key.replaceAll("_", " ")}</small>
                        <strong>{String(value)}</strong>
                      </span>
                    ))}
                  </div>
                )}
              </header>
            )}
            <div
              className="markdown notation-view-both"
              onClick={handleMarkdownClick}
              dangerouslySetInnerHTML={{ __html: active.html }}
            />
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
                placeholder="Search swaras, lessons, ragas, talas, composers…"
                aria-label="Search the library"
              />
              <kbd>Esc</kbd>
            </div>
            <div className="search-results">
              <span className="result-label">{query ? `${results.length} matches` : "Quick access"}</span>
              {results.map((item) => (
                <button key={item.id} onClick={() => navigate(item.id)}>
                  <span className="result-icon">{item.category.slice(0, 1)}</span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.category}
                      {item.category !== "Scores" && ` · ${item.excerpt}`}
                    </small>
                  </span>
                  <b>↵</b>
                </button>
              ))}
              {results.length === 0 && (
                <div className="empty-search">
                  <strong>No matching lesson yet.</strong>
                  <span>Try a raga, tala, composer, or swara pattern.</span>
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
              <article
                className="markdown score-preview-content notation-view-both"
                onClick={handleMarkdownClick}
                dangerouslySetInnerHTML={{ __html: preview.html }}
              />
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
