import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Repo metadata + embeddings — used by the semantic router to pick
// the right repo for an item when no project is matched on the
// snippet. Daily is plenty; repos rarely change description.
crons.daily(
  "reindex repos",
  { hourUTC: 8, minuteUTC: 0 },
  internal.repos.reindexAll,
  {},
);

// Meeting-source crons (granola pollAll, zoom pollAll) used to live
// here. Removed alongside the widget-first pivot — meetings are
// buried in the product. The granola/zoom backend code is still
// present but not exercised by any cron, so existing teams that
// installed the integrations stop pulling new data automatically.

export default crons;
