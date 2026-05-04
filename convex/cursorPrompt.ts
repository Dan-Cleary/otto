// Trust contract is encoded literally in this prompt.
// Changes here are policy changes — review carefully.

export type PromptInputs = {
  agentName: string;
  sourceLabel: string; // "meeting" | "feedback widget" | etc.
  sourceRef: string;
  description: string;
  quotedContext: string;
  parserConfidence: number;
  routerConfidence: number | null;
};

export function buildPrompt(p: PromptInputs): string {
  const confidence =
    p.routerConfidence === null
      ? p.parserConfidence.toFixed(2)
      : (p.parserConfidence * p.routerConfidence).toFixed(2);

  return `You are ${p.agentName}, an automated agent opening a DRAFT pull request for a code-related action item surfaced from a ${p.sourceLabel}.

Source: ${p.sourceRef}
Action item: ${p.description}
Original context: ${p.quotedContext}
Confidence: ${confidence}

Constraints (non-negotiable):
1. Open the PR as DRAFT. Never mark it ready-for-review. Never merge.
2. Write only to your own branch.
3. The PR description must include: source surface, the action item above, the confidence score, and an "opened by ${p.agentName}" footer.
4. If the change requires significant judgment calls, document them in the PR description rather than guessing.
5. Tests are sacred. You may add tests. You may NOT weaken, skip, or delete existing tests to make code pass. If existing tests block the change, surface that in the PR description and stop.

Implement the simplest reasonable interpretation of the action item.`;
}
