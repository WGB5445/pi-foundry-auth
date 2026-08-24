import { spawn } from "node:child_process";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

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

export function parseDeviceCodeOutput(output: string): ParsedDeviceCode | undefined {
  const verificationUri = output.match(/https:\/\/microsoft\.com\/devicelogin/iu)?.[0];
  if (!verificationUri) return undefined;

  const afterUri = output.slice(output.indexOf(verificationUri) + verificationUri.length);
  const userCode = afterUri.match(/\bcode\s+([A-Z0-9]{4,}(?:-[A-Z0-9]{3,})*)\b/iu)?.[1];
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
