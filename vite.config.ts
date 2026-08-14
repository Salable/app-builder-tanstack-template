import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tanstackStart(), nitro(), tailwindcss(), viteReact()],
  resolve: {
    alias: {
      "pg-native": fileURLToPath(
        new URL("./src/persistence/pg-native-unavailable.ts", import.meta.url),
      ),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 3000,
  },
});
