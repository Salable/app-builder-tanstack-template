import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getOpenApiDocument } from "../src/api/app";

const outputDirectory = path.resolve("openapi");
const outputPath = path.join(outputDirectory, "openapi.json");
const document = sortObject(getOpenApiDocument());

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(`Generated ${path.relative(process.cwd(), outputPath)}`);

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortObject(child)]),
  );
}
