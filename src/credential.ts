import { DefaultAzureCredential, DeviceCodeCredential, type TokenCredential } from "@azure/identity";

import { ALLOWED_SCOPES, MANAGEMENT_SCOPE, type FoundryConfig } from "./config.js";
import { redactSecrets } from "./redaction.js";

export type CredentialFactory = (config: FoundryConfig) => TokenCredential;

export interface DeviceCodeLoginCallbacks {
  onDeviceCode: (params: {
    userCode: string;
    verificationUri: string;
    expiresInSeconds?: number;
  }) => void;
  onProgress?: (message: string) => void;
}

export type DeviceCodeCredentialFactory = (
  config: FoundryConfig,
  callbacks: DeviceCodeLoginCallbacks,
) => TokenCredential;

const defaultDeviceCodeCredentialFactory: DeviceCodeCredentialFactory = (config, callbacks) =>
  new DeviceCodeCredential({
    ...(config.tenantId ? { tenantId: config.tenantId } : {}),
    ...(config.clientId ? { clientId: config.clientId } : {}),
    userPromptCallback: ({ userCode, verificationUri }) => callbacks.onDeviceCode({ userCode, verificationUri }),
  });

export interface TokenProvider {
  getToken(signal?: AbortSignal): Promise<string>;
  getTokenForScope?(scope: string, signal?: AbortSignal): Promise<string>;
  loginWithDeviceCode?(callbacks: DeviceCodeLoginCallbacks, signal?: AbortSignal): Promise<void>;
}

const defaultCredentialFactory: CredentialFactory = (config) =>
  new DefaultAzureCredential(config.tenantId ? { tenantId: config.tenantId } : {});

let cachedCredential: { factory: CredentialFactory; configKey: string; credential: TokenCredential } | undefined;

export function createTokenProvider(
  config: FoundryConfig,
  factory: CredentialFactory = defaultCredentialFactory,
  deviceCodeFactory: DeviceCodeCredentialFactory = defaultDeviceCodeCredentialFactory,
): TokenProvider {
  let deviceCodeCredential: { configKey: string; credential: TokenCredential } | undefined;

  const configKey = () => `${config.tenantId ?? ""}\u0000${config.clientId ?? ""}\u0000${config.scope}`;
  const defaultCredential = (key: string) => {
    if (!cachedCredential || cachedCredential.factory !== factory || cachedCredential.configKey !== key) {
      cachedCredential = { factory, configKey: key, credential: factory(config) };
    }
    return cachedCredential.credential;
  };

  const requestToken = async (credential: TokenCredential, scope: string, signal?: AbortSignal): Promise<string> => {
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");

    try {
      const accessToken = await credential.getToken(
        scope,
        signal ? { abortSignal: signal } : undefined,
      );
      if (!accessToken?.token) throw new Error("Azure credential returned no access token");
      return accessToken.token;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Azure Entra authentication failed: ${redactSecrets(message)}`);
    }
  };

  return {
    async getToken(signal) {
      const key = configKey();
      const credential = deviceCodeCredential?.configKey === key
        ? deviceCodeCredential.credential
        : defaultCredential(key);
      return requestToken(credential, config.scope, signal);
    },

    async getTokenForScope(scope, signal) {
      if (!scope.trim()) throw new Error("Azure token scope must not be empty");
      if (scope !== MANAGEMENT_SCOPE && !ALLOWED_SCOPES.has(scope)) {
        throw new Error(`Unsupported Azure token scope: ${scope}`);
      }
      const key = configKey();
      const credential = deviceCodeCredential?.configKey === key
        ? deviceCodeCredential.credential
        : defaultCredential(key);
      return requestToken(credential, scope, signal);
    },

    async loginWithDeviceCode(callbacks, signal) {
      callbacks.onProgress?.("Waiting for Microsoft Entra device-code sign-in");
      const credential = deviceCodeFactory(config, callbacks);
      // Keep the interactive credential in memory only. It is never copied
      // into pi auth storage or written to disk by this plugin.
      await requestToken(credential, config.scope, signal);
      deviceCodeCredential = { configKey: configKey(), credential };
    },
  };
}

export function resetCredentialCache(): void {
  cachedCredential = undefined;
}

export function markerExpiresAt(now = Date.now()): number {
  return now + 4 * 60 * 1000;
}
