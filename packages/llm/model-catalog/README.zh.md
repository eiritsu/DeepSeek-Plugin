# `@deepseek-ai/dsh-model-catalog`

[English](README.md) | 中文

该 Profile Bundle 从实时 `models.dev` catalog 提供模型输入模态，通过 `storageDomain` 持久化 last-good 快照，并在动态源没有声明时使用 pi-ai 已安装 catalog。随发行版提供的 Web profile 默认启用它；其 patch 只挂载一个 Host 插件，不改动任何提供方配置。

插件仅在端点省略 `inputModalities` 时补充发现候选。它还会注册精确模型输入解析器；除非逐模型 profile 显式固定 `input`，否则 `llm-pi-ai` 会调用它。任一查询都会刷新陈旧快照；并发查询共用一次刷新，成功后替换持久快照，失败则保留 last-good 数据。可识别的 owner 会选择该提供方的精确动态声明，模型页也会把发现结果中的 `owned_by` 保存在采用的模型行上。模型 ID 以大小写无关方式匹配，让大小写别名归入同一声明集合。owner 不透明、缺失或为网关自定义值时，输入模态要求所有同 id 声明完全一致；声明不一致或 id 未知时保持原样。动态快照不存在该 id 时，才按同样规则回退 pi-ai。端点与逐模型元数据始终优先，更早的解析器优先；路由名、协议名与模型名称模式绝不会被当作能力证据。

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

## 模型体验

### 动态原生附件准入

#### 模型看到的内容

插件不产生文本。它复制完整的 `models.dev` 输入声明（`text`、`image`、`audio`、`video` 与 `pdf`）。所属适配器会把声明与所选 wire protocol 已实现的序列化能力取交集：支持的附件保持原生输入，不支持的媒体由 `Deepseek-Files` 生成持久识别文本。

#### Token 影响

插件不增加固定 token。准入的附件会产生提供方常规图片 token，以及适配器拥有的图片描述。

#### KV Cache 影响

允许图片进入请求会像提供方原生图片请求一样改变请求内容及其缓存标识。发现元数据不变时，不会引入额外 cache 变化。

## 已知限制与暂缓工作

- **刷新由查询触发**：模型发现或运行时精确查询会检查快照是否陈旧；插件不在后台轮询，也不静默改写已有模型行。
- **不透明 owner 采用保守结果**：`owned_by` 缺失或是网关自定义值时，输入声明必须完全一致，绝不合并提供方特有模态。
- **只有已实现的传输会生效**：catalog 可以声明 `audio`、`video` 或 `pdf`，但 `llm-pi-ai` 仅在能够序列化任意 inline media 的 Google 协议上公开这些模态；其他协议保留 `text/image` 并使用识别回退。
- **不复制容量**：上下文与输出容量仍由端点或提供方配置决定，因为网关可能采用与上游 owner 不同的限制。
