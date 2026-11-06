import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
const here = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: path.join(here, "wrangler.test.jsonc") },
      miniflare: {
        assets: { directory: path.join(here, "dist") },
        bindings: {
          AUTH_PEPPER: "TF9URVNUX09OTFlfQUFBQUFBQUFBQUFBQUFBQUFBQUE",
          PULSE_RUNTIME: "production",
          TEST_CLIENT_IP: "127.0.0.1",
          SETUP_TOKEN: "LOCAL_TEST_SETUP_ONLY_32_BYTES_LONG_GENERATED",
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(here, "migrations"),
          ),
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.js"],
    include: ["test/workers/**/*.spec.js"],
    isolate: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 120000,
  },
});
