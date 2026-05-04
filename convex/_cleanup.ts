import { internalMutation } from "./_generated/server";

// One-shot dev-side cleanup. After we migrated Granola from the
// `settings` table to `integrations`, the old (teamId, "granola.*")
// rows in settings are dead weight. This mutation deletes them. Safe
// to run multiple times — does nothing on subsequent runs.
//
// Run with: `npx convex run _cleanup:purgeOldGranolaSettings --no-push`
export const purgeOldGranolaSettings = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("settings").collect();
    let removed = 0;
    for (const row of all) {
      if (
        row.key === "granola.apiKey" ||
        row.key === "granola.cursor" ||
        row.key === "granola.lastPoll"
      ) {
        await ctx.db.delete(row._id);
        removed++;
      }
    }
    return { removed };
  },
});
