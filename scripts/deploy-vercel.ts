import { spawnSync } from "node:child_process";
import { deploymentScripts } from "./deployment-plan";

for (const script of deploymentScripts(process.env.APP_BUILDER_DELIVERY_STAGE)) {
  const result = spawnSync("npm", ["run", script], {
    env: process.env,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Vercel deployment step failed: npm run ${script}`);
  }
}
