import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";
import {
  installBrowserErrorLogging,
  reportBrowserError,
} from "./runtime/browser-errors";

installBrowserErrorLogging(window);

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
    {
      onCaughtError: (error) =>
        reportBrowserError(error, {
          operation: "react.render",
          code: "COMPONENT_RENDER_FAILED",
        }),
      onUncaughtError: (error) =>
        reportBrowserError(error, {
          operation: "react.render",
          code: "UNHANDLED_RENDER_ERROR",
        }),
      onRecoverableError: (error) =>
        reportBrowserError(error, {
          operation: "react.hydrate",
          code: "HYDRATION_FAILED",
        }),
    },
  );
});
