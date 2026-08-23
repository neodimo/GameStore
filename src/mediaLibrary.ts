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
  videoId: string | null;
  video: LocalVideoInfo | null;
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
const patchRecord = (id: string, patch: Partial<GameMediaRecord>) => {
  const current = records.get(id) ?? {
    shots: [],
    shotState: "loading",
    videoId: null,
    video: null,
    videoState: "loading",
  };
  records.set(id, { ...current, ...patch });
  emit();
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

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
      videoId: null,
      video: null,
      videoState: "empty",
    });
    return Promise.resolve(records.get(game.id)!);
  }
  const existing = inflight.get(game.id);
  if (existing) return existing;
  patchRecord(game.id, {
    shots: [],
    shotState: "loading",
    videoId: null,
    video: null,
    videoState: "loading",
    videoError: undefined,
  });
  const job = loadResources()
    .then(async (data) => {
      const resolved = resolveScreenshots(game.title, game.region, {
        Named_Snaps: data.snaps,
        Named_Titles: data.titles,
      });
      const match = resolveLongplay(game.title, data.longplays);
      let videoJob: Promise<void> = Promise.resolve();
      if (!match)
        patchRecord(game.id, {
          videoId: null,
          video: null,
          videoState: "empty",
        });
      else {
        patchRecord(game.id, { videoId: match.identifier });
        videoJob = window
          .gameStore!.getVideoInfo(match.identifier)
          .then(async (video) => {
            if (!video.cached && video.size <= 120 * 1024 ** 2) {
              const cached = await window.gameStore!.downloadVideo(match.identifier);
              patchRecord(game.id, { video: cached, videoState: "ready" });
            } else patchRecord(game.id, { video, videoState: "ready" });
          })
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
export const setCachedVideo = (gameId: string, video: LocalVideoInfo) =>
  patchRecord(gameId, { video, videoState: "ready" });
export const useGameMedia = (gameId: string) => {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return records.get(gameId);
};
export const useMediaAuditStatus = () => {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return audit;
};
