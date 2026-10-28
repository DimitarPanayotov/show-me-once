import { defineConfig } from "wxt";

export default defineConfig({
  manifest: () => ({
    name: "Show Me Once",
    description:
      "Record a browser task safely, then turn it into a reusable skill.",
    permissions: [
      "storage",
      "tabs",
      "scripting",
      "activeTab",
      "alarms",
      "clipboardWrite",
    ],
    minimum_chrome_version: "120",
    host_permissions: [
      `${new URL(import.meta.env.WXT_API_BASE_URL || "http://localhost:3000").origin}/*`,
      "http://127.0.0.1:4320/*",
    ],
  }),
});
