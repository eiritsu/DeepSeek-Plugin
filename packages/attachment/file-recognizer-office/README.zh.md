# @deepseek-ai/dsh-file-recognizer-office

[English](README.md) | 中文

这个可安装的 Profile Bundle 为 UTF-8 纯文本与源码、Markdown、CSV/TSV、DOCX、XLSX、PPTX、ODT、ODS、ODP 和 PDF 附件注册有界语义提取。它还会安装一个 `Deepseek-Files` 设置页，用于配置可选的 OCR、音频转写和视频理解 endpoint。原文件仍是 durable source；提取文本经过上限裁剪并记录在所属 file 内容块中，使模型请求可以重建。

通过桌面插件审查流程安装精确 npm 版本或固定 Git commit。安装过程禁用 lifecycle scripts。解析器作为受信任本地插件代码运行，并限制输入大小、ZIP 条目数、解压字节数和提取字符数。

每项远程能力分别配置 Model ID、API Base URL 或完整 Endpoint URL，以及托管 API key。以 `/v1` 或 `/api/v1` 结尾的 URL 会自动补充标准 `chat/completions` 或 `audio/transcriptions` 操作路径；其他 URL 保持原样请求。OCR 与视频使用 OpenAI-compatible Chat Completions 内容（分别为 `file`/`image_url` 与 `video_url`），音频使用 OpenAI-compatible Audio Transcriptions multipart 请求。API key 值由 credentials provider 分别保存在 `DEEPSEEK_FILES_OCR_API_KEY`、`DEEPSEEK_FILES_AUDIO_API_KEY` 和 `DEEPSEEK_FILES_VIDEO_API_KEY`；settings 只保存这些引用。Model ID 或 URL 为空时，对应远程能力关闭。可提取的文本和文档始终在本机处理。Prompt 准入会按所选路由的有效模态决定每个媒体文件：原生 `image`、`audio`、`video` 或 `pdf` 会绕过对应识别器，不支持的模态则调用已配置回退并记录其文本。既没有原生传输、识别又没有产出内容时，不支持的音频、视频或 PDF 输入会被拒绝。

## 模型体验

### 已识别附件文本

#### 模型看到的内容

模型看到 durable 附件说明以及 prompt admission 时提取的有界纯文本。文本模型会用持久 OCR 文本代替新准入图片。无法支持或解析失败的通用文件只保留文件说明，不虚构内容。

##### 已识别文件示例

```markdown
[attached file: report.docx; application/vnd.openxmlformats-officedocument.wordprocessingml.document; 12345 bytes; attachment sha256:abcd1234]
Quarterly report
```

#### Token 影响

仅在识别成功时产生，并受 `maxExtractedChars` 限制。

#### KV Cache 影响

识别文本随用户消息追加，后续轮次保持稳定。

## 已知限制与后续工作

- 旧版二进制 DOC、XLS、PPT、RTF 和 EPUB 文件可以保存和下载，但此 provider 不解析其内容。
- Provider 兼容性取决于具体协议。即使 endpoint 自称 OpenAI-compatible，也可能不支持 `file` 或 `video_url` 内容，因此需要按其文档确认能力。
- 识别过程会把完整且受大小限制的附件上传到配置的第三方 endpoint；Harness 沙箱不能约束该 provider 的保留或处理策略。
