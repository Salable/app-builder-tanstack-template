import { QueryClientProvider } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { RouterContext } from "../router";
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
        content: "A production-readiness proof for App Builder generated applications.",
        name: "description",
      },
      { title: "App Builder Starter" },
    ],
  }),
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <RootDocument>
      <QueryClientProvider client={queryClient}>
        <Outlet />
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
