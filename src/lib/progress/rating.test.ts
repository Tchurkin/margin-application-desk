import { describe, expect, it } from "vitest";
import { ratingBand, ratingPhrase } from "./rating";

describe("ratings on the board", () => {
  it("bands: below 55, 55–64, 65–79, 80 and up", () => {
    const band = (rating: number) => ratingBand({ rating });
    expect([0, 54, 55, 64, 65, 79, 80, 100].map(band)).toEqual(["low", "low", "mid", "mid", "ok", "ok", "high", "high"]);
  });

  it("no band without a rating", () => {
    expect(ratingBand({})).toBeNull();
    expect(ratingBand({ rating: null })).toBeNull();
  });

  it("says the rating, whether it's stale, and the reason when asked", () => {
    const p = { rating: 72, rating_reason: "Specific and warm." };
    expect(ratingPhrase(p, false)).toBe(" · rated 72");
    expect(ratingPhrase({ ...p, rating_stale: true }, true)).toBe(" · rated 72, edited since: Specific and warm.");
    expect(ratingPhrase({}, true)).toBe("");
  });
});
