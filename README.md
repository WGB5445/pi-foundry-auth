# pi Foundry Auth

Security-first Microsoft Entra ID authentication provider for [pi](https://pi.dev/) and Azure AI Foundry.

The npm package is named `pi-foundry-auth` and is configured as a public package. Publishing is intentionally a manual step so a maintainer can review the exact version and tarball first.

This package adds an `azure-foundry` provider that uses the Azure OpenAI-compatible `/openai/v1/` route and Microsoft Entra ID. It is intended for Foundry model deployments that are usable through that route. It does not implement Foundry Agent Service, evaluations, or management APIs.

## Security model

- Microsoft Entra ID only; this extension does not accept or persist Azure API keys.
- Access tokens are acquired through `@azure/identity`, used in memory for requests, and never written to pi's `auth.json`, printed, or included in diagnostics by this plugin. Any persistence belongs to the selected credential provider (for example, Azure CLI), not this plugin.
- `/login azure-foundry` stores only a non-secret marker so pi can manage the provider. `/logout azure-foundry` removes that marker.
- The default credential chain is used: environment/workload identity, managed identity, Azure CLI, Azure Developer CLI, and other supported local developer credentials.
- The optional Azure CLI login uses fixed arguments and `shell: false`; no user-provided shell command is executed.
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

Project-local `.pi/azure-foundry.json` overrides the global file. The following environment variables override file values:

| Variable | Purpose |
| --- | --- |
| `AZURE_FOUNDRY_RESOURCE` | Azure resource name; used to build the standard endpoint |
| `AZURE_FOUNDRY_ENDPOINT` | Full `https://.../openai/v1/` endpoint |
| `AZURE_FOUNDRY_MODELS` | Comma-separated deployment IDs |
| `AZURE_FOUNDRY_TENANT_ID` | Optional tenant restriction |
| `AZURE_FOUNDRY_SCOPE` | Token scope; defaults to `https://ai.azure.com/.default` |
| `AZURE_FOUNDRY_CONFIG` | Explicit metadata config path |

The only accepted scopes are `https://ai.azure.com/.default` and `https://cognitiveservices.azure.com/.default`.

## Sign in

Start pi with the extension, then use:

```text
/login azure-foundry
```

Choose “Use an existing Azure credential” if you have already authenticated with Azure CLI, Azure Developer CLI, VS Code, environment credentials, or managed identity. Choose “Sign in with Azure CLI device code” when you want the plugin to run a fixed `az login --use-device-code` flow. The Azure CLI must be installed for that option.

The plugin verifies that it can request the configured Entra scope. The access token itself remains owned by the Azure identity library and is not copied into pi storage.

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

- Model discovery is intentionally not automatic; model IDs are deployment-specific and are configured explicitly.
- The plugin targets Foundry's OpenAI v1-compatible model route, not the Foundry Agent Service project API.
- Azure CLI device login relies on the Azure CLI's own token cache; the plugin does not manage or export that cache.

## License

MIT. See [LICENSE](./LICENSE).
