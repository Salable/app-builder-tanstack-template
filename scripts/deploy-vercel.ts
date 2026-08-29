import { spawnSync } from "node:child_process";
import { deploymentApplicationOrigin, deploymentScripts } from "./deployment-plan";

const stage = process.env.APP_BUILDER_DELIVERY_STAGE;
const scripts = deploymentScripts(stage);
deploymentApplicationOrigin(stage);

for (const script of scripts) {
  const result = spawnSync("npm", ["run", script], {
    env: process.env,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Vercel deployment step failed: npm run ${script}`);
  }
}
