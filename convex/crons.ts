import { cronJobs } from "convex/server";

// Otto is offline. All scheduled jobs are disabled.
//
// Previously this ran a daily "reindex repos" job (08:00 UTC) to keep
// repo embeddings fresh for the semantic router. With the service taken
// offline there's nothing to route, so the cron is removed to stop the
// recurring compute. To bring Otto back, restore the crons.daily(...)
// registration for internal.repos.reindexAll (see git history).
const crons = cronJobs();

export default crons;
