import { describe, expect, it } from "vitest";
import { matchRemoteTitles, normalizeRemoteTitle } from "./fpgaInventory";

describe("MiSTer remote library matching", () => {
  it("matches managed folders while ignoring release tags and punctuation", () => {
    expect(normalizeRemoteTitle("Future Cop - L.A.P.D. (USA)")).toBe("future cop l a p d");
    expect(matchRemoteTitles(["Future Cop - L.A.P.D. (USA)"], [
      { id: "future-cop", title: "Future Cop: L.A.P.D." },
      { id: "other", title: "Other Game" },
    ])).toEqual(["future-cop"]);
  });
});
