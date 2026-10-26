import { describe, expect, it } from "vitest";
import { ratingBand, ratingPhrase } from "./rating";

describe("ratings on the board", () => {
  it("bands: below 55, 55–64, 65–79, 80 and up", () => {
    const band = (rating: number) => ratingBand({ rating, word_count: 100 });
    expect([0, 54, 55, 64, 65, 79, 80, 100].map(band)).toEqual(["low", "low", "mid", "mid", "ok", "ok", "high", "high"]);
  });

  it("no band without a rating, or with nothing written", () => {
    expect(ratingBand({ word_count: 100 })).toBeNull();
    expect(ratingBand({ rating: null, word_count: 100 })).toBeNull();
    expect(ratingBand({ rating: 70, word_count: 0 })).toBeNull();
  });

  it("says the rating, whether it's stale, and the reason when asked", () => {
    const p = { rating: 72, rating_reason: "Specific and warm.", word_count: 90 };
    expect(ratingPhrase(p, false)).toBe(" · rated 72");
    expect(ratingPhrase({ ...p, rating_stale: true }, true)).toBe(" · rated 72, edited since: Specific and warm.");
    expect(ratingPhrase({ word_count: 90 }, true)).toBe("");
  });
});
