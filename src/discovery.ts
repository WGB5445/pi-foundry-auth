import type { FoundryConfig, FoundryModelConfig } from "./config.js";
import type { TokenProvider } from "./credential.js";
import { redactSecrets } from "./redaction.js";

const MAX_MODEL_RESPONSE_CHARS = 1_000_000;
const DISCOVERY_TIMEOUT_MS = 10_000;
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

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.isFinite(Number(contentLength)) && Number(contentLength) > MAX_MODEL_RESPONSE_CHARS) {
      throw new Error("model catalog response is too large");
    }
    const body = await response.text();
    if (body.length > MAX_MODEL_RESPONSE_CHARS) throw new Error("model catalog response is too large");

    let payload: unknown;
    try {
      payload = JSON.parse(body) as unknown;
    } catch {
      throw new Error("model catalog response was not valid JSON");
    }
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
