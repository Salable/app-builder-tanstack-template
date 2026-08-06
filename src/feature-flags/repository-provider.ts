import { ProductFeatureFlagEvaluator } from "./evaluator";
import {
  createFeatureFlagRuntimeClient,
  type FeatureFlagRuntimeClient,
} from "./runtime-client";

let client: FeatureFlagRuntimeClient | undefined;
let evaluator: ProductFeatureFlagEvaluator | undefined;

export function getProductFeatureFlagEvaluator(): ProductFeatureFlagEvaluator {
  client ??= createFeatureFlagRuntimeClient(process.env);
  evaluator ??= new ProductFeatureFlagEvaluator(client);
  return evaluator;
}

export function setProductFeatureFlagsForTesting(
  replacement: FeatureFlagRuntimeClient | undefined,
): void {
  client = replacement;
  evaluator =
    replacement === undefined
      ? undefined
      : new ProductFeatureFlagEvaluator(replacement);
}
