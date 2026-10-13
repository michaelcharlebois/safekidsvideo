import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "server-only": path.resolve(import.meta.dirname, "test/server-only-stub.ts") } },
  test: { include: ["src/**/*.test.ts", "test/**/*.test.ts"], environment: "node", testTimeout: 60_000 },
});
