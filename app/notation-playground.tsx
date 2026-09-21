import { lazy, Suspense, useEffect, useRef, useState } from "react";

const MuseScoreViewer = lazy(() => import("../components/musescore-viewer"));

/**
 * Notation playground: converts a `carnatic` block to MuseScore .mscx XML in
 * the browser. The converter and the raga registry are async imports — they
 * load only when this page is opened.
 */

type ConverterModule = typeof import("../components/carnatic-mscx");
type RagasModule = typeof import("../components/ragas.generated");

let converterPromise: Promise<ConverterModule> | null = null;
let ragasPromise: Promise<RagasModule> | null = null;

const loadConverter = () =>
  (converterPromise ??= import("../components/carnatic-mscx"));
const loadRagas = () =>
  (ragasPromise ??= import("../components/ragas.generated"));

interface PlaygroundIssue {
  line?: number;
  column?: number;
  message: string;
}

interface PlaygroundResult {
  mscx: string;
  mscz: Uint8Array;
  title: string;
}

const DEFAULT_RAGA = "Mayamalavagowla";
const DEFAULT_TITLE = "Playground sketch";

const UNDO_GROUP_MS = 750;
const HISTORY_LIMIT = 100;
/** Conversion is throttled: at most one run per interval, final edit always converted. */
const THROTTLE_MS = 250;

interface TalaOption {
  name: string;
  /** Anga grouping in cells, when the workbook documents one. */
  grouping?: string;
}

/**
 * Talas documented in docs/carnatic_saxophone.md: Aadi and the Saptasulaadi
 * entries used by the current workbook, with their recorded anga groupings.
 */
const TALAS: TalaOption[] = [
  { name: "Aadi", grouping: "4 + 2 + 2" },
  { name: "Dhruva", grouping: "4 + 2 + 4 + 4" },
  { name: "Matya", grouping: "4 + 2 + 4" },
  { name: "Roopaka", grouping: "2 + 4" },
  { name: "Jampe" },
  { name: "Tiruputa", grouping: "3 + 2 + 2" },
  { name: "Atta" },
  { name: "Eka", grouping: "4" },
];

const DEFAULT_TALA = "Aadi";

const EXAMPLE_NOTATION = `# Pallavi
@Time: (4+2+2)/4
S R G M | P D | N Ṡ ||
sa ri ga ma | pa dha | ni sā ||
Ṡ N D P | M G | R S ||
sā ni dha pa | ma ga | ri sa ||`;

const synthesizeMdx = (
  title: string,
  raga: string,
  tala: string,
  unit: string,
  notation: string,
) => {
  const talaOption = TALAS.find((option) => option.name === tala);
  return [
    "```yaml",
    `title: ${JSON.stringify(title.trim() || DEFAULT_TITLE)}`,
    `raga: ${JSON.stringify(raga)}`,
    ...(talaOption ? [`tala: ${JSON.stringify(talaOption.name)}`] : []),
    ...(talaOption?.grouping
      ? [`tala_grouping: ${JSON.stringify(talaOption.grouping)}`]
      : []),
    ...(unit === "crotchet" ? [] : [`notation_unit: ${unit}`]),
    "```",
    "",
    "```carnatic",
    notation,
    "```",
  ].join("\n");
};

const issueFrom = (error: unknown): PlaygroundIssue => {
  if (error instanceof Error) {
    const positioned = error as Error & { line?: unknown; column?: unknown };
    return {
      line: typeof positioned.line === "number" ? positioned.line : undefined,
      column:
        typeof positioned.column === "number" ? positioned.column : undefined,
      message: error.message,
    };
  }
  return { message: String(error) };
};

const slugFor = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "playground";

export default function NotationPlayground() {
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [raga, setRaga] = useState(DEFAULT_RAGA);
  const [tala, setTala] = useState(DEFAULT_TALA);
  const [unit, setUnit] = useState<"crotchet" | "quaver">("crotchet");
  const [notation, setNotation] = useState(EXAMPLE_NOTATION);
  const [ragaNames, setRagaNames] = useState<string[]>([DEFAULT_RAGA]);
  const [issues, setIssues] = useState<PlaygroundIssue[]>([]);
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [convertedFor, setConvertedFor] = useState("");
  const [conversionCount, setConversionCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const conversionRun = useRef(0);
  const lastConvertAt = useRef(0);
  const lastSnapshotAt = useRef(0);
  const [history, setHistory] = useState<{ past: string[]; future: string[] }>({
    past: [],
    future: [],
  });

  // The raga registry is an async import: it arrives only on this page.
  useEffect(() => {
    let cancelled = false;
    void loadRagas().then((module) => {
      if (!cancelled) {
        setRagaNames(module.RAGAS.map((entry) => entry.name));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The MDX the current inputs describe; conversion reacts to every change.
  const currentMdx = synthesizeMdx(title, raga, tala, unit, notation);

  // Throttled conversion of the current notation into .mscx/.mscz: a run
  // starts immediately after a quiet interval, and the final edit always
  // converts — fast typing never starves the output.
  useEffect(() => {
    const run = ++conversionRun.current;
    const wait = Math.max(
      0,
      THROTTLE_MS - (Date.now() - lastConvertAt.current),
    );
    const timer = window.setTimeout(() => {
      lastConvertAt.current = Date.now();
      if (!notation.trim()) {
        setIssues([]);
        setResult(null);
        setConvertedFor(currentMdx);
        return;
      }
      void loadConverter()
        .then((converter) => {
          if (run !== conversionRun.current) return;
          const converted = converter.convertMdx(currentMdx, {
            stem: "playground",
          });
          if (run !== conversionRun.current) return;
          setResult(converted);
          setIssues([]);
          setConvertedFor(currentMdx);
          setConversionCount((count) => count + 1);
        })
        .catch((error: unknown) => {
          if (run !== conversionRun.current) return;
          setIssues([issueFrom(error)]);
          setConvertedFor(currentMdx);
        });
    }, wait);
    return () => window.clearTimeout(timer);
  }, [currentMdx, notation]);

  const focusIssue = (issue: PlaygroundIssue) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    if (issue.line === undefined) return;
    const lines = notation.split("\n");
    let offset = 0;
    for (let index = 0; index < issue.line - 1 && index < lines.length; index += 1) {
      offset += lines[index].length + 1;
    }
    offset += Math.max(0, (issue.column ?? 1) - 1);
    offset = Math.min(offset, notation.length);
    textarea.setSelectionRange(offset, offset);
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 21;
    textarea.scrollTop = Math.max(0, (issue.line - 3) * lineHeight);
    textarea.setSelectionRange(offset, offset);
  };

  const copyXml = () => {
    if (!result) return;
    void navigator.clipboard.writeText(result.mscx).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const downloadMscz = () => {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([result.mscz as BlobPart], { type: "application/zip" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slugFor(result.title)}.mscz`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const remember = (value: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastSnapshotAt.current < UNDO_GROUP_MS) return;
    lastSnapshotAt.current = now;
    setHistory((current) => ({
      past: [...current.past.slice(-(HISTORY_LIMIT - 1)), value],
      future: [],
    }));
  };

  const changeNotation = (value: string, forceSnapshot = false) => {
    if (value === notation) return;
    remember(notation, forceSnapshot);
    setNotation(value);
  };

  const undo = () => {
    const { past, future } = history;
    if (past.length === 0) return;
    lastSnapshotAt.current = Date.now();
    setHistory({
      past: past.slice(0, -1),
      future: [...future, notation],
    });
    setNotation(past[past.length - 1]);
  };

  const redo = () => {
    const { past, future } = history;
    if (future.length === 0) return;
    lastSnapshotAt.current = Date.now();
    setHistory({
      past: [...past, notation],
      future: future.slice(0, -1),
    });
    setNotation(future[future.length - 1]);
  };

  const handleNotationKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (key === "y") {
      event.preventDefault();
      redo();
    }
  };

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const loadExample = () => {
    setTitle(DEFAULT_TITLE);
    setRaga(DEFAULT_RAGA);
    setTala(DEFAULT_TALA);
    setUnit("crotchet");
    changeNotation(EXAMPLE_NOTATION, true);
  };

  const clearAll = () => {
    changeNotation("", true);
    textareaRef.current?.focus();
  };

  const stale = issues.length > 0 && result !== null;
  const pending = Boolean(notation.trim()) && convertedFor !== currentMdx;

  return (
    <div className="playground">
      <header className="document-head">
        <span className="eyebrow">Tool</span>
        <h1>Notation playground</h1>
        <p>
          Type <code>carnatic</code> notation and see the MuseScore{" "}
          <code>.mscx</code> it converts into — the same output{" "}
          <code>npm run mscz:generate</code> writes. Everything runs in your
          browser; the converter loads only when you open this page.
        </p>
      </header>

      <div className="playground-controls">
        <label>
          <small>Title</small>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={DEFAULT_TITLE}
          />
        </label>
        <label>
          <small>Raga</small>
          <select value={raga} onChange={(event) => setRaga(event.target.value)}>
            {ragaNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <small>Taala</small>
          <select value={tala} onChange={(event) => setTala(event.target.value)}>
            <option value="">None</option>
            {TALAS.map((option) => (
              <option key={option.name} value={option.name}>
                {option.name}
                {option.grouping ? ` (${option.grouping})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <small>Notation unit</small>
          <select
            value={unit}
            onChange={(event) => setUnit(event.target.value as "crotchet" | "quaver")}
          >
            <option value="crotchet">Crotchet (¼) cells</option>
            <option value="quaver">Quaver (⅛) cells</option>
          </select>
        </label>
        <div className="playground-control-actions">
          <button
            type="button"
            className="quiet"
            onClick={undo}
            disabled={!canUndo}
            title="Undo (Ctrl/⌘+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            className="quiet"
            onClick={redo}
            disabled={!canRedo}
            title="Redo (Ctrl/⌘+Shift+Z or Ctrl+Y)"
          >
            Redo
          </button>
          <button type="button" onClick={loadExample}>
            Load example
          </button>
          <button type="button" className="quiet" onClick={clearAll}>
            Clear
          </button>
        </div>
      </div>

      <div className="playground-grid">
        <div className="playground-editor">
          <label htmlFor="playground-notation">
            <small>Carnatic notation block</small>
          </label>
          <textarea
            id="playground-notation"
            ref={textareaRef}
            value={notation}
            onChange={(event) => changeNotation(event.target.value)}
            onKeyDown={handleNotationKeyDown}
            spellCheck={false}
            aria-invalid={issues.length > 0}
            className={issues.length > 0 ? "has-errors" : ""}
            placeholder={"# Pallavi\nS R G M | P D | N Ṡ ||"}
          />
          {issues.length > 0 && (
            <div className="playground-issues" role="alert">
              <strong>Notation needs attention</strong>
              <ul>
                {issues.map((issue, index) => (
                  <li key={index}>
                    <button type="button" onClick={() => focusIssue(issue)}>
                      {issue.line !== undefined && (
                        <span className="playground-issue-pos">
                          {issue.line}:{issue.column ?? 1}
                        </span>
                      )}
                      <span>{issue.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className={`playground-preview ${stale ? "is-stale" : ""}`}>
          <small>Engraved preview</small>
          {result ? (
            <Suspense
              fallback={
                <div className="document-state" aria-live="polite">
                  Loading the score renderer…
                </div>
              }
            >
              <MuseScoreViewer
                data={result.mscz}
                title={`${result.title} · preview`}
                compact
              />
            </Suspense>
          ) : (
            <p className="playground-output-empty">
              {notation.trim()
                ? issues.length > 0
                  ? "Fix the notation to see the engraved score."
                  : "Loading the converter…"
                : "Type Carnatic notation to see the engraved score."}
            </p>
          )}
        </div>
      </div>

      <div className="playground-output">
        <div className="playground-output-head">
          <small>Generated MuseScore .mscx</small>
          <div>
            {pending && <em>converting…</em>}
            {!pending && stale && <em>showing the last valid output</em>}
            {!pending && !stale && result && (
              <em className="is-ok">
                v{conversionCount} · {(result.mscx.length / 1024).toFixed(1)} kB
              </em>
            )}
            <button type="button" onClick={copyXml} disabled={!result}>
              {copied ? "Copied ✓" : "Copy XML"}
            </button>
            <button type="button" onClick={downloadMscz} disabled={!result}>
              Download .mscz
            </button>
          </div>
        </div>
        {result ? (
          <pre className={stale ? "is-stale" : ""}>
            <code>{result.mscx}</code>
          </pre>
        ) : (
          <p className="playground-output-empty">
            {notation.trim()
              ? issues.length > 0
                ? "Fix the notation to generate XML."
                : "Loading the converter…"
              : "Start typing Carnatic notation to see the generated XML."}
          </p>
        )}
      </div>
    </div>
  );
}
