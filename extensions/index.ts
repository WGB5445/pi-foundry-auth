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
  const oauth = createAzureFoundryOAuth(config, { tokenProvider });

  pi.registerProvider(DEFAULT_PROVIDER_ID, {
    name: "Azure AI Foundry (Microsoft Entra ID)",
    ...(config.endpoint ? { baseUrl: config.endpoint } : {}),
    apiKey: LOGIN_MARKER,
    api: "azure-foundry-openai",
    models: config.models,
    oauth,
    streamSimple: (model, context, options) => streamAzureFoundry(model, context, options, config, tokenProvider),
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
