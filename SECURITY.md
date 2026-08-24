# Security Policy

## Supported versions

Security fixes target the latest version on the default branch. This project is not published yet and should be treated as experimental until a tagged release exists.

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
- Network endpoints are restricted to HTTPS Azure hosts unless an explicit custom-endpoint opt-in is set.
- pi extensions have the same process permissions as pi itself. Only load this extension from a source you trust.
