"use client";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { useEffect, useRef, useState } from "react";

type LoadedScore = {
  npages(): Promise<number>;
  saveSvg(pageNumber?: number, drawPageBackground?: boolean): Promise<string>;
  destroy(soft?: boolean): void;
};

type WebMscoreRuntime = {
  load(
    format: "mscz",
    data: Uint8Array,
    fonts?: Uint8Array[],
    doLayout?: boolean,
  ): Promise<LoadedScore>;
};

const runtimeUrl =
  "/vendor/webmscore/webmscore.mjs?v=embedded-musescore-fonts-1";
let runtimePromise: Promise<WebMscoreRuntime> | null = null;
let fontPromise: Promise<Uint8Array[]> | null = null;

const loadRuntime = () => {
  runtimePromise ??= new Promise((resolve, reject) => {
    const loaded = (
      window as typeof window & { __webMscoreRuntime?: WebMscoreRuntime }
    ).__webMscoreRuntime;
    if (loaded) {
      resolve(loaded);
      return;
    }
    const script = document.createElement("script");
    script.type = "module";
    script.src = runtimeUrl;
    script.onload = () => {
      const runtime = (
        window as typeof window & { __webMscoreRuntime?: WebMscoreRuntime }
      ).__webMscoreRuntime;
      if (runtime) resolve(runtime);
      else reject(new Error("MuseScore renderer did not initialize"));
    };
    script.onerror = () =>
      reject(new Error("MuseScore renderer failed to load"));
    document.head.append(script);
  });
  return runtimePromise;
};

const loadMuseScoreFonts = () => {
  fontPromise ??= loadRuntime().then(() => {
    const fonts = (
      window as typeof window & { __webMscoreFonts?: Uint8Array[] }
    ).__webMscoreFonts;
    if (!fonts?.length) {
      throw new Error("MuseScore fonts were not embedded in the renderer");
    }
    return fonts;
  });
  return fontPromise;
};

const messageForError = (error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.includes("file version")
    ? "This score was saved by a newer MuseScore version than the web viewer supports."
    : "The score could not be rendered in this browser.";
};

const directChild = (element: Element, tagName: string) =>
  Array.from(element.children).find((child) => child.tagName === tagName);

const normalizeMultilineFrameText = (archive: Uint8Array) => {
  const files = unzipSync(archive);
  const scoreName = Object.keys(files).find((name) => name.endsWith(".mscx"));
  if (!scoreName) return archive;

  const documentNode = new DOMParser().parseFromString(
    strFromU8(files[scoreName]),
    "application/xml",
  );
  if (documentNode.querySelector("parsererror")) return archive;

  let changed = false;
  const textObjects = Array.from(documentNode.getElementsByTagName("Text"));

  for (const textObject of textObjects) {
    const style = directChild(textObject, "style");
    const richText = directChild(textObject, "text");
    if (
      style?.textContent !== "frame" ||
      !richText ||
      !Array.from(richText.children).some((child) => child.tagName === "br")
    ) {
      continue;
    }

    const lines: Node[][] = [[]];
    let activeFont: Element | null = null;
    const lineFonts: Array<Element | null> = [];

    for (const node of Array.from(richText.childNodes)) {
      if (node instanceof Element && node.tagName === "br") {
        lineFonts.push(activeFont?.cloneNode(true) as Element | null);
        lines.push([]);
        continue;
      }
      if (node instanceof Element && node.tagName === "font") {
        activeFont = node;
      }
      lines.at(-1)?.push(node.cloneNode(true));
    }
    lineFonts.push(activeFont?.cloneNode(true) as Element | null);

    const originalOffset = directChild(textObject, "offset");
    const baseX = Number(originalOffset?.getAttribute("x") ?? 0);
    const baseY = Number(originalOffset?.getAttribute("y") ?? 0);
    let lineY = baseY;
    let previousFontSize = 11;
    const replacements: Element[] = [];

    lines.forEach((line, index) => {
      const replacement = textObject.cloneNode(false) as Element;
      for (const property of Array.from(textObject.children)) {
        if (
          !["offset", "text"].includes(property.tagName) &&
          (index === 0 || property.tagName !== "eid")
        ) {
          replacement.append(property.cloneNode(true));
        }
      }

      if (index > 0) {
        lineY += Math.max(4, previousFontSize / 3);
      }

      const offset = documentNode.createElement("offset");
      offset.setAttribute("x", String(baseX));
      offset.setAttribute("y", String(lineY));
      replacement.append(offset);

      const lineText = documentNode.createElement("text");
      const inheritedFont = lineFonts[Math.max(0, index - 1)];
      const hasOwnFont = line.some(
        (node) => node instanceof Element && node.tagName === "font",
      );
      if (index > 0 && inheritedFont && !hasOwnFont) {
        lineText.append(inheritedFont.cloneNode(true));
      }
      line.forEach((node) => lineText.append(node));
      replacement.append(lineText);

      const font = directChild(lineText, "font") ?? inheritedFont;
      previousFontSize = Number(font?.getAttribute("size") ?? 11);
      replacements.push(replacement);
    });

    textObject.replaceWith(...replacements);
    changed = true;
  }

  if (!changed) return archive;
  files[scoreName] = strToU8(
    new XMLSerializer().serializeToString(documentNode),
  );
  return zipSync(files, { level: 6 });
};

export default function MuseScoreViewer({
  source,
  data,
  title,
  compact = false,
}: {
  /** URL the .mscz archive is fetched from; used when `data` is not given. */
  source?: string;
  /** Raw .mscz archive bytes; takes precedence over `source`. */
  data?: Uint8Array;
  title: string;
  compact?: boolean;
}) {
  const scoreRef = useRef<LoadedScore | null>(null);
  const renderToken = useRef(0);
  const [readyVersion, setReadyVersion] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(compact ? 76 : 92);
  const [svgPages, setSvgPages] = useState<string[]>([]);
  const [status, setStatus] = useState("Loading MuseScore renderer…");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const bytesPromise = data
      ? Promise.resolve(data)
      : fetch(source!).then((response) => {
          if (!response.ok) {
            throw new Error(`Score request failed (${response.status})`);
          }
          return response.arrayBuffer();
        });

    Promise.all([loadRuntime(), loadMuseScoreFonts(), bytesPromise])
      .then(async ([WebMscore, fonts, buffer]) => {
        if (cancelled) return;
        setStatus("Opening MuseScore file…");
        const scoreData = normalizeMultilineFrameText(new Uint8Array(buffer));
        // webMscore transfers the font buffers to its worker via postMessage,
        // which detaches them. Hand it copies so repeated loads (for example
        // the playground's live preview after every edit) keep working.
        const score = await WebMscore.load(
          "mscz",
          scoreData,
          fonts.map((font) => new Uint8Array(font)),
        );
        if (cancelled) {
          score.destroy(false);
          return;
        }
        scoreRef.current = score;
        const pages = await score.npages();
        setPageCount(pages);
        setReadyVersion((version) => version + 1);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(messageForError(reason));
          setStatus("");
          console.error("MuseScore viewer failed to load:", reason);
        }
      });

    return () => {
      cancelled = true;
      renderToken.current += 1;
      scoreRef.current?.destroy(false);
      scoreRef.current = null;
    };
  }, [source, data]);

  useEffect(() => {
    const score = scoreRef.current;
    if (!score || pageCount === 0) return;
    const token = ++renderToken.current;
    const renderPages = async () => {
      await Promise.resolve();
      setError("");
      try {
        const pages: string[] = [];
        for (let page = 0; page < pageCount; page += 1) {
          setStatus(`Engraving page ${page + 1} of ${pageCount}…`);
          const markup = await score.saveSvg(page, true);
          pages.push(markup.replace(/^<\?xml[^>]*>\s*/i, ""));
        }
        if (renderToken.current !== token) return;
        setSvgPages(pages);
        setStatus("");
      } catch (reason) {
        if (renderToken.current !== token) return;
        setError(messageForError(reason));
        setStatus("");
        console.error("MuseScore page failed to render:", reason);
      }
    };
    void renderPages();
  }, [pageCount, readyVersion]);

  return (
    <section className={`musescore-viewer ${compact ? "is-compact" : ""}`}>
      <header className="musescore-toolbar">
        <div>
          <span className="eyebrow">Engraved score</span>
          <strong>{title}</strong>
        </div>
        <div className="musescore-controls">
          <span className="page-count">
            {pageCount
              ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}`
              : "Loading…"}
          </span>
          <div className="zoom-controls" aria-label="Score zoom">
            <button
              type="button"
              onClick={() => setZoom((current) => Math.max(50, current - 10))}
              disabled={zoom <= 50}
              aria-label="Zoom out"
            >
              −
            </button>
            <span>{zoom}%</span>
            <button
              type="button"
              onClick={() => setZoom((current) => Math.min(150, current + 10))}
              disabled={zoom >= 150}
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
        </div>
      </header>
      <div
        className="musescore-canvas"
        aria-live="polite"
        aria-busy={Boolean(status)}
      >
        {status && (
          <div className="musescore-state">
            <i aria-hidden="true" />
            <span>{status}</span>
          </div>
        )}
        {error && (
          <div className="musescore-error" role="alert">
            <strong>Score preview unavailable</strong>
            <span>{error}</span>
          </div>
        )}
        {svgPages.length > 0 && (
          <div className="musescore-pages">
            {svgPages.map((svg, index) => (
              <div
                className="musescore-page"
                style={{ width: `${zoom}%` }}
                aria-label={`Score page ${index + 1} of ${svgPages.length}`}
                dangerouslySetInnerHTML={{ __html: svg }}
                key={index}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
