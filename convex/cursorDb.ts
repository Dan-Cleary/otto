import { internalQuery, internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireTeamAdmin, requireTeamMember } from "./auth";

const KIND = "cursor" as const;

export const getFireContext = internalQuery({
  args: { itemId: v.id("items") },
  handler: async (ctx, { itemId }) => {
    const item = await ctx.db.get(itemId);
    if (!item) return null;
    const repo = item.repoId ? await ctx.db.get(item.repoId) : null;
    let cursorApiKey: string | null = null;
    if (item.teamId) {
      const integ = await ctx.db
        .query("integrations")
        .withIndex("by_team_kind", (q) =>
          q.eq("teamId", item.teamId!).eq("kind", KIND),
        )
        .first();
      if (integ?.enabled && typeof integ.config?.apiKey === "string") {
        cursorApiKey = integ.config.apiKey;
      }
    }
    return { item, repo, cursorApiKey };
  },
});

// ── Public API for the per-team Cursor API key ──────────────────

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
    return {
      configured: !!row,
      enabled: row?.enabled ?? false,
      keyHint:
        typeof row?.config?.apiKey === "string"
          ? maskKey(row.config.apiKey)
          : null,
    };
  },
});

export const saveKey = mutation({
  args: { teamId: v.id("teams"), apiKey: v.string() },
  handler: async (ctx, { teamId, apiKey }) => {
    const { email } = await requireTeamAdmin(ctx, teamId);
    const trimmed = apiKey.trim();
    if (!trimmed) throw new Error("api key cannot be empty");
    const at = Date.now();
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
    const config = { apiKey: trimmed };
    if (existing) {
      await ctx.db.patch(existing._id, {
        config,
        enabled: true,
        updatedAt: at,
        updatedBy: email,
      });
    } else {
      await ctx.db.insert("integrations", {
        teamId,
        kind: KIND,
        enabled: true,
        config,
        createdAt: at,
        createdBy: email,
        updatedAt: at,
        updatedBy: email,
      });
    }
    await ctx.db.insert("auditLog", {
      itemId: null,
      event: "cursor.key.set",
      payload: { actor: email },
      actor: email,
      at,
      teamId,
    });
    return { ok: true };
  },
});

export const clearKey = mutation({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    const { email } = await requireTeamAdmin(ctx, teamId);
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("auditLog", {
      itemId: null,
      event: "cursor.key.cleared",
      payload: { actor: email },
      actor: email,
      at: Date.now(),
      teamId,
    });
    return { ok: true };
  },
});

function maskKey(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export const markFired = internalMutation({
  args: {
    itemId: v.id("items"),
    cursorRunId: v.string(),
    cursorAgentId: v.string(),
  },
  handler: async (ctx, { itemId, cursorRunId, cursorAgentId }) => {
    const item = await ctx.db.get(itemId);
    await ctx.db.patch(itemId, {
      status: "fired",
      cursorRunId,
      cursorAgentId,
    });
    await ctx.db.insert("auditLog", {
      itemId,
      event: "cursor.fired",
      payload: { cursorRunId, cursorAgentId },
      actor: "system",
      at: Date.now(),
      teamId: item?.teamId,
    });
  },
});

export const markPrOpened = internalMutation({
  args: { itemId: v.id("items"), prUrl: v.string() },
  handler: async (ctx, { itemId, prUrl }) => {
    const item = await ctx.db.get(itemId);
    await ctx.db.patch(itemId, { status: "pr_opened", prUrl });
    await ctx.db.insert("auditLog", {
      itemId,
      event: "cursor.pr_opened",
      payload: { prUrl },
      actor: "system",
      at: Date.now(),
      teamId: item?.teamId,
    });
  },
});

export const markFailed = internalMutation({
  args: { itemId: v.id("items"), reason: v.string() },
  handler: async (ctx, { itemId, reason }) => {
    const item = await ctx.db.get(itemId);
    await ctx.db.patch(itemId, { status: "failed", failureReason: reason });
    await ctx.db.insert("auditLog", {
      itemId,
      event: "cursor.failed",
      payload: { reason },
      actor: "system",
      at: Date.now(),
      teamId: item?.teamId,
    });
  },
});
