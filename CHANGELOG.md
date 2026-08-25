# Changelog

All notable changes to this project will be documented here.

## [0.1.1]

- Replaced fragile Azure CLI device-code output parsing with Azure Identity's direct `DeviceCodeCredential` callback flow; existing credentials still use `DefaultAzureCredential`.
- Added optional tenant-scoped Entra App Registration `clientId` configuration for direct device-code login.
- Added authenticated Azure AI Foundry `/openai/v1/models` discovery after login and the `/azure-foundry-models` refresh command.
- Added Atlas `[foundry]` resource/endpoint metadata fallback and filtering for non-chat catalog entries.

## [Unreleased]

- Renamed the npm package and repository to `pi-foundry-auth`; the pi provider id remains `azure-foundry`.
- Switched dependency installation, checks, auditing, and package preparation to pnpm; the package is now configured for intentional public publication.
- Changed repository publishing to npm Trusted Publishing with GitHub OIDC; no `NPM_TOKEN` is required after the one-time bootstrap release.
- Initial security-first Azure AI Foundry provider extension for pi.
