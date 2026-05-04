"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import OpenAI from "openai";

export const indexOne = internalAction({
  args: { repoId: v.id("repos") },
  handler: async (ctx, { repoId }) => {
    const repo = await ctx.runQuery(internal.reposDb.getRepo, { repoId });
    if (!repo) throw new Error(`repo ${repoId} not found`);

    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN not set");

    const [readme, commits, tree] = await Promise.all([
      fetchReadme(repo.githubFullName, token),
      fetchRecentCommits(repo.githubFullName, token),
      fetchTopLevelPaths(repo.githubFullName, token),
    ]);

    const blob = [
      `Repo: ${repo.githubFullName}`,
      repo.description ? `Description: ${repo.description}` : "",
      readme ? `README excerpt:\n${readme.slice(0, 4000)}` : "",
      commits.length ? `Recent commits:\n${commits.join("\n")}` : "",
      tree.length ? `Top-level paths:\n${tree.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const embed = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: blob,
    });

    await ctx.runMutation(internal.reposDb.persistIndex, {
      repoId,
      metadataBlob: blob,
      embedding: embed.data[0]!.embedding,
    });
  },
});

export const reindexAll = internalAction({
  args: {},
  handler: async (ctx) => {
    // Fan out to per-team reindex via the cross-team admin query.
    const ids: string[] = await ctx.runQuery(
      internal.reposDb.listAllEnabledIds,
      {},
    );
    for (const repoId of ids) {
      await ctx.scheduler.runAfter(0, internal.repos.indexOne, {
        repoId: repoId as any,
      });
    }
  },
});

async function ghFetch(path: string, token: string): Promise<any> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "otto",
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchReadme(full: string, token: string): Promise<string> {
  const data = await ghFetch(`/repos/${full}/readme`, token);
  if (!data?.content) return "";
  return Buffer.from(data.content, "base64").toString("utf8");
}

async function fetchRecentCommits(
  full: string,
  token: string,
): Promise<string[]> {
  const data = await ghFetch(`/repos/${full}/commits?per_page=20`, token);
  if (!Array.isArray(data)) return [];
  return data
    .map((c) => c?.commit?.message?.split("\n")[0])
    .filter((m): m is string => !!m);
}

async function fetchTopLevelPaths(
  full: string,
  token: string,
): Promise<string[]> {
  const repo = await ghFetch(`/repos/${full}`, token);
  const branch = repo?.default_branch ?? "main";
  const tree = await ghFetch(`/repos/${full}/git/trees/${branch}`, token);
  if (!Array.isArray(tree?.tree)) return [];
  return tree.tree
    .filter((n: any) => n?.type === "tree" || n?.type === "blob")
    .map((n: any) => n.path)
    .filter((p: any): p is string => typeof p === "string")
    .slice(0, 60);
}
