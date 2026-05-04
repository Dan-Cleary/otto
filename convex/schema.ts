import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const EMBEDDING_DIM = 1536; // text-embedding-3-small

export default defineSchema({
  ...authTables,

  // ── Teams ─────────────────────────────────────────────────────────
  // Otto is a multi-tenant team tool. Every piece of admin data
  // (projects, repos, items, ingest events, audit log, settings,
  // routing memory) belongs to a team. Users can be in many teams;
  // the UI carries an active teamId in localStorage and passes it
  // to every query/mutation. New signups land in their own personal
  // team automatically.
  teams: defineTable({
    name: v.string(),
    slug: v.string(),
    createdAt: v.number(),
    createdBy: v.string(),
  }).index("by_slug", ["slug"]),

  teamMembers: defineTable({
    teamId: v.id("teams"),
    userId: v.string(),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    joinedAt: v.number(),
    invitedBy: v.optional(v.string()),
  })
    .index("by_team", ["teamId"])
    .index("by_user", ["userId"])
    .index("by_team_user", ["teamId", "userId"]),

  // Per-team external integrations. One row per (team, kind). Multi-
  // field configs (secrets, OAuth tokens, cursors, last-poll status)
  // live here.
  integrations: defineTable({
    teamId: v.id("teams"),
    kind: v.union(
      v.literal("granola"),
      v.literal("zoom"),
      v.literal("google_meet"),
      v.literal("cursor"),
    ),
    enabled: v.boolean(),
    // Platform-specific config shape:
    //   zoom: { accountId, clientId, clientSecret }
    //   google_meet: TBD
    config: v.any(),
    // Cached short-lived OAuth access token. { value, expiresAt }.
    cachedToken: v.optional(v.any()),
    // Pagination cursor / since-watermark, platform-defined.
    cursor: v.optional(v.any()),
    lastPollAt: v.optional(v.number()),
    lastPollOk: v.optional(v.boolean()),
    lastPollError: v.optional(v.string()),
    lastPollIngested: v.optional(v.number()),
    createdAt: v.number(),
    createdBy: v.string(),
    updatedAt: v.number(),
    updatedBy: v.string(),
  })
    .index("by_team_kind", ["teamId", "kind"])
    .index("by_kind_enabled", ["kind", "enabled"]),

  teamInvites: defineTable({
    teamId: v.id("teams"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    token: v.string(),
    invitedBy: v.string(),
    invitedAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedBy: v.optional(v.string()),
  })
    .index("by_token", ["token"])
    .index("by_team", ["teamId"])
    .index("by_email", ["email"]),

  ingestEvents: defineTable({
    sourceType: v.union(
      v.literal("widget"),
      v.literal("granola"),
      v.literal("zoom"),
    ),
    sourceRef: v.string(),
    payload: v.any(),
    receivedAt: v.number(),
    teamId: v.optional(v.id("teams")),
  })
    .index("by_source", ["sourceType", "sourceRef"])
    .index("by_team", ["teamId"]),

  items: defineTable({
    ingestEventId: v.id("ingestEvents"),
    sourceType: v.union(
      v.literal("widget"),
      v.literal("granola"),
      v.literal("zoom"),
    ),
    sourceRef: v.string(),
    description: v.string(),
    quotedContext: v.string(),
    repoCandidate: v.union(v.string(), v.null()),
    repoId: v.union(v.id("repos"), v.null()),
    parserConfidence: v.number(),
    routerConfidence: v.union(v.number(), v.null()),
    routerSuggestions: v.optional(
      v.array(
        v.object({
          repoId: v.id("repos"),
          score: v.number(),
        }),
      ),
    ),
    surfacedInUserNotes: v.optional(v.boolean()),
    status: v.union(
      v.literal("parsed"),
      v.literal("queued"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("fired"),
      v.literal("pr_opened"),
      v.literal("failed"),
    ),
    cursorRunId: v.optional(v.string()),
    cursorAgentId: v.optional(v.string()),
    prUrl: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    slackTs: v.optional(v.string()),
    slackChannel: v.optional(v.string()),
    createdAt: v.number(),
    projectId: v.optional(v.union(v.id("projects"), v.null())),
    teamId: v.optional(v.id("teams")),
  })
    .index("by_status", ["status"])
    .index("by_source", ["sourceType", "sourceRef"])
    .index("by_slack", ["slackChannel", "slackTs"])
    .index("by_team", ["teamId"])
    .index("by_team_status", ["teamId", "status"]),

  repos: defineTable({
    name: v.string(),
    githubFullName: v.string(),
    githubUrl: v.string(),
    description: v.string(),
    metadataBlob: v.string(),
    embedding: v.optional(v.array(v.float64())),
    enabled: v.boolean(),
    lastIndexedAt: v.optional(v.number()),
    // A repo belongs to at most one project. Optional during the
    // projects-rollout migration; treated as "unassigned" when null.
    projectId: v.optional(v.union(v.id("projects"), v.null())),
    teamId: v.optional(v.id("teams")),
  })
    .index("by_github", ["githubFullName"])
    .index("by_project", ["projectId"])
    .index("by_team", ["teamId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: EMBEDDING_DIM,
      filterFields: ["enabled"],
    }),

  // Projects group one or more repos and own the routing rules for
  // them. Widget feedback routes to a project via URL pattern; Granola
  // extractions route via semantic match on the project description.
  projects: defineTable({
    name: v.string(),
    slug: v.string(),
    description: v.string(),
    // URL patterns that identify this project's host pages. Each is a
    // simple "host" / "host/path" / "*.host.com/path*" glob — see
    // projects.matchUrl on the server. First match wins.
    urlPatterns: v.array(v.string()),
    primaryRepoId: v.union(v.id("repos"), v.null()),
    autoFireThreshold: v.optional(v.number()),
    enabled: v.boolean(),
    createdAt: v.number(),
    createdBy: v.string(),
    teamId: v.optional(v.id("teams")),
  })
    .index("by_slug", ["slug"])
    .index("by_enabled", ["enabled"])
    .index("by_team", ["teamId"]),

  routingMemory: defineTable({
    description: v.string(),
    quotedContext: v.string(),
    embedding: v.array(v.float64()),
    correctedRepoId: v.id("repos"),
    correctedAt: v.number(),
    correctedBy: v.string(),
    sourceItemId: v.optional(v.id("items")),
    teamId: v.optional(v.id("teams")),
  })
    .index("by_team", ["teamId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: EMBEDDING_DIM,
      filterFields: ["teamId"],
    }),

  auditLog: defineTable({
    itemId: v.union(v.id("items"), v.null()),
    event: v.string(),
    payload: v.any(),
    actor: v.string(),
    at: v.number(),
    teamId: v.optional(v.id("teams")),
  })
    .index("by_item", ["itemId"])
    .index("by_at", ["at"])
    .index("by_team_at", ["teamId", "at"]),

  settings: defineTable({
    key: v.string(),
    value: v.any(),
    updatedAt: v.number(),
    updatedBy: v.string(),
    teamId: v.optional(v.id("teams")),
  })
    .index("by_key", ["key"])
    .index("by_team_key", ["teamId", "key"]),
});
