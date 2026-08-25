import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  DEFAULT_PROVIDER_ID,
  DEFAULT_SCOPE,
  LOGIN_MARKER,
  loadFoundryConfig,
  type FoundryConfig,
  configSummary,
} from "../src/config.js";
import { createTokenProvider } from "../src/credential.js";
import { discoverFoundryModels, mergeFoundryModels } from "../src/discovery.js";
import { createAzureFoundryOAuth } from "../src/login.js";
import { streamAzureFoundry } from "../src/stream.js";

const EMPTY_CONFIG: FoundryConfig = {
  models: [],
  scope: DEFAULT_SCOPE,
  allowCustomEndpoint: false,
};

export default function azureFoundryExtension(pi: ExtensionAPI): void {
  let config = EMPTY_CONFIG;
  let configError: string | undefined;
  try {
    config = loadFoundryConfig();
  } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
    console.error(`[${DEFAULT_PROVIDER_ID}] ${configError}`);
  }

  const tokenProvider = createTokenProvider(config);
  let discoveryInFlight: Promise<FoundryConfig["models"]> | undefined;

  const registerProvider = (models: FoundryConfig["models"]): void => {
    pi.registerProvider(DEFAULT_PROVIDER_ID, {
      name: "Azure AI Foundry (Microsoft Entra ID)",
      ...(config.endpoint ? { baseUrl: config.endpoint } : {}),
      apiKey: LOGIN_MARKER,
      api: "azure-foundry-openai",
      models,
      oauth,
      streamSimple: (model, context, options) => streamAzureFoundry(model, context, options, config, tokenProvider),
    });
  };

  const refreshModels = (signal?: AbortSignal): Promise<FoundryConfig["models"]> => {
    if (discoveryInFlight) return discoveryInFlight;
    discoveryInFlight = discoverFoundryModels(config, tokenProvider, { ...(signal ? { signal } : {}) })
      .then((discovered) => {
        const models = mergeFoundryModels(config.models, discovered);
        registerProvider(models);
        return models;
      })
      .finally(() => {
        discoveryInFlight = undefined;
      });
    return discoveryInFlight;
  };

  const oauth = createAzureFoundryOAuth(config, {
    tokenProvider,
    onAuthenticated: async (callbacks) => {
      try {
        const models = await refreshModels(callbacks.signal);
        callbacks.onProgress?.(`Discovered ${models.length} Azure Foundry model${models.length === 1 ? "" : "s"}`);
      } catch {
        callbacks.onProgress?.("Model discovery was unavailable; use /azure-foundry-models to retry");
      }
    },
  });

  registerProvider(config.models);

  pi.registerCommand("azure-foundry-models", {
    description: "Discover and refresh Azure AI Foundry models",
    handler: async (_args, ctx) => {
      if (configError) {
        ctx.ui.notify(`Azure Foundry configuration error: ${configError}`, "error");
        return;
      }
      try {
        const models = await refreshModels();
        ctx.ui.notify(`Discovered ${models.length} Azure Foundry model${models.length === 1 ? "" : "s"}; use /model to select`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(message, "error");
      }
    },
  });

  pi.registerCommand("azure-foundry-status", {
    description: "Check Azure AI Foundry endpoint configuration and Entra credentials",
    handler: async (_args, ctx) => {
      if (configError) {
        ctx.ui.notify(`Azure Foundry configuration error: ${configError}`, "error");
        return;
      }
      if (!config.endpoint) {
        ctx.ui.notify("Azure Foundry endpoint is not configured", "warning");
        return;
      }
      if (config.models.length === 0) {
        ctx.ui.notify(`Endpoint configured, but no models are configured: ${configSummary(config)}`, "warning");
        return;
      }
      try {
        await tokenProvider.getToken();
        ctx.ui.notify(`Azure Foundry is ready: ${configSummary(config)}; token not displayed or stored`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Azure Entra credential unavailable: ${message}`, "error");
      }
    },
  });
}
