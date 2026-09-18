import { Button } from "@base-ui/react/button";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { create } from "zustand";
import { useGetApiV1Health } from "../api/generated/client";

type Theme = "light" | "dark" | "system";
type ThemeStore = {
  setTheme: (theme: Theme) => void;
  theme: Theme;
};

export function healthStatusText(health: {
  data?: { status: string; version: number };
  isError: boolean;
  isPending: boolean;
}): string {
  if (health.isPending) return "Foundation status: checking…";
  if (health.isError || health.data === undefined) {
    return "Foundation status: unavailable";
  }
  return "Foundation status: ready";
}

const useTheme = create<ThemeStore>((set) => ({
  setTheme: (theme) => set({ theme }),
  theme: "system",
}));

export function ThemeSelector({
  setTheme,
  theme,
}: Pick<ThemeStore, "setTheme" | "theme">) {
  return (
    <div aria-label="Theme" className="theme-selector flex rounded-xl p-1" role="group">
      {(["light", "dark", "system"] as const).map((option) => (
        <Button
          aria-pressed={theme === option}
          className="theme-selector-button rounded-lg px-3 py-2 text-sm capitalize"
          key={option}
          onClick={() => setTheme(option)}
          type="button"
        >
          {option}
        </Button>
      ))}
    </div>
  );
}

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const theme = useTheme((state) => state.theme);
  const setTheme = useTheme((state) => state.setTheme);
  const health = useGetApiV1Health({
    request: {
      headers: { "API-Version": "1" },
    },
  });
  useEffect(() => {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolved = theme === "system" ? (prefersDark ? "dark" : "light") : theme;
    document.documentElement.dataset.theme = resolved;
  }, [theme]);

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-950 transition-colors data-[theme=dark]:bg-slate-950">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-violet-700">
            Salable App Builder
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            TanStack Starter
          </h1>
          <p className="max-w-2xl text-base leading-7 text-slate-600">
            A maintained application foundation with the core API, database,
            authentication, testing, and deployment seams ready for your product. Return
            to App Builder to define what you want to build and start the work.
          </p>
          <nav
            aria-label="Account"
            className="flex gap-5 font-semibold text-violet-700"
          >
            <Link to="/auth/sign-in">Sign in</Link>
            <Link to="/auth/sign-up">Create an account</Link>
          </nav>
        </header>

        <section
          aria-labelledby="runtime-heading"
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 id="runtime-heading" className="text-lg font-semibold">
                Starter status
              </h2>
              <p className="mt-1 text-sm text-slate-600" role="status">
                {healthStatusText(health)}
              </p>
            </div>
            <ThemeSelector setTheme={setTheme} theme={theme} />
          </div>
        </section>
      </div>
    </main>
  );
}
