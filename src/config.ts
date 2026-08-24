import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const DEFAULT_SCOPE = "https://ai.azure.com/.default";
export const COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default";
export const ALLOWED_SCOPES = new Set([DEFAULT_SCOPE, COGNITIVE_SERVICES_SCOPE]);

export const DEFAULT_PROVIDER_ID = "azure-foundry";
export const LOGIN_MARKER = "pi-foundry-auth:azure-credential";

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

export type FoundryInput = "text" | "image";

export interface FoundryCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface FoundryModelConfig {
  id: string;
  name: string;
  reasoning: boolean;
  input: FoundryInput[];
  cost: FoundryCost;
  contextWindow: number;
  maxTokens: number;
}

export interface FoundryConfig {
  endpoint?: string;
  models: FoundryModelConfig[];
  tenantId?: string;
  scope: string;
  allowCustomEndpoint: boolean;
}

interface RawModelConfig {
  id?: unknown;
  name?: unknown;
  reasoning?: unknown;
  input?: unknown;
  cost?: unknown;
  contextWindow?: unknown;
  maxTokens?: unknown;
}

interface RawConfig {
  endpoint?: unknown;
  resource?: unknown;
  models?: unknown;
  tenantId?: unknown;
  scope?: unknown;
  allowCustomEndpoint?: unknown;
}

export interface ConfigLoadOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function readBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

function readNumber(value: unknown, field: string, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative number`);
  }
  return value;
}

function readRawConfig(filePath: string): RawConfig {
  if (!existsSync(filePath)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    throw new Error(`Could not parse Azure Foundry config: ${filePath}`);
  }
  if (!isRecord(parsed)) throw new Error(`Azure Foundry config must be a JSON object: ${filePath}`);

  const forbidden = ["apiKey", "clientSecret", "accessToken", "refreshToken", "token"];
  const foundForbidden = forbidden.find((key) => key in parsed);
  if (foundForbidden) {
    throw new Error(`Refusing Azure Foundry config containing secret field: ${foundForbidden}`);
  }

  return parsed as RawConfig;
}

function mergeRawConfig(base: RawConfig, override: RawConfig): RawConfig {
  const merged: RawConfig = { ...base, ...override };
  if (base.models !== undefined && override.models === undefined) merged.models = base.models;
  return merged;
}

function parseModels(value: unknown): FoundryModelConfig[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("models must be an array");

  return value.map((rawModel, index) => {
    if (typeof rawModel === "string") {
      return normalizeModel({ id: rawModel }, `models[${index}]`);
    }
    if (!isRecord(rawModel)) throw new Error(`models[${index}] must be a string or object`);
    return normalizeModel(rawModel as RawModelConfig, `models[${index}]`);
  });
}

function normalizeModel(raw: RawModelConfig, field: string): FoundryModelConfig {
  const id = readString(raw.id, `${field}.id`);
  if (!id) throw new Error(`${field}.id is required`);
  if (id.length > 128 || /[\r\n]/u.test(id)) throw new Error(`${field}.id contains invalid characters`);

  const name = readString(raw.name, `${field}.name`) ?? id;
  const reasoning = readBoolean(raw.reasoning, `${field}.reasoning`) ?? false;
  const inputValue = raw.input ?? ["text"];
  if (!Array.isArray(inputValue) || inputValue.length === 0 || inputValue.some((item) => item !== "text" && item !== "image")) {
    throw new Error(`${field}.input must contain only text and/or image`);
  }
  const input = [...new Set(inputValue)] as FoundryInput[];

  const rawCost = raw.cost === undefined ? {} : raw.cost;
  if (!isRecord(rawCost)) throw new Error(`${field}.cost must be an object`);
  const cost: FoundryCost = {
    input: readNumber(rawCost.input, `${field}.cost.input`, 0),
    output: readNumber(rawCost.output, `${field}.cost.output`, 0),
    cacheRead: readNumber(rawCost.cacheRead, `${field}.cost.cacheRead`, 0),
    cacheWrite: readNumber(rawCost.cacheWrite, `${field}.cost.cacheWrite`, 0),
  };

  return {
    id,
    name,
    reasoning,
    input,
    cost,
    contextWindow: readNumber(raw.contextWindow, `${field}.contextWindow`, DEFAULT_CONTEXT_WINDOW),
    maxTokens: readNumber(raw.maxTokens, `${field}.maxTokens`, DEFAULT_MAX_TOKENS),
  };
}

function parseEnvModels(value: string | undefined): FoundryModelConfig[] | undefined {
  if (!value?.trim()) return undefined;
  return parseModels(value.split(",").map((id) => id.trim()).filter(Boolean));
}

function validateTenantId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length > 256 || /[\s\r\n]/u.test(value)) throw new Error("tenantId contains invalid characters");
  return value;
}

export function validateScope(scope: string): string {
  if (!ALLOWED_SCOPES.has(scope)) {
    throw new Error(`Unsupported Azure token scope: ${scope}`);
  }
  return scope;
}

export function normalizeEndpoint(endpoint: string, allowCustomEndpoint = false): string {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("Azure Foundry endpoint must be a valid URL");
  }

  if (parsed.protocol !== "https:") throw new Error("Azure Foundry endpoint must use HTTPS");
  if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    throw new Error("Azure Foundry endpoint cannot contain credentials, a port, query, or fragment");
  }
  if (!parsed.hostname || parsed.hostname.endsWith(".")) throw new Error("Azure Foundry endpoint has an invalid hostname");

  const hostname = parsed.hostname.toLowerCase();
  const isAzureFoundryHost = hostname.endsWith(".openai.azure.com") || hostname.endsWith(".services.ai.azure.com");
  if (!isAzureFoundryHost && !allowCustomEndpoint) {
    throw new Error("Azure Foundry endpoint host is not an approved Azure host");
  }

  const pathname = parsed.pathname.replace(/\/+$/u, "");
  if (pathname !== "/openai/v1") {
    throw new Error("Azure Foundry endpoint path must be /openai/v1");
  }

  return `${parsed.origin}${pathname}/`;
}

function resourceEndpoint(resource: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(resource)) {
    throw new Error("Azure resource name contains invalid characters");
  }
  return `https://${resource}.openai.azure.com/openai/v1/`;
}

function envOrConfig(env: NodeJS.ProcessEnv, config: RawConfig, envName: string, configKey: keyof RawConfig): unknown {
  return env[envName] ?? config[configKey];
}

export function loadFoundryConfig(options: ConfigLoadOptions = {}): FoundryConfig {
  const env = options.env ?? process.env;
  const cwd = resolve(options.cwd ?? process.cwd());
  const baseDir = env.PI_CODING_AGENT_DIR?.trim() || join(options.homeDir ?? homedir(), ".pi", "agent");

  const explicitConfig = env.AZURE_FOUNDRY_CONFIG?.trim();
  const globalConfigPath = join(baseDir, "azure-foundry.json");
  const projectConfigPath = join(cwd, ".pi", "azure-foundry.json");
  const config = explicitConfig
    ? readRawConfig(resolve(cwd, explicitConfig))
    : mergeRawConfig(readRawConfig(globalConfigPath), readRawConfig(projectConfigPath));

  const allowCustomEndpoint =
    (env.AZURE_FOUNDRY_ALLOW_CUSTOM_ENDPOINT ?? readBoolean(config.allowCustomEndpoint, "allowCustomEndpoint")?.toString()) === "true";
  const endpointValue = readString(envOrConfig(env, config, "AZURE_FOUNDRY_ENDPOINT", "endpoint"), "endpoint");
  const resourceValue = readString(envOrConfig(env, config, "AZURE_FOUNDRY_RESOURCE", "resource"), "resource");
  const endpoint = endpointValue
    ? normalizeEndpoint(endpointValue, allowCustomEndpoint)
    : resourceValue
      ? resourceEndpoint(resourceValue)
      : undefined;
  const models = parseEnvModels(env.AZURE_FOUNDRY_MODELS) ?? parseModels(config.models);
  const tenantId = validateTenantId(readString(envOrConfig(env, config, "AZURE_FOUNDRY_TENANT_ID", "tenantId"), "tenantId"));
  const scope = validateScope(
    readString(envOrConfig(env, config, "AZURE_FOUNDRY_SCOPE", "scope"), "scope") ?? DEFAULT_SCOPE,
  );

  return { ...(endpoint ? { endpoint } : {}), models, ...(tenantId ? { tenantId } : {}), scope, allowCustomEndpoint };
}

export function configSummary(config: FoundryConfig): string {
  const endpoint = config.endpoint ?? "not configured";
  return `${endpoint} (${config.models.length} configured model${config.models.length === 1 ? "" : "s"})`;
}
