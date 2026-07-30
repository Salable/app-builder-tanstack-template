import { Button } from "@base-ui/react/button";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { create } from "zustand";
import { useGetApiV1Health } from "../api/generated/client";
import type { HealthResponse } from "../api/generated/models";

const projectFormSchema = z
  .object({
    name: z.string().trim().min(3, "Use at least three characters."),
  })
  .strict();

type ProjectForm = z.infer<typeof projectFormSchema>;
type Theme = "light" | "dark" | "system";
type ThemeStore = {
  setTheme: (theme: Theme) => void;
  theme: Theme;
};

const useTheme = create<ThemeStore>((set) => ({
  setTheme: (theme) => set({ theme }),
  theme: "system",
}));

const initialHealth = {
  service: "generated-app",
  status: "ok",
  version: 1,
} satisfies HealthResponse;

export const Route = createFileRoute("/")({
  component: Home,
  loader: () => ({ initialHealth }),
});

function Home() {
  const { initialHealth } = Route.useLoaderData();
  const theme = useTheme((state) => state.theme);
  const setTheme = useTheme((state) => state.setTheme);
  const health = useGetApiV1Health({
    fetch: {
      headers: { "API-Version": "1" },
    },
    query: {
      initialData: initialHealth,
    },
  });
  const form = useForm<ProjectForm>({
    defaultValues: { name: "" },
    resolver: zodResolver(projectFormSchema),
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
            App Builder golden path
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Generated App Foundation
          </h1>
          <p className="max-w-2xl text-base leading-7 text-slate-600">
            TanStack Start SSR with an independently versioned Hono API and generated
            client boundary.
          </p>
        </header>

        <section
          aria-labelledby="runtime-heading"
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 id="runtime-heading" className="text-lg font-semibold">
                Runtime proof
              </h2>
              <p className="mt-1 text-sm text-slate-600" role="status">
                Public API: {health.data.status}; version {health.data.version}
              </p>
            </div>
            <div aria-label="Theme" className="flex rounded-xl bg-slate-100 p-1">
              {(["light", "dark", "system"] as const).map((option) => (
                <Button
                  aria-pressed={theme === option}
                  className="rounded-lg px-3 py-2 text-sm capitalize data-[pressed]:bg-white"
                  key={option}
                  onClick={() => setTheme(option)}
                  type="button"
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>
        </section>

        <section
          aria-labelledby="form-heading"
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 id="form-heading" className="text-lg font-semibold">
            Typed form boundary
          </h2>
          <form
            className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start"
            onSubmit={form.handleSubmit(({ name }) => {
              form.setValue("name", name.trim());
            })}
          >
            <div className="flex-1">
              <label className="text-sm font-medium" htmlFor="project-name">
                Project name
              </label>
              <input
                aria-describedby="project-name-error"
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-200"
                id="project-name"
                {...form.register("name")}
              />
              <p
                className="mt-2 min-h-5 text-sm text-rose-700"
                id="project-name-error"
                role="alert"
              >
                {form.formState.errors.name?.message}
              </p>
            </div>
            <Button
              className="mt-7 rounded-xl bg-violet-700 px-5 py-3 font-semibold text-white hover:bg-violet-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700"
              type="submit"
            >
              Validate
            </Button>
          </form>
        </section>

        <Link className="w-fit font-semibold text-violet-700 underline" to="/protected">
          Open protected account
        </Link>
      </div>
    </main>
  );
}
