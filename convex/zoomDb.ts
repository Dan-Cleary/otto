import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { requireTeamAdmin, requireTeamMember } from "./auth";

const KIND = "zoom" as const;

// ── Queries ─────────────────────────────────────────────────────

export const getInternal = internalQuery({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    return ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
  },
});

// All teams that have an enabled Zoom integration. Used by the cron
// fan-out.
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

// Admin-facing: status for the current team. Never returns the raw
// secret values.
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
    if (!row) {
      return {
        configured: false,
        enabled: false,
        authType: null as "oauth" | "s2s" | null,
        accountId: null as string | null,
        accountEmail: null as string | null,
        accountName: null as string | null,
        last: null as
          | {
              ok: boolean;
              ingested: number;
              error: string | null;
              at: number;
            }
          | null,
        itemsToday: 0,
      };
    }
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const itemsToday = await ctx.db
      .query("items")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .filter((q) =>
        q.and(
          q.eq(q.field("sourceType"), "zoom"),
          q.gt(q.field("createdAt"), since),
        ),
      )
      .collect();

    const authType: "oauth" | "s2s" =
      row.config?.authType === "oauth" ? "oauth" : "s2s";

    return {
      configured: true,
      enabled: row.enabled,
      authType,
      accountId:
        typeof row.config?.accountId === "string"
          ? row.config.accountId
          : null,
      accountEmail:
        typeof row.config?.accountEmail === "string"
          ? row.config.accountEmail
          : null,
      accountName:
        typeof row.config?.accountName === "string"
          ? row.config.accountName
          : null,
      last:
        typeof row.lastPollAt === "number"
          ? {
              ok: !!row.lastPollOk,
              ingested: row.lastPollIngested ?? 0,
              error: row.lastPollError ?? null,
              at: row.lastPollAt,
            }
          : null,
      itemsToday: itemsToday.length,
    };
  },
});

// Find every team whose Zoom integration matches this Zoom account_id.
// Used by the webhook handler to route inbound recording events back
// to the right team(s). Returns multiple teams if more than one team
// connected the same Zoom account.
export const findTeamsByAccountId = internalQuery({
  args: { accountId: v.string() },
  handler: async (ctx, { accountId }) => {
    const rows = await ctx.db
      .query("integrations")
      .withIndex("by_kind_enabled", (q) =>
        q.eq("kind", KIND).eq("enabled", true),
      )
      .collect();
    return rows
      .filter((r) => r.config?.accountId === accountId)
      .map((r) => r.teamId);
  },
});

export const ensureTeamAdmin = internalQuery({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    await requireTeamAdmin(ctx, teamId);
    return true;
  },
});

// ── Mutations ───────────────────────────────────────────────────

export const upsertOAuthTokens = internalMutation({
  args: {
    teamId: v.id("teams"),
    tokens: v.object({
      accessToken: v.string(),
      refreshToken: v.string(),
      expiresAt: v.number(),
      scope: v.string(),
    }),
    accountEmail: v.union(v.string(), v.null()),
    accountName: v.union(v.string(), v.null()),
    accountId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (
    ctx,
    { teamId, tokens, accountEmail, accountName, accountId },
  ) => {
    const at = Date.now();
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
    const config = {
      authType: "oauth" as const,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
      accountEmail: accountEmail ?? null,
      accountName: accountName ?? null,
      accountId: accountId ?? existing?.config?.accountId ?? null,
    };
    if (existing) {
      await ctx.db.patch(existing._id, {
        config,
        cachedToken: undefined,
        // Don't reset cursor on a refresh — only on a fresh connect.
        cursor: existing.config?.authType === "oauth" ? existing.cursor : undefined,
        enabled: true,
        updatedAt: at,
        updatedBy: accountEmail ?? "oauth",
      });
    } else {
      await ctx.db.insert("integrations", {
        teamId,
        kind: KIND,
        enabled: true,
        config,
        createdAt: at,
        createdBy: accountEmail ?? "oauth",
        updatedAt: at,
        updatedBy: accountEmail ?? "oauth",
      });
    }
    await ctx.db.insert("auditLog", {
      itemId: null,
      event: "zoom.oauth.connected",
      payload: { accountEmail },
      actor: accountEmail ?? "oauth",
      at,
      teamId,
    });
  },
});

export const upsertCreds = internalMutation({
  args: {
    teamId: v.id("teams"),
    actor: v.string(),
    accountId: v.string(),
    clientId: v.string(),
    clientSecret: v.string(),
  },
  handler: async (
    ctx,
    { teamId, actor, accountId, clientId, clientSecret },
  ) => {
    const at = Date.now();
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
    const config = { accountId, clientId, clientSecret };
    if (existing) {
      await ctx.db.patch(existing._id, {
        config,
        cachedToken: undefined,
        cursor: undefined, // reset on creds change
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
      event: "zoom.creds.set",
      payload: { actor },
      actor,
      at,
      teamId,
    });
  },
});

export const remove = internalMutation({
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
      event: "zoom.creds.cleared",
      payload: { actor },
      actor,
      at: Date.now(),
      teamId,
    });
  },
});

export const setCachedToken = internalMutation({
  args: {
    teamId: v.id("teams"),
    token: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, { teamId, token, expiresAt }) => {
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
    if (!row) return;
    await ctx.db.patch(row._id, {
      cachedToken: { value: token, expiresAt },
    });
  },
});

export const recordPoll = internalMutation({
  args: {
    teamId: v.id("teams"),
    ok: v.boolean(),
    ingested: v.number(),
    error: v.optional(v.string()),
    nextCursor: v.optional(v.any()),
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
      patch.cursor = nextCursor;
    }
    await ctx.db.patch(row._id, patch);

    await ctx.db.insert("auditLog", {
      itemId: null,
      event: ok ? "zoom.poll.ok" : "zoom.poll.error",
      payload: { ingested, error: error ?? null },
      actor: "cron:zoom",
      at,
      teamId,
    });
  },
});
