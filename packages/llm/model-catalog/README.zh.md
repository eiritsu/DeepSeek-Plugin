# `@deepseek-ai/dsh-model-catalog`

[English](README.md) | 中文

该 Profile Bundle 从实时 `models.dev` catalog 获取并持久化完整的模型记录，同时将 Harness 已支持的输入模态、上下文／输出容量和模型级推理等级接入运行时；动态源没有声明的字段继续使用 pi-ai 已安装 catalog。随发行版提供的 Web profile 默认启用它；其 patch 只挂载一个 Host 插件，不改动任何提供方配置。

该 catalog 的运行时补丁标记为 `authoritative`：上游声明的模态、上下文、输出容量与推理字段会在模型发现和实际 prepared call 中替换本地陈旧值；上游没有声明的字段才保留本地值。

插件会补充发现候选中由端点省略的字段，并为运行时调用注册精确模型输入、容量与推理等级解析器。快照保留上游模型的原始 JSON，规范化字段为 Harness 消费者提供稳定类型。任一查询都会刷新陈旧快照；并发查询共用一次刷新，成功后替换持久快照，失败则保留 last-good 数据。可识别的 owner 会选择该提供方的精确动态声明，模型页也会把发现结果中的 `owned_by` 保存在采用的模型行上。当 owner 是本地别名时，配置的完整 `baseURL` 若与唯一一个 `models.dev` 提供方 API 精确一致，也能确定同一身份，无需逐模型映射。模型 ID 以大小写无关方式匹配，让大小写别名归入同一声明集合。没有 owner 或端点匹配时，每个字段都要求所有同 id 声明完全一致；声明不一致或 id 未知时保持原样。动态快照没有覆盖的字段按同样规则回退 pi-ai。端点明确公布的发现字段与更早的 enricher 仍然优先；运行时 catalog 容量和推理等级会替换已安装或已保存的陈旧能力值，但不改写 settings。路由名、协议名、部分 URL 与模型名称模式绝不会被当作能力证据。

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `catalogURL` | `https://models.dev/api.json` | 动态提供方／模型 catalog。 |
| `refreshIntervalMs` | `86400000` | 最近一次成功快照的有效期。 |
| `requestTimeoutMs` | `15000` | 远程刷新截止时间。 |
| `maxResponseBytes` | `8388608` | 单次 catalog 响应的实际字节上限。 |

```sh
dsh plugin --profile <custom-profile> add @deepseek-ai/dsh-model-catalog
```

本包声明了 `dsh.bundle.patch`，因此向自定义 profile 安装时会把它加入有序 Bundle 列表。具有随发行版提供的应用前缀的既有 Web profile，会在下次启动时补入缺失的默认 catalog Bundle，同时保留自定义 Bundle。

## 需要的 Harness 底层扩展点

这个 Bundle 可以独立打包，但依赖未修改 DSH runtime 中不存在的模型元数据扩展点：

- `@deepseek-ai/dsh-llm` 提供有序的模型发现补充，以及精确输入和容量解析 API；Harness 源码中的所有者实现位于 `packages/llm/llm/src/index.ts`，公开类型位于 `packages/llm/llm/src/types.ts`。
- `@deepseek-ai/dsh-llm-dsh-ai` 会先把精确 owner 与端点元数据交给这些解析器，再使用已安装 catalog 回退；Harness 源码中的所有者适配位于 `packages/llm/llm-dsh-ai/src/adapter.ts`。
- Host 模型发现和模型设置页会保留上游 `owned_by` 与可选 `inputModalities`，使网关模型可以匹配正确的 catalog owner。

侧载包只通过这些 API 提供 catalog 数据，不会自行增加 API、推断推理等级支持或改写提供方设置。缺少这些扩展点的 DSH 版本不兼容，必须先升级主程序；扩展点进入 Harness 基线后，catalog 刷新逻辑才可以通过这个 Bundle 独立更新。

## 模型体验

### 动态原生附件准入

#### 模型看到的内容

插件不产生文本。它复制完整的 `models.dev` 输入声明（`text`、`image`、`audio`、`video` 与 `pdf`）。所属适配器会把声明与所选 wire protocol 已实现的序列化能力取交集：支持的附件保持原生输入，不支持的媒体由 `Deepseek-Files` 生成持久识别文本。

#### Token 影响

插件不增加固定 token。准入的附件会产生提供方常规图片 token，以及适配器拥有的图片描述。

#### KV Cache 影响

允许图片进入请求会像提供方原生图片请求一样改变请求内容及其缓存标识。发现元数据不变时，不会引入额外 cache 变化。

## 已知限制与暂缓工作

- **刷新由查询触发**：模型发现或运行时精确查询会检查快照是否陈旧；插件不在后台轮询，也不静默改写已有模型行。旧缓存会被标记为一次性过期，使下一次查询获取并持久化端点身份与容量。
- **不透明 owner 采用保守结果**：没有可识别的 `owned_by` 或精确提供方端点匹配时，每个字段的同 id 声明必须完全一致，绝不合并提供方特有内容。
- **只有已实现的传输会生效**：catalog 可以声明 `audio`、`video` 或 `pdf`，但 `llm-dsh-ai` 仅在能够序列化任意 inline media 的 Google 协议上公开这些模态；其他协议保留 `text/image` 并使用识别回退。
- **输出能力不是请求默认值**：`limit.output` 会确定提供方模型描述符的容量，但只有提供方 profile 显式配置时才会成为请求的 `maxTokens`。
- **推理等级依赖上游声明**：只有 `reasoning_options` 中类型为 `effort` 的标准等级会进入模型能力；上游没有等级列表时，插件不会为该模型猜测支持项。
