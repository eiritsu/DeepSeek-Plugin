# Harness 插件开发标准

[English](plugin-standard.md) | 中文

## Summary

本参考文档定义 DeepSeek Harness Desktop v0.1.11 的插件包、运行时、UI、持久化、安全、测试和发布规则。

当你为桌面应用创建插件、发布第三方包，或把插件加入内置发行版时，请使用本标准。

本标准把插件定义为由 profile 挂载的 Cordis 代码；没有 `apply` 入口的库不是插件。

桌面应用在本机运行内置插件，因此安装审查、依赖固定、生命周期清理和失败报告都属于插件契约。

## Table of Contents

- [选择包类型](#choose-the-package-shape)
- [必需的包结构](#required-package-structure)
- [实现运行时](#implement-the-runtime)
- [添加 Web Client 端](#add-a-web-client-face)
- [保存用户数据](#store-user-data)
- [处理安全和生命周期](#handle-security-and-lifecycle)
- [测试和发布](#test-and-release)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Choose the package shape

在编写代码前选择一种类型，因为桌面加载器对每种类型的处理方式不同。

| 类型 | 入口 | 安装含义 |
| --- | --- | --- |
| Cordis 插件 | `apply(ctx, config)` 或 Service 子类 | 由 `cordis.yml` 条目挂载。 |
| Bundle | 插件包加 `dsh.bundle.patch` | 安装到 profile 并增加配置层。 |
| Library | 没有插件入口的普通模块 API | 由其他包导入；没有独立的插件安装路径。 |

需要用户通过 `dsh plugin` 启用的可分发桌面功能包，应使用 Bundle 类型。

## Required package structure

使用 ESM，发布构建文件，并保持包清单明确。

```text
my-plugin/
├── package.json
├── src/index.ts
├── lib/index.js
├── lib/types/index.d.ts
└── cordis.patch.yml
```

清单必须声明 `type: module`、`main`、`types`、`files`、license，以及所使用 Harness 包的精确 peer dependencies。

Bundle 清单声明 `dsh.bundle.patch`，补丁按包名插入插件；发布补丁中不要插入开发者本地路径。

只有在包提供浏览器端实现时才使用 `dsh.client`，并明确列出注入的 client 包和 `platform: web`。

## Implement the runtime

导出命名的 `apply` 函数和可选的 `name`；每个必须在加载前存在的服务都使用 `inject` 声明。

```ts ignore-check
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(/* defineTool(...) */)
}
```

监听器、工具、适配器和自定义资源都必须通过 `ctx` 注册，使 Cordis 能在卸载和热替换时清理它们。

使用类型化的 `Config` 接口和同名 Schemastery schema；超时、限制和端点等部署变量必须放进 schema。

对自包含的无效配置在加载阶段失败；不要静默禁用缺失的依赖或资源。

使用 `session/event`、`agent/request`、`tools/pre-execute` 和 `tools/result` 等已文档化扩展点；不要为实现功能修改 agent loop。

## Add a Web Client face

Client 代码是独立的浏览器端，必须通过 `dsh.client` 声明；不得导入 Node 专用模块或密钥。

从已记录的 `session/event` 数据渲染会话状态，并通过公开的 agent 或 RPC API 发送用户操作。

所有可见产品文案都必须通过 locale 字典和 `t` 提供；组件中不得硬编码用户文案。

Host 和 Client 注册放在各自所属包中，使用生成的 Typert 或 client bridge 类型，不要重复定义 wire 类型。

## Store user data

通过桌面数据服务持久化设置、插件状态、已安装来源和会话相关数据；不要在应用旁创建未登记的 JSON 数据库。

桌面应用把受管理记录保存在 SQLite 中，把可执行代码、清单和生成产物保存在插件源码树中。

所有会被模型看到的持久输入都写入 session event stream，使 replay 能重建模型收到的内容。

把文件、网络响应、插件清单和子进程输出视为持久化或不可信边界，在使用前进行校验。

## Handle security and lifecycle

第三方插件作为可信本机代码执行；审查不会限制它们的文件、网络或子进程访问。

GitHub 插件源必须固定到 commit 并记录已审查的来源；分支或浮动 tag 不是可复现的发布输入。

连接、计时器、子进程和其他资源使用 `ctx.effect()` 管理，并在 disposer 中等待异步清理完成。

工作完成且 Agent 空闲后不要继续持有 AgentHandle；应释放它，使其他客户端可以管理或删除已完成会话。

不要销毁其他生命周期拥有的 Agent；只移除本插件拥有的上下文注册。

返回可操作的错误，在日志中保留原始原因，并避免在 UI 中暴露凭据或完整的不可信载荷。

## Test and release

为有效配置、无效配置、注册清理、重复投递、失败恢复和并发生命周期路径添加聚焦单元测试。

每个变更端都运行所属 Vitest、TypeScript 检查和构建产物 smoke；插件嵌入桌面应用时还要运行桌面 Swift 测试。

打包前构建插件，使 `lib` 与 `src` 一致；桌面发行版会把已跟踪的插件源码和构建后的 `lib` 复制进 SourceBootstrap archive。

内置插件发生运行时或 client 变更后必须重新构建 official client 和 DMG；只更新 Git 仓库不会更新已安装应用。

分别发布插件仓库和桌面 release，然后验证 release asset 包含预期的包和 commit，再对外宣布。

## Further Exploration

- [第一个 Harness 插件](../basic/index.zh.md) — 创建并挂载最小插件。
- [插件配置](../basic/config.zh.md) — 定义和校验 Cordis 配置。
- [打包与安装插件](../basic/publish.zh.md) — 发布 profile Bundle。
- [插件与生命周期](../framework/index.zh.md) — 理解 Fiber 清理和 HMR。
- [扩展 Cookbook](../../../cookbook/extension-cookbook.zh.md) — 选择正确的事件或能力扩展点。

## Known Limitations and Deferred Work

v0.1.11 桌面发行版仍会在首次使用时启动源码快照并安装依赖树；封闭的 Electron 或 Node 完整 runtime 是独立的打包项目。

插件库可以审查 GitHub、npm 和本地来源，但审查记录不会隔离代码执行，也不会授予网络权限。

### Dev Note

None.
