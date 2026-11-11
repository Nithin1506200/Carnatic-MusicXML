import { useEffect, useRef, useState } from "react";
import { renderScoreAudio, type AudioScore } from "./score-audio";

export default function ScoreAudioPlayer({
  score,
  title,
}: {
  score: AudioScore;
  title: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      requestRef.current?.abort();
      audio?.pause();
      audio?.removeAttribute("src");
      audio?.load();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const prepareAudio = async () => {
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    setLoading(true);
    setError("");
    try {
      const blob = await renderScoreAudio(score, request.signal);
      if (request.signal.aborted) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const nextUrl = URL.createObjectURL(blob);
      urlRef.current = nextUrl;
      setUrl(nextUrl);
    } catch (reason) {
      if (request.signal.aborted) return;
      setError(
        reason instanceof Error
          ? reason.message
          : "Audio could not be prepared. Please retry.",
      );
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  };

  return (
    <div className="musescore-audio">
      {!url && (
        <button
          type="button"
          onClick={() => void prepareAudio()}
          disabled={loading}
        >
          {loading ? "Preparing audio…" : error ? "Retry audio" : "Load audio"}
        </button>
      )}
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        src={url || undefined}
        hidden={!url}
        aria-label={`Audio playback: ${title}`}
        onLoadedMetadata={(event) => {
          event.currentTarget.playbackRate = speed;
          event.currentTarget.preservesPitch = true;
        }}
        onRateChange={(event) => setSpeed(event.currentTarget.playbackRate)}
        onError={() => {
          if (!url) return;
          setError("Audio could not be played. Please retry.");
          setUrl("");
          if (urlRef.current) URL.revokeObjectURL(urlRef.current);
          urlRef.current = null;
        }}
      />
      <label className="musescore-audio-speed">
        Speed
        <select
          aria-label="Playback speed"
          value={speed}
          disabled={!url}
          onChange={(event) => {
            const rate = Number(event.target.value);
            setSpeed(rate);
            if (audioRef.current) {
              audioRef.current.preservesPitch = true;
              audioRef.current.playbackRate = rate;
            }
          }}
        >
          {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
            <option key={rate} value={rate}>
              {rate}×
            </option>
          ))}
        </select>
      </label>
      {loading && <span role="status">Preparing playback for this score.</span>}
      {error && (
        <span className="musescore-audio-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
