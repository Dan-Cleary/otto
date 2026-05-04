"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import OpenAI from "openai";

type ParsedItem = {
  description: string;
  quotedContext: string;
  repoCandidate: string | null;
  surfacedInUserNotes?: boolean;
  confidence: number;
};

const SYSTEM_PROMPT = `You extract code-related action items from raw user feedback.

Return a JSON object: { "items": ParsedItem[] }.

Each ParsedItem:
  description: imperative sentence describing what should change in code.
  quotedContext: exact substring from the input that triggered this item.
  repoCandidate: best guess at target repo name if the user named one, else null.
  surfacedInUserNotes: true if this came from the user's own typed notes vs. transcript only (Granola only; omit for widget).
  confidence: 0-1 float. Reflect uncertainty honestly.

Only include items that require code changes. Skip vague gripes, status updates, and non-code asks.`;

export const parse = internalAction({
  args: { ingestEventId: v.id("ingestEvents") },
  handler: async (ctx, { ingestEventId }) => {
    const event = await ctx.runQuery(internal.parserDb.getIngestEvent, {
      id: ingestEventId,
    });
    if (!event) throw new Error(`ingestEvent ${ingestEventId} not found`);

    const userInput = formatInput(event);

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userInput },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: { items?: ParsedItem[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { items: [] };
    }

    if (!event.teamId) {
      // Orphan event — happens during the team migration window. Skip
      // and audit; the migration script will reattach the event.
      return;
    }

    await ctx.runMutation(internal.parserDb.persistItems, {
      ingestEventId,
      teamId: event.teamId,
      sourceType: event.sourceType,
      sourceRef: event.sourceRef,
      widgetUrl:
        event.sourceType === "widget" && typeof event.payload?.url === "string"
          ? event.payload.url
          : null,
      items: parsed.items ?? [],
    });
  },
});

function formatInput(event: {
  sourceType: "widget" | "granola" | "zoom";
  payload: any;
}): string {
  if (event.sourceType === "widget") {
    const { url, description, consoleErrors } = event.payload ?? {};
    return [
      `Source: widget`,
      `Page: ${url ?? "unknown"}`,
      `User said: ${description ?? ""}`,
      consoleErrors?.length
        ? `Recent console errors:\n${consoleErrors.slice(-5).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  if (event.sourceType === "zoom") {
    const { topic, startedAt, transcript, hostEmail } = event.payload ?? {};
    return [
      `Source: zoom`,
      `Meeting: ${topic ?? "untitled"}`,
      hostEmail ? `Host: ${hostEmail}` : "",
      startedAt ? `When: ${startedAt}` : "",
      transcript ? `Transcript:\n${transcript.slice(0, 12000)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  return JSON.stringify(event.payload).slice(0, 12000);
}
