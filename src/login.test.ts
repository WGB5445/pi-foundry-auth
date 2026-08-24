import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai/compat";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SCOPE, LOGIN_MARKER, type FoundryConfig } from "./config.js";
import { createAzureFoundryOAuth, createLoginMarker, isLoginMarker } from "./login.js";

const config: FoundryConfig = {
  endpoint: "https://resource.openai.azure.com/openai/v1/",
  models: [],
  scope: DEFAULT_SCOPE,
  allowCustomEndpoint: false,
};

function callbacks(selected: string): OAuthLoginCallbacks {
  return {
    onAuth: vi.fn(),
    onDeviceCode: vi.fn(),
    onPrompt: vi.fn(async () => "unused"),
    onSelect: vi.fn(async () => selected),
    onProgress: vi.fn(),
  };
}

describe("Azure Foundry login", () => {
  it("returns only a non-secret marker", () => {
    const marker = createLoginMarker(1000);
    expect(marker).toEqual({ refresh: LOGIN_MARKER, access: LOGIN_MARKER, expires: 241000 });
    expect(isLoginMarker(marker)).toBe(true);
  });

  it("verifies an existing Azure credential without storing its token", async () => {
    const getToken = vi.fn(async () => "eyJ.fake.token");
    const ui = callbacks("existing");
    const oauth = createAzureFoundryOAuth(config, { tokenProvider: { getToken } });

    const credentials = await oauth.login(ui);

    expect(getToken).toHaveBeenCalledOnce();
    expect(credentials.access).toBe(LOGIN_MARKER);
    expect(credentials.refresh).toBe(LOGIN_MARKER);
    expect(credentials.access).not.toContain("eyJ");
  });

  it("uses direct Azure Identity device-code login when selected", async () => {
    const loginWithDeviceCode = vi.fn(async (deviceCallbacks: {
      onDeviceCode: (params: { userCode: string; verificationUri: string }) => void;
    }) => {
      deviceCallbacks.onDeviceCode({
        userCode: "ABCD-EFGH",
        verificationUri: "https://microsoft.com/devicelogin",
      });
    });
    const ui = callbacks("device-code");
    const oauth = createAzureFoundryOAuth(config, {
      tokenProvider: { getToken: vi.fn(async () => "token"), loginWithDeviceCode },
    });

    await oauth.login(ui);

    expect(loginWithDeviceCode).toHaveBeenCalledWith(
      expect.objectContaining({ onDeviceCode: expect.any(Function) }),
      undefined,
    );
  });
});
