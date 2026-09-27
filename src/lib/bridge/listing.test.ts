import { describe, expect, it } from "vitest";
import { LIST_MAX, MESSAGE_MAX, PASSAGE_MAX, renderGuestQuestion, renderRequest, renderRequestList, type PendingRequest } from "./listing";

const PIECE = "11111111-1111-4111-8111-111111111111";

function row(id: string, over: Partial<PendingRequest> = {}): PendingRequest {
  return {
    id,
    kind: "ask",
    piece_id: PIECE,
    piece_title: "Why Northfield?",
    prompt: "Is my opening strong enough?",
    selection: "",
    created_at: "2026-09-23T14:02:03.123456+00:00",
    ...over,
  };
}

describe("renderRequestList", () => {
  it("says plainly when nothing is waiting", () => {
    expect(renderRequestList([])).toContain("Nothing is waiting");
  });

  it("lists a question with its ids, the pointed-at passage, and what to call", () => {
    const t = renderRequestList([row("r1", { selection: "It was very good at it." })]);
    expect(t).toContain("1 request waiting");
    expect(t).toContain("[request_id: r1]");
    expect(t).toContain(`Piece: "Why Northfield?" [piece_id: ${PIECE}]`);
    expect(t).toContain("Is my opening strong enough?");
    expect(t).toContain('"""\nIt was very good at it.\n"""');
    expect(t).toContain(`read_piece with piece_id ${PIECE}, then answer_request with request_id r1`);
    expect(t).toContain("Sent: 2026-09-23 14:02 UTC");
  });

  it("asks for versions of a highlighted passage, each between option tags", () => {
    const t = renderRequestList([row("p1", { kind: "polish", prompt: "", selection: "My robot sorted cans." })]);
    expect(t).toContain("rewrites of a highlighted passage [request_id: p1] (kind: polish)");
    expect(t).toContain('"""\nMy robot sorted cans.\n"""');
    expect(t).toContain("(nothing typed: make it better)");
    expect(t).toContain("2 or 3 different versions");
    expect(t).toContain("<option>…</option>");
    expect(t).toContain("answer_request with request_id p1");
    expect(t).not.toContain("suggest_edits");
  });

  it("asks for a highlight when a polish request has no passage", () => {
    expect(renderRequestList([row("p2", { kind: "polish", selection: " " })])).toContain("No passage was highlighted");
  });

  it("sends odds requests to read_strategy and set_college_strategy", () => {
    const t = renderRequestList([row("o1", { kind: "odds", piece_id: null, piece_title: null, prompt: "" })]);
    expect(t).toContain("admission odds for every college [request_id: o1]");
    // Not only the chance: how each college fits the student too.
    for (const field of ["chance_percent", "fit_rank", "campus_life", "reputation"]) expect(t).toContain(field);
    expect(t).toContain("read_strategy, then set_college_strategy for each college");
    expect(t).toContain("answer_request with request_id o1");
    expect(t).not.toContain("piece_id");
  });

  it("says the piece is already there when it was sent along, so read_piece isn't needed", () => {
    const t = renderRequestList([row("r1")], { included: { pieces: new Set([PIECE]) } });
    expect(t).toContain("is included below");
    expect(t).not.toContain("call read_piece");
    expect(t).toContain("answer_request with request_id r1");
  });

  it("lets the counselor answer by replying, for every kind", () => {
    const kinds = ["ask", "polish", "odds", "interview", "chat", "transcript"] as const;
    for (const kind of kinds) {
      const t = renderRequest(row(`k-${kind}`, { kind, selection: kind === "polish" ? "My robot." : "" }), {
        answer: "reply",
        included: { pieces: new Set([PIECE]), strategy: true, profile: true },
      });
      expect(t, kind).toContain(`(kind: ${kind})`);
      expect(t, kind).toContain("don't call answer_request");
      expect(t, kind).not.toMatch(/call answer_request with/);
      expect(t, kind).not.toContain("read_strategy,");
    }
  });

  it("passes a chat message on as it was written", () => {
    const t = renderRequestList([row("c1", { kind: "chat", piece_id: null, piece_title: null, prompt: "What should I work on this week?" })]);
    expect(t).toContain("a message from the student [request_id: c1] (kind: chat)");
    expect(t).toContain("What should I work on this week?");
    expect(t).toContain("Reply with answer_request with request_id c1");
  });

  it("hands a pasted transcript over whole, to be read into the academics without guessing", () => {
    const transcript = "Grade 9: Honors English A, Algebra II A-\nGrade 10: AP World History B+\nCumulative GPA 3.87 unweighted, 4.21 weighted";
    const tr = row("t1", { kind: "transcript", piece_id: null, piece_title: null, prompt: transcript });
    const t = renderRequestList([tr]);
    expect(t).toContain("the student's transcript, to fill in their academics [request_id: t1] (kind: transcript)");
    expect(t).toContain(`"""\n${transcript}\n"""`);
    expect(t).toContain("call read_profile");
    expect(t).toContain("update_academics");
    expect(t).toContain("class_rank");
    expect(t).toContain("coursework");
    expect(t).toContain("Never guess a grade");
    expect(t).toContain("leave intended_major alone");
    expect(t).toContain("call answer_request with request_id t1");
    const withProfile = renderRequest(tr, { answer: "reply", included: { profile: true } });
    expect(withProfile).toContain("academics already saved, is included below");
    expect(withProfile).not.toContain("call read_profile");
    // A long one is cut where the message box cuts.
    const long = renderRequest(row("t2", { kind: "transcript", piece_id: null, prompt: "x".repeat(MESSAGE_MAX + 10) }));
    expect(long).toContain("[…cut here: transcript cut]");
    // Pasted into the chat instead, it's read the same way.
    expect(renderRequest(row("c2", { kind: "chat", piece_id: null, prompt: transcript }))).toContain("If they paste their transcript or grades");
  });

  it("caps how many it lists and how long a passage runs", () => {
    const many = Array.from({ length: LIST_MAX + 3 }, (_, i) => row(`r${i}`));
    const t = renderRequestList(many);
    expect(t).toContain(`${LIST_MAX + 3} requests waiting`);
    expect(t).toContain(`Showing the first ${LIST_MAX}`);
    expect(t).not.toContain(`[request_id: r${LIST_MAX}]`);
    const long = renderRequestList([row("l", { selection: "x".repeat(PASSAGE_MAX + 50) })]);
    expect(long).toContain("[…cut here: read_piece has the whole text]");
  });
});

describe("a question from someone the desk is shared with", () => {
  it("says who asked, and that the counselor answers them without changing the desk or telling what's only the student's", () => {
    const t = renderRequest(row("g1", { asked_by: "Mom Testy", prompt: "Is the ending too abrupt?" }), { answer: "reply" });
    expect(t).toContain("Question from Mom Testy, someone the student shares their desk with (not the student):");
    expect(t).toContain("Is the ending too abrupt?");
    expect(t).toContain("don't reveal those");
    expect(t).toContain("change nothing on the desk for them");
  });

  it("reads as the student's own when nobody else asked, with a word that the people they share with may read the answer", () => {
    const t = renderRequest(row("s1", { asked_by: "" }));
    expect(t).toContain("Question:");
    expect(t).not.toContain("Question from");
    expect(t).toContain("may read this answer: keep private details from the profile");
  });

  it("goes to the counselor on its own, with the essay and nothing to call", () => {
    const t = renderGuestQuestion(row("g1", { asked_by: "Mom Testy", prompt: "Is the ending too abrupt?" }), "# Why Northfield?\nThe essay itself.");
    expect(t).toContain('Mom Testy, someone the student shares their desk with (a parent or mentor), asks about "Why Northfield?":');
    expect(t).toContain("Is the ending too abrupt?");
    expect(t).toContain("The essay itself.");
    expect(t).toContain("doesn't allow AI help with drafting");
    for (const call of ["answer_request", "read_piece", "read_profile", "request_id"]) expect(t).not.toContain(call);
  });

  it("says so when the essay couldn't be loaded", () => {
    expect(renderGuestQuestion(row("g2", { asked_by: "Mom Testy" }), null)).toContain("say you can't see it right now");
  });
});
