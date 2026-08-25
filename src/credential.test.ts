import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SCOPE, type FoundryConfig } from "./config.js";
import { createTokenProvider, resetCredentialCache } from "./credential.js";

const config: FoundryConfig = {
  models: [],
  scope: DEFAULT_SCOPE,
  allowCustomEndpoint: false,
  clientId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
};
const FAKE_JWT = [
  ["e", "y", "Jaaaaaaaaaaaa"].join(""),
  ["e", "y", "Jbbbbbbbbbbbbb"].join(""),
  ["e", "y", "Jccccccccccccc"].join(""),
].join(".");

describe("token provider", () => {
  it("requests the configured scope and returns the token only to the caller", async () => {
    resetCredentialCache();
    const getToken = vi.fn(async (scope: string, options?: { abortSignal?: AbortSignal }) => {
      expect(scope).toBe(DEFAULT_SCOPE);
      expect(options).toBeUndefined();
      return { token: "secret-token", expiresOnTimestamp: Date.now() + 60_000 };
    });
    const provider = createTokenProvider(config, () => ({ getToken }));

    await expect(provider.getToken()).resolves.toBe("secret-token");
    expect(getToken).toHaveBeenCalledOnce();
  });

  it("redacts bearer/JWT-shaped data in credential errors", async () => {
    resetCredentialCache();
    const provider = createTokenProvider(config, () => ({
      getToken: async () => {
        throw new Error(`Bearer ${FAKE_JWT}`);
      },
    }));

    await expect(provider.getToken()).rejects.toThrow("Bearer [redacted]");
    await expect(provider.getToken()).rejects.not.toThrow(FAKE_JWT);
  });

  it("does not call the credential after cancellation", async () => {
    resetCredentialCache();
    const getToken = vi.fn();
    const provider = createTokenProvider(config, () => ({ getToken }));
    const controller = new AbortController();
    controller.abort();

    await expect(provider.getToken(controller.signal)).rejects.toThrow(/aborted/iu);
    expect(getToken).not.toHaveBeenCalled();
  });

  it("passes the device code directly to the login callback and keeps the credential in memory", async () => {
    resetCredentialCache();
    const getToken = vi.fn(async () => ({ token: "device-token", expiresOnTimestamp: Date.now() + 60_000 }));
    const deviceCodes: Array<{ userCode: string; verificationUri: string }> = [];
    const provider = createTokenProvider(
      config,
      () => ({ getToken: vi.fn() }),
      (deviceConfig, callbacks) => {
        expect(deviceConfig.clientId).toBe(config.clientId);
        callbacks.onDeviceCode({
          userCode: "ABCD-EFGH",
          verificationUri: "https://microsoft.com/devicelogin",
        });
        return { getToken };
      },
    );

    await provider.loginWithDeviceCode?.({ onDeviceCode: (info) => deviceCodes.push(info) });
    await expect(provider.getToken()).resolves.toBe("device-token");
    expect(deviceCodes).toEqual([
      { userCode: "ABCD-EFGH", verificationUri: "https://microsoft.com/devicelogin" },
    ]);
    expect(getToken).toHaveBeenCalledTimes(2);
  });
});
