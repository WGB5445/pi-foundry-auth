# Security Policy

## Supported versions

Security fixes target the latest version on the default branch. Published versions should be upgraded promptly when a security fix is announced.

## Reporting a vulnerability

Please do not open a public issue for a credential, token, endpoint-validation, or command-execution vulnerability. Use GitHub's private vulnerability reporting for the repository after it is created, or contact the repository owner privately.

Include:

- the affected commit or version;
- a minimal reproduction that contains no real credentials;
- the security impact; and
- any suggested mitigation.

Never include access tokens, refresh tokens, API keys, tenant secrets, or private endpoint details in a report.

## Security guarantees and non-goals

- The extension does not persist bearer tokens or API keys.
- The plugin does not invoke Azure CLI for interactive login or parse its output; existing Azure CLI credentials are consumed through `DefaultAzureCredential`.
- Direct device-code login accepts an optional organization-owned Entra application `clientId` and tenant restriction; no client secret is accepted.
- The plugin does not enable Azure Identity's persistent token-cache provider, so the direct-login credential and its token cache remain process-local.
- Deployment verification uses a read-only ARM GET with a separate management-scope token and never sends a model inference request.
- Data-plane catalog fallback sends its bearer token only to the validated configured endpoint, rejects redirects, limits response size, and does not expose catalog response bodies in errors.
- Network endpoints are restricted to HTTPS Azure hosts unless an explicit custom-endpoint opt-in is set.
- pi extensions have the same process permissions as pi itself. Only load this extension from a source you trust.
