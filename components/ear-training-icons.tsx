type IconName =
  | "ear"
  | "piano"
  | "saxophone"
  | "play"
  | "replay"
  | "reveal"
  | "next"
  | "stop"
  | "end"
  | "volume"
  | "muted";
export function EarTrainingIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    ear: (
      <>
        <path d="M8 15c0 4 1.5 6 4 6 2 0 3-1.5 3-3 0-3 5-4 5-9a7 7 0 0 0-14 0" />
        <path d="M9 10a4 4 0 0 1 8 0c0 2-2 3-3 4" />
        <path d="M3 10v4M23 8v8" />
      </>
    ),
    piano: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16m6-16v16M6 4v8m6-8v8m6-8v8" />
      </>
    ),
    saxophone: (
      <>
        <path d="m14 3 4 2-5 11c-1 3-4 5-7 4-2-1-3-3-2-5l2-4 4 2-2 4c1 1 2 0 3-2l3-9-3-1 1-2h2Z" />
        <path d="m13 8 3 1m-4 2 3 1m-4 2 3 1M18 5l3-2" />
      </>
    ),
    play: <path d="m8 4 12 8-12 8Z" />,
    replay: (
      <>
        <path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" />
      </>
    ),
    reveal: (
      <>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    next: (
      <>
        <path d="m5 5 10 7-10 7ZM19 5v14" />
      </>
    ),
    stop: <rect x="5" y="5" width="14" height="14" rx="1" />,
    end: (
      <>
        <path d="M10 4H4v16h6m4-12 5 4-5 4m-6-4h11" />
      </>
    ),
    volume: (
      <>
        <path d="m11 4-6 5H2v6h3l6 5ZM15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14" />
      </>
    ),
    muted: (
      <>
        <path d="m11 4-6 5H2v6h3l6 5ZM16 9l6 6m0-6-6 6" />
      </>
    ),
  };
  return (
    <svg
      className="ear-training-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
