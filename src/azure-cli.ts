import { spawn } from "node:child_process";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const AZURE_CLI_LOGIN_ENV = {
  // Azure CLI can hide the device-code warning when the user's global
  // `core.only_show_errors` setting is enabled. Override it only for this
  // child process; never mutate the user's Azure CLI configuration.
  AZURE_CORE_ONLY_SHOW_ERRORS: "false",
  // Make parsing deterministic when Azure CLI is attached to a TUI pipe.
  AZURE_CORE_NO_COLOR: "true",
};

export interface AzureCliLoginCallbacks {
  onDeviceCode?: (params: {
    userCode: string;
    verificationUri: string;
    expiresInSeconds?: number;
  }) => void;
  onProgress?: (message: string) => void;
}

export interface ParsedDeviceCode {
  userCode: string;
  verificationUri: string;
}

const ANSI_ESCAPE_SEQUENCE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/gu;

export function parseDeviceCodeOutput(output: string): ParsedDeviceCode | undefined {
  // Azure CLI can color or split this message across stdout/stderr chunks.
  // Normalize presentation-only characters before extracting the public
  // device-login URL and the user-entered code independently.
  const normalized = output.replace(ANSI_ESCAPE_SEQUENCE, "").replace(/\s+/gu, " ");
  const verificationUri = normalized.match(/https:\/\/(?:microsoft\.com|aka\.ms)\/devicelogin\b/iu)?.[0];
  if (!verificationUri) return undefined;

  const userCode = normalized.match(
    /\b(?:enter\s+(?:the\s+)?|device\s+|user\s+)?code\s*[:：]?\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{3,})*)\b/iu,
  )?.[1];
  if (!userCode) return undefined;

  return { userCode, verificationUri };
}

export function buildAzureCliLoginArgs(tenantId?: string): string[] {
  return ["login", "--use-device-code", "--output", "none", ...(tenantId ? ["--tenant", tenantId] : [])];
}

export function runAzureCliLogin(
  tenantId: string | undefined,
  callbacks: AzureCliLoginCallbacks = {},
  executable = "az",
): Promise<void> {
  const args = buildAzureCliLoginArgs(tenantId);
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    let codeShown = false;
    let timeout: NodeJS.Timeout | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };

    let child;
    try {
      child = spawn(executable, args, {
        shell: false,
        windowsHide: true,
        env: { ...process.env, ...AZURE_CLI_LOGIN_ENV },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      finish(new Error("Could not start Azure CLI; install Azure CLI or use an existing Azure credential"));
      return;
    }

    const consume = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.length > 16_384) output = output.slice(-16_384);
      const deviceCode = parseDeviceCodeOutput(output);
      if (deviceCode && !codeShown) {
        codeShown = true;
        callbacks.onDeviceCode?.({ ...deviceCode, expiresInSeconds: 900 });
      } else if (!codeShown) {
        callbacks.onProgress?.("Azure CLI is waiting for Microsoft Entra sign-in");
      }
    };

    child.stdout?.on("data", consume);
    child.stderr?.on("data", consume);
    child.once("error", () => {
      finish(new Error("Could not start Azure CLI; install Azure CLI or use an existing Azure credential"));
    });
    child.once("close", (exitCode) => {
      if (exitCode === 0) finish();
      else finish(new Error("Azure CLI login failed or was cancelled"));
    });

    timeout = setTimeout(() => {
      child.kill();
      finish(new Error("Azure CLI login timed out"));
    }, LOGIN_TIMEOUT_MS);
  });
}
