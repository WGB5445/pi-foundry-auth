import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SCOPE, type FoundryConfig, type FoundryModelConfig } from "./config.js";
import { discoverFoundryModels, mergeFoundryModels } from "./discovery.js";

const config: FoundryConfig = {
  endpoint: "https://resource.openai.azure.com/openai/v1/",
  models: [],
  scope: DEFAULT_SCOPE,
  allowCustomEndpoint: false,
};

describe("Azure Foundry model discovery", () => {
  it("uses the authenticated v1 model catalog and returns safe model metadata", async () => {
    const getToken = vi.fn(async () => "secret-token");
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toBe("https://resource.openai.azure.com/openai/v1/models");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret-token");
      expect(init?.redirect).toBe("error");
      return new Response(JSON.stringify({
        object: "list",
        data: [
          { id: "gpt-4.1", object: "model", owned_by: "azure" },
          { id: "gpt-4.1-mini", object: "model", owned_by: "azure" },
          { id: "text-embedding-3-small", object: "model", owned_by: "azure" },
          { id: "bad\nmodel", object: "model" },
        ],
      }), { status: 200 });
    });

    const models = await discoverFoundryModels(config, { getToken }, { fetch: fetcher });

    expect(getToken).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(models.map((model) => model.id)).toEqual(["gpt-4.1", "gpt-4.1-mini"]);
    expect(models[0]?.input).toEqual(["text"]);
  });

  it("keeps configured model metadata while adding newly discovered models", () => {
    const configured: FoundryModelConfig[] = [{
      id: "gpt-4.1",
      name: "Preferred GPT-4.1",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 32_000,
    }];
    const discovered: FoundryModelConfig[] = [{
      id: "gpt-4.1",
      name: "Discovered GPT-4.1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
    }, {
      id: "gpt-4.1-mini",
      name: "gpt-4.1-mini",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
    }];

    const models = mergeFoundryModels(configured, discovered);

    expect(models).toHaveLength(2);
    expect(models[0]?.name).toBe("Preferred GPT-4.1");
    expect(models[1]?.id).toBe("gpt-4.1-mini");
  });

  it("does not expose an error response body", async () => {
    const fetcher = vi.fn(async () => new Response("Bearer secret-token", { status: 403 }));

    await expect(discoverFoundryModels(config, { getToken: async () => "secret-token" }, { fetch: fetcher }))
      .rejects.toThrow("HTTP 403");
    await expect(discoverFoundryModels(config, { getToken: async () => "secret-token" }, { fetch: fetcher }))
      .rejects.not.toThrow("secret-token");
  });
});
