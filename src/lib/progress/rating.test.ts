import { describe, expect, it } from "vitest";
import { ordinal, ratingBand, ratingPhrase } from "./rating";

describe("ratings on the board", () => {
  it("bands: below 55, 55–64, 65–79, 80 and up", () => {
    const band = (rating: number) => ratingBand({ rating });
    expect([0, 54, 55, 64, 65, 79, 80, 100].map(band)).toEqual(["low", "low", "mid", "mid", "ok", "ok", "high", "high"]);
  });

  it("percentiles read as ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 63, 72, 100].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "63rd", "72nd", "100th"]);
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
    expect(ratingPhrase({ ...p, rating_ai: "“A tapestry of…”: stock phrase." }, false)).toBe(" · rated 72, sounds AI-written");
  });
});
