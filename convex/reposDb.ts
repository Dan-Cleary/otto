import {
  internalQuery,
  internalMutation,
  query,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireTeamMember, requireTeamAdmin } from "./auth";

export const getRepo = internalQuery({
  args: { repoId: v.id("repos") },
  handler: (ctx, { repoId }) => ctx.db.get(repoId),
});

// Per-team enabled repo ids — used by the router action.
export const listEnabledIdsForTeam = internalQuery({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    const rows = await ctx.db
      .query("repos")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .filter((q) => q.eq(q.field("enabled"), true))
      .collect();
    return rows.map((r) => r._id);
  },
});

// Used by the daily reindex cron — needs to fan out across every team.
export const listAllEnabledIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("repos")
      .filter((q) => q.eq(q.field("enabled"), true))
      .collect();
    return rows.map((r) => r._id);
  },
});

export const persistIndex = internalMutation({
  args: {
    repoId: v.id("repos"),
    metadataBlob: v.string(),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, { repoId, metadataBlob, embedding }) => {
    const repo = await ctx.db.get(repoId);
    if (!repo) return;
    await ctx.db.patch(repoId, {
      metadataBlob,
      embedding,
      lastIndexedAt: Date.now(),
    });
    await ctx.db.insert("auditLog", {
      itemId: null,
      event: "repo.indexed",
      payload: { repoId },
      actor: "system",
      at: Date.now(),
      teamId: repo.teamId,
    });
  },
});

// ── Public CRUD ─────────────────────────────────────────────────

export const list = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    await requireTeamMember(ctx, teamId);
    return ctx.db
      .query("repos")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .order("desc")
      .take(200);
  },
});

export const upsert = mutation({
  args: {
    teamId: v.id("teams"),
    repoId: v.optional(v.id("repos")),
    name: v.string(),
    githubFullName: v.string(),
    githubUrl: v.string(),
    description: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireTeamAdmin(ctx, args.teamId);
    const { teamId, repoId, ...fields } = args;
    if (repoId) {
      const existing = await ctx.db.get(repoId);
      if (!existing || existing.teamId !== teamId)
        throw new Error("repo not in this team");
      await ctx.db.patch(repoId, fields);
      return repoId;
    }
    const id = await ctx.db.insert("repos", {
      ...fields,
      metadataBlob: "",
      teamId,
    });
    await ctx.scheduler.runAfter(0, internal.repos.indexOne, { repoId: id });
    return id;
  },
});

export const reindex = mutation({
  args: { teamId: v.id("teams"), repoId: v.id("repos") },
  handler: async (ctx, { teamId, repoId }) => {
    await requireTeamMember(ctx, teamId);
    const existing = await ctx.db.get(repoId);
    if (!existing || existing.teamId !== teamId)
      throw new Error("repo not in this team");
    await ctx.scheduler.runAfter(0, internal.repos.indexOne, { repoId });
  },
});

export const remove = mutation({
  args: { teamId: v.id("teams"), repoId: v.id("repos") },
  handler: async (ctx, { teamId, repoId }) => {
    await requireTeamAdmin(ctx, teamId);
    const existing = await ctx.db.get(repoId);
    if (!existing || existing.teamId !== teamId)
      throw new Error("repo not in this team");
    await ctx.db.delete(repoId);
  },
});
