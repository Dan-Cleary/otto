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

    // Tenant scoping: vector search must be filtered to the item's
    // team so we never surface another team's repo as a match. Convex
    // vector filters only support a single q.eq per call; we filter by
    // teamId at the index level (when present) and then drop disabled
    // rows on the result side. Items without teamId (legacy) fall back
    // to enabled-only search, which is fine since legacy rows were
    // single-tenant.
    const teamId = item.teamId ?? null;
    const rawRepoMatches = await ctx.vectorSearch("repos", "by_embedding", {
      vector: queryVec,
      limit: TOP_K * 4,
      filter: teamId
        ? (q) => q.eq("teamId", teamId)
        : (q) => q.eq("enabled", true),
    });
    const repoMatches: { _id: any; _score: number }[] = [];
    for (const m of rawRepoMatches) {
      if (repoMatches.length >= TOP_K) break;
      const repo = await ctx.runQuery(internal.routerDb.getRepo, {
        repoId: m._id,
      });
      if (repo?.enabled) repoMatches.push(m);
    }

    const memoryMatches = await ctx.vectorSearch(
      "routingMemory",
      "by_embedding",
      {
        vector: queryVec,
        limit: 3,
        filter: teamId ? (q) => q.eq("teamId", teamId) : undefined,
      },
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
