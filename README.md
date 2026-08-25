# pi Foundry Auth

[![npm version](https://img.shields.io/npm/v/pi-foundry-auth?logo=npm)](https://www.npmjs.com/package/pi-foundry-auth)
[![CI](https://github.com/WGB5445/pi-foundry-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/WGB5445/pi-foundry-auth/actions/workflows/ci.yml)

Security-first [pi](https://pi.dev/) provider plugin for Azure AI Foundry model deployments. It uses Microsoft Entra ID for authentication, routes requests through the OpenAI-compatible API, and never stores Azure API keys or access tokens in pi's auth storage.

The public npm package is [`pi-foundry-auth`](https://www.npmjs.com/package/pi-foundry-auth). Publishing is intentionally a manual step so a maintainer can review the exact version and tarball first.

This package adds an `azure-foundry` provider that uses the Azure OpenAI-compatible `/openai/v1/` route and Microsoft Entra ID. It is intended for Foundry model deployments that are usable through that route. It does not implement Foundry Agent Service, evaluations, or management APIs.

## Security model

- Microsoft Entra ID only; this extension does not accept or persist Azure API keys.
- Access tokens are acquired through `@azure/identity`, used in memory for requests, and never written to pi's `auth.json`, printed, or included in diagnostics by this plugin. Any persistence belongs to the selected credential provider (for example, Azure CLI), not this plugin.
- `/login azure-foundry` stores only a non-secret marker so pi can manage the provider. `/logout azure-foundry` removes that marker.
- The default credential chain is used: environment/workload identity, managed identity, Azure CLI, Azure Developer CLI, and other supported local developer credentials.
- The Pi device-code flow uses `@azure/identity` directly; it never starts Azure CLI or parses terminal output.
- Endpoint validation requires HTTPS and an Azure Foundry/Azure OpenAI hostname by default. Arbitrary endpoints require an explicit opt-in.

## Requirements

- Node.js 22+
- pi 0.84 or later (`@earendil-works/pi-coding-agent`)
- An Azure AI Foundry resource with a model deployment
- An Entra identity with permission to use the resource (for example, the appropriate Cognitive Services/Foundry user role)

## Install from a local checkout

From this repository:

```text
cd /path/to/pi-foundry-auth
pnpm install
pi -e ./extensions
```

To make it available globally while developing, add the extension directory to pi's settings or copy the package into `~/.pi/agent/extensions/`.

## Configure a resource and model

The plugin never needs a secret in its configuration. Configure the endpoint and deployment names with environment variables:

```sh
export AZURE_FOUNDRY_RESOURCE="my-foundry-resource"
export AZURE_FOUNDRY_MODELS="my-gpt-deployment,my-reasoning-deployment"
```

Deployment IDs are the names you assigned in Azure; they are not necessarily the public model names.

You can also use a metadata-only config file at `~/.pi/agent/azure-foundry.json`:

```json
{
  "resource": "my-foundry-resource",
  "tenantId": "00000000-0000-0000-0000-000000000000",
  "clientId": "00000000-0000-4000-8000-000000000000",
  "models": [
    {
      "id": "my-gpt-deployment",
      "name": "My GPT deployment",
      "reasoning": false,
      "input": ["text", "image"],
      "contextWindow": 128000,
      "maxTokens": 16384
    }
  ]
}
```

If this machine already uses Atlas, the plugin also reads only the non-secret `[foundry]` `resource`, `endpoint`, `tenant_id`, and `client_id` fields from Atlas's `config.toml` as a fallback. Plugin environment variables and `~/.pi/agent/azure-foundry.json` always take precedence. It never reads Atlas's token or keychain files.

Project-local `.pi/azure-foundry.json` overrides the global file. The following environment variables override file values:

| Variable | Purpose |
| --- | --- |
| `AZURE_FOUNDRY_RESOURCE` | Azure resource name; used to build the standard endpoint |
| `AZURE_FOUNDRY_ENDPOINT` | Full `https://.../openai/v1/` endpoint |
| `AZURE_FOUNDRY_MODELS` | Optional comma-separated deployment IDs; discovered models are added automatically |
| `AZURE_FOUNDRY_TENANT_ID` | Optional tenant restriction |
| `AZURE_FOUNDRY_CLIENT_ID` | Optional Entra App Registration client ID for direct device-code login |
| `AZURE_FOUNDRY_SCOPE` | Token scope; defaults to `https://ai.azure.com/.default` |
| `AZURE_FOUNDRY_CONFIG` | Explicit metadata config path |

The only accepted scopes are `https://ai.azure.com/.default` and `https://cognitiveservices.azure.com/.default`.

## Sign in

Start pi with the extension, then use:

```text
/login azure-foundry
```

Choose “Use an existing Azure credential” if you have already authenticated with Azure CLI, Azure Developer CLI, VS Code, environment credentials, or managed identity. Choose “Sign in with Microsoft Entra device code” to run Azure Identity's direct device-code flow inside Pi. This flow displays the verification URL and user code through Pi's login dialog; it does not start `az` or parse CLI output.

For enterprise or production use, set `AZURE_FOUNDRY_CLIENT_ID` to an App Registration that your organization controls. The optional `AZURE_FOUNDRY_TENANT_ID` restricts the sign-in authority to the selected tenant. The client ID is an application identifier, not a secret; no client secret is accepted by this plugin. If no client ID is configured, Azure Identity uses its developer sign-on application for convenience, which is not the recommended production setup.

If you prefer Azure CLI's own credential cache, run `az login --use-device-code` in a separate terminal first, then choose “Use an existing Azure credential”. This is the same external-credential pattern used by other Azure Foundry Pi extensions.

The plugin verifies that it can request the configured Entra scope. The access token itself remains owned by the Azure identity library and is not copied into pi storage.

After a successful login, the plugin queries the authenticated Azure AI Foundry data-plane model catalog at `/openai/v1/models` and registers the returned model IDs in Pi. If discovery was unavailable during login, retry it with:

```text
/azure-foundry-models
```

Then use `/model` to select one. Discovery is limited to the configured endpoint and uses the same bearer token as model requests; it does not call ARM management APIs or send credentials to a catalog host.

You can check readiness without displaying a token:

```text
/azure-foundry-status
```

## Endpoint safety

By default, the full endpoint must use HTTPS, have no credentials/port/query/fragment, end in `/openai/v1`, and use one of these host suffixes:

- `.openai.azure.com`
- `.services.ai.azure.com`

For an enterprise gateway or private proxy, you may explicitly opt in with `AZURE_FOUNDRY_ALLOW_CUSTOM_ENDPOINT=true`. The endpoint still must use HTTPS and the exact `/openai/v1` path. Review this setting carefully because it allows the bearer token to be sent to the configured host.

## Development

```sh
pnpm install
pnpm check
pnpm pack:check
pnpm publish:check
```

The test suite uses fake credentials and local/mocked streams; it does not contact Azure and does not require an Azure account.

## Publish to npm

The package uses pnpm for installation, testing, auditing, and package preparation. The final repository-based registry publish uses npm's Trusted Publishing and GitHub OIDC; it is not run automatically on every push.

The one-time bootstrap release is interactive. Authenticate with npm and verify the account:

```sh
npm login
npm whoami
```

Review the package contents and then publish the current version:

```sh
pnpm check
pnpm audit --prod --audit-level high
pnpm publish:check
npm publish --access public
```

The package version must be incremented before each subsequent release. All preparation uses pnpm; the final `npm publish` command is intentional because npm Trusted Publishing authenticates the npm CLI with GitHub OIDC. No npm token is stored in the repository or workflow.

For the first release, publish the package once interactively with npm account 2FA. npm requires the package to exist before a Trusted Publisher can be configured:

```sh
pnpm check
pnpm publish:check
npm publish --access public
```

Then configure npm Trusted Publishing for GitHub Actions with:

- Owner: `WGB5445`
- Repository: `pi-foundry-auth`
- Workflow filename: `publish.yml`
- Environment: `npm-publish`
- Allowed action: `npm publish`

The recommended path is the npm web UI: open the package's **Settings → Trusted publishing** page and create a GitHub Actions publisher with the fields above. The package is already present on npm, so this configuration is now available.

The CLI alternative requires npm CLI 11.15.0 or newer. If `npm trust` prints `Unknown command: "trust"`, your npm CLI is too old; upgrade npm or use the web UI:

```sh
npm --version
npm install --global npm@^11.15.0
npm trust github pi-foundry-auth --repo WGB5445/pi-foundry-auth --file publish.yml --allow-publish
```

After that bootstrap release, manually run the `Publish Package` workflow from the Actions tab. It requests only the GitHub OIDC `id-token: write` permission and has no `NPM_TOKEN` secret. npm generates provenance automatically for trusted publishes.

## References

- [pi custom providers](https://pi.dev/docs/latest/custom-provider)
- [Microsoft Foundry Entra ID authentication](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/configure-entra-id)
- [Microsoft Foundry application integration and endpoint guidance](https://learn.microsoft.com/en-us/azure/foundry/how-to/integrate-with-other-apps)

## Current limitations

- Model discovery uses the Azure AI Foundry data-plane `/openai/v1/models` endpoint. Manual model metadata remains supported for custom names, capabilities, context windows, and costs.
- The plugin targets Foundry's OpenAI v1-compatible model route, not the Foundry Agent Service project API.
- Direct device-code login keeps the Azure Identity credential in memory for the current Pi process; Pi auth storage contains only the non-secret login marker. Existing Azure CLI credentials are read through `DefaultAzureCredential`.
- For direct device-code login, configure an organization-owned `AZURE_FOUNDRY_CLIENT_ID` and, when appropriate, `AZURE_FOUNDRY_TENANT_ID`; the plugin does not persist refresh tokens or enable a persistent token cache.

## License

MIT. See [LICENSE](./LICENSE).
