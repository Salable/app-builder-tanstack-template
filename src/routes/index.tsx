import { Button } from "@base-ui/react/button";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { create } from "zustand";
import { useGetApiV1Health } from "../api/generated/client";

export const projectFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, "Use at least three characters.")
      .max(100, "Use no more than 100 characters."),
  })
  .strict();

type ProjectForm = z.infer<typeof projectFormSchema>;
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
  if (health.isPending) return "Public API: checking…";
  if (health.isError || health.data === undefined) return "Public API: unavailable";
  return `Public API: ${health.data.status}; version ${health.data.version}`;
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
                {healthStatusText(health)}
              </p>
            </div>
            <ThemeSelector setTheme={setTheme} theme={theme} />
          </div>
        </section>

        <section
          aria-labelledby="form-heading"
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 id="form-heading" className="text-lg font-semibold">
            Typed form boundary
          </h2>
          <ProjectNameForm />
        </section>

        <Link className="w-fit font-semibold text-violet-700 underline" to="/protected">
          Open protected account
        </Link>
      </div>
    </main>
  );
}

export function ProjectNameForm() {
  const form = useForm<ProjectForm>({
    defaultValues: { name: "" },
    resolver: zodResolver(projectFormSchema),
  });

  return (
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
          aria-invalid={form.formState.errors.name ? true : undefined}
          className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-200"
          id="project-name"
          maxLength={100}
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
  );
}
