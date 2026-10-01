// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, expect, it, vi } from "vitest";
import { SessionBoundary } from "./session-boundary";
import { announceSessionChange } from "./session-changes";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function application() {
  const queries = new QueryClient();
  let load = async () => "Previous account";
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queries}>
        <SessionBoundary>
          <Outlet />
        </SessionBoundary>
      </QueryClientProvider>
    ),
  });
  const account = createRoute({
    getParentRoute: () => root,
    path: "/",
    loader: () => load(),
    component: () => <p>{account.useLoaderData()}</p>,
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routeTree: root.addChildren([account]),
    defaultPendingMs: 0,
  });
  const view = render(<RouterProvider router={router} />);
  await screen.findByText("Previous account");
  return {
    ...view,
    queries,
    router,
    setLoader: (next: typeof load) => {
      load = next;
    },
  };
}

it("cancels account queries, discards cached data and hides the old account until server routes refresh", async () => {
  const app = await application();
  app.queries.setQueryData(["private"], "private cached data");
  let aborted = false;
  const pending = app.queries
    .fetchQuery({
      queryKey: ["pending"],
      queryFn: ({ signal }) =>
        new Promise<string>((_, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("cancelled"));
          });
        }),
    })
    .catch(() => undefined);
  let finish!: (value: string) => void;
  app.setLoader(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  act(announceSessionChange);
  expect(screen.getByRole("status").textContent).toContain("Checking");
  expect(screen.queryByText("Previous account")).toBeNull();
  await waitFor(() => expect(app.queries.getQueryCache().getAll()).toEqual([]));
  expect(aborted).toBe(true);
  await pending;
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () => finish("Authentication required"));
  await screen.findByText("Authentication required");
  expect(screen.queryByRole("status")).toBeNull();
});

it("keeps account content hidden after a refresh failure and retries through the real router", async () => {
  const app = await application();
  app.setLoader(async () => "New account");
  vi.spyOn(app.router, "invalidate").mockRejectedValueOnce(
    new Error("private diagnostic"),
  );
  act(announceSessionChange);
  await screen.findByRole("alert");
  expect(screen.queryByText("Previous account")).toBeNull();
  expect(screen.queryByText("private diagnostic")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("New account");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("coalesces superseded queued changes without restoring an earlier account", async () => {
  const app = await application();
  const finishes: Array<(value: string) => void> = [];
  app.setLoader(() => new Promise<string>((resolve) => finishes.push(resolve)));
  act(announceSessionChange);
  await waitFor(() => expect(finishes).toHaveLength(1));
  act(() => {
    announceSessionChange();
    announceSessionChange();
  });
  await act(async () => finishes[0]!("Obsolete account"));
  expect(screen.queryByText("Obsolete account")).toBeNull();
  expect(screen.getByRole("status")).toBeTruthy();
  await waitFor(() => expect(finishes).toHaveLength(2));
  await act(async () => finishes[1]!("Current account"));
  await screen.findByText("Current account");
});

it("unsubscribes when the boundary unmounts during a refresh", async () => {
  const app = await application();
  let finish!: (value: string) => void;
  app.setLoader(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const invalidate = vi.spyOn(app.router, "invalidate");
  act(announceSessionChange);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  app.unmount();
  await act(async () => finish("Finished after unmount"));
  act(announceSessionChange);
  expect(invalidate).toHaveBeenCalledOnce();
});
