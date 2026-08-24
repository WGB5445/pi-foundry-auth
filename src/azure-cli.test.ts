import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildAzureCliLoginArgs, parseDeviceCodeOutput, runAzureCliLogin } from "./azure-cli.js";

describe("Azure CLI login helpers", () => {
  it("builds fixed non-shell arguments", () => {
    expect(buildAzureCliLoginArgs("tenant.example")).toEqual([
      "login",
      "--use-device-code",
      "--output",
      "none",
      "--tenant",
      "tenant.example",
    ]);
    expect(buildAzureCliLoginArgs()).toEqual(["login", "--use-device-code", "--output", "none"]);
  });

  it("extracts only the device code and verification URL", () => {
    expect(
      parseDeviceCodeOutput(
        "To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code ABCD-EFGH to authenticate.",
      ),
    ).toEqual({ userCode: "ABCD-EFGH", verificationUri: "https://microsoft.com/devicelogin" });
    expect(
      parseDeviceCodeOutput(
        "\u001b[36mTo sign in, open the page\u001b[0m\nhttps://microsoft.com/devicelogin\n\u001b[33mEnter the code: ABCD-EFGH\u001b[0m",
      ),
    ).toEqual({ userCode: "ABCD-EFGH", verificationUri: "https://microsoft.com/devicelogin" });
    expect(
      parseDeviceCodeOutput("Enter the code ABCD-EFGH, then open https://microsoft.com/devicelogin"),
    ).toEqual({ userCode: "ABCD-EFGH", verificationUri: "https://microsoft.com/devicelogin" });
    expect(
      parseDeviceCodeOutput("To sign in, open https://aka.ms/devicelogin and enter the code ABCD-EFGH"),
    ).toEqual({ userCode: "ABCD-EFGH", verificationUri: "https://aka.ms/devicelogin" });
    expect(parseDeviceCodeOutput("Azure CLI did not print a device code")).toBeUndefined();
  });

  it("parses device-code output from the fixed child-process flow without exposing raw output", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-foundry-cli-"));
    const executable = join(directory, "fake-az");
    const progress: string[] = [];
    const deviceCodes: string[] = [];
    try {
      writeFileSync(
        executable,
        "#!/bin/sh\ntest \"$AZURE_CORE_ONLY_SHOW_ERRORS\" = \"false\"\ntest \"$AZURE_CORE_NO_COLOR\" = \"true\"\nprintf '%s\\n' 'To sign in, open https://microsoft.com/devicelogin and enter the code ABCD-EFGH'\n",
      );
      chmodSync(executable, 0o700);
      await runAzureCliLogin(
        "tenant.example",
        {
          onProgress: (message) => progress.push(message),
          onDeviceCode: ({ userCode }) => deviceCodes.push(userCode),
        },
        executable,
      );

      expect(deviceCodes).toEqual(["ABCD-EFGH"]);
      expect(progress.every((message) => !message.includes("ABCD-EFGH"))).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
