import { createHash } from "node:crypto";
import {
  FeatureFlagEvaluationContextSchema,
  type FeatureFlagEvaluationContext,
  type FeatureFlagValue,
  type FeatureFlagValueKind,
  valueKind,
} from "./contracts";
import type { FeatureFlagRuntimeClient } from "./runtime-client";

export type FeatureFlagResolution<Value extends FeatureFlagValue> = {
  key: string;
  value: Value;
  reason: "CONTROL_PLANE" | "SAFE_FALLBACK";
  revision: number | null;
  contextDigest: string;
  errorCode?: "CONTROL_PLANE_UNAVAILABLE" | "FLAG_NOT_FOUND" | "TYPE_MISMATCH";
};

export class ProductFeatureFlagEvaluator {
  constructor(private readonly client: FeatureFlagRuntimeClient) {}

  evaluateBoolean(
    key: string,
    safeFallback: boolean,
    context?: FeatureFlagEvaluationContext,
  ): Promise<FeatureFlagResolution<boolean>> {
    return this.evaluate(key, "BOOLEAN", safeFallback, context);
  }

  evaluateString(
    key: string,
    safeFallback: string,
    context?: FeatureFlagEvaluationContext,
  ): Promise<FeatureFlagResolution<string>> {
    return this.evaluate(key, "STRING", safeFallback, context);
  }

  evaluateNumber(
    key: string,
    safeFallback: number,
    context?: FeatureFlagEvaluationContext,
  ): Promise<FeatureFlagResolution<number>> {
    return this.evaluate(key, "NUMBER", safeFallback, context);
  }

  evaluateJson<Value extends FeatureFlagValue>(
    key: string,
    safeFallback: Value,
    context?: FeatureFlagEvaluationContext,
  ): Promise<FeatureFlagResolution<Value>> {
    return this.evaluate(key, "JSON", safeFallback, context);
  }

  async clientSnapshot(
    keys: string[],
    context?: FeatureFlagEvaluationContext,
  ): Promise<Record<string, FeatureFlagValue>> {
    try {
      const values = await this.client.evaluate(keys, context);
      return Object.fromEntries(
        values
          .filter(({ exposure }) => exposure === "CLIENT_EXPOSED")
          .map(({ key, value }) => [key, value]),
      );
    } catch {
      return {};
    }
  }

  private async evaluate<Value extends FeatureFlagValue>(
    key: string,
    kind: FeatureFlagValueKind,
    safeFallback: Value,
    context?: FeatureFlagEvaluationContext,
  ): Promise<FeatureFlagResolution<Value>> {
    const contextDigest = normalizeContext(context);
    if (valueKind(safeFallback) !== kind) {
      return fallback(key, safeFallback, contextDigest, "TYPE_MISMATCH");
    }
    try {
      const resolved = (await this.client.evaluate([key], context)).find(
        (value) => value.key === key,
      );
      if (resolved === undefined) {
        return fallback(key, safeFallback, contextDigest, "FLAG_NOT_FOUND");
      }
      if (resolved.valueKind !== kind || valueKind(resolved.value) !== kind) {
        return fallback(key, safeFallback, contextDigest, "TYPE_MISMATCH");
      }
      return {
        key,
        value: resolved.value as Value,
        reason: "CONTROL_PLANE",
        revision: resolved.revision,
        contextDigest,
      };
    } catch {
      return fallback(key, safeFallback, contextDigest, "CONTROL_PLANE_UNAVAILABLE");
    }
  }
}

export function normalizeContext(
  rawContext: FeatureFlagEvaluationContext | undefined,
): string {
  const context = FeatureFlagEvaluationContextSchema.parse(rawContext ?? {});
  const normalized = {
    subject: context.subjectId === undefined ? null : privacyDigest(context.subjectId),
    organization:
      context.organizationId === undefined
        ? null
        : privacyDigest(context.organizationId),
    attributes: Object.fromEntries(
      Object.entries(context.attributes)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, 20),
    ),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function fallback<Value extends FeatureFlagValue>(
  key: string,
  value: Value,
  contextDigest: string,
  errorCode: FeatureFlagResolution<Value>["errorCode"],
): FeatureFlagResolution<Value> {
  return {
    key,
    value,
    reason: "SAFE_FALLBACK",
    revision: null,
    contextDigest,
    errorCode,
  };
}

function privacyDigest(value: string): string {
  return createHash("sha256").update(value.trim()).digest("hex");
}
