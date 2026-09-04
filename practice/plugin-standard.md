# Harness plugin development standard

English | [中文](plugin-standard.zh.md)

## Summary

This reference defines the plugin package, runtime, UI, persistence, security, testing, and release rules for DeepSeek Harness Desktop v0.1.11.

Use it when you create a plugin for the desktop application, publish a third-party package, or add a plugin to the built-in distribution.

The standard treats a plugin as Cordis code that is mounted by a profile; a library without an `apply` entry point is not a plugin.

The desktop application runs bundled plugins locally, so installation review, dependency pinning, lifecycle cleanup, and failure reporting are part of the plugin contract.

## Table of Contents

- [Choose the package shape](#choose-the-package-shape)
- [Required package structure](#required-package-structure)
- [Implement the runtime](#implement-the-runtime)
- [Add a Web Client face](#add-a-web-client-face)
- [Store user data](#store-user-data)
- [Handle security and lifecycle](#handle-security-and-lifecycle)
- [Test and release](#test-and-release)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Choose the package shape

Choose one shape before writing code because the desktop loader treats each shape differently.

| Shape | Entry point | Installation meaning |
| --- | --- | --- |
| Cordis plugin | `apply(ctx, config)` or a Service subclass | Mounted by a `cordis.yml` row. |
| Bundle | Plugin package plus `dsh.bundle.patch` | Installed into a profile and adds a configuration layer. |
| Library | Plain module API without a plugin entry point | Imported by another package; it has no plugin installation path. |

Every distributable desktop feature package should use the bundle shape when users must enable it through `dsh plugin`.

## Required package structure

Use ESM, publish built files, and keep the package manifest explicit.

```text
my-plugin/
├── package.json
├── src/index.ts
├── lib/index.js
├── lib/types/index.d.ts
└── cordis.patch.yml
```

The manifest must declare `type: module`, `main`, `types`, `files`, a license, and exact peer dependencies for the Harness packages it consumes.

A bundle manifest declares `dsh.bundle.patch` and the patch inserts the plugin package by name; do not insert a developer checkout path into a published patch.

Use `dsh.client` only when the package contributes a browser face, and list its injected client packages and `platform: web` explicitly.

## Implement the runtime

Export a named `apply` function and an optional `name`; use `inject` for every service that must exist before loading.

```ts ignore-check
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(/* defineTool(...) */)
}
```

Register listeners, tools, adapters, and custom resources through `ctx` so Cordis can dispose them during unload and hot replacement.

Use a typed `Config` interface and same-named Schemastery schema; put deployment-varying values such as timeouts, limits, and endpoints in the schema.

Fail at load when self-contained configuration is invalid; do not silently disable a missing dependency or resource.

Use documented extension points such as `session/event`, `agent/request`, `tools/pre-execute`, and `tools/result`; do not modify the agent loop for feature behavior.

## Add a Web Client face

Client code is a separate browser face and must be declared through `dsh.client`; it must not import Node-only modules or secrets.

Render conversation state from logged `session/event` data and send user actions through the public agent or RPC APIs.

Route all visible product text through the locale dictionaries and `t`; do not hardcode user-facing copy in a component.

Keep Host and Client registrations in their owning packages, and use the generated Typert or client bridge types instead of duplicating wire shapes.

## Store user data

Persist settings, plugin state, installed sources, and session-related data through the desktop data services; do not create an untracked JSON database beside the application.

The desktop application keeps its managed records in SQLite and uses the plugin source tree for executable code, manifests, and generated artifacts.

Write durable model-visible input to the session event stream so a replay can reconstruct what the model received.

Treat files, network responses, plugin manifests, and subprocess output as durable or untrusted boundaries and validate them before use.

## Handle security and lifecycle

Third-party plugins execute as trusted local code; review cannot sandbox their file, network, or subprocess access.

Pin GitHub plugin sources to a commit and record the reviewed source; a branch or floating tag is not a reproducible release input.

Use `ctx.effect()` for connections, timers, child processes, and other resources, and await asynchronous cleanup in the disposer.

Do not retain an AgentHandle after the work it owns is idle; release it so another client can manage or delete the completed session.

Never dispose an Agent owned by another lifecycle; remove only the context registrations owned by your plugin.

Return actionable errors, preserve the original cause in logs, and avoid exposing credentials or full untrusted payloads in UI messages.

## Test and release

Add focused unit tests for valid configuration, invalid configuration, registration cleanup, duplicate delivery, failure recovery, and concurrent lifecycle paths.

Run the owning Vitest files, TypeScript check, and built-artifact smoke for every changed face; run the desktop Swift tests when the package is embedded in the app.

Build the plugin before packaging so `lib` matches `src`; the desktop distribution copies the tracked plugin source and built `lib` into its SourceBootstrap archive.

For an embedded plugin, rebuild the official client and DMG after every runtime or client change; updating only the Git repository does not update an installed application.

Publish the plugin repository and desktop release separately, then verify that the release asset contains the expected package and commit before announcing it.

## Further Exploration

- [Your first Harness plugin](../basic/index.md) — create and mount a minimal plugin.
- [Plugin configuration](../basic/config.md) — define and validate Cordis configuration.
- [Package and install a plugin](../basic/publish.md) — publish a profile bundle.
- [Plugins and lifecycle](../framework/index.md) — understand Fiber disposal and HMR.
- [Extension cookbook](../../../cookbook/extension-cookbook.md) — choose the correct event or capability extension point.

## Known Limitations and Deferred Work

The v0.1.11 desktop distribution still bootstraps a source snapshot and installs its dependency tree on first use; a sealed Electron or Node runtime closure is a separate packaging project.

The plugin library can review GitHub, npm, and local sources, but review records do not sandbox code execution or grant network permissions.

### Dev Note

None.
