import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SCOPE, MANAGEMENT_SCOPE, type FoundryConfig, type FoundryModelConfig } from "./config.js";
import { canDiscoverFoundryDeployments, discoverFoundryDeployments, discoverFoundryModels, mergeFoundryModels } from "./discovery.js";

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

  it("uses ARM deployments as the authoritative list when coordinates are configured", async () => {
    const armConfig: FoundryConfig = {
      ...config,
      resource: "resource",
      subscriptionId: "11111111-1111-4111-8111-111111111111",
      resourceGroup: "foundry-rg",
    };
    const getTokenForScope = vi.fn(async (scope: string) => {
      expect(scope).toBe(MANAGEMENT_SCOPE);
      return "management-token";
    });
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toBe(
        "https://management.azure.com/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/foundry-rg/providers/Microsoft.CognitiveServices/accounts/resource/deployments?api-version=2024-10-01",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer management-token");
      return new Response(JSON.stringify({
        value: [
          {
            name: "gpt-prod",
            properties: { provisioningState: "Succeeded", model: { name: "gpt-4.1" } },
          },
          {
            name: "pending-deployment",
            properties: { provisioningState: "Creating", model: { name: "gpt-4.1" } },
          },
          {
            name: "embedding-prod",
            properties: { provisioningState: "Succeeded", model: { name: "text-embedding-3-small" } },
          },
        ],
      }), { status: 200 });
    });

    const models = await discoverFoundryDeployments(armConfig, { getToken: vi.fn(), getTokenForScope }, { fetch: fetcher });

    expect(models.map((model) => model.id)).toEqual(["gpt-prod"]);
    expect(getTokenForScope).toHaveBeenCalledOnce();
  });

  it("accepts a trusted endpoint as the ARM account name and follows safe pagination", async () => {
    const armConfig: FoundryConfig = {
      ...config,
      subscriptionId: "11111111-1111-4111-8111-111111111111",
      resourceGroup: "foundry-rg",
    };
    expect(canDiscoverFoundryDeployments(armConfig)).toBe(true);
    const fetcher = vi.fn(async (input: string) => {
      const page = input.includes("next-page")
        ? { value: [{ name: "gpt-next", properties: { provisioningState: "Succeeded", model: { name: "gpt-4.1" } } }] }
        : {
            value: [{ name: "gpt-first", properties: { provisioningState: "Succeeded", model: { name: "gpt-4.1" } } }],
            nextLink: "https://management.azure.com/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/foundry-rg/providers/Microsoft.CognitiveServices/accounts/resource/deployments?api-version=2024-10-01&next-page=1",
          };
      return new Response(JSON.stringify(page), { status: 200 });
    });

    const models = await discoverFoundryDeployments(armConfig, { getToken: vi.fn(), getTokenForScope: vi.fn(async () => "management-token") }, { fetch: fetcher });

    expect(models.map((model) => model.id)).toEqual(["gpt-first", "gpt-next"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects an untrusted ARM pagination link", async () => {
    const armConfig: FoundryConfig = {
      ...config,
      resource: "resource",
      subscriptionId: "11111111-1111-4111-8111-111111111111",
      resourceGroup: "foundry-rg",
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      value: [],
      nextLink: "https://evil.example/deployments",
    }), { status: 200 }));

    await expect(discoverFoundryDeployments(armConfig, { getToken: vi.fn(), getTokenForScope: vi.fn(async () => "management-token") }, { fetch: fetcher }))
      .rejects.toThrow(/untrusted nextLink/iu);
  });

  it("does not expose an error response body", async () => {
    const fetcher = vi.fn(async () => new Response("Bearer secret-token", { status: 403 }));

    await expect(discoverFoundryModels(config, { getToken: async () => "secret-token" }, { fetch: fetcher }))
      .rejects.toThrow("HTTP 403");
    await expect(discoverFoundryModels(config, { getToken: async () => "secret-token" }, { fetch: fetcher }))
      .rejects.not.toThrow("secret-token");
  });
});
