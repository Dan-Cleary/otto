/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _cleanup from "../_cleanup.js";
import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as authDb from "../authDb.js";
import type * as crons from "../crons.js";
import type * as cursor from "../cursor.js";
import type * as cursorDb from "../cursorDb.js";
import type * as cursorPrompt from "../cursorPrompt.js";
import type * as github from "../github.js";
import type * as githubDb from "../githubDb.js";
import type * as granola from "../granola.js";
import type * as granolaDb from "../granolaDb.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as parser from "../parser.js";
import type * as parserDb from "../parserDb.js";
import type * as projects from "../projects.js";
import type * as repos from "../repos.js";
import type * as reposDb from "../reposDb.js";
import type * as router from "../router.js";
import type * as routerDb from "../routerDb.js";
import type * as seed from "../seed.js";
import type * as slack from "../slack.js";
import type * as slackDb from "../slackDb.js";
import type * as teams from "../teams.js";
import type * as zoom from "../zoom.js";
import type * as zoomDb from "../zoomDb.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  _cleanup: typeof _cleanup;
  admin: typeof admin;
  auth: typeof auth;
  authDb: typeof authDb;
  crons: typeof crons;
  cursor: typeof cursor;
  cursorDb: typeof cursorDb;
  cursorPrompt: typeof cursorPrompt;
  github: typeof github;
  githubDb: typeof githubDb;
  granola: typeof granola;
  granolaDb: typeof granolaDb;
  http: typeof http;
  ingest: typeof ingest;
  parser: typeof parser;
  parserDb: typeof parserDb;
  projects: typeof projects;
  repos: typeof repos;
  reposDb: typeof reposDb;
  router: typeof router;
  routerDb: typeof routerDb;
  seed: typeof seed;
  slack: typeof slack;
  slackDb: typeof slackDb;
  teams: typeof teams;
  zoom: typeof zoom;
  zoomDb: typeof zoomDb;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
