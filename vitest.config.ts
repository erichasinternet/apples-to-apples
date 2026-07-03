import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/unit/**/*.test.ts"],
    restoreMocks: true,
    coverage: {
      reporter: ["text", "html"],
      include: ["src/core/**/*.ts", "src/content/**/*.ts"]
    }
  }
});
