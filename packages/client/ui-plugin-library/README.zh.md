# @deepseek-ai/dsh-client-ui-plugin-library

[English](README.md) | 中文

面向 macOS 桌面壳的插件库。浏览器插件把 `window.dshDesktopPluginBridge` 视为能力信号：没有这个 document-start 原生桥接时不会注册任何内容；存在桥接时，只通过既有可追加 slot 提供一个 `sidebar.footer.action` 图标和一个 `shell.overlay` 表面，不会替换或修改侧边栏 owner。本包声明了可侧载 Bundle，用同名 `ui-plugin-library` 配置行替换内置界面，因此更新插件库不需要修改 Harness 源码；本地目录选择仍需要配套版本的 macOS 桌面壳原生桥。

“已安装”列表展示 Web profile 的树外依赖，以及内置 `Deepseek-Files` 和 `@deepseek-ai/dsh-model-catalog` Bundle。两个内置 Bundle 都标记为“默认已安装”，不能通过外部依赖控制移除。使用公共 npm 精确版本安装的依赖会查询 registry 的 `latest` 版本；发现更新后，已安装卡片显示更新入口，新版本仍需通过同一套固定来源审查才能安装。Git commit 和本地目录没有 registry 版本通道，继续通过手动重新审查更新。浏览器 locale 会把 catalog 在中文界面显示为“模型能力目录”，在英文界面显示为“Model Capabilities”。画布遵循设置弹窗的尺寸约定：宽度为 `800px`，高度为 `min(800px, 100vh - 48px)`，内容超出时只在画布内部滚动。它提供低高度长方形详细卡片、正方形简洁卡片、自适应列数、固定网络来源或本地目录审查与安装、卸载，以及原生持久操作日志。

社区发现与手动来源审查分离，并保留两个互不混淆的外部来源：GitHub [`dsh-plugin` topic](https://github.com/topics/dsh-plugin) 和第三方 [deepseek1024.com 目录](https://deepseek1024.com/plugins)。Topic 仓库会直接接受本机结构检查并显示四类判定。第三方目录只提供名称、分类、简介、数量、仓库与详情链接；这些元数据不代表背书或安装资格。用户从社区卡片发起审查时，界面立即切换到“审查安装”；原生端把 Topic 仓库固定到 commit，或从固定站点详情解析公开的 `dsh plugin --profile web add` npm 目标并向 npm registry 解析精确版本，之后进入同一套结构与安全预检。无法解析 npm 目标、无法固定版本或 registry 中不存在的条目不会获得安装 token。

两个来源分别保存搜索词、页码和滚动位置。插件库打开后会并行预取各自第一页。GitHub 当前页最多并发执行四项结构检查；第三方来源使用目录的分页 API、公开分类数量和排序模式，原生端只保留短期分页缓存。每页返回 12 项，目录区域触底时加载下一页，并保留显式“加载更多”按钮供键盘操作。

只有 `package.json` 声明了 `dsh.bundle.patch` 且对应的包内 YAML 组合入口存在时，界面才允许直接安装。网络来源必须固定到精确 npm 版本或 Git commit；本地目录会解析为绝对路径，并在安装前再次检查清单和组合入口。审查 token 在 15 分钟后过期，且只能被一次安装消费；安装会携带 `--save-exact --ignore-scripts` 委托给官方 `dsh plugin --profile web` 命令，随后以同一源码版本重启运行时。本地目录仍是可变且受信任的代码来源，安装后的目录内容变化不受审查器隔离。

手动网络来源、本地目录、Topic 发现和第三方来源送审共用以下四类判定：

- **可直接安装：** 根清单具有有效 package 名称，通过 `dsh.bundle.patch` 声明安全的包内 YAML 路径，且该入口确实存在。只有这一类会获得安装 token。
- **需要适配：** 根清单是有效 npm package，但没有声明 `dsh.bundle.patch`；仅将其加入依赖不会激活 Harness Profile Bundle。
- **外部项目：** 仓库根目录没有 `package.json`，因此 DSH 插件命令不能直接消费它。
- **已阻止：** 清单、package 名称、bundle 路径或所引用的组合入口无效或无法读取。检查失败时会默认进入这一类，而不是放行安装。

这里的来源检查明确属于预检，不是沙箱。禁用依赖 lifecycle script 可以减少安装阶段的代码执行，但启用后的 DSH 插件仍作为可信本机代码运行，并能使用 Harness 组合授予的文件、网络、进程或凭据访问能力。

## 模型体验

无，因为这个包只提供桌面管理 UI，不增加模型工具、提示词或 provider 流量。

#### KV Cache 影响

无。这个包不会组装或发送 provider 请求。

## 已知限制与延后工作

- 插件库不提供 package 级启停开关。Harness 的激活状态属于单个 Cordis 配置条目，而一个 npm 包可能贡献多个条目；单一 package 开关会错误表达这项所有权。
- 目录分类与来源预检会校验最低 DSH Bundle 结构、不可变来源及声明的组合入口，并禁止 lifecycle script；但尚不会下载并展示依赖/许可证清单、验证发布者签名，或在运行阶段隔离插件。
- 依赖 `prepare` 或其他 lifecycle script 的插件通过此入口安装后可能无法工作。
