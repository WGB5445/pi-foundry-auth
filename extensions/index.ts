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
import { canDiscoverFoundryDeployments, discoverFoundryDeployments, discoverFoundryModels, mergeFoundryModels } from "../src/discovery.js";
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
  const configuredModels = config.models;
  const useArmDiscovery = (): boolean => canDiscoverFoundryDeployments(config);
  let discoverySource: "arm" | "catalog" | undefined;
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
    const useArm = useArmDiscovery();
    const discovery = useArm
      ? discoverFoundryDeployments
      : discoverFoundryModels;
    discoveryInFlight = discovery(config, tokenProvider, { ...(signal ? { signal } : {}) })
      .then((discovered) => {
        const models = mergeFoundryModels(configuredModels, discovered);
        discoverySource = useArm ? "arm" : "catalog";
        config = { ...config, models };
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        callbacks.onProgress?.(`Model discovery was unavailable: ${message}`);
        if (config.models.length === 0) {
          throw new Error(
            useArmDiscovery()
              ? "Azure ARM deployment discovery failed; check subscription/resource-group permissions or retry /azure-foundry-models"
              : "Azure Foundry catalog discovery failed; configure ARM coordinates or retry /azure-foundry-models",
          );
        }
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
        const source = discoverySource === "arm" ? "deployed" : "catalog";
        ctx.ui.notify(`Discovered ${models.length} ${source} Azure Foundry model${models.length === 1 ? "" : "s"}; use /model to select`, "info");
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
        ctx.ui.notify("Azure Foundry endpoint is not configured; set AZURE_FOUNDRY_ENDPOINT or AZURE_FOUNDRY_RESOURCE", "warning");
        return;
      }
      if (config.models.length === 0) {
        ctx.ui.notify(`Endpoint configured, but no models are loaded: ${configSummary(config)}; run /azure-foundry-models`, "warning");
        return;
      }
      try {
        await tokenProvider.getToken();
        const source = discoverySource === "arm" ? "ARM deployment list" : discoverySource === "catalog" ? "data-plane catalog" : "manual configuration";
        ctx.ui.notify(`Azure Foundry is ready: ${configSummary(config)}; source: ${source}; token not displayed or stored`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Azure Entra credential unavailable: ${message}`, "error");
      }
    },
  });
}
