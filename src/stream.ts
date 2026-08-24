import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  openAIResponsesApi,
  type SimpleStreamOptions,
  type Model,
} from "@earendil-works/pi-ai/compat";

import type { FoundryConfig } from "./config.js";
import { redactSecrets } from "./redaction.js";
import type { TokenProvider } from "./credential.js";

export type ResponsesApi = ReturnType<typeof openAIResponsesApi>;

function emptyUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function errorMessage(model: Model<any>, message: string, aborted: boolean): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: aborted ? "aborted" : "error",
    ...(aborted ? {} : { errorMessage: redactSecrets(message) }),
    timestamp: Date.now(),
  };
}

export function streamAzureFoundry(
  model: Model<any>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  config: FoundryConfig,
  tokenProvider: TokenProvider,
  responsesApi: ResponsesApi = openAIResponsesApi(),
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  void (async () => {
    try {
      if (!config.endpoint) throw new Error("Azure Foundry endpoint is not configured");
      if (options?.signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");

      const token = await tokenProvider.getToken(options?.signal);
      if (!token) throw new Error("Azure Entra credential returned no token");

      const innerModel = {
        ...model,
        api: "openai-responses" as const,
        baseUrl: config.endpoint,
      } as Model<"openai-responses">;
      const innerStream = responsesApi.streamSimple(innerModel, context, {
        ...options,
        apiKey: token,
      });

      for await (const event of innerStream) {
        if (event.type === "error") {
          stream.push({
            ...event,
            error: {
              ...event.error,
              ...(event.error.errorMessage ? { errorMessage: redactSecrets(event.error.errorMessage) } : {}),
            },
          });
        } else {
          stream.push(event);
        }
      }
      stream.end();
    } catch (error) {
      const aborted = options?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError");
      const message = error instanceof Error ? error.message : String(error);
      stream.push({
        type: "error",
        reason: aborted ? "aborted" : "error",
        error: errorMessage(model, message, Boolean(aborted)),
      });
      stream.end();
    }
  })();

  return stream;
}
