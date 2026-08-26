# @deepseek-ai/dsh-client-ui-deepseek-files

English | [中文](README.zh.md)

Browser settings surface installed by the `Deepseek-Files` Profile Bundle. It contributes one first-level `settings.section` entry and binds the `file-recognizer-office` settings namespace without modifying the Settings shell.

The page edits Model ID and API Base URL or complete Endpoint URL values for OCR, audio transcription, and video understanding. API key values travel through the credentials RPC and never enter the settings document; the page reads only configured/writable metadata and cannot recover an existing key value.

## Model Experience

None, as this package only configures the recognizer provider; recognized text is owned and documented by [`@deepseek-ai/dsh-file-recognizer-office`](../../attachment/file-recognizer-office/README.md).

#### KV Cache effect

None. The configured provider's recognized text follows the recognizer package's bounded attachment projection.

## Known Limitations and Deferred Work

- The page configures protocol endpoints but does not probe provider capabilities before saving.
- A read-only settings or credential source remains visible but cannot be modified from this page.
