import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts"],
    // Convex test setup runs in edge-runtime, but "use node" actions run in
    // node. convex-test handles this internally; we just supply mocks below.
  },
});
