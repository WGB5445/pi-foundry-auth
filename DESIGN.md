# Design and threat model

## Goal

Provide a pi model provider for Azure AI Foundry deployments through the OpenAI v1-compatible route, with Microsoft Entra ID authentication and no plugin-managed API-key storage.

## Explicit non-goals

- Foundry Agent Service, evaluations, project management, or other management APIs.
- Automatic model catalog discovery at startup.
- Arbitrary shell commands, arbitrary HTTP endpoints, or API-key fallback.
- Storing Azure access tokens, refresh tokens, client secrets, or API keys in pi configuration.

## Runtime flow

1. The extension loads metadata from environment variables or `azure-foundry.json`.
2. It validates the endpoint, token scope, tenant value, optional Entra application client ID, and deployment metadata before registering the provider.
3. The provider registers any manually configured models without making a network request during startup.
4. `/login azure-foundry` either verifies the existing `DefaultAzureCredential` chain or uses Azure Identity's direct `DeviceCodeCredential` flow; successful authentication refreshes the model catalog.
5. `/azure-foundry-models` explicitly refreshes the model catalog using the current credential.
6. pi stores only `pi-foundry-auth:azure-credential` as an OAuth marker in its normal auth storage.
7. Before a model request or catalog request, `@azure/identity` obtains a token for the configured scope.
8. The token is passed in memory to the configured Azure endpoint and pi's built-in OpenAI Responses stream implementation; it is never logged or persisted by this extension.

## Trust boundaries

| Boundary | Decision |
| --- | --- |
| pi auth storage | Contains only a fixed marker; the plugin rejects non-marker OAuth records. |
| Azure Identity | Owns credential selection and token refresh. This plugin does not enable persistent token-cache storage. |
| Azure CLI | Used by `DefaultAzureCredential` when the user has already authenticated with `az login`; the plugin never invokes or parses Azure CLI output. |
| Endpoint | HTTPS and `/openai/v1` are mandatory; Azure host suffixes are required unless an explicit custom-endpoint opt-in is set. |
| Model catalog | Queried only at the configured endpoint over HTTPS with the same Entra bearer token; redirects are rejected, the response is size-limited, and obvious non-chat model families are excluded. |
| Model metadata | Deployment IDs are length-limited and reject CR/LF; request serialization is delegated to pi's OpenAI implementation. |
| Diagnostics | Credential and downstream error messages are redacted for Bearer/JWT-shaped values. |

## Threats considered

- **Credential exfiltration through project config:** secret-shaped fields are rejected; endpoint hosts are constrained by default.
- **Shell injection through tenant or CLI configuration:** the extension does not invoke a shell or build a CLI command for interactive login.
- **SSRF/token forwarding:** arbitrary hosts require an explicit opt-in; standard configurations accept only Azure Foundry/Azure OpenAI suffixes.
- **Catalog token forwarding:** model discovery uses the configured endpoint only, rejects HTTP redirects, and never includes response bodies in errors.
- **Token leakage through auth.json:** only a constant marker is returned from the pi OAuth adapter.
- **Token leakage through errors:** provider credential errors and downstream stream error messages are redacted before reaching pi.
- **Cross-tenant/client credential reuse:** cached credential instances are keyed by tenant, client ID, and scope; direct device-code credentials are retained only by the current provider instance.
- **Stale or incorrect model assumptions:** the data-plane catalog is refreshed after authentication or on demand; explicit model metadata remains available for deployment-specific capabilities and pricing.

## Verification gates

- `pnpm typecheck`
- `pnpm test` with fake credentials and mocked streams only
- `pnpm audit --prod --audit-level high`
- `pnpm pack --dry-run`
- pi CLI smoke test using an isolated config directory and a fake model; no Azure request

## Release checklist

- Review dependency updates and run the full check suite.
- Confirm no credentials, private endpoints, or tenant-specific data are committed.
- Review GitHub Actions permissions and branch protection.
- Confirm the intended version, package contents, registry, and npm account before publishing.
- Keep npm authentication outside the repository; the post-bootstrap workflow uses GitHub OIDC and no npm token.
- The manual publish workflow re-runs checks and grants only `id-token: write` for the npm Trusted Publisher exchange.
- Create a tagged release only after a real Azure tenant/model smoke test is performed by the maintainer.
