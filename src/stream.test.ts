import type { AssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";

import { DEFAULT_SCOPE, type FoundryConfig } from "./config.js";
import { streamAzureFoundry, type ResponsesApi } from "./stream.js";

const config: FoundryConfig = {
  endpoint: "https://resource.openai.azure.com/openai/v1/",
  models: [],
  scope: DEFAULT_SCOPE,
  allowCustomEndpoint: false,
};
const FAKE_JWT = [
  ["e", "y", "Jaaaaaaaaaaaa"].join(""),
  ["e", "y", "Jbbbbbbbbbbbbb"].join(""),
  ["e", "y", "Jccccccccccccc"].join(""),
].join(".");

const model = {
  id: "deployment",
  name: "Deployment",
  api: "azure-foundry-openai",
  provider: "azure-foundry",
  baseUrl: config.endpoint,
  reasoning: false,
  input: ["text"] as ("text" | "image")[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 16_384,
};

describe("Azure Foundry stream bridge", () => {
  it("injects a short-lived Entra token into pi's OpenAI Responses stream", async () => {
    let receivedToken = "";
    let receivedBaseUrl = "";
    const responsesApi = {
      streamSimple: (innerModel: { baseUrl?: string }, _context: unknown, options?: { apiKey?: string }) => {
        receivedToken = options?.apiKey ?? "";
        receivedBaseUrl = innerModel.baseUrl ?? "";
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "done", reason: "stop", message: {} };
          },
        } as unknown as AssistantMessageEventStream;
      },
    } as unknown as ResponsesApi;

    const stream = streamAzureFoundry(
      model as never,
      {} as never,
      undefined,
      config,
      { getToken: async () => "memory-only-token" },
      responsesApi,
    );
    const events = [];
    for await (const event of stream) events.push(event);

    expect(receivedToken).toBe("memory-only-token");
    expect(receivedBaseUrl).toBe(config.endpoint);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("done");
  });

  it("does not leak credential errors into the stream", async () => {
    const stream = streamAzureFoundry(
      model as never,
      {} as never,
      undefined,
      config,
      { getToken: async () => { throw new Error(`Bearer ${FAKE_JWT}`); } },
      { streamSimple: () => { throw new Error("must not be called"); } } as unknown as ResponsesApi,
    );
    const events = [];
    for await (const event of stream) events.push(event);

    expect(events[0]?.type).toBe("error");
    const text = JSON.stringify(events[0]);
    expect(text).toContain("[redacted]");
    expect(text).not.toContain(FAKE_JWT);
  });

  it("redacts errors emitted by the downstream provider stream", async () => {
    const stream = streamAzureFoundry(
      model as never,
      {} as never,
      undefined,
      config,
      { getToken: async () => "token" },
      {
        streamSimple: () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              type: "error",
              reason: "error",
              error: { errorMessage: `Bearer ${FAKE_JWT}` },
            };
          },
        } as unknown as AssistantMessageEventStream),
      } as unknown as ResponsesApi,
    );
    const events = [];
    for await (const event of stream) events.push(event);

    const text = JSON.stringify(events[0]);
    expect(text).toContain("[redacted]");
    expect(text).not.toContain(FAKE_JWT);
  });
});
