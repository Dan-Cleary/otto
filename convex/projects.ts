import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { requireTeamAdmin, requireTeamMember } from "./auth";

// Projects own URL patterns + a primary repo. They're how Otto routes
// widget feedback (URL → project → repo) and meeting extractions
// (semantic match on description → project → repo) without ever
// asking the user to pick a repo.

export const list = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    await requireTeamMember(ctx, teamId);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .order("desc")
      .collect();
    const repos = await ctx.db
      .query("repos")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .collect();
    const reposById = new Map(repos.map((r) => [r._id, r]));
    return projects.map((p) => ({
      ...p,
      primaryRepoName: p.primaryRepoId
        ? reposById.get(p.primaryRepoId)?.githubFullName ?? "(deleted)"
        : null,
      repoCount: repos.filter((r) => r.projectId === p._id).length,
    }));
  },
});

export const get = query({
  args: { teamId: v.id("teams"), id: v.id("projects") },
  handler: async (ctx, { teamId, id }) => {
    await requireTeamMember(ctx, teamId);
    const p = await ctx.db.get(id);
    if (!p || p.teamId !== teamId) return null;
    return p;
  },
});

export const upsert = mutation({
  args: {
    teamId: v.id("teams"),
    id: v.optional(v.id("projects")),
    name: v.string(),
    slug: v.string(),
    primaryRepoId: v.union(v.id("repos"), v.null()),
    autoFireThreshold: v.optional(v.number()),
    enabled: v.boolean(),
  },
  handler: async (
    ctx,
    { teamId, id, name, slug, primaryRepoId, autoFireThreshold, enabled },
  ) => {
    const { email } = await requireTeamAdmin(ctx, teamId);
    const cleanedSlug = slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-");

    if (id) {
      const existing = await ctx.db.get(id);
      if (!existing || existing.teamId !== teamId)
        throw new Error("project not in this team");
      await ctx.db.patch(id, {
        name,
        slug: cleanedSlug,
        primaryRepoId,
        autoFireThreshold,
        enabled,
      });
      return id;
    }

    // Slugs are unique within a team only.
    const dup = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", cleanedSlug))
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .first();
    if (dup)
      throw new Error(`a project with slug "${cleanedSlug}" already exists`);

    return ctx.db.insert("projects", {
      name,
      slug: cleanedSlug,
      primaryRepoId,
      autoFireThreshold,
      enabled,
      createdAt: Date.now(),
      createdBy: email,
      teamId,
    });
  },
});

export const remove = mutation({
  args: { teamId: v.id("teams"), id: v.id("projects") },
  handler: async (ctx, { teamId, id }) => {
    await requireTeamAdmin(ctx, teamId);
    const existing = await ctx.db.get(id);
    if (!existing || existing.teamId !== teamId)
      throw new Error("project not in this team");
    const repos = await ctx.db
      .query("repos")
      .withIndex("by_project", (q) => q.eq("projectId", id))
      .collect();
    for (const r of repos) {
      await ctx.db.patch(r._id, { projectId: null });
    }
    await ctx.db.delete(id);
  },
});

// Allow assigning a repo to a project from the Repos tab.
export const setRepoProject = mutation({
  args: {
    teamId: v.id("teams"),
    repoId: v.id("repos"),
    projectId: v.union(v.id("projects"), v.null()),
  },
  handler: async (ctx, { teamId, repoId, projectId }) => {
    await requireTeamAdmin(ctx, teamId);
    const repo = await ctx.db.get(repoId);
    if (!repo || repo.teamId !== teamId)
      throw new Error("repo not in this team");
    if (projectId) {
      const proj = await ctx.db.get(projectId);
      if (!proj || proj.teamId !== teamId)
        throw new Error("project not in this team");
    }
    await ctx.db.patch(repoId, { projectId });
  },
});

// Internal mutation used by parserDb to attach a project to an item
// (legacy: used by Granola path; widget path always resolves at ingest
// via the snippet's data-project attribute).
export const attachProject = internalMutation({
  args: {
    itemId: v.id("items"),
    projectId: v.union(v.id("projects"), v.null()),
  },
  handler: async (ctx, { itemId, projectId }) => {
    await ctx.db.patch(itemId, { projectId });
  },
});
