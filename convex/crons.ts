import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "reindex repos",
  { hourUTC: 8, minuteUTC: 0 },
  internal.repos.reindexAll,
  {},
);

// Pull new Granola meeting notes off the REST API. Granola has no
// webhook system, so this is the only ingest path. Three-minute
// cadence comfortably fits Granola's rate budget (5 req/s sustained)
// and keeps user-perceived latency under ~3 min after a meeting ends.
crons.interval(
  "poll granola",
  { minutes: 3 },
  internal.granola.pollAll,
  {},
);

// Zoom polls every 5 min — recordings take a couple minutes to process
// after a meeting ends, so a 5-min cadence keeps user-perceived latency
// at "lunch break or less" without burning the rate budget.
crons.interval(
  "poll zoom",
  { minutes: 5 },
  internal.zoom.pollAll,
  {},
);

export default crons;
