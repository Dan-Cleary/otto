import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAuthAction } from "./auth";

const GRANOLA_API_BASE = "https://api.granola.ai/v1";
const PAGE_LIMIT = 50;

// Cron entry point — fans out to a per-team poll for every team that
// has a Granola API key configured.
export const pollAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const teamIds: string[] = await ctx.runQuery(
      internal.granolaDb.teamsToPoll,
      {},
    );
    for (const teamId of teamIds) {
      await ctx.scheduler.runAfter(0, internal.granola.pollNewMeetings, {
        teamId: teamId as any,
      });
    }
  },
});

export const pollNewMeetings = internalAction({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    const apiKey = await ctx.runQuery(internal.granolaDb.getApiKey, {
      teamId,
    });
    if (!apiKey) {
      await ctx.runMutation(internal.granolaDb.recordPoll, {
        teamId,
        ok: false,
        ingested: 0,
        error: "no granola api key configured",
      });
      return;
    }

    const cursor = await ctx.runQuery(internal.granolaDb.getCursor, {
      teamId,
    });
    const url = new URL(`${GRANOLA_API_BASE}/notes`);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor) url.searchParams.set("cursor", cursor);

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json",
        },
      });
    } catch (err) {
      await ctx.runMutation(internal.granolaDb.recordPoll, {
        teamId,
        ok: false,
        ingested: 0,
        error: `network: ${(err as Error).message}`,
      });
      return;
    }

    if (res.status === 429) {
      await ctx.runMutation(internal.granolaDb.recordPoll, {
        teamId,
        ok: false,
        ingested: 0,
        error: "rate-limited (429)",
      });
      return;
    }
    if (res.status === 401 || res.status === 403) {
      await ctx.runMutation(internal.granolaDb.recordPoll, {
        teamId,
        ok: false,
        ingested: 0,
        error: `auth failed (${res.status})`,
      });
      return;
    }
    if (!res.ok) {
      await ctx.runMutation(internal.granolaDb.recordPoll, {
        teamId,
        ok: false,
        ingested: 0,
        error: `http ${res.status}`,
      });
      return;
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      await ctx.runMutation(internal.granolaDb.recordPoll, {
        teamId,
        ok: false,
        ingested: 0,
        error: `bad json: ${(err as Error).message}`,
      });
      return;
    }

    const { notes, nextCursor } = extractPage(body);
    let ingested = 0;
    for (const note of notes) {
      const noteId = readNoteId(note);
      if (!noteId) continue;
      const sourceRef = `granola:${noteId}`;

      const already = await ctx.runQuery(internal.granolaDb.findExisting, {
        teamId,
        sourceRef,
      });
      if (already) continue;

      await ctx.runMutation(internal.ingest.recordGranola, {
        teamId,
        sourceRef,
        payload: note,
      });
      ingested++;
    }

    await ctx.runMutation(internal.granolaDb.recordPoll, {
      teamId,
      ok: true,
      ingested,
      nextCursor: nextCursor ?? null,
    });
  },
});

// ── Public actions called from the admin UI ─────────────────────

export const saveApiKey = action({
  args: { teamId: v.id("teams"), key: v.string() },
  handler: async (
    ctx,
    { teamId, key },
  ): Promise<{ ok: boolean; error?: string }> => {
    const { email } = await requireAuthAction(ctx);
    // Verify the caller is a team admin (action context can't reach
    // ctx.db; round-trip through a query that does).
    await ctx.runQuery(internal.granolaDb.ensureTeamAdmin, { teamId });

    const trimmed = key.trim();
    if (!trimmed) return { ok: false, error: "key is empty" };

    // Validate before persisting.
    const probe = await fetch(`${GRANOLA_API_BASE}/notes?limit=1`, {
      headers: {
        authorization: `Bearer ${trimmed}`,
        accept: "application/json",
      },
    });
    if (probe.status === 401 || probe.status === 403)
      return { ok: false, error: "key was rejected by granola" };
    if (probe.status === 429)
      return { ok: false, error: "rate-limited; try again in a moment" };
    if (!probe.ok)
      return { ok: false, error: `granola returned http ${probe.status}` };

    await ctx.runMutation(internal.granolaDb.setApiKey, {
      teamId,
      key: trimmed,
      actor: email,
    });

    await ctx.scheduler.runAfter(0, internal.granola.pollNewMeetings, {
      teamId,
    });

    return { ok: true };
  },
});

export const clearApiKey = action({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }): Promise<{ ok: true }> => {
    const { email } = await requireAuthAction(ctx);
    await ctx.runQuery(internal.granolaDb.ensureTeamAdmin, { teamId });
    await ctx.runMutation(internal.granolaDb.clearApiKey, {
      teamId,
      actor: email,
    });
    return { ok: true };
  },
});

// ── Response shape helpers (defensive) ──────────────────────────

function extractPage(body: unknown): {
  notes: unknown[];
  nextCursor: string | null;
} {
  if (!body || typeof body !== "object") {
    return { notes: [], nextCursor: null };
  }
  const b = body as Record<string, unknown>;
  const notes =
    (Array.isArray(b.items) && b.items) ||
    (Array.isArray(b.notes) && b.notes) ||
    (Array.isArray(b.data) && b.data) ||
    (Array.isArray(b.results) && b.results) ||
    [];
  const nextCursor =
    (typeof b.nextCursor === "string" && b.nextCursor) ||
    (typeof b.next_cursor === "string" && b.next_cursor) ||
    (typeof b.cursor === "string" && b.cursor) ||
    null;
  return { notes: notes as unknown[], nextCursor };
}

function readNoteId(note: unknown): string | null {
  if (!note || typeof note !== "object") return null;
  const n = note as Record<string, unknown>;
  if (typeof n.id === "string") return n.id;
  if (typeof n.note_id === "string") return n.note_id;
  if (typeof n.meeting_id === "string") return n.meeting_id;
  return null;
}
