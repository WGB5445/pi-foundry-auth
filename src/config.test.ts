import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  COGNITIVE_SERVICES_SCOPE,
  DEFAULT_SCOPE,
  loadFoundryConfig,
  normalizeEndpoint,
  validateScope,
} from "./config.js";

describe("normalizeEndpoint", () => {
  it("builds a safe canonical endpoint", () => {
    expect(normalizeEndpoint("https://my-resource.openai.azure.com/openai/v1")).toBe(
      "https://my-resource.openai.azure.com/openai/v1/",
    );
    expect(normalizeEndpoint("https://my-resource.services.ai.azure.com/openai/v1/")).toBe(
      "https://my-resource.services.ai.azure.com/openai/v1/",
    );
  });

  it("rejects unsafe endpoint variants by default", () => {
    expect(() => normalizeEndpoint("http://my-resource.openai.azure.com/openai/v1")).toThrow(/HTTPS/iu);
    expect(() => normalizeEndpoint("https://example.com/openai/v1")).toThrow(/approved Azure host/iu);
    expect(() => normalizeEndpoint("https://my-resource.openai.azure.com/v1")).toThrow(/path/iu);
    expect(() => normalizeEndpoint("https://user:pass@my-resource.openai.azure.com/openai/v1")).toThrow(/credentials/iu);
    expect(() => normalizeEndpoint("https://my-resource.openai.azure.com/openai/v1?redirect=1")).toThrow(/query/iu);
  });

  it("requires explicit opt-in for a custom HTTPS host", () => {
    expect(normalizeEndpoint("https://gateway.example.com/openai/v1", true)).toBe(
      "https://gateway.example.com/openai/v1/",
    );
  });
});

describe("loadFoundryConfig", () => {
  it("loads metadata from a global file and lets environment values override it", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "pi-foundry-home-"));
    try {
      const agentDir = join(homeDir, ".pi", "agent");
      const configDir = join(agentDir);
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "azure-foundry.json"),
        JSON.stringify({ resource: "from-file", models: ["file-model"], scope: COGNITIVE_SERVICES_SCOPE }),
      );

      const config = loadFoundryConfig({
        cwd: homeDir,
        homeDir,
        env: {
          PI_CODING_AGENT_DIR: agentDir,
          AZURE_FOUNDRY_RESOURCE: "from-env",
          AZURE_FOUNDRY_MODELS: "env-model-a,env-model-b",
        },
      });

      expect(config.endpoint).toBe("https://from-env.openai.azure.com/openai/v1/");
      expect(config.models.map((model) => model.id)).toEqual(["env-model-a", "env-model-b"]);
      expect(config.scope).toBe(COGNITIVE_SERVICES_SCOPE);
      expect(config.models[0]?.contextWindow).toBe(128_000);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("refuses secret-shaped config fields", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "pi-foundry-home-"));
    try {
      const agentDir = join(homeDir, ".pi", "agent");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "azure-foundry.json"), JSON.stringify({ apiKey: "must-not-be-here" }));
      expect(() => loadFoundryConfig({ cwd: homeDir, homeDir, env: { PI_CODING_AGENT_DIR: agentDir } })).toThrow(
        /secret field/iu,
      );
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("validates the scope allowlist", () => {
    expect(validateScope(DEFAULT_SCOPE)).toBe(DEFAULT_SCOPE);
    expect(() => validateScope("https://attacker.example/.default")).toThrow(/Unsupported/iu);
  });

  it("loads and validates an explicit Entra application client ID", () => {
    const clientId = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
    const config = loadFoundryConfig({
      cwd: "/tmp",
      homeDir: "/tmp/nonexistent-pi-home",
      env: { AZURE_FOUNDRY_CLIENT_ID: clientId },
    });

    expect(config.clientId).toBe(clientId.toLowerCase());
    expect(() => loadFoundryConfig({
      cwd: "/tmp",
      homeDir: "/tmp/nonexistent-pi-home",
      env: { AZURE_FOUNDRY_CLIENT_ID: "not-a-client-id" },
    })).toThrow(/clientId/iu);
  });

  it("uses only non-secret Foundry metadata from Atlas config as a fallback", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "pi-foundry-home-"));
    try {
      const atlasDir = join(homeDir, ".config", "atlas");
      mkdirSync(atlasDir, { recursive: true });
      writeFileSync(join(atlasDir, "config.toml"), [
        "[foundry]",
        'resource = "atlas-resource"',
        'tenant_id = "organizations"',
        'client_id = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"',
        'subscription_id = "11111111-1111-4111-8111-111111111111"',
        'resource_group = "atlas-rg"',
        "auth = \"entra\"",
      ].join("\n"));

      const config = loadFoundryConfig({ cwd: homeDir, homeDir, env: {} });

      expect(config.endpoint).toBe("https://atlas-resource.openai.azure.com/openai/v1/");
      expect(config.tenantId).toBe("organizations");
      expect(config.clientId).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
      expect(config.subscriptionId).toBe("11111111-1111-4111-8111-111111111111");
      expect(config.resourceGroup).toBe("atlas-rg");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("validates ARM deployment coordinates", () => {
    expect(loadFoundryConfig({
      cwd: "/tmp",
      homeDir: "/tmp/nonexistent-pi-home",
      env: {
        AZURE_FOUNDRY_SUBSCRIPTION_ID: "11111111-1111-4111-8111-111111111111",
        AZURE_FOUNDRY_RESOURCE_GROUP: "foundry-rg",
      },
    })).toMatchObject({
      subscriptionId: "11111111-1111-4111-8111-111111111111",
      resourceGroup: "foundry-rg",
    });
    expect(() => loadFoundryConfig({
      cwd: "/tmp",
      homeDir: "/tmp/nonexistent-pi-home",
      env: { AZURE_FOUNDRY_SUBSCRIPTION_ID: "not-a-subscription" },
    })).toThrow(/subscriptionId/iu);
    expect(() => loadFoundryConfig({
      cwd: "/tmp",
      homeDir: "/tmp/nonexistent-pi-home",
      env: { AZURE_FOUNDRY_RESOURCE_GROUP: "unsafe/group" },
    })).toThrow(/resourceGroup/iu);
  });
});
