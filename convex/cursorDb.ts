import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const getFireContext = internalQuery({
  args: { itemId: v.id("items") },
  handler: async (ctx, { itemId }) => {
    const item = await ctx.db.get(itemId);
    if (!item) return null;
    const repo = item.repoId ? await ctx.db.get(item.repoId) : null;
    return { item, repo };
  },
});

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
