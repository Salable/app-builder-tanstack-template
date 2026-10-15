import { QueryClientProvider } from "@tanstack/react-query";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { RouterContext } from "../router";
import { SessionBoundary } from "../identity/session-boundary";
import "../styles.css";

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  head: () => ({
    links: [{ href: "/favicon.ico", rel: "icon" }],
    meta: [
      { charSet: "utf-8" },
      {
        content: "width=device-width, initial-scale=1",
        name: "viewport",
      },
      {
        content:
          "A starter skeleton. App Builder tasks replace its content and design.",
        name: "description",
      },
      { title: "App Builder starter" },
    ],
  }),
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <RootDocument>
      <QueryClientProvider client={queryClient}>
        <SessionBoundary>
          <header>
            <Link className="brand" to="/">
              App Builder starter
            </Link>
            <Link to="/protected">Application</Link>
          </header>
          <main>
            <Outlet />
          </main>
          <footer>Starter content — replaced by your App Builder tasks.</footer>
        </SessionBoundary>
      </QueryClientProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
