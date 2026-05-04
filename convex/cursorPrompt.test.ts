import { describe, expect, it } from "vitest";
import { buildPrompt } from "./cursorPrompt";

const base = {
  agentName: "Otto",
  sourceLabel: "feedback widget",
  sourceRef: "https://example.test/dashboard",
  description: "Fix the chart on /metrics to use this week's data.",
  quotedContext: "the chart on /metrics is using last week's data",
  parserConfidence: 0.9,
  routerConfidence: 0.8,
};

describe("trust contract prompt", () => {
  it("encodes draft-only constraint literally", () => {
    const p = buildPrompt(base);
    expect(p).toMatch(/DRAFT/);
    expect(p).toMatch(/Never mark it ready-for-review/);
    expect(p).toMatch(/Never merge/);
  });

  it("forbids weakening tests", () => {
    const p = buildPrompt(base);
    expect(p).toMatch(/Tests are sacred/);
    expect(p).toMatch(/may NOT weaken, skip, or delete existing tests/);
  });

  it("requires the agent to write only to its own branch", () => {
    expect(buildPrompt(base)).toMatch(/Write only to your own branch/);
  });

  it("requires the PR description to include source + confidence + footer", () => {
    const p = buildPrompt(base);
    expect(p).toMatch(/source surface/);
    expect(p).toMatch(/confidence score/);
    expect(p).toMatch(/opened by Otto/);
  });

  it("multiplies parser and router confidence when both present", () => {
    const p = buildPrompt(base);
    // 0.9 * 0.8 = 0.72
    expect(p).toMatch(/Confidence: 0\.72/);
  });

  it("falls back to parser confidence when router confidence is null", () => {
    const p = buildPrompt({ ...base, routerConfidence: null });
    expect(p).toMatch(/Confidence: 0\.90/);
  });

  it("includes the action item and quoted context verbatim", () => {
    const p = buildPrompt(base);
    expect(p).toContain(base.description);
    expect(p).toContain(base.quotedContext);
    expect(p).toContain(base.sourceRef);
  });

  it("uses the configured agent name in the constraint and footer", () => {
    const p = buildPrompt({ ...base, agentName: "Tonka" });
    expect(p).toContain("You are Tonka");
    expect(p).toContain("opened by Tonka");
  });

  it("describes the source label naturally", () => {
    const meeting = buildPrompt({ ...base, sourceLabel: "meeting" });
    expect(meeting).toMatch(/surfaced from a meeting\./);
  });
});
