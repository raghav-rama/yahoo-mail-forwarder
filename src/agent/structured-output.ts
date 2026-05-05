import { z } from "zod";

export type ResponsesParseClient = {
  responses: {
    parse(request: unknown): Promise<unknown>;
  };
};

export function extractParsedOutput<T>(response: unknown, schema: z.ZodType<T>): T {
  const direct = getProperty(response, "output_parsed");
  if (direct !== undefined) {
    return schema.parse(direct);
  }

  for (const output of asArray(getProperty(response, "output"))) {
    if (getProperty(output, "type") !== "message") {
      continue;
    }

    for (const item of asArray(getProperty(output, "content"))) {
      if (getProperty(item, "type") === "refusal") {
        throw new ModelRefusalError(String(getProperty(item, "refusal") ?? "Model refused the request"));
      }

      const parsed = getProperty(item, "parsed");
      if (parsed !== undefined) {
        return schema.parse(parsed);
      }
    }
  }

  throw new Error("Structured output response did not include parsed content");
}

export class ModelRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelRefusalError";
  }
}

function getProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
