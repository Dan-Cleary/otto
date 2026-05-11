import { internalMutation } from "./_generated/server";

// One-shot seed for the public marketing landing's dogfood widget.
// Idempotent — running it again returns the same project + secret.
// The project sits on whatever team is first in the table, which on
// the prod deployment is Dan's personal team (the only one).
//
// Items from the landing widget have no primary repo, so they stop at
// "queued" in the router. No PRs are opened automatically from
// public visitor feedback.
//
// Invoke from the host:
//   npx convex run --prod internal.seed.ensureLandingProject
export const ensureLandingProject = internalMutation({
  args: {},
  handler: async (ctx) => {
    const team = (await ctx.db.query("teams").collect())[0];
    if (!team) {
      throw new Error("no teams on this deployment; sign in first");
    }

    const existing = await ctx.db
      .query("projects")
      .withIndex("by_team", (q) => q.eq("teamId", team._id))
      .filter((q) => q.eq(q.field("slug"), "otto-landing"))
      .first();

    if (existing) {
      // Backfill a secret if a stale row exists without one.
      let secret = existing.widgetSecret;
      if (!secret) {
        secret = `wk_${crypto.randomUUID().replace(/-/g, "")}`;
        await ctx.db.patch(existing._id, { widgetSecret: secret });
      }
      return {
        teamId: team._id,
        projectId: existing._id,
        secret,
        created: false,
      };
    }

    const secret = `wk_${crypto.randomUUID().replace(/-/g, "")}`;
    const projectId = await ctx.db.insert("projects", {
      name: "Otto Landing",
      slug: "otto-landing",
      widgetSecret: secret,
      primaryRepoId: null,
      enabled: true,
      createdAt: Date.now(),
      createdBy: "system:landing-seed",
      teamId: team._id,
    });

    return { teamId: team._id, projectId, secret, created: true };
  },
});
