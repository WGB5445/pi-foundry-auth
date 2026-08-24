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
});
