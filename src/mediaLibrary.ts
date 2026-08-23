import { useSyncExternalStore } from "react";
import type { Game } from "./catalog";
import {
  resolveLongplay,
  resolveScreenshots,
  type Screenshot,
} from "./mediaMatch";

export type CachedShot = Screenshot & { localUrl: string };
export type GameMediaRecord = {
  shots: CachedShot[];
  shotState: "loading" | "ready" | "empty" | "error";
  frames: CachedFrame[];
  frameState: "idle" | "capturing" | "ready" | "unavailable";
  frameError?: string;
  videoId: string | null;
  video: VideoPreview | null;
  videoState: "loading" | "ready" | "empty" | "error";
  videoError?: string;
};
export type MediaAuditStatus = {
  state: "idle" | "indexing" | "scanning" | "complete" | "error";
  completed: number;
  total: number;
  message?: string;
};

const records = new Map<string, GameMediaRecord>();
const inflight = new Map<string, Promise<GameMediaRecord>>();
const listeners = new Set<() => void>();
let version = 0;
let started = false;
let audit: MediaAuditStatus = { state: "idle", completed: 0, total: 0 };
let resources: Promise<{
  snaps: string[];
  titles: string[];
  longplays: { identifier: string; title: string }[];
}> | null = null;
const emit = () => {
  version++;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => version;
const blank = (): GameMediaRecord => ({
  shots: [],
  shotState: "loading",
  frames: [],
  frameState: "idle",
  videoId: null,
  video: null,
  videoState: "loading",
});
const patchRecord = (id: string, patch: Partial<GameMediaRecord>) => {
  records.set(id, { ...(records.get(id) ?? blank()), ...patch });
  emit();
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Asks EmuMovies for this game's snap, and treats every failure as "no snap".
 *
 * A media provider that is not configured, whose session drops, or that simply
 * does not carry a title must not turn into a broken preview: the archive
 * fallback exists precisely for those cases, and can only run if this path
 * declines quietly.
 */
const snapPreview = async (game: Game): Promise<VideoPreview | null> => {
  try {
    const snap = await window.gameStore?.getEmuMoviesSnap(game.title, game.region);
    if (!snap) return null;
    return {
      identifier: snap.name,
      name: snap.name,
      size: snap.bytes,
      format: snap.quality,
      duration: 0,
      streamUrl: snap.localUrl,
      localUrl: snap.localUrl,
      cached: true,
      source: "emumovies",
    };
  } catch {
    return null;
  }
};

const loadResources = () =>
  (resources ??= Promise.all([
    window.gameStore!.getArtIndex("Named_Snaps"),
    window.gameStore!.getArtIndex("Named_Titles"),
    window.gameStore!.getLongplays(),
  ]).then(([snaps, titles, longplays]) => ({
    snaps: snaps.files,
    titles: titles.files,
    longplays,
  })));

export const ensureGameMedia = (game: Game) => {
  if (!window.gameStore) {
    patchRecord(game.id, {
      shots: [],
      shotState: "empty",
      frames: [],
      frameState: "unavailable",
      videoId: null,
      video: null,
      videoState: "empty",
    });
    return Promise.resolve(records.get(game.id)!);
  }
  const existing = inflight.get(game.id);
  if (existing) return existing;
  patchRecord(game.id, {
    ...blank(),
    videoError: undefined,
  });
  const job = loadResources()
    .then(async (data) => {
      const resolved = resolveScreenshots(game.title, game.region, {
        Named_Snaps: data.snaps,
        Named_Titles: data.titles,
      });
      /**
       * EmuMovies first, when the member has signed in.
       *
       * A snap is the preview this pane actually wants: one file per release,
       * named by the same Redump convention the collection index parses, in a
       * published format of thirty seconds of gameplay followed by ten of title
       * screen. Matching it is a filename lookup rather than a similarity score
       * against an uploader's free-text longplay title, and the result is small
       * enough to keep, so the preview stops depending on a remote node staying
       * healthy. The archive path stays behind it for everything EmuMovies does
       * not carry, or when no account is configured.
       */
      const snap = await snapPreview(game);
      if (snap) {
        patchRecord(game.id, {
          videoId: null,
          video: snap,
          videoState: "ready",
        });
      }
      const match = snap ? null : resolveLongplay(game.title, data.longplays);
      let videoJob: Promise<void> = Promise.resolve();
      if (snap) {
        /* preview already resolved */
      } else if (!match)
        patchRecord(game.id, {
          videoId: null,
          video: null,
          videoState: "empty",
          frameState: "unavailable",
        });
      else {
        patchRecord(game.id, { videoId: match.identifier });
        /**
         * Resolution stops at metadata. The previous step here downloaded any
         * recording under 120 MB, which for this collection means almost never
         * — matched runtimes are 448 MB to 2.28 GB — so the audit's real
         * output was a download button. Playback streams instead.
         */
        videoJob = window
          .gameStore!.getVideoPreview(match.identifier)
          .then((video) => patchRecord(game.id, { video, videoState: "ready" }))
          .catch((error) =>
            patchRecord(game.id, {
              video: null,
              videoState: "error",
              videoError: errorText(error),
            }),
          );
      }
      if (!resolved.length)
        patchRecord(game.id, { shots: [], shotState: "empty" });
      else {
        try {
          const cached = await window.gameStore!.cacheScreenshots(
            game.id,
            resolved.map((shot) => shot.url),
          );
          const paths = new Map(
            cached.map((item) => [item.sourceUrl, item.localUrl]),
          );
          const shots = resolved
            .filter((shot) => paths.has(shot.url))
            .map((shot) => ({ ...shot, localUrl: paths.get(shot.url)! }));
          patchRecord(game.id, {
            shots,
            shotState: shots.length ? "ready" : "error",
          });
        } catch {
          patchRecord(game.id, { shots: [], shotState: "error" });
        }
      }
      await videoJob;
      return records.get(game.id)!;
    })
    .finally(() => inflight.delete(game.id));
  inflight.set(game.id, job);
  return job;
};

export const startMediaAudit = (games: Game[]) => {
  if (started || !window.gameStore) return;
  started = true;
  audit = {
    state: "indexing",
    completed: 0,
    total: games.length,
    message: "Loading media indexes",
  };
  emit();
  loadResources()
    .then(async () => {
      audit = {
        state: "scanning",
        completed: 0,
        total: games.length,
        message: "Checking missing media",
      };
      emit();
      let cursor = 0;
      const worker = async () => {
        while (cursor < games.length) {
          const game = games[cursor++];
          await ensureGameMedia(game);
          audit = {
            ...audit,
            completed: audit.completed + 1,
            message: game.title,
          };
          emit();
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      audit = {
        state: "complete",
        completed: games.length,
        total: games.length,
        message: "Media cache checked",
      };
      emit();
    })
    .catch((error) => {
      audit = {
        state: "error",
        completed: audit.completed,
        total: games.length,
        message: errorText(error),
      };
      emit();
    });
};
export const restartMediaAudit = (games: Game[]) => {
  records.clear();
  inflight.clear();
  resources = null;
  started = false;
  audit = { state: "idle", completed: 0, total: games.length };
  emit();
  startMediaAudit(games);
};
export const setCachedVideo = (gameId: string, video: VideoPreview) =>
  patchRecord(gameId, { video, videoState: "ready" });

/**
 * Gameplay stills taken out of the preview while it plays.
 *
 * Libretro publishes exactly one snap per release, so a gallery restricted to
 * one release — which is what stops it becoming a multi-region grab-bag — has
 * one gameplay frame in it. The recording that already backs the preview is a
 * far better screenshot source than a second metadata provider: it is
 * unambiguously this game, at native resolution, and can supply as many frames
 * as the gallery wants.
 *
 * They are read from the *visible* player rather than a second hidden one.
 * Opening the recording twice doubled the load on an archive storage node that
 * is intermittently unhealthy, and both elements then failed together: one run
 * streamed cleanly, the next reported "the recording could not be opened" in
 * the pane and in the gallery at the same moment. Seeking a hidden element to
 * twelve points across three hours was also unreliable in its own right —
 * drawing on `seeked` produced six frames of which four were byte-identical,
 * because the event fires before the decoder presents the new picture.
 * Sampling frames the player has genuinely shown costs no extra request and
 * cannot produce a duplicate, since playback only moves forward.
 */
const FRAME_COUNT = 12;
const FRAME_QUALITY = 0.82;

export const beginFrameCapture = (gameId: string) => {
  if (records.get(gameId)?.frameState === "idle")
    patchRecord(gameId, { frameState: "capturing" });
};
export const failFrameCapture = (gameId: string, reason: string) => {
  const record = records.get(gameId);
  if (record?.frames.length) return;
  patchRecord(gameId, { frameState: "unavailable", frameError: reason });
};

/** Frames already on disk, so a reopened game costs nothing. */
export const loadCachedFrames = async (game: Game) => {
  if (!window.gameStore) return false;
  const cached = await window.gameStore.getCachedFrames(game.id);
  if (!cached.length) return false;
  patchRecord(game.id, { frames: cached, frameState: "ready" });
  return true;
};

/**
 * Persists one sampled frame. Frames are written as they arrive so the gallery
 * fills while the preview plays rather than all at once at the end.
 */
export const collectFrame = async (gameId: string, at: number, data: string) => {
  const record = records.get(gameId);
  if (!window.gameStore || !record || record.frames.length >= FRAME_COUNT) return;
  const [saved] = await window.gameStore.cacheFrames(gameId, [{ at, data }]);
  if (!saved) return;
  const current = records.get(gameId);
  if (!current) return;
  const frames = [...current.frames, saved];
  patchRecord(gameId, {
    frames,
    frameState: frames.length >= FRAME_COUNT ? "ready" : "capturing",
    frameError: undefined,
  });
};

export const frameQuality = FRAME_QUALITY;
export const frameTarget = FRAME_COUNT;

export const useGameMedia = (gameId: string) => {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return records.get(gameId);
};
export const useMediaAuditStatus = () => {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return audit;
};
