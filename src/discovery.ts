import { MANAGEMENT_SCOPE, type FoundryConfig, type FoundryModelConfig } from "./config.js";
import type { TokenProvider } from "./credential.js";
import { redactSecrets } from "./redaction.js";

const MAX_MODEL_RESPONSE_CHARS = 1_000_000;
const DISCOVERY_TIMEOUT_MS = 10_000;
const MAX_ARM_DEPLOYMENT_PAGES = 20;
const NON_CHAT_MODEL_MARKERS = [
  "embedding",
  "embed-",
  "tts",
  "whisper",
  "dall-e",
  "dalle",
  "sora",
  "realtime",
  "audio-",
  "transcribe",
  "moderation",
];

export type FoundryFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ModelDiscoveryOptions {
  fetch?: FoundryFetch;
  signal?: AbortSignal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelFromResponse(value: unknown): FoundryModelConfig | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;

  const id = value.id.trim();
  if (!id || id.length > 128 || /[\r\n]/u.test(id)) return undefined;
  const lowerId = id.toLowerCase();
  if (NON_CHAT_MODEL_MARKERS.some((marker) => lowerId.includes(marker))) return undefined;

  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
  };
}

function modelFromDeployment(value: unknown): FoundryModelConfig | undefined {
  if (!isRecord(value) || typeof value.name !== "string") return undefined;
  const properties = isRecord(value.properties) ? value.properties : {};
  if (typeof properties.provisioningState !== "string" || properties.provisioningState.toLowerCase() !== "succeeded") return undefined;
  const model = isRecord(properties.model) && typeof properties.model.name === "string"
    ? properties.model.name
    : undefined;
  if (model && NON_CHAT_MODEL_MARKERS.some((marker) => model.toLowerCase().includes(marker))) return undefined;
  return modelFromResponse({ id: value.name });
}

async function parseJsonResponse(response: Response, label: string): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number.isFinite(Number(contentLength)) && Number(contentLength) > MAX_MODEL_RESPONSE_CHARS) {
    throw new Error(`${label} response is too large`);
  }
  const body = await response.text();
  if (body.length > MAX_MODEL_RESPONSE_CHARS) throw new Error(`${label} response is too large`);

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`${label} response was not valid JSON`);
  }
}

function requestSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function mergeFoundryModels(
  configured: FoundryModelConfig[],
  discovered: FoundryModelConfig[],
): FoundryModelConfig[] {
  const byId = new Map(configured.map((model) => [model.id, model]));
  for (const model of discovered) {
    if (!byId.has(model.id)) byId.set(model.id, model);
  }
  return [...byId.values()];
}

export async function discoverFoundryModels(
  config: FoundryConfig,
  tokenProvider: TokenProvider,
  options: ModelDiscoveryOptions = {},
): Promise<FoundryModelConfig[]> {
  if (!config.endpoint) {
    throw new Error("Azure Foundry endpoint is not configured; set AZURE_FOUNDRY_ENDPOINT or AZURE_FOUNDRY_RESOURCE");
  }

  const signal = requestSignal(options.signal);
  try {
    const token = await tokenProvider.getToken(signal);
    const fetcher = options.fetch ?? fetch;
    const endpoint = new URL("models", config.endpoint).toString();
    const response = await fetcher(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      redirect: "error",
      signal,
    });

    if (!response.ok) {
      throw new Error(`model catalog request returned HTTP ${response.status}`);
    }

    const payload = await parseJsonResponse(response, "model catalog");
    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      throw new Error("model catalog response did not contain a data array");
    }

    const models = payload.data.map(modelFromResponse).filter((model): model is FoundryModelConfig => model !== undefined);
    if (models.length === 0) throw new Error("model catalog returned no usable models");
    return models;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Azure Foundry model discovery failed: ${redactSecrets(message)}`);
  }
}

function managementAccountName(config: FoundryConfig): string | undefined {
  if (config.resource) return config.resource;
  if (!config.endpoint) return undefined;

  let hostname: string;
  try {
    hostname = new URL(config.endpoint).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (!hostname.endsWith(".openai.azure.com") && !hostname.endsWith(".services.ai.azure.com")) return undefined;
  return hostname.split(".", 1)[0];
}

export function canDiscoverFoundryDeployments(config: FoundryConfig): boolean {
  return Boolean(config.subscriptionId && config.resourceGroup && managementAccountName(config));
}

function nextArmDeploymentPage(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error("ARM deployment response contained an invalid nextLink");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ARM deployment response contained an invalid nextLink");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "management.azure.com" || url.username || url.password) {
    throw new Error("ARM deployment response contained an untrusted nextLink");
  }
  return url.toString();
}

export async function discoverFoundryDeployments(
  config: FoundryConfig,
  tokenProvider: TokenProvider,
  options: ModelDiscoveryOptions = {},
): Promise<FoundryModelConfig[]> {
  const accountName = managementAccountName(config);
  const { subscriptionId, resourceGroup } = config;
  if (!canDiscoverFoundryDeployments(config) || !accountName || !subscriptionId || !resourceGroup) {
    throw new Error("ARM deployment discovery needs subscriptionId, resourceGroup, and an Azure Foundry resource endpoint");
  }
  if (!tokenProvider.getTokenForScope) {
    throw new Error("Azure management credential is unavailable");
  }

  const signal = requestSignal(options.signal);
  try {
    const token = await tokenProvider.getTokenForScope(MANAGEMENT_SCOPE, signal);
    const fetcher = options.fetch ?? fetch;
    let endpoint: string | undefined = [
      "https://management.azure.com/subscriptions",
      encodeURIComponent(subscriptionId),
      "resourceGroups",
      encodeURIComponent(resourceGroup),
      "providers/Microsoft.CognitiveServices/accounts",
      encodeURIComponent(accountName),
      "deployments?api-version=2024-10-01",
    ].join("/");
    const models: FoundryModelConfig[] = [];
    for (let page = 0; endpoint; page += 1) {
      if (page >= MAX_ARM_DEPLOYMENT_PAGES) throw new Error("ARM deployment response contained too many pages");

      const response = await fetcher(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (!response.ok) throw new Error(`ARM deployment request returned HTTP ${response.status}`);

      const payload = await parseJsonResponse(response, "ARM deployment catalog");
      if (!isRecord(payload) || !Array.isArray(payload.value)) {
        throw new Error("ARM deployment response did not contain a value array");
      }

      models.push(...payload.value
        .map(modelFromDeployment)
        .filter((model): model is FoundryModelConfig => model !== undefined));
      endpoint = nextArmDeploymentPage(payload.nextLink);
    }

    if (models.length === 0) throw new Error("ARM deployment catalog returned no succeeded chat deployments");
    return models;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Azure Foundry ARM deployment discovery failed: ${redactSecrets(message)}`);
  }
}
