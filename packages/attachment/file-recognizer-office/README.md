# @deepseek-ai/dsh-file-recognizer-office

English | [中文](README.zh.md)

This installable Profile Bundle registers bounded semantic extraction for UTF-8 plain text and source files, Markdown, CSV/TSV, DOCX, XLSX, PPTX, ODT, ODS, ODP, and PDF attachments. It also installs a `Deepseek-Files` Settings page for optional OCR, audio transcription, and video-understanding endpoints. The original file remains the durable source; extracted text is capped and recorded in the owning file content block so model requests remain reconstructable.

Install it through the desktop plugin review flow using an exact npm version or pinned Git commit. Installation disables lifecycle scripts. The parser runs as trusted local plugin code and applies input, ZIP-entry, uncompressed-byte, and extracted-character limits.

Each remote capability has a Model ID, an API Base URL or complete Endpoint URL, and a managed API key. A URL ending in `/v1` or `/api/v1` receives the standard `chat/completions` or `audio/transcriptions` operation path; any other URL is requested unchanged. OCR and video use OpenAI-compatible Chat Completions content (`file`/`image_url` and `video_url` respectively); audio uses an OpenAI-compatible Audio Transcriptions multipart request. API key values live in the credentials provider under `DEEPSEEK_FILES_OCR_API_KEY`, `DEEPSEEK_FILES_AUDIO_API_KEY`, and `DEEPSEEK_FILES_VIDEO_API_KEY`; settings store only those references. An empty Model ID or URL disables that remote capability. Extractable text and documents stay local. At prompt admission the selected route's effective modalities decide each media file: native `image`, `audio`, `video`, or `pdf` bypasses its recognizer, while an unsupported modality runs the configured fallback and records its text. Unsupported audio, video, or PDF input is refused when neither native transport nor recognition produces content.

## Model Experience

### Recognized attachment text

#### What the model sees

The durable attachment header followed by bounded plain text extracted at prompt admission. A text-only model receives durable OCR text in place of a newly admitted image. Unsupported or failed generic-file formats keep the file header without invented content.

##### Recognized file example

```markdown
[attached file: report.docx; application/vnd.openxmlformats-officedocument.wordprocessingml.document; 12345 bytes; attachment sha256:abcd1234]
Quarterly report
```

#### Token effect

Conditional and capped by `maxExtractedChars`.

#### KV Cache effect

Recognized text appends with the user message and remains stable on later turns.

## Known Limitations and Deferred Work

- Legacy binary DOC, XLS, PPT, RTF, and EPUB files are stored and downloadable but are not parsed by this provider.
- Provider compatibility is protocol-specific. An endpoint that labels itself OpenAI-compatible may still omit `file` or `video_url` content, so verify those capabilities with its documentation.
- Recognition uploads the complete bounded attachment to the configured third-party endpoint; the Harness sandbox does not constrain that provider's retention or processing.
