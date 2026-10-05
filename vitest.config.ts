import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "lib/**/*.test.ts"],
    maxWorkers: 2,
    // Stdio hooks launch a fresh Node process; allow slower disks and CI startup.
    hookTimeout: 45_000,
  },
})
