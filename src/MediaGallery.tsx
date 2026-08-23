import { useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  Film,
  Image,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import type { Game } from "./catalog";
import { ensureGameMedia, setCachedVideo, useGameMedia } from "./mediaLibrary";
const bytes = (value: number) =>
  value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(1)} GB`
    : `${Math.round(value / 1024 ** 2)} MB`;

export function MediaGallery({ game }: { game: Game }) {
  const record = useGameMedia(game.id);
  const shots = record?.shots ?? [];
  const shotState = record?.shotState ?? "loading";
  const video = record?.video ?? null;
  const videoId = record?.videoId ?? null;
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const videoState = downloading
    ? "downloading"
    : error
      ? "error"
      : (record?.videoState ?? "loading");
  const archiveUrl = useMemo(
    () => (videoId ? `https://archive.org/details/${videoId}` : ""),
    [videoId],
  );

  useEffect(() => {
    ensureGameMedia(game);
  }, [game]);
  useEffect(
    () =>
      window.gameStore?.onVideoProgress((p) => {
        if (p.identifier === videoId) {
          setProgress(p.percent);
          setDownloading(true);
        }
      }),
    [videoId],
  );

  const download = async () => {
    if (!videoId || !window.gameStore) return;
    setDownloading(true);
    setProgress(0);
    setError("");
    try {
      const info = await window.gameStore.downloadVideo(videoId);
      setCachedVideo(game.id, info);
      setDownloading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDownloading(false);
    }
  };
  return (
    <section className="media-gallery">
      <div className="screenshot-browser">
        <div className="media-heading">
          <span>
            <Image />
            Screenshots
          </span>
          <small>
            {shotState === "ready"
              ? `${shots.length} cached locally`
              : shotState === "loading"
                ? "Caching…"
                : ""}
          </small>
        </div>
        {shotState === "ready" ? (
          <div className="shot-scroll">
            {shots.map((shot, i) => (
              <figure key={shot.url}>
                <img src={shot.localUrl} alt={`${game.title} ${shot.kind.toLowerCase()} ${i + 1}`} loading="lazy" />
                <figcaption>{shot.kind}<span>{shot.label}</span></figcaption>
              </figure>
            ))}
          </div>
        ) : shotState === "loading" ? (
          <MediaWait icon={<LoaderCircle className="spin" />} title="Resolving and caching screenshots…" />
        ) : (
          <MediaWait icon={<Image />} title={shotState === "empty" ? "No release-matched screenshots found" : "Screenshots unavailable"} detail="No unrelated game imagery will be substituted." />
        )}
      </div>
      <div className="local-video">
        <div className="media-heading">
          <span>
            <Film />
            Short gameplay loop
          </span>
          {videoId && (
            <button onClick={() => window.gameStore?.openExternal(archiveUrl)}>
              Source <ExternalLink />
            </button>
          )}
        </div>
        {video?.cached && video.localUrl ? (
          <video
            src={video.localUrl}
            controls
            loop
            muted
            preload="metadata"
            onTimeUpdate={(event) => {
              if (event.currentTarget.currentTime > 45) event.currentTarget.currentTime = 8;
            }}
          />
        ) : videoState === "loading" ? (
          <MediaWait
            icon={<LoaderCircle className="spin" />}
            title="Finding a release-matched preview…"
          />
        ) : videoState === "empty" ? (
          <MediaWait
            icon={<Film />}
            title="No verified short preview found"
            detail="Screenshots remain available; GameStore will not attach a vaguely similar video."
          />
        ) : videoState === "downloading" ? (
          <MediaWait
            icon={<Download />}
            title={`Downloading local video · ${progress}%`}
            detail="Playback starts from the local cache when complete."
            progress={progress}
          />
        ) : video ? (
          <MediaWait
            icon={<Download />}
            title={video.size > 250 * 1024 ** 2 ? "Longplay rejected as preview" : `Download local preview · ${bytes(video.size)}`}
            detail={video.size > 250 * 1024 ** 2 ? "This source is too large for an ambient game preview. GameStore will wait for a short-form provider result." : `${video.format} · cached only after you approve the download.`}
            action={video.size > 250 * 1024 ** 2 ? undefined : "Download to cache"}
            onAction={video.size > 250 * 1024 ** 2 ? undefined : download}
          />
        ) : (
          <MediaWait
            icon={<RefreshCw />}
            title="Video unavailable"
            detail={
              error ||
              record?.videoError ||
              "The provider could not resolve a playable MP4."
            }
          />
        )}
      </div>
    </section>
  );
}

function MediaWait({
  icon,
  title,
  detail,
  progress,
  action,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: string;
  progress?: number;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="media-wait">
      {icon}
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
      {progress !== undefined && (
        <i>
          <b style={{ width: `${progress}%` }} />
        </i>
      )}
      {action && <button onClick={onAction}>{action}</button>}
    </div>
  );
}
