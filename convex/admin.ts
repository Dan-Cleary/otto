import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireAuth, requireTeamMember } from "./auth";

export const recentAuditLog = query({
  args: { teamId: v.id("teams"), limit: v.optional(v.number()) },
  handler: async (ctx, { teamId, limit }) => {
    await requireTeamMember(ctx, teamId);
    return ctx.db
      .query("auditLog")
      .withIndex("by_team_at", (q) => q.eq("teamId", teamId))
      .order("desc")
      .take(limit ?? 100);
  },
});

export const recentItems = query({
  args: { teamId: v.id("teams"), limit: v.optional(v.number()) },
  handler: async (ctx, { teamId, limit }) => {
    await requireTeamMember(ctx, teamId);
    return ctx.db
      .query("items")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .order("desc")
      .take(limit ?? 50);
  },
});

export const itemsByStatus = query({
  args: {
    teamId: v.id("teams"),
    status: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { teamId, status, limit }) => {
    await requireTeamMember(ctx, teamId);
    return ctx.db
      .query("items")
      .withIndex("by_team_status", (q) =>
        q.eq("teamId", teamId).eq("status", status as any),
      )
      .order("desc")
      .take(limit ?? 50);
  },
});

export const listMemory = query({
  args: { teamId: v.id("teams"), limit: v.optional(v.number()) },
  handler: async (ctx, { teamId, limit }) => {
    await requireTeamMember(ctx, teamId);
    const rows = await ctx.db
      .query("routingMemory")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .order("desc")
      .take(limit ?? 100);
    const repos = await ctx.db
      .query("repos")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .collect();
    const repoById = new Map(repos.map((r) => [r._id, r]));
    return rows.map((m) => ({
      ...m,
      correctedRepoName:
        repoById.get(m.correctedRepoId)?.name ?? "(deleted repo)",
    }));
  },
});

export const getThreshold = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    await requireTeamMember(ctx, teamId);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_team_key", (q) =>
        q.eq("teamId", teamId).eq("key", "confidenceThreshold"),
      )
      .first();
    return typeof row?.value === "number" ? row.value : 0.6;
  },
});

// Lightweight check that the current session is authorized. Returns
// null if not signed in; the email otherwise. Does NOT scope to a
// team — used by the admin app as a simple "are we logged in" gate.
export const me = query({
  args: {},
  handler: async (ctx) => {
    try {
      const { email } = await requireAuth(ctx);
      return { email };
    } catch {
      return null;
    }
  },
});
