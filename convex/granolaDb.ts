import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { requireTeamAdmin, requireTeamMember } from "./auth";

// Per-team Granola integration. One row in `integrations` keyed by
// (teamId, "granola"). config.apiKey holds the personal API key,
// integration.cursor holds the API pagination token, and
// integration.lastPoll* fields hold poll telemetry.

const KIND = "granola" as const;

// ── Internal helpers ────────────────────────────────────────────

export const getInternal = internalQuery({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) =>
    ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first(),
});

export const getApiKey = internalQuery({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
    return typeof row?.config?.apiKey === "string" && row.config.apiKey.length
      ? (row.config.apiKey as string)
      : null;
  },
});

export const setApiKey = internalMutation({
  args: { teamId: v.id("teams"), key: v.string(), actor: v.string() },
  handler: async (ctx, { teamId, key, actor }) => {
    const at = Date.now();
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
    const config = { apiKey: key };
    if (existing) {
      await ctx.db.patch(existing._id, {
        config,
        // New key → reset cursor (might point at a different account).
        cursor: undefined,
        enabled: true,
        updatedAt: at,
        updatedBy: actor,
      });
    } else {
      await ctx.db.insert("integrations", {
        teamId,
        kind: KIND,
        enabled: true,
        config,
        createdAt: at,
        createdBy: actor,
        updatedAt: at,
        updatedBy: actor,
      });
    }
    await ctx.db.insert("auditLog", {
      itemId: null,
      event: "granola.apiKey.set",
      payload: { actor },
      actor,
      at,
      teamId,
    });
  },
});

export const clearApiKey = internalMutation({
  args: { teamId: v.id("teams"), actor: v.string() },
  handler: async (ctx, { teamId, actor }) => {
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("auditLog", {
      itemId: null,
      event: "granola.apiKey.cleared",
      payload: { actor },
      actor,
      at: Date.now(),
      teamId,
    });
  },
});

export const getCursor = internalQuery({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
    return typeof row?.cursor === "string" ? (row.cursor as string) : null;
  },
});

export const findExisting = internalQuery({
  args: { teamId: v.id("teams"), sourceRef: v.string() },
  handler: async (ctx, { teamId, sourceRef }) => {
    const hit = await ctx.db
      .query("ingestEvents")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", "granola").eq("sourceRef", sourceRef),
      )
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .first();
    return hit ? hit._id : null;
  },
});

export const recordPoll = internalMutation({
  args: {
    teamId: v.id("teams"),
    ok: v.boolean(),
    ingested: v.number(),
    error: v.optional(v.string()),
    nextCursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { teamId, ok, ingested, error, nextCursor }) => {
    const at = Date.now();
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
    if (!row) return;
    const patch: any = {
      lastPollAt: at,
      lastPollOk: ok,
      lastPollIngested: ingested,
      lastPollError: error ?? undefined,
    };
    if (ok && typeof nextCursor !== "undefined") {
      patch.cursor = nextCursor ?? undefined;
    }
    await ctx.db.patch(row._id, patch);

    await ctx.db.insert("auditLog", {
      itemId: null,
      event: ok ? "granola.poll.ok" : "granola.poll.error",
      payload: { ingested, error: error ?? null },
      actor: "cron:granola",
      at,
      teamId,
    });
  },
});

// All teams that have a Granola integration. Used by the cron fan-out.
export const teamsToPoll = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("integrations")
      .withIndex("by_kind_enabled", (q) =>
        q.eq("kind", KIND).eq("enabled", true),
      )
      .collect();
    return rows.map((r) => r.teamId);
  },
});

// ── Admin-facing ────────────────────────────────────────────────

export const status = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    await requireTeamMember(ctx, teamId);
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
    const apiKeyConfigured =
      !!(typeof row?.config?.apiKey === "string" && row.config.apiKey.length > 0);

    const since = Date.now() - 24 * 60 * 60 * 1000;
    const itemsToday = await ctx.db
      .query("items")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .filter((q) =>
        q.and(
          q.eq(q.field("sourceType"), "granola"),
          q.gt(q.field("createdAt"), since),
        ),
      )
      .collect();

    const last =
      row && typeof row.lastPollAt === "number"
        ? {
            ok: !!row.lastPollOk,
            ingested: row.lastPollIngested ?? 0,
            error: row.lastPollError ?? null,
            at: row.lastPollAt,
          }
        : null;

    return { last, itemsToday: itemsToday.length, apiKeyConfigured };
  },
});

export const ensureTeamAdmin = internalQuery({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    await requireTeamAdmin(ctx, teamId);
    return true;
  },
});
