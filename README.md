# DeepSeek Plugin

DeepSeek Harness 的自主插件工作区。这里保存可独立构建、打包和侧载的产品插件；侧载包通过 DSH 公开的插件、Settings、Credentials、Remote 与客户端插槽运行，不改动 Harness 源码、数据库格式或默认沙盒策略。

当前源码包括 Deepseek-Files、模型目录、插件库界面、macOS 桌面壳，以及 Lark/飞书管理插件。插件库的“审查安装”支持固定网络来源和本地插件目录；社区条目可直接送入同一审查流程。GitHub Topic 发布与公开插件市场发布不在本阶段范围内。

## 插件分类

`catalog/` 是面向用户和插件市场的分类目录，`packages/` 是工程构建目录。每个分类项使用 `plugin.json` 指向实际源码包，避免为了展示分类而复制源码。

- `catalog/collaboration/`：协作与通信，例如 Lark/飞书。
- `catalog/files/`：文件解析与多模态识别，例如 Deepseek-Files。
- `catalog/models/`：模型元数据与能力补全，例如 dsh-model-catalog。
- `catalog/platform/`：Harness 管理界面与平台扩展，例如插件库。

## 开发

工作区默认从同级目录 `../DeepSeek Harness` 链接 DSH 开发依赖，需要 Node.js `^22.19.0 || >=24.0.0` 与 pnpm 11。

```sh
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
```

## Lark/飞书侧载

Lark 包同时包含 Host 插件和设置页。官方快速连接会运行 Lark CLI 的设备授权流程，由飞书开放平台创建并连接个人应用；高级连接保留已有自建应用的 App ID/App Secret。两条连接路径可分别使用 Bot 身份与用户 OAuth 身份。

```sh
pnpm run build
PLUGIN_ROOT=$PWD
mkdir -p "$PLUGIN_ROOT/artifacts"
pnpm --dir packages/lark/lark pack --pack-destination "$PLUGIN_ROOT/artifacts"
cd '../DeepSeek Harness'
pnpm dsh plugin --profile web add "$PLUGIN_ROOT/artifacts/deepseek-ai-dsh-lark-0.1.1-rc.3.tgz"
pnpm dsh --profile web
```

安装后在 DSH 设置中打开“Lark 管理”。插件使用独立的 `$DSH_HOME/lark-cli` 配置和 token 目录；App Secret 进入 DSH Credentials，不返回浏览器。未获取的应用权限可以用“复制权限模板”生成剪贴板内容，再到飞书开放平台的批量导入页面粘贴，页面本身不展示 JSON。

## 插件库侧载

插件库包替换同名界面配置行，提供“审查安装”、本地目录选择和社区送审跳转；本地目录选择还需要本目录 `desktop-shell` 构建出的配套 macOS 原生桥。

```sh
PLUGIN_ROOT=$PWD
mkdir -p "$PLUGIN_ROOT/artifacts"
pnpm --dir packages/client/ui-plugin-library pack --pack-destination "$PLUGIN_ROOT/artifacts"
cd '../DeepSeek Harness'
pnpm dsh plugin --profile web add "$PLUGIN_ROOT/artifacts/deepseek-ai-dsh-client-ui-plugin-library-0.1.1-rc.3.tgz"
```

## 迁移边界

本目录已保存上述自主组件的开发源码。DeepSeek Harness 中的原副本目前仍是现有默认 profile 和包依赖的一部分；在这些包发布到稳定安装源并切换 Harness 组合配置前，不删除原副本，以免破坏主程序构建。桌面壳可用 `DSH_SOURCE_DIR` 指向其他 Harness 源码目录，未设置时使用同级的 `../DeepSeek Harness`。
