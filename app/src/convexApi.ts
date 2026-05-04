// Re-export Convex generated API. The path resolves once `npx convex dev` has
// generated `../convex/_generated/api.ts`.
//
// We export it from a single module so tabs don't all reach into the parent
// directory directly.
export { api } from "../../convex/_generated/api";
