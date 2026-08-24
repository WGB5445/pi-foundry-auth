# Contributing

Thanks for helping improve pi Azure AI Foundry.

## Before opening a pull request

Run:

```sh
npm install
npm run check
npm run pack:check
```

The tests must remain offline and must not require Azure credentials. Use fake token providers and local/mocked streams for new tests.

## Security-sensitive changes

Changes involving credentials, endpoint validation, Azure CLI process execution, token scopes, or error handling need focused tests. Do not add real credentials to fixtures, snapshots, logs, or documentation. See [SECURITY.md](./SECURITY.md) for reporting guidance.

## Scope

Keep the provider focused on Azure Foundry model calls through the OpenAI v1-compatible route. Larger features such as Foundry Agent Service support should be proposed separately because they have different APIs and permission boundaries.
