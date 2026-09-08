import { describe, expect, it } from "vitest";
import { igdbImageUrl, igdbPlatformId } from "./igdb";

describe("IGDB platform media", () => {
  it("uses each console's own IGDB platform id", () => {
    expect(igdbPlatformId("X360")).toBe(12);
    expect(igdbPlatformId("PS2")).toBe(8);
    expect(igdbPlatformId("PS1")).toBe(7);
  });

  it("requests display-sized images over HTTPS", () => {
    expect(igdbImageUrl("//images.igdb.com/igdb/image/upload/t_thumb/abc.jpg", "cover_big"))
      .toBe("https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg");
  });
});
