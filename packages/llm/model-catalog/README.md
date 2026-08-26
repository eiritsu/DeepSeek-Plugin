# `@deepseek-ai/dsh-model-catalog`

English | [中文](README.zh.md)

Profile Bundle that supplies model input modalities from the live `models.dev` catalog, persists a last-good snapshot through `storageDomain`, and uses pi-ai's installed catalog when the dynamic source has no declaration. The shipped Web profile enables it by default; its patch mounts one Host plugin and changes no provider configuration.

The plugin fills a discovery candidate only when the endpoint omits `inputModalities`. It also registers an exact-model input resolver that `llm-pi-ai` consults unless the per-model profile explicitly pins `input`. Either lookup refreshes a stale snapshot; concurrent lookups share that refresh, success replaces the durable snapshot, and failure retains the last-good data. A recognized owner selects that provider's exact dynamic declaration, and the Models page preserves a discovered `owned_by` value on an adopted model. Model IDs are matched case-insensitively so casing aliases stay in one declaration set. For an opaque, absent, or gateway-specific owner, input modalities require identical same-id declarations; disagreement or an unknown id remains unchanged. An id absent from the dynamic snapshot falls back to the same pi-ai lookup. Endpoint and per-model metadata remain authoritative, earlier resolvers win, and route names, protocol names, and model-name patterns are never treated as capability evidence.

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

## Model Experience

### Dynamic native attachment admission

#### What the model sees

The plugin emits no text. It copies the complete `models.dev` input declaration (`text`, `image`, `audio`, `video`, and `pdf`). The owning adapter intersects that declaration with the selected wire protocol's implemented serializers: supported attachments remain native, while `Deepseek-Files` produces durable recognition text for unsupported media.

#### Token effect

The plugin adds no fixed tokens. An admitted attachment contributes the provider's normal image tokens and any adapter-owned image description.

#### KV Cache effect

Admitting an image changes request content and its cache identity exactly as a provider-native image request would. Unchanged discovery metadata adds no further cache variation.

## Known Limitations and Deferred Work

- **Refresh is demand-driven** — the plugin checks staleness during model discovery or an exact runtime lookup; it does not poll in the background or silently rewrite saved model rows.
- **Opaque ownership is conservative** — a missing or gateway-specific `owned_by` value requires identical input declarations; it never combines provider-specific extras.
- **Only implemented transports become effective** — the catalog may declare `audio`, `video`, or `pdf`, but `llm-pi-ai` exposes those modalities only on Google protocols that serialize arbitrary inline media. Other protocols keep `text/image` and use recognition fallback.
- **Capacities are not copied** — context and output capacities stay with the endpoint or provider configuration because a gateway may expose different limits from the upstream owner.
