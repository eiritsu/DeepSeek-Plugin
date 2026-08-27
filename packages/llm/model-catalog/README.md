# `@deepseek-ai/dsh-model-catalog`

English | [中文](README.zh.md)

Profile Bundle that supplies model input modalities and context/output capacities from the live `models.dev` catalog, persists a last-good snapshot through `storageDomain`, and uses pi-ai's installed catalog when the dynamic source has no declaration. The shipped Web profile enables it by default; its patch mounts one Host plugin and changes no provider configuration.

The plugin fills fields omitted from a discovery candidate and registers exact-model input and capacity resolvers for runtime calls. Either lookup refreshes a stale snapshot; concurrent lookups share that refresh, success replaces the durable snapshot, and failure retains the last-good data. A recognized owner selects that provider's exact dynamic declaration, and the Models page preserves a discovered `owned_by` value on an adopted model. When the owner is a local alias, an exact configured `baseURL` match against one `models.dev` provider API supplies the same identity without per-model mappings. Model IDs are matched case-insensitively so casing aliases stay in one declaration set. Without an owner or endpoint match, each field requires identical same-id declarations; disagreement or an unknown id remains unchanged. An uncovered field falls back to the same pi-ai lookup. Endpoint-disclosed discovery fields and earlier enrichers remain authoritative, while runtime catalog capacities replace stale installed or saved capability values without rewriting settings. Route names, protocols, partial URLs, and model-name patterns are never treated as capability evidence.

| Config | Default | Meaning |
| --- | --- | --- |
| `catalogURL` | `https://models.dev/api.json` | Dynamic provider/model catalog. |
| `refreshIntervalMs` | `86400000` | Freshness interval for the last successful snapshot. |
| `requestTimeoutMs` | `15000` | Remote refresh deadline. |
| `maxResponseBytes` | `8388608` | Actual-byte ceiling for one catalog response. |

```sh
dsh plugin --profile <custom-profile> add @deepseek-ai/dsh-model-catalog
```

The package declares `dsh.bundle.patch`, so custom-profile installation adds it to the ordered Bundle list. Existing Web profiles with the shipped application prefix receive a missing default catalog Bundle on their next launch; custom Bundles remain in place.

## Required Harness extension points

This Bundle is independently packaged but requires model-metadata extension points that are not present in an unmodified DSH runtime:

- `@deepseek-ai/dsh-llm` provides ordered model-discovery enrichment plus exact input and capacity resolver APIs. Their owning implementation lives in `packages/llm/llm/src/index.ts` and their public types live in `packages/llm/llm/src/types.ts` in the Harness source tree.
- `@deepseek-ai/dsh-llm-pi-ai` supplies exact owner and endpoint metadata to those resolvers before applying its installed-catalog fallback. The owning adapter integration lives in `packages/llm/llm-pi-ai/src/adapter.ts`.
- Host model discovery and the Models settings page preserve the upstream `owned_by` value and optional `inputModalities`, so a gateway model can be matched against the correct catalog owner.

The side-loaded package contributes catalog data through those APIs; it does not add the APIs, infer reasoning-effort support, or rewrite provider settings. A DSH build without these extension points is incompatible and must be upgraded first. Once they are part of the Harness baseline, catalog refresh behavior can be updated independently through this Bundle.

## Model Experience

### Dynamic native attachment admission

#### What the model sees

The plugin emits no text. It copies the complete `models.dev` input declaration (`text`, `image`, `audio`, `video`, and `pdf`). The owning adapter intersects that declaration with the selected wire protocol's implemented serializers: supported attachments remain native, while `Deepseek-Files` produces durable recognition text for unsupported media.

#### Token effect

The plugin adds no fixed tokens. An admitted attachment contributes the provider's normal image tokens and any adapter-owned image description.

#### KV Cache effect

Admitting an image changes request content and its cache identity exactly as a provider-native image request would. Unchanged discovery metadata adds no further cache variation.

## Known Limitations and Deferred Work

- **Refresh is demand-driven** — the plugin checks staleness during model discovery or an exact runtime lookup; it does not poll in the background or silently rewrite saved model rows. An earlier cache is marked stale once so endpoint identities and capacities are fetched and persisted on the next lookup.
- **Opaque ownership is conservative** — without a recognized `owned_by` or exact provider endpoint match, every field requires identical same-id declarations; it never combines provider-specific extras.
- **Only implemented transports become effective** — the catalog may declare `audio`, `video`, or `pdf`, but `llm-pi-ai` exposes those modalities only on Google protocols that serialize arbitrary inline media. Other protocols keep `text/image` and use recognition fallback.
- **Output capability is not a request default** — `limit.output` sizes the provider model descriptor but does not become a request `maxTokens` value unless the provider profile explicitly configured one.
