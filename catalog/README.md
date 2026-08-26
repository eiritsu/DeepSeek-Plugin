# Plugin catalog

This directory groups DeepSeek Harness extensions by product purpose. Source code stays under `packages/`; each `plugin.json` identifies package sources, distribution artifacts, and runtime compatibility without duplicating implementation files.

`standalone-sideload` uses the ordinary public plugin surface of a compatible DSH release. `desktop-assisted-sideload` additionally requires the matching macOS bridge for native actions. `requires-harness-extension-points` means the package can update independently only after the named owner-side capabilities have entered the DSH baseline; installation does not add those capabilities.

| Category | Purpose |
| --- | --- |
| `collaboration` | Communication, productivity, and third-party workspace integrations |
| `files` | Attachment parsing, recognition, and media fallback processing |
| `models` | Model metadata, modality, and capability discovery |
| `platform` | Harness management and plugin lifecycle interfaces |
