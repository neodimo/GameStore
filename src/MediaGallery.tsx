import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  Film,
  Image,
  LoaderCircle,
  Maximize2,
  Play,
  X,
} from "lucide-react";
import type { Game } from "./catalog";
import {
  beginFrameCapture,
  collectFrame,
  ensureGameMedia,
  failFrameCapture,
  frameQuality,
  frameTarget,
  loadCachedFrames,
  setCachedVideo,
  useGameMedia,
} from "./mediaLibrary";

const bytes = (value: number) =>
  value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(1)} GB`
    : `${Math.round(value / 1024 ** 2)} MB`;
const clock = (value: number) =>
  `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;

/**
 * Where a preview starts, and how much of it plays before looping. Recordings
 * open on a publisher logo and a title screen, so the window skips the first
 * eighth of the run; thirty seconds is long enough to show what a game *is*
 * without becoming something you sit and watch.
 */
const LOOP_START = 0.12;
const LOOP_SECONDS = 30;
/** Seconds of playback between sampled gallery frames. */
const FRAME_SPACING = 2.2;
/**
 * A sampled frame has to contain a picture, and "the decoder presented it" does
 * not guarantee that: recordings fade through black between scenes, so the
 * first gallery tile came back solid black. Rejecting on brightness alone would
 * throw away real frames — the catalog is full of deliberately dark games — so
 * a frame is refused only when it is both dark and *flat*, which is what a fade
 * is and what a lit room never is. Flat white is refused for the same reason at
 * the other end, where recordings cut through a white flash into a title card.
 */
const BLANK_SAMPLE = 24;
const BLANK_LEVEL = 10;
const BLANK_SPREAD = 6;
const WHITE_LEVEL = 246;
/** How soon a refused frame is retried, and how many refusals end the check. */
const RETRY_AFTER = 0.4;
const BLANK_LIMIT = 40;

/**
 * Mean and spread of luma over a downscaled copy. Sampling a fixed small grid
 * keeps the cost per presented frame flat regardless of recording resolution.
 */
const isBlankFrame = (canvas: HTMLCanvasElement) => {
  const probe = document.createElement("canvas");
  probe.width = BLANK_SAMPLE;
  probe.height = BLANK_SAMPLE;
  const context = probe.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(canvas, 0, 0, BLANK_SAMPLE, BLANK_SAMPLE);
  const { data } = context.getImageData(0, 0, BLANK_SAMPLE, BLANK_SAMPLE);
  let total = 0;
  let squares = 0;
  const count = data.length / 4;
  for (let index = 0; index < data.length; index += 4) {
    const luma =
      0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    total += luma;
    squares += luma * luma;
  }
  const mean = total / count;
  const spread = Math.sqrt(Math.max(0, squares / count - mean * mean));
  if (spread >= BLANK_SPREAD) return false;
  return mean <= BLANK_LEVEL || mean >= WHITE_LEVEL;
};

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: { mediaTime: number }) => void,
  ) => number;
};

type GalleryItem = { url: string; kind: string; label: string };

export function MediaGallery({ game }: { game: Game }) {
  const record = useGameMedia(game.id);
  const shots = record?.shots ?? [];
  const frames = record?.frames ?? [];
  const shotState = record?.shotState ?? "loading";
  const frameState = record?.frameState ?? "idle";
  const video = record?.video ?? null;
  const videoState = record?.videoState ?? "loading";
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    void ensureGameMedia(game).then(() => loadCachedFrames(game));
  }, [game]);

  /**
   * Gameplay first, in run order, then the release's own snap and title screen.
   * The captured frames are the bulk of the gallery; the Libretro pair is the
   * verified, exactly-named release imagery and reads as its provenance.
   */
  const verifiedFrames = video?.source === "emumovies" ? frames : [];
  const items = useMemo<GalleryItem[]>(
    () => [
      ...verifiedFrames.map((frame) => ({
        url: frame.localUrl,
        kind: "Gameplay",
        label: clock(frame.at),
      })),
      ...shots.map((shot) => ({
        url: shot.localUrl,
        kind: shot.kind,
        label: shot.label,
      })),
    ],
    [verifiedFrames, shots],
  );

  const stills = items.map((item) => item.url);
  const capturing = frameState === "capturing";

  return (
    <section className="media-gallery">
      <PreviewPane
        game={game}
        video={video}
        videoState={videoState}
        stills={stills}
        needsFrames={
          video?.source === "emumovies" &&
          frameState !== "ready" &&
          frames.length < frameTarget
        }
      />
      <div className="screenshot-browser">
        <div className="media-heading">
          <span>
            <Image />
            Screenshots
          </span>
          <small>
            {capturing
              ? "Capturing gameplay frames…"
              : record?.frameError
                ? `${items.length} shown · gameplay capture failed: ${record.frameError}`
                : items.length
                  ? `${items.length} from the ${game.region} release`
                  : shotState === "loading"
                    ? "Resolving…"
                    : ""}
          </small>
        </div>
        {items.length ? (
          <div className="shot-grid">
            {items.map((item, i) => (
              <figure key={item.url} onClick={() => setLightbox(i)}>
                <img
                  src={item.url}
                  alt={`${game.title} ${item.kind.toLowerCase()} ${i + 1}`}
                  loading="lazy"
                />
                <figcaption>
                  <b>{item.kind}</b>
                  <span>{item.label}</span>
                  <Maximize2 />
                </figcaption>
              </figure>
            ))}
            {capturing && (
              <div className="shot-pending">
                <LoaderCircle className="spin" />
                <span>Capturing more…</span>
              </div>
            )}
          </div>
        ) : shotState === "loading" || capturing ? (
          <MediaWait
            icon={<LoaderCircle className="spin" />}
            title="Resolving and caching screenshots…"
          />
        ) : (
          <MediaWait
            icon={<Image />}
            title="No release-matched screenshots found"
            detail="No unrelated game imagery will be substituted."
          />
        )}
      </div>
      {lightbox !== null && items[lightbox] && (
        <Lightbox
          items={items}
          index={lightbox}
          title={game.title}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </section>
  );
}

/**
 * The looping preview.
 *
 * Three states used to reach the user as four different apologies — "not
 * loaded", "cache needed", "no short preview", "no long preview" — because
 * playback required possessing the file and matched recordings run 448 MB to
 * 2.28 GB against a 120 MB automatic ceiling. Playback now streams a range out
 * of the recording, and when a game has no recording at all the pane loops its
 * own stills rather than reporting an absence. Something always moves.
 */
function PreviewPane({
  game,
  video,
  videoState,
  stills,
  needsFrames,
}: {
  game: Game;
  video: VideoPreview | null;
  videoState: string;
  stills: string[];
  needsFrames: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const source = video?.localUrl ?? video?.streamUrl;
  const start = video?.duration ? video.duration * LOOP_START : 0;

  useEffect(() => {
    setFailed(false);
    setProgress(0);
  }, [video?.identifier]);

  /**
   * Samples the playing preview at a fixed spacing, using
   * `requestVideoFrameCallback` so every capture is a picture the decoder
   * actually presented. It reads the element that is already on screen: a
   * second hidden player doubled the load on the same archive node and made
   * both fail together.
   */
  useEffect(() => {
    const player = ref.current as FrameCallbackVideo | null;
    if (!player || !needsFrames || !source) return;
    let cancelled = false;
    let last = -Infinity;
    let taken = 0;
    let refused = 0;
    const canvas = document.createElement("canvas");
    beginFrameCapture(game.id);
    const tick = (_now: number, metadata: { mediaTime: number }) => {
      if (cancelled) return;
      if (metadata.mediaTime - last >= FRAME_SPACING && taken < frameTarget) {
        const { videoWidth: width, videoHeight: height } = player;
        const context = width && height ? canvas.getContext("2d") : null;
        if (context) {
          canvas.width = width;
          canvas.height = height;
          context.drawImage(player, 0, 0, width, height);
          if (refused < BLANK_LIMIT && isBlankFrame(canvas)) {
            /**
             * Retry sooner than the gallery spacing so a fade costs a moment
             * rather than a slot, and give up refusing after a bounded number
             * of tries so a recording that really is this dark still fills.
             */
            refused += 1;
            last = metadata.mediaTime - FRAME_SPACING + RETRY_AFTER;
            player.requestVideoFrameCallback?.(tick);
            return;
          }
          try {
            void collectFrame(
              game.id,
              metadata.mediaTime,
              canvas.toDataURL("image/jpeg", frameQuality),
            );
            last = metadata.mediaTime;
            taken += 1;
          } catch (error) {
            cancelled = true;
            failFrameCapture(
              game.id,
              error instanceof Error ? error.message : String(error),
            );
            return;
          }
        }
      }
      if (taken < frameTarget) player.requestVideoFrameCallback?.(tick);
    };
    if (!player.requestVideoFrameCallback)
      failFrameCapture(game.id, "This build cannot read frames from video.");
    else player.requestVideoFrameCallback(tick);
    return () => {
      cancelled = true;
    };
  }, [game.id, needsFrames, source]);
  useEffect(
    () =>
      window.gameStore?.onVideoProgress((p) => {
        if (p.identifier === video?.identifier) setProgress(p.percent);
      }),
    [video?.identifier],
  );

  const save = async () => {
    if (!video || !window.gameStore) return;
    setSaving(true);
    try {
      setCachedVideo(game.id, await window.gameStore.downloadVideo(video.identifier));
    } finally {
      setSaving(false);
    }
  };

  if (source && !failed)
    return (
      <div className="preview-pane">
        <video
          ref={ref}
          src={source}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster={video?.gifUrl}
          onLoadedMetadata={(event) => {
            if (start) event.currentTarget.currentTime = start;
          }}
          onTimeUpdate={(event) => {
            const player = event.currentTarget;
            if (player.currentTime < start - 1 || player.currentTime > start + LOOP_SECONDS)
              player.currentTime = start;
          }}
          onError={() => {
            setFailed(true);
            failFrameCapture(game.id, "The recording would not stream.");
          }}
        />
        <div className="preview-meta">
          <span>
            <Play /> Looping preview
          </span>
          <small>
            {video?.source === "emumovies"
              ? `EmuMovies snap · ${video.format}`
              : `${video?.cached ? "Saved offline" : "Streaming"} · ${
                  video?.duration ? `${clock(video.duration)} recording` : video?.format
                }`}
          </small>
          <div className="preview-actions">
            {video?.source !== "emumovies" && !video?.cached && (
              <button disabled={saving} onClick={save}>
                <Download />
                {saving
                  ? `Saving ${progress}%`
                  : `Save offline · ${bytes(video?.size ?? 0)}`}
              </button>
            )}
            {video && video.source !== "emumovies" && (
              <button
                onClick={() =>
                  window.gameStore?.openExternal(
                    `https://archive.org/details/${video.identifier}`,
                  )
                }
              >
                Source <ExternalLink />
              </button>
            )}
          </div>
        </div>
      </div>
    );

  if (stills.length)
    return (
      <div className="preview-pane">
        <StillLoop stills={stills} title={game.title} />
        <div className="preview-meta">
          <span>
            <Image /> Screenshot loop
          </span>
          <small>
            {failed
              ? "The recording would not stream; looping this release's frames instead."
              : "No verified recording for this release yet."}
          </small>
        </div>
      </div>
    );

  return (
    <div className="preview-pane empty">
      <MediaWait
        icon={
          videoState === "loading" ? <LoaderCircle className="spin" /> : <Film />
        }
        title={
          videoState === "loading"
            ? "Finding a release-matched preview…"
            : "Nothing to preview yet"
        }
        detail="GameStore will not attach a recording of a different game."
      />
    </div>
  );
}

/** Crossfading stills, the fallback that keeps every game's pane in motion. */
const STILL_MS = 2400;
function StillLoop({ stills, title }: { stills: string[]; title: string }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setIndex((value) => (value + 1) % stills.length),
      STILL_MS,
    );
    return () => clearInterval(timer);
  }, [stills.length]);
  return (
    <div className="still-loop">
      {stills.map((url, i) => (
        <img
          key={url}
          src={url}
          alt={`${title} preview frame ${i + 1}`}
          className={i === index ? "active" : ""}
        />
      ))}
    </div>
  );
}

function Lightbox({
  items,
  index,
  title,
  onIndex,
  onClose,
}: {
  items: GalleryItem[];
  index: number;
  title: string;
  onIndex: (value: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") onIndex((index + 1) % items.length);
      if (event.key === "ArrowLeft") onIndex((index - 1 + items.length) % items.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onIndex]);
  return (
    <div className="lightbox" role="dialog" aria-label={`${title} screenshots`} onClick={onClose}>
      <button className="lightbox-close" aria-label="Close screenshot viewer" onClick={onClose}>
        <X />
      </button>
      <img
        src={items[index].url}
        alt={`${title} ${items[index].kind.toLowerCase()}`}
        onClick={(event) => {
          event.stopPropagation();
          onIndex((index + 1) % items.length);
        }}
      />
      <p>
        {items[index].kind} · {items[index].label} · {index + 1} of {items.length}
      </p>
    </div>
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
