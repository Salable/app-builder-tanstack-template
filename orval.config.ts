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
        mutator: {
          path: "./src/api/fetch-mutator.ts",
          name: "apiFetch",
        },
      },
      schemas: "./src/api/generated/models",
      target: "./src/api/generated/client.ts",
    },
  },
});
