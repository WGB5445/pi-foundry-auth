import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai/compat";

import { runAzureCliLogin } from "./azure-cli.js";
import type { FoundryConfig } from "./config.js";
import { LOGIN_MARKER } from "./config.js";
import { markerExpiresAt, type TokenProvider } from "./credential.js";

const LOGIN_METHODS = [
  { id: "existing", label: "Use an existing Azure credential" },
  { id: "cli", label: "Sign in with Azure CLI device code" },
];

export function createLoginMarker(now = Date.now()): OAuthCredentials {
  return {
    refresh: LOGIN_MARKER,
    access: LOGIN_MARKER,
    expires: markerExpiresAt(now),
  };
}

export function isLoginMarker(credentials: OAuthCredentials): boolean {
  return credentials.refresh === LOGIN_MARKER && credentials.access === LOGIN_MARKER;
}

export interface LoginDependencies {
  tokenProvider: TokenProvider;
  runCliLogin?: typeof runAzureCliLogin;
}

async function verifyCredential(callbacks: OAuthLoginCallbacks, tokenProvider: TokenProvider): Promise<void> {
  callbacks.onProgress?.("Checking Microsoft Entra credentials");
  await tokenProvider.getToken();
  callbacks.onProgress?.("Microsoft Entra credential verified; no access token was stored by the plugin");
}

export function createAzureFoundryOAuth(config: FoundryConfig, dependencies: LoginDependencies) {
  return {
    name: "Azure AI Foundry (Microsoft Entra ID)",

    async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
      const method = await callbacks.onSelect({ message: "Azure Foundry sign-in method:", options: LOGIN_METHODS });
      if (!method) throw new Error("Azure Foundry login cancelled");

      if (method === "cli") {
        const cliCallbacks = {
          onDeviceCode: callbacks.onDeviceCode,
          ...(callbacks.onProgress ? { onProgress: callbacks.onProgress } : {}),
        };
        await (dependencies.runCliLogin ?? runAzureCliLogin)(config.tenantId, {
          ...cliCallbacks,
        });
      }

      await verifyCredential(callbacks, dependencies.tokenProvider);
      return createLoginMarker();
    },

    async refreshToken(credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials> {
      if (!isLoginMarker(credentials)) throw new Error("Invalid Azure Foundry login marker");
      await dependencies.tokenProvider.getToken(signal);
      return createLoginMarker();
    },

    getApiKey(credentials: OAuthCredentials): string {
      if (!isLoginMarker(credentials)) throw new Error("Invalid Azure Foundry login marker");
      return LOGIN_MARKER;
    },
  };
}
