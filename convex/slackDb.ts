import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const getReviewContext = internalQuery({
  args: { itemId: v.id("items") },
  handler: async (ctx, { itemId }) => {
    const item = await ctx.db.get(itemId);
    if (!item) return null;
    const suggestions: { repoId: string; name: string; score: number }[] = [];
    for (const s of item.routerSuggestions ?? []) {
      const repo = await ctx.db.get(s.repoId);
      if (repo) {
        suggestions.push({ repoId: s.repoId, name: repo.name, score: s.score });
      }
    }
    return { item, suggestions };
  },
});

export const recordReviewMessage = internalMutation({
  args: {
    itemId: v.id("items"),
    channel: v.string(),
    ts: v.string(),
  },
  handler: async (ctx, { itemId, channel, ts }) => {
    const item = await ctx.db.get(itemId);
    await ctx.db.patch(itemId, { slackTs: ts, slackChannel: channel });
    await ctx.db.insert("auditLog", {
      itemId,
      event: "slack.review_posted",
      payload: { channel, ts },
      actor: "system",
      at: Date.now(),
      teamId: item?.teamId,
    });
  },
});

export const findItemBySlackTs = internalQuery({
  args: { channel: v.string(), ts: v.string() },
  handler: async (ctx, { channel, ts }) =>
    ctx.db
      .query("items")
      .withIndex("by_slack", (q) =>
        q.eq("slackChannel", channel).eq("slackTs", ts),
      )
      .first(),
});
