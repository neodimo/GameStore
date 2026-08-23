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
import {
  resolveLongplay,
  resolveScreenshots,
  type Screenshot,
} from "./mediaMatch";

type CachedShot = Screenshot & { localUrl: string };
const bytes = (value: number) =>
  value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(1)} GB`
    : `${Math.round(value / 1024 ** 2)} MB`;

export function MediaGallery({ game }: { game: Game }) {
  const [shots, setShots] = useState<CachedShot[]>([]);
  const [shotState, setShotState] = useState<
    "loading" | "ready" | "empty" | "error"
  >("loading");
  const [video, setVideo] = useState<LocalVideoInfo | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<
    "loading" | "ready" | "empty" | "downloading" | "error"
  >("loading");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const archiveUrl = useMemo(
    () => (videoId ? `https://archive.org/details/${videoId}` : ""),
    [videoId],
  );

  useEffect(() => {
    let alive = true;
    setShots([]);
    setShotState("loading");
    setVideo(null);
    setVideoId(null);
    setVideoState("loading");
    setError("");
    if (!window.gameStore) {
      setShotState("error");
      setVideoState("error");
      return;
    }
    Promise.all([
      window.gameStore.getArtIndex("Named_Snaps"),
      window.gameStore.getArtIndex("Named_Titles"),
    ])
      .then(async ([snaps, titles]) => {
        const resolved = resolveScreenshots(game.title, game.region, {
          Named_Snaps: snaps.files,
          Named_Titles: titles.files,
        });
        if (!resolved.length) {
          if (alive) setShotState("empty");
          return;
        }
        const cached = await window.gameStore!.cacheScreenshots(
          game.id,
          resolved.map((s) => s.url),
        );
        const paths = new Map(cached.map((c) => [c.sourceUrl, c.localUrl]));
        if (alive) {
          setShots(
            resolved
              .filter((s) => paths.has(s.url))
              .map((s) => ({ ...s, localUrl: paths.get(s.url)! })),
          );
          setShotState(cached.length ? "ready" : "error");
        }
      })
      .catch(() => alive && setShotState("error"));
    window.gameStore
      .getLongplays()
      .then(async (items) => {
        const match = resolveLongplay(game.title, items);
        if (!match) {
          if (alive) setVideoState("empty");
          return;
        }
        if (alive) setVideoId(match.identifier);
        const info = await window.gameStore!.getVideoInfo(match.identifier);
        if (alive) {
          setVideo(info);
          setVideoState("ready");
        }
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : String(e));
          setVideoState("error");
        }
      });
    return () => {
      alive = false;
    };
  }, [game.id, game.region, game.title]);
  useEffect(
    () =>
      window.gameStore?.onVideoProgress((p) => {
        if (p.identifier === videoId) {
          setProgress(p.percent);
          setVideoState("downloading");
        }
      }),
    [videoId],
  );

  const download = async () => {
    if (!videoId || !window.gameStore) return;
    setVideoState("downloading");
    setProgress(0);
    try {
      const info = await window.gameStore.downloadVideo(videoId);
      setVideo(info);
      setVideoState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setVideoState("error");
    }
  };
  return (
    <section className="media-gallery">
      <div className="local-video">
        <div className="media-heading">
          <span>
            <Film />
            Local gameplay preview
          </span>
          {videoId && (
            <button onClick={() => window.gameStore?.openExternal(archiveUrl)}>
              Source <ExternalLink />
            </button>
          )}
        </div>
        {video?.cached && video.localUrl ? (
          <video src={video.localUrl} controls preload="metadata" />
        ) : videoState === "loading" ? (
          <MediaWait
            icon={<LoaderCircle className="spin" />}
            title="Finding a release-matched longplay…"
          />
        ) : videoState === "empty" ? (
          <MediaWait
            icon={<Film />}
            title="No verified longplay found"
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
            title={`Download local preview · ${bytes(video.size)}`}
            detail={`${video.format} · cached only after you approve the download.`}
            action="Download to cache"
            onAction={download}
          />
        ) : (
          <MediaWait
            icon={<RefreshCw />}
            title="Video unavailable"
            detail={error || "The provider could not resolve a playable MP4."}
          />
        )}
      </div>
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
                <img
                  src={shot.localUrl}
                  alt={`${game.title} ${shot.kind.toLowerCase()} ${i + 1}`}
                  loading="lazy"
                />
                <figcaption>
                  {shot.kind}
                  <span>{shot.label}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : shotState === "loading" ? (
          <MediaWait
            icon={<LoaderCircle className="spin" />}
            title="Resolving and caching screenshots…"
          />
        ) : (
          <MediaWait
            icon={<Image />}
            title={
              shotState === "empty"
                ? "No release-matched screenshots found"
                : "Screenshots unavailable"
            }
            detail="No unrelated game imagery will be substituted."
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
