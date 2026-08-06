import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FeatureFlagManifestSchema,
  featureFlagManifest,
} from "../src/feature-flags/manifest";

const methodKinds = {
  Boolean: "BOOLEAN",
  String: "STRING",
  Number: "NUMBER",
  Json: "JSON",
} as const;

export async function verifyFeatureFlagSources(root = process.cwd()): Promise<void> {
  FeatureFlagManifestSchema.parse(featureFlagManifest);
  const definitions = new Map(
    featureFlagManifest.definitions.map((definition) => [definition.key, definition]),
  );
  const sourceRoot = path.join(root, "src");
  for (const filename of await listFiles(sourceRoot)) {
    if (
      !/\.[cm]?[jt]sx?$/.test(filename) ||
      filename.endsWith("evaluator.ts") ||
      /\.test\.[cm]?[jt]sx?$/.test(filename)
    ) {
      continue;
    }
    const source = await readFile(filename, "utf8");
    const reference = /\.evaluate(Boolean|String|Number|Json)\(\s*["']([^"']+)["']/g;
    for (const match of source.matchAll(reference)) {
      const method = match[1] as keyof typeof methodKinds | undefined;
      const key = match[2];
      if (method === undefined || key === undefined) continue;
      const definition = definitions.get(key);
      if (definition === undefined) {
        throw new Error(`Unknown feature flag reference ${key} in ${filename}.`);
      }
      if (definition.valueKind !== methodKinds[method]) {
        throw new Error(
          `Feature flag ${key} is ${definition.valueKind} but ${filename} uses evaluate${method}.`,
        );
      }
    }
  }
}

export async function verifyBrowserBoundary(root = process.cwd()): Promise<void> {
  const publicRoot = path.join(root, ".output", "public");
  if (!(await exists(publicRoot))) return;
  const prohibited = [
    "APP_BUILDER_FEATURE_FLAG_RUNTIME_TOKEN",
    "feature_flag_definitions",
    "/internal/v1/feature-flags",
  ];
  for (const filename of await listFiles(publicRoot)) {
    if ((await stat(filename)).size > 5_000_000) continue;
    const source = await readFile(filename, "utf8");
    const exposed = prohibited.find((value) => source.includes(value));
    if (exposed !== undefined) {
      throw new Error(`Browser artifact ${filename} exposes ${exposed}.`);
    }
  }
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(filename)));
    else files.push(filename);
  }
  return files;
}

async function exists(filename: string): Promise<boolean> {
  try {
    await stat(filename);
    return true;
  } catch {
    return false;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(fileURLToPath(pathToFileURL(invokedPath))).href
) {
  await verifyFeatureFlagSources();
  await verifyBrowserBoundary();
  console.log(
    `Verified feature flag manifest ${featureFlagManifest.manifestVersion} and browser boundary.`,
  );
}
