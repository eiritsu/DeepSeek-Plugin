# @deepseek-ai/dsh-client-ui-deepseek-files

[English](README.md) | 中文

由 `Deepseek-Files` Profile Bundle 安装的浏览器设置界面。它提供一个一级 `settings.section` 条目并绑定 `file-recognizer-office` settings namespace，不修改 Settings shell。

该页面分别编辑 OCR、音频转写和视频理解的 Model ID，以及 API Base URL 或完整 Endpoint URL。API key 值通过 credentials RPC 写入，不会进入 settings 文档；页面只能读取是否已配置和是否可写，不能恢复已有 key 值。

## 模型体验

无，因为此包只配置 recognizer provider；识别文本由 [`@deepseek-ai/dsh-file-recognizer-office`](../../attachment/file-recognizer-office/README.zh.md) 负责并记录其规则。

#### KV Cache 影响

无。配置的 provider 所产生的识别文本遵循 recognizer 包的有界附件投影。

## 已知限制与后续工作

- 页面只配置协议 endpoint，保存前不会探测 provider 的具体能力。
- 只读 settings 或 credential source 仍会显示，但不能在此页面修改。
