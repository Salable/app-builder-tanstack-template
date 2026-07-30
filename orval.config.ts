import { defineConfig } from "orval";

export default defineConfig({
  publicApi: {
    input: {
      target: "./openapi/openapi.json",
    },
    output: {
      client: "react-query",
      clean: true,
      httpClient: "fetch",
      mode: "split",
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
      },
      schemas: "./src/api/generated/models",
      target: "./src/api/generated/client.ts",
    },
  },
});
