import { describe, expect, it } from "vitest";
import { renderWriting, writingParts, WRITING_PART, type WritingGroup, type WritingPiece } from "./writing";

const piece = (id: string, text: string, over: Partial<WritingPiece> = {}): WritingPiece => ({
  id,
  title: `Piece ${id}`,
  prompt: "Why us?",
  status: "Drafting",
  words: text.split(/\s+/).filter(Boolean).length,
  limit_kind: "words",
  limit_value: 250,
  text,
  ...over,
});

const college = (name: string, pieces: WritingPiece[]): WritingGroup => ({ name, id: `id-${name}`, deadline: "2030-11-01", pieces });

describe("read_writing", () => {
  it("shows every piece with its prompt, limit, text and rating, by college", () => {
    const t = renderWriting(
      [
        college("Testy Tech", [piece("a", "I like rockets.", { rating: { rating: 72, stale: true } }), piece("b", "")]),
        { name: null, id: null, pieces: [piece("c", "My personal statement.")] },
      ],
      1,
    );
    expect(t).toContain("This is all of it.");
    expect(t).toContain("## Testy Tech [college_id: id-Testy Tech], deadline 2030-11-01");
    expect(t).toContain("### Piece a [piece_id: a] 3 words, limit 250 words, Drafting, rated 72 (edited since)");
    expect(t).toContain('Prompt: Why us?\n"""\nI like rockets.\n"""');
    expect(t).toContain("### Piece b [piece_id: b] empty: nothing to rate");
    expect(t).toContain("## Independent pieces (not tied to one college)");
    expect(t).toContain("My personal statement.");
  });

  it("splits a big desk into parts, never splitting a college, and says to save each part's ratings first", () => {
    const long = "word ".repeat(WRITING_PART / 10);
    const groups = ["A", "B", "C"].map((n) => college(n, [piece(n, long)]));
    const parts = writingParts(groups);
    expect(parts.length).toBe(2);
    expect(parts[0].length + parts[1].length).toBe(3);
    const first = renderWriting(groups, 1);
    expect(first).toContain("part 1 of 2");
    expect(first).toContain("before reading part 2 (read_writing with part: 2)");
    expect(renderWriting(groups, 2)).toContain("This is the last part (2 of 2).");
    expect(renderWriting(groups, 3)).toBe("There are only 2 parts.");
  });

  it("can leave out the text of colleges already rated and unchanged", () => {
    const groups = [
      college("Done", [piece("d", "Rated and the same.", { rating: { rating: 80, stale: false } })]),
      college("Changed", [piece("e", "Rated, then edited.", { rating: { rating: 60, stale: true } })]),
    ];
    const t = renderWriting(groups, 1, true);
    expect(t).toContain("Every piece here has a rating and hasn't been edited since (Piece d: 80)");
    expect(t).not.toContain("Rated and the same.");
    expect(t).toContain("Rated, then edited.");
  });
});
