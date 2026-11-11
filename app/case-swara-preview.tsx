import { useMemo } from "react";
import { MusicScore, parseScoreNotation } from "../components/score-notation";

/** Invalid notation is intentional in rejection cases; keep other previews usable. */
export default function CaseSwaraPreview({ source }: { source: string }) {
  const issue = useMemo(() => {
    try {
      parseScoreNotation(source);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [source]);

  if (issue) {
    return (
      <p className="playground-output-empty">
        Swara preview unavailable: {issue}
      </p>
    );
  }

  return (
    <div className="markdown playground-representation-body notation-view-both">
      <MusicScore source={source} />
    </div>
  );
}
