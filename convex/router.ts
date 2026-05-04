"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import OpenAI from "openai";

const TOP_K = 5;

export const route = internalAction({
  args: { itemId: v.id("items") },
  handler: async (ctx, { itemId }) => {
    const item = await ctx.runQuery(internal.routerDb.getItem, { itemId });
    if (!item) return;

    const text = `${item.description}\n\nContext: ${item.quotedContext}`;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const embed = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    const queryVec = embed.data[0]!.embedding;

    const repoMatches = await ctx.vectorSearch("repos", "by_embedding", {
      vector: queryVec,
      limit: TOP_K,
      filter: (q) => q.eq("enabled", true),
    });

    const memoryMatches = await ctx.vectorSearch(
      "routingMemory",
      "by_embedding",
      { vector: queryVec, limit: 3 },
    );

    await ctx.runMutation(internal.routerDb.applyRoute, {
      itemId,
      repoMatches: repoMatches.map((r) => ({ repoId: r._id, score: r._score })),
      memoryMatches: memoryMatches.map((m) => ({
        memoryId: m._id,
        score: m._score,
      })),
    });
  },
});

export const gate = internalAction({
  args: { itemId: v.id("items") },
  handler: async (ctx, { itemId }) => {
    await ctx.runMutation(internal.routerDb.runGate, { itemId });
  },
});
