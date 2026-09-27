import { describe, expect, it } from "vitest";
import { noticeFor, onTab, showing } from "./notices";

const r = (kind: "ask" | "polish" | "odds" | "transcript" | "chat" | "interview", piece_id: string | null = null) => ({
  id: "r1",
  kind,
  piece_id,
  answered_by: "",
});

describe("answer notices", () => {
  it("says where each answer is, and lights up its tab", () => {
    expect(noticeFor(r("chat"), "/desk")).toEqual({ id: "r1", tab: "Counselor", href: "/desk/counselor", text: "Claude replied on the Counselor page." });
    expect(noticeFor(r("interview"), "/desk/profile")?.tab).toBe("Counselor");
    expect(noticeFor(r("odds"), "/desk")).toMatchObject({ tab: "Strategy", text: "Claude estimated your odds." });
    expect(noticeFor(r("transcript"), "/desk")).toMatchObject({ tab: "Profile", href: "/desk/profile#academics" });
    expect(noticeFor(r("ask", "p1"), "/desk", "Why us?")).toMatchObject({
      tab: "Write",
      href: "/desk/piece/p1",
      text: "Claude answered your question about “Why us?”.",
    });
    expect(noticeFor({ ...r("polish", "p1"), answered_by: "ChatGPT" }, "/desk/piece/p2", "Why us?")?.text).toBe("ChatGPT's rewrites about “Why us?” are ready.");
    expect(noticeFor({ ...r("ask", "p1"), asked_by: "Mom Testy" }, "/desk", "Why us?")?.text).toBe("Claude answered Mom Testy's question about “Why us?”.");
  });

  it("stays quiet when the answer is already in front of the student", () => {
    expect(noticeFor(r("chat"), "/desk/counselor")).toBeNull();
    expect(noticeFor(r("odds"), "/desk/strategy")).toBeNull();
    expect(noticeFor(r("transcript"), "/desk/profile")).toBeNull();
    expect(noticeFor(r("transcript"), "/desk/counselor")).toBeNull();
    expect(noticeFor(r("ask", "p1"), "/desk/piece/p1")).toBeNull();
    expect(noticeFor(r("ask", null), "/desk")).toBeNull();
  });

  it("clears a tab's dot on any of its pages", () => {
    expect(onTab("Write", "/desk/piece/p9")).toBe(true);
    expect(onTab("Write", "/desk")).toBe(false);
    expect(onTab("Counselor", "/desk/counselor")).toBe(true);
    expect(onTab("Strategy", "/desk/profile")).toBe(false);
  });

  it("counts a note about a piece as read only on that piece", () => {
    const n = noticeFor(r("ask", "p1"), "/desk/piece/p2", "Why us?")!;
    expect(showing(n, "/desk/piece/p2")).toBe(false);
    expect(showing(n, "/desk/write")).toBe(false);
    expect(showing(n, "/desk/piece/p1")).toBe(true);
    expect(showing(noticeFor(r("chat"), "/desk")!, "/desk/counselor")).toBe(true);
  });
});
