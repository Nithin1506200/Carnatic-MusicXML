import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  CARNATIC_CASES,
  evaluateCase,
  evaluationPassed,
  snapshotPathFor,
  type CarnaticCase,
  type CaseEvaluation,
} from "../components/carnatic-cases";
import { hunkify, lineDiff } from "../components/line-diff";

const MuseScoreViewer = lazy(() => import("../components/musescore-viewer"));

/**
 * Converter test cases: runs the shared case list (`components/carnatic-cases.ts`,
 * the same list `scripts/carnatic-to-mscz.test.ts` executes) one case at a
 * time in the browser. Every case shows its `carnatic` notation block, the
 * generated `.mscx` with its engraved rendering, and — when the output differs from the stored snapshot
 * under `components/__snapshots__/carnatic-cases/` — the snapshot and a
 * line diff. The converter, the snapshots, and the repository scores are
 * async imports that load only when this page is opened.
 */

type ConverterModule = typeof import("../components/carnatic-mscx");

let converterPromise: Promise<ConverterModule> | null = null;
const loadConverter = () =>
  (converterPromise ??= import("../components/carnatic-mscx"));

const snapshotLoaders = import.meta.glob<string>(
  "../components/__snapshots__/carnatic-cases/*.txt",
  { query: "?raw", import: "default" },
);

/**
 * Only the repository scores the shared cases name are bundled. Vite needs
 * literal patterns here, so the list is duplicated from `CARNATIC_CASES`;
 * `components/carnatic-cases.test.ts` keeps the two in step.
 */
export const BUNDLED_CASE_SCORES = [
  "scores/02_basics/sarale_varase_to_alankaaras.mdx",
  "scores/02_basics/sri_gananatha_geethe.mdx",
  "scores/05_varnams/ninnu_kori_vasantha_varnam.mdx",
  "scores/06_bhajans/bhagyada_lakshmi_baaramma.mdx",
] as const;

const scoreLoaders = import.meta.glob<string>(
  [
    "../scores/02_basics/sarale_varase_to_alankaaras.mdx",
    "../scores/02_basics/sri_gananatha_geethe.mdx",
    "../scores/05_varnams/ninnu_kori_vasantha_varnam.mdx",
    "../scores/06_bhajans/bhagyada_lakshmi_baaramma.mdx",
  ],
  { query: "?raw", import: "default" },
);

const loadSnapshot = async (testCase: CarnaticCase): Promise<string | null> => {
  const loader = snapshotLoaders[`../${snapshotPathFor(testCase)}`];
  return loader ? loader() : null;
};

const loadSource = async (testCase: CarnaticCase): Promise<string> => {
  if (testCase.file) {
    const loader = scoreLoaders[`../${testCase.file}`];
    if (!loader) throw new Error(`Score file ${testCase.file} is not bundled.`);
    return loader();
  }
  return testCase.mdx ?? "";
};

type CaseStatus = "pass" | "changed" | "new" | "failed";

interface CaseRun {
  evaluation: CaseEvaluation;
  snapshot: string | null;
  status: CaseStatus;
}

const STATUS_LABEL: Record<CaseStatus, string> = {
  pass: "Matches snapshot",
  changed: "Differs from snapshot",
  new: "No snapshot yet",
  failed: "Expectation failed",
};

const statusFor = (evaluation: CaseEvaluation, snapshot: string | null) => {
  if (!evaluationPassed(evaluation)) return "failed";
  if (snapshot === null) return "new";
  return snapshot === evaluation.text ? "pass" : "changed";
};

/** Splits a companion MDX into its YAML metadata and `carnatic` blocks. */
const splitMdx = (mdx: string) => {
  const yaml = /```yaml\n([\s\S]*?)```/u.exec(mdx)?.[1]?.trimEnd() ?? "";
  const blocks = [...mdx.matchAll(/```carnatic\n([\s\S]*?)```/gu)].map(
    (match) => match[1].trimEnd(),
  );
  return { yaml, blocks };
};

// --- Page ----------------------------------------------------------------

const yieldToPaint = () =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });

export default function ConverterCases() {
  const [runs, setRuns] = useState<Record<string, CaseRun>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [runAll, setRunAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [copied, setCopied] = useState<string | null>(null);
  // `runsRef` is the sequencing source of truth; `runs` mirrors it for render.
  const runsRef = useRef<Record<string, CaseRun>>({});
  const cancelled = useRef(false);

  const commitRuns = (next: Record<string, CaseRun>) => {
    runsRef.current = next;
    setRuns(next);
  };

  const nextCase = () =>
    CARNATIC_CASES.find((testCase) => !runsRef.current[testCase.id]) ?? null;

  const runOne = async (testCase: CarnaticCase): Promise<boolean> => {
    setRunning(testCase.id);
    setError(null);
    let generated = false;
    try {
      const [converter, source, snapshot] = await Promise.all([
        loadConverter(),
        loadSource(testCase),
        loadSnapshot(testCase),
      ]);
      const evaluation = evaluateCase(converter.convertMdx, testCase, source);
      const run: CaseRun = {
        evaluation,
        snapshot,
        status: statusFor(evaluation, snapshot),
      };
      commitRuns({ ...runsRef.current, [testCase.id]: run });
      generated = true;
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : String(failure),
      );
    } finally {
      setRunning(null);
    }
    await yieldToPaint();
    document
      .getElementById(`case-${testCase.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    return generated;
  };

  const runNext = async () => {
    const testCase = nextCase();
    if (testCase) await runOne(testCase);
  };

  const runRemaining = async () => {
    cancelled.current = false;
    setRunAll(true);
    let testCase = nextCase();
    while (testCase && !cancelled.current) {
      // A case whose sources fail to load stays pending; stop instead of retrying it forever.
      if (!(await runOne(testCase))) break;
      await yieldToPaint();
      testCase = nextCase();
    }
    setRunAll(false);
  };

  const stopRun = () => {
    cancelled.current = true;
  };

  const reset = () => {
    cancelled.current = true;
    commitRuns({});
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const rerun = (testCase: CarnaticCase) => {
    const next = { ...runsRef.current };
    delete next[testCase.id];
    commitRuns(next);
    void runOne(testCase);
  };

  const copyOutput = (testCase: CarnaticCase, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(testCase.id);
      window.setTimeout(() => setCopied(null), 1500);
    });
  };

  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

  const doneCount = Object.keys(runs).length;
  const total = CARNATIC_CASES.length;
  const tally = { pass: 0, changed: 0, new: 0, failed: 0 };
  for (const run of Object.values(runs)) tally[run.status] += 1;
  const busy = running !== null || runAll;
  const remaining = total - doneCount;

  const groups = [...new Set(CARNATIC_CASES.map((testCase) => testCase.group))];
  const visible = (testCase: CarnaticCase) => {
    if (filter === "all") return true;
    const run = runs[testCase.id];
    return run ? run.status !== "pass" : false;
  };

  return (
    <div className="playground cases">
      <header className="document-head">
        <span className="eyebrow">Tool</span>
        <h1>Converter test cases</h1>
        <p>
          The {total} cases below are the ones <code>npm test</code> runs from{" "}
          <code>components/carnatic-cases.ts</code>. Each one is generated here in
          the browser, one at a time: the <code>carnatic</code> block, the{" "}
          <code>.mscx</code> it produces, and, when that output no longer matches
          the stored snapshot, the previous snapshot with the differences. Accept
          intended changes with <code>npx vitest run -u</code>.
        </p>
      </header>

      <div className="cases-toolbar">
        <div className="cases-progress" aria-live="polite">
          <strong>
            {doneCount}/{total}
          </strong>
          <span>generated</span>
          {tally.pass > 0 && <em className="is-pass">{tally.pass} match</em>}
          {tally.changed > 0 && (
            <em className="is-changed">{tally.changed} changed</em>
          )}
          {tally.new > 0 && <em className="is-new">{tally.new} new</em>}
          {tally.failed > 0 && (
            <em className="is-failed">{tally.failed} failed</em>
          )}
          {running && (
            <em className="is-running">
              running {CARNATIC_CASES.find((c) => c.id === running)?.title}…
            </em>
          )}
        </div>
        <div className="playground-control-actions">
          <label className="cases-filter">
            <input
              type="checkbox"
              checked={filter === "attention"}
              onChange={(event) =>
                setFilter(event.target.checked ? "attention" : "all")
              }
            />
            <span>Only changed / failed</span>
          </label>
          <button
            type="button"
            onClick={() => void runNext()}
            disabled={busy || remaining === 0}
          >
            Generate next{remaining > 0 ? ` (${remaining} left)` : ""}
          </button>
          {runAll ? (
            <button type="button" className="quiet" onClick={stopRun}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="quiet"
              onClick={() => void runRemaining()}
              disabled={busy || remaining === 0}
            >
              Generate all remaining
            </button>
          )}
          <button
            type="button"
            className="quiet"
            onClick={reset}
            disabled={doneCount === 0 && !busy}
          >
            Reset
          </button>
        </div>
      </div>

      {error && (
        <div className="playground-issues" role="alert">
          <strong>The case could not be generated</strong>
          <p>{error}</p>
        </div>
      )}

      <ol className="cases-index" aria-label="Case list">
        {CARNATIC_CASES.map((testCase, index) => {
          const run = runs[testCase.id];
          const state = run ? run.status : running === testCase.id ? "running" : "pending";
          return (
            <li key={testCase.id} className={`is-${state}`}>
              <a
                href={`#case-${testCase.id}`}
                title={run ? STATUS_LABEL[run.status] : "Not generated yet"}
              >
                <i aria-hidden="true" />
                <span>{index + 1}</span>
                {testCase.title}
              </a>
            </li>
          );
        })}
      </ol>

      {groups.map((group) => {
        const cases = CARNATIC_CASES.filter(
          (testCase) => testCase.group === group && visible(testCase),
        );
        if (cases.length === 0) return null;
        return (
          <section key={group} className="cases-group">
            <h2>{group}</h2>
            {cases.map((testCase) => (
              <CaseCard
                key={testCase.id}
                index={CARNATIC_CASES.indexOf(testCase) + 1}
                testCase={testCase}
                run={runs[testCase.id]}
                running={running === testCase.id}
                busy={busy}
                copied={copied === testCase.id}
                onRun={() => void runOne(testCase)}
                onRerun={() => rerun(testCase)}
                onCopy={(text) => copyOutput(testCase, text)}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

interface CaseCardProps {
  index: number;
  testCase: CarnaticCase;
  run?: CaseRun;
  running: boolean;
  busy: boolean;
  copied: boolean;
  onRun: () => void;
  onRerun: () => void;
  onCopy: (text: string) => void;
}

function CaseCard({
  index,
  testCase,
  run,
  running,
  busy,
  copied,
  onRun,
  onRerun,
  onCopy,
}: CaseCardProps) {
  const [source, setSource] = useState<string | null>(testCase.mdx ?? null);
  const [showSnapshot, setShowSnapshot] = useState(false);
  // Whole repository scores are heavy to engrave: render those on request.
  const [showScore, setShowScore] = useState(!testCase.file);

  // Repository-score cases pull their notation from the bundled MDX file.
  useEffect(() => {
    let active = true;
    if (!testCase.file) return;
    void loadSource(testCase)
      .then((mdx) => {
        if (active) setSource(mdx);
      })
      .catch((failure: unknown) => {
        if (active) setSource(`(could not load: ${String(failure)})`);
      });
    return () => {
      active = false;
    };
  }, [testCase]);

  const { yaml, blocks } = source ? splitMdx(source) : { yaml: "", blocks: [] };
  const status = run?.status;
  const diff =
    run && run.status === "changed" && run.snapshot !== null
      ? hunkify(lineDiff(run.snapshot, run.evaluation.text))
      : null;
  const removed = diff?.filter((line) => line.kind === "-").length ?? 0;
  const added = diff?.filter((line) => line.kind === "+").length ?? 0;

  return (
    <article
      id={`case-${testCase.id}`}
      className={`case-card ${status ? `is-${status}` : ""} ${running ? "is-running" : ""}`}
    >
      <header className="case-head">
        <div>
          <span className="case-number">Case {index}</span>
          <h3>{testCase.title}</h3>
          <p>{testCase.description}</p>
          <small className="case-meta">
            <code>{testCase.id}</code>
            {testCase.file && <code>{testCase.file}</code>}
            {testCase.unit && <code>--unit {testCase.unit}</code>}
            {testCase.expectError && <code>expects an error</code>}
          </small>
        </div>
        <div className="case-actions">
          {status && <b className={`case-status is-${status}`}>{STATUS_LABEL[status]}</b>}
          {running && <b className="case-status is-running">Generating…</b>}
          {!run && !running && (
            <button type="button" onClick={onRun} disabled={busy}>
              Generate
            </button>
          )}
          {run && (
            <button type="button" className="quiet" onClick={onRerun} disabled={busy}>
              Re-run
            </button>
          )}
        </div>
      </header>

      <div className="case-section">
        <small>1 · Carnatic notation block</small>
        {yaml && (
          <pre className="case-yaml">
            <code>{yaml}</code>
          </pre>
        )}
        {blocks.length > 0 ? (
          blocks.map((block, blockIndex) => (
            <pre key={blockIndex} className="case-notation">
              <code>{block}</code>
            </pre>
          ))
        ) : (
          <p className="playground-output-empty">
            {source === null ? "Loading the score file…" : "No carnatic block."}
          </p>
        )}
      </div>

      {run && (
        <>
          {(run.evaluation.errorExpectation || run.evaluation.checks.length > 0) && (
            <div className="case-section">
              <small>Expectations</small>
              <ul className="case-checks">
                {run.evaluation.errorExpectation && (
                  <li className={run.evaluation.errorExpectation.passed ? "is-pass" : "is-failed"}>
                    {run.evaluation.errorExpectation.message}
                  </li>
                )}
                {run.evaluation.checks.map((check, checkIndex) => (
                  <li key={checkIndex} className={check.passed ? "is-pass" : "is-failed"}>
                    <code>{check.label}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {run.evaluation.output.kind === "mscx" && (
            <div className="case-section case-preview">
              <div className="playground-output-head">
                <small>2 · Engraved score</small>
                <div>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => setShowScore((value) => !value)}
                  >
                    {showScore ? "Hide engraved score" : "Show engraved score"}
                  </button>
                </div>
              </div>
              {showScore ? (
                <Suspense
                  fallback={
                    <div className="document-state" aria-live="polite">
                      Loading the score renderer…
                    </div>
                  }
                >
                  <MuseScoreViewer
                    data={run.evaluation.output.mscz}
                    title={`${run.evaluation.output.title} · ${testCase.title}`}
                    compact
                  />
                </Suspense>
              ) : (
                <p className="playground-output-empty">
                  Engraving is off for this full score; show it to render the pages.
                </p>
              )}
            </div>
          )}

          <div className="case-section">
            <div className="playground-output-head">
              <small>
                {run.evaluation.output.kind === "mscx" ? "3 · Generated MuseScore .mscx" : "2 · Error"}
              </small>
              <div>
                <em className="is-ok">
                  {(run.evaluation.text.length / 1024).toFixed(1)} kB ·{" "}
                  {run.evaluation.text.split("\n").length} lines
                </em>
                <button type="button" onClick={() => onCopy(run.evaluation.text)}>
                  {copied ? "Copied ✓" : "Copy output"}
                </button>
              </div>
            </div>
            <pre className={`case-output ${run.evaluation.output.kind === "error" ? "is-error" : ""}`}>
              <code>{run.evaluation.text}</code>
            </pre>
          </div>

          {run.status === "new" && (
            <div className="case-section">
              <small>{run.evaluation.output.kind === "mscx" ? "4" : "3"} · Snapshot</small>
              <p className="playground-output-empty">
                No stored snapshot for this case yet. Running{" "}
                <code>npx vitest run scripts/carnatic-to-mscz.test.ts</code> writes it to{" "}
                <code>{snapshotPathFor(testCase)}</code>.
              </p>
            </div>
          )}

          {run.status === "pass" && (
            <div className="case-section">
              <small>{run.evaluation.output.kind === "mscx" ? "4" : "3"} · Snapshot</small>
              <p className="case-same">
                Output is identical to <code>{snapshotPathFor(testCase)}</code>.
              </p>
            </div>
          )}

          {diff && run.snapshot !== null && (
            <div className="case-section">
              <div className="playground-output-head">
                <small>{run.evaluation.output.kind === "mscx" ? "4" : "3"} · Differences from the stored snapshot</small>
                <div>
                  <em className="is-removed">−{removed}</em>
                  <em className="is-added">+{added}</em>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => setShowSnapshot((value) => !value)}
                  >
                    {showSnapshot ? "Hide full snapshot" : "Show full snapshot"}
                  </button>
                </div>
              </div>
              <pre className="case-diff">
                {diff.map((line, lineIndex) =>
                  line.kind === "skip" ? (
                    <span key={lineIndex} className="diff-skip">
                      ··· {line.count} unchanged line{line.count === 1 ? "" : "s"} ···
                    </span>
                  ) : (
                    <span
                      key={lineIndex}
                      className={
                        line.kind === "-"
                          ? "diff-removed"
                          : line.kind === "+"
                            ? "diff-added"
                            : "diff-context"
                      }
                    >
                      <i>{line.kind}</i>
                      {line.text}
                    </span>
                  ),
                )}
              </pre>
              {showSnapshot && (
                <>
                  <small>Previously generated snapshot</small>
                  <pre className="case-output is-snapshot">
                    <code>{run.snapshot}</code>
                  </pre>
                </>
              )}
            </div>
          )}
        </>
      )}
    </article>
  );
}
