---
name: lark
description: Use Lark/Feishu calendars, messages, documents, Drive, Base, Sheets, Slides, tasks, Wiki, contacts, mail, meetings, attendance, approvals, OKRs, and apps through the configured official CLI.
---

# Lark/Feishu through DSH

Use the `lark_cli` tool. Its `arguments` are the words after `lark-cli`; never include the executable itself. Prefer shortcut commands such as `calendar +event-list`, `docs +fetch`, `drive +file-list`, and `base +record-list`. Add `--json` whenever the command supports it so the result is unambiguous.

Start with a narrow read or status request. Before creating, updating, sending, deleting, granting, or otherwise changing remote data, summarize the exact target and intended effect in the tool call description; DSH will route the operation through approval. Do not work around a rejected approval.

When the CLI reports a missing application scope, tell the user to open Settings → Lark 管理 and use “复制缺失权限模板”, then import it in the Feishu/Lark developer console. When it reports missing user authorization, use the management page's user authorization action. Do not request or print the App Secret.
