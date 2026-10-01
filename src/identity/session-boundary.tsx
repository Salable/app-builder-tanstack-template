import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { subscribeToSessionChanges } from "./session-changes";

/** Discard the previous account's UI before reloading authoritative server routes. */
export function SessionBoundary({ children }: { children: ReactNode }) {
  const queries = useQueryClient();
  const router = useRouter();
  const revision = useRef(0);
  const pending = useRef(Promise.resolve());
  const [state, setState] = useState<"ready" | "checking" | "failed">("ready");
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    setState("checking");
    const refreshRoutes = pending.current
      .catch(() => undefined)
      .then(async () => {
        if (revision.current !== current) return;
        await queries.cancelQueries();
        queries.clear();
        await router.invalidate({ sync: true });
      });
    pending.current = refreshRoutes;
    try {
      await refreshRoutes;
      if (revision.current === current) setState("ready");
    } catch {
      if (revision.current === current) setState("failed");
    }
  }, [queries, router]);

  useEffect(() => {
    const unsubscribe = subscribeToSessionChanges(() => void refresh());
    return () => {
      revision.current += 1;
      unsubscribe();
    };
  }, [refresh]);

  if (state === "checking") return <p role="status">Checking your session…</p>;
  if (state === "failed")
    return (
      <div role="alert">
        <p>We could not refresh your session.</p>
        <button type="button" onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    );
  return children;
}
