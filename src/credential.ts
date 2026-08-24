import { DefaultAzureCredential, type TokenCredential } from "@azure/identity";

import type { FoundryConfig } from "./config.js";
import { redactSecrets } from "./redaction.js";

export interface TokenProvider {
  getToken(signal?: AbortSignal): Promise<string>;
}

export type CredentialFactory = (config: FoundryConfig) => TokenCredential;

const defaultCredentialFactory: CredentialFactory = (config) =>
  new DefaultAzureCredential(config.tenantId ? { tenantId: config.tenantId } : {});

let cachedCredential: { factory: CredentialFactory; configKey: string; credential: TokenCredential } | undefined;

export function createTokenProvider(config: FoundryConfig, factory: CredentialFactory = defaultCredentialFactory): TokenProvider {
  return {
    async getToken(signal) {
      if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");

      const configKey = `${config.tenantId ?? ""}\u0000${config.scope}`;
      if (!cachedCredential || cachedCredential.factory !== factory || cachedCredential.configKey !== configKey) {
        cachedCredential = { factory, configKey, credential: factory(config) };
      }

      try {
        const accessToken = await cachedCredential.credential.getToken(
          config.scope,
          signal ? { abortSignal: signal } : undefined,
        );
        if (!accessToken?.token) throw new Error("Azure credential returned no access token");
        return accessToken.token;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Azure Entra authentication failed: ${redactSecrets(message)}`);
      }
    },
  };
}

export function resetCredentialCache(): void {
  cachedCredential = undefined;
}

export function markerExpiresAt(now = Date.now()): number {
  return now + 4 * 60 * 1000;
}
