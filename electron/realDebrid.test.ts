import { describe, expect, it, vi } from "vitest";
import { addTorrent } from "./realDebrid";

describe("Real-Debrid torrent upload", () => {
  it("sends raw torrent bytes rather than a multipart form field", async () => {
    const torrent = new Uint8Array([0x64, 0x34, 0x3a, 0x69, 0x6e, 0x66, 0x6f]);
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("PUT");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer secret",
        "Content-Type": "application/x-bittorrent",
      });
      expect(init?.body).toBe(torrent);
      expect(init?.body).not.toBeInstanceOf(FormData);
      return new Response(JSON.stringify({ id: "torrent-42" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(addTorrent("secret", torrent, fetchImpl as typeof fetch)).resolves.toBe("torrent-42");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
