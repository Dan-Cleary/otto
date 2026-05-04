import { internalQuery, internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireTeamAdmin } from "./auth";

const DEFAULT_THRESHOLD = 0.6;

export const getItem = internalQuery({
  args: { itemId: v.id("items") },
  handler: (ctx, { itemId }) => ctx.db.get(itemId),
});

export const getRepo = internalQuery({
  args: { repoId: v.id("repos") },
  handler: (ctx, { repoId }) => ctx.db.get(repoId),
});

export const applyRoute = internalMutation({
  args: {
    itemId: v.id("items"),
    repoMatches: v.array(
      v.object({ repoId: v.id("repos"), score: v.number() }),
    ),
    memoryMatches: v.array(
      v.object({ memoryId: v.id("routingMemory"), score: v.number() }),
    ),
  },
  handler: async (ctx, { itemId, repoMatches, memoryMatches }) => {
    const scores = new Map<string, number>();
    for (const m of repoMatches) scores.set(m.repoId, m.score);

    // Blend in routing memory: each memory hit boosts its corrected repo.
    for (const mm of memoryMatches) {
      const mem = await ctx.db.get(mm.memoryId);
      if (!mem) continue;
      const prev = scores.get(mem.correctedRepoId) ?? 0;
      const boost = mm.score * 0.3;
      scores.set(mem.correctedRepoId, prev + boost);
    }

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked[0];
    const suggestions = ranked.slice(0, 3).map(([repoId, score]) => ({
      repoId: repoId as any,
      score,
    }));

    await ctx.db.patch(itemId, {
      repoId: (top?.[0] as any) ?? null,
      routerConfidence: top?.[1] ?? 0,
      routerSuggestions: suggestions,
    });

    await ctx.scheduler.runAfter(0, internal.router.gate, { itemId });
  },
});

export const runGate = internalMutation({
  args: { itemId: v.id("items") },
  handler: async (ctx, { itemId }) => {
    const item = await ctx.db.get(itemId);
    if (!item) return;

    const threshold = await readThreshold(ctx, item.teamId);
    const combined = item.parserConfidence * (item.routerConfidence ?? 0);
    const hasRepo = !!item.repoId;

    await ctx.db.insert("auditLog", {
      itemId,
      event: "router.decided",
      payload: {
        parserConfidence: item.parserConfidence,
        routerConfidence: item.routerConfidence,
        combined,
        threshold,
        hasRepo,
      },
      actor: "system",
      at: Date.now(),
      teamId: item.teamId,
    });

    if (hasRepo && combined >= threshold) {
      await ctx.db.patch(itemId, { status: "fired" });
      await ctx.scheduler.runAfter(0, internal.cursor.fire, { itemId });
    } else {
      await ctx.db.patch(itemId, { status: "queued" });
      await ctx.scheduler.runAfter(0, internal.slack.postReview, { itemId });
    }
  },
});

async function readThreshold(
  ctx: any,
  teamId: any | undefined,
): Promise<number> {
  if (!teamId) return DEFAULT_THRESHOLD;
  const row = await ctx.db
    .query("settings")
    .withIndex("by_team_key", (q: any) =>
      q.eq("teamId", teamId).eq("key", "confidenceThreshold"),
    )
    .first();
  return typeof row?.value === "number" ? row.value : DEFAULT_THRESHOLD;
}

// Called from Slack approve / reject / re-route handlers.
export const approve = internalMutation({
  args: { itemId: v.id("items"), actor: v.string() },
  handler: async (ctx, { itemId, actor }) => {
    const item = await ctx.db.get(itemId);
    if (!item || !item.repoId) return;
    await ctx.db.patch(itemId, { status: "fired" });
    await ctx.db.insert("auditLog", {
      itemId,
      event: "review.approved",
      payload: {},
      actor,
      at: Date.now(),
      teamId: item.teamId,
    });
    await ctx.scheduler.runAfter(0, internal.cursor.fire, { itemId });
  },
});

export const reject = internalMutation({
  args: { itemId: v.id("items"), actor: v.string() },
  handler: async (ctx, { itemId, actor }) => {
    const item = await ctx.db.get(itemId);
    if (!item) return;
    await ctx.db.patch(itemId, { status: "rejected" });
    await ctx.db.insert("auditLog", {
      itemId,
      event: "review.rejected",
      payload: {},
      actor,
      at: Date.now(),
      teamId: item.teamId,
    });
  },
});

export const reroute = internalMutation({
  args: {
    itemId: v.id("items"),
    repoId: v.id("repos"),
    actor: v.string(),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, { itemId, repoId, actor, embedding }) => {
    const item = await ctx.db.get(itemId);
    if (!item) return;

    await ctx.db.insert("routingMemory", {
      description: item.description,
      quotedContext: item.quotedContext,
      embedding,
      correctedRepoId: repoId,
      correctedAt: Date.now(),
      correctedBy: actor,
      sourceItemId: itemId,
      teamId: item.teamId,
    });

    await ctx.db.patch(itemId, {
      repoId,
      routerConfidence: 1,
      status: "fired",
    });

    await ctx.db.insert("auditLog", {
      itemId,
      event: "review.rerouted",
      payload: { repoId },
      actor,
      at: Date.now(),
      teamId: item.teamId,
    });

    await ctx.scheduler.runAfter(0, internal.cursor.fire, { itemId });
  },
});

// Public helper for admin app: read/write threshold (per team).
export const setThreshold = mutation({
  args: { teamId: v.id("teams"), value: v.number() },
  handler: async (ctx, { teamId, value }) => {
    const me = await requireTeamAdmin(ctx, teamId);
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_team_key", (q) =>
        q.eq("teamId", teamId).eq("key", "confidenceThreshold"),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        value,
        updatedAt: Date.now(),
        updatedBy: me.email,
      });
    } else {
      await ctx.db.insert("settings", {
        key: "confidenceThreshold",
        value,
        updatedAt: Date.now(),
        updatedBy: me.email,
        teamId,
      });
    }
  },
});
