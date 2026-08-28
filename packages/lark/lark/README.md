# @deepseek-ai/dsh-lark

侧载式 Lark/飞书集成。Host 插件通过 DSH Credentials 保存 App Secret，通过 Host Remote 向管理页提供不含秘密值的状态，通过官方 `@larksuite/cli` 执行业务命令，并通过官方 `@larksuite/channel` 建立消息长连接。插件注册 `lark_cli` 工具；审批层读取官方 CLI 的 `Risk: read` 命令声明，只读查询直接执行，数据变更命令进入 DSH approval 流程。

默认快速连接使用官方 Channel SDK 的 `registerApp`，用户通过官方页面批准后，平台创建应用并返回凭据；页面不要求用户手填 App ID 或 App Secret。注册请求声明管理页权限模板中的 tenant/user scope，并包含 `im.message.receive_v1` 事件。高级方式可连接已有自建应用，插件通过官方 `config init --app-secret-stdin` 接口同步凭据，Secret 不进入 argv、浏览器响应或日志；自建应用还需在开放平台启用长连接事件订阅并订阅 `im.message.receive_v1`。

两种方式都把 OAuth token 和 CLI 配置隔离在 `$DSH_HOME/lark-cli`，不读取系统级 `~/.lark-cli`。经 SHA-256 校验的官方 v1.0.90 二进制按平台下载到 `$DSH_HOME/lark-cli-bin/v1.0.90`，不会写入插件安装目录。管理页先显示应用/Bot 连接，再显示用户 OAuth；只有应用连接完成后才能授权当前用户。应用创建或批量导入一次性声明全部 capability user scope，紧接着的 OAuth 一次性请求同一集合，包括以当前用户身份发送消息所需的 `im:message.send_as_user`。应用权限已获取不等于用户已登录，查询个人日历等用户数据前必须完成用户 OAuth。待完成的用户授权由 Host Credentials 保存，关闭设置页、重启 App 或重载插件后仍可继续；功能更新改变用户权限集合时，旧授权请求自动失效，管理页会列出当前 token 缺少的 scope 并要求重新授权。两个身份可以同时使用；清除连接会移除该目录管理的应用配置和 token。

权限页通过官方 Open Platform 应用信息接口分别核验 tenant 与 user scope；批量导入模板包含该检查所需的最小应用身份权限 `application:application:self_manage`，不申请可读取企业全部应用信息的高级权限 `admin:app.info:readonly`。任一层未开通时都不会显示“已获取”。复制按钮只把批量导入模板写入剪贴板，不在页面或 Remote 日志中渲染 JSON。用户 OAuth 仅请求同一模板中的 user scope，使应用后台权限与个人授权保持对应。

私聊 Channel 只接受完成用户授权时记录的 Open ID，群聊和其他发送者不会进入 Agent。每个 `(App ID, chat ID)` 映射到一个稳定的 DSH session；收到的消息以 `kind: lark` 及 app、chat、message、sender 标识写入持久日志，平台重投同一 message ID 时不会再次提交。新会话按 `conversationCwd` 创建或复用可重命名的 DSH Workspace；恢复或已由其他客户端恢复的私聊 session 按其持久化 cwd 重新加入原 Workspace，因此默认目录变更不会破坏已有聊天。新会话使用当前默认模型，已有会话从 session persistence 恢复。

入站文本直接进入用户消息；图片和文件由 Channel 下载后保存到 DSH attachment store，并附带可用的识别文本。assistant 回复中的文本通过 Channel 的 text 消息发送，图片 attachment 和文件 attachment 会依次回复到原飞书消息。文件能力以结构化 attachment block 为准，不会把回复文本中的本地路径当作待上传文件。

对话连接默认启用，可通过 `conversationEnabled` 关闭。`conversationUserOpenId`、`conversationHandshakeTimeoutMs`、`conversationResponseTimeoutMs`、`conversationCwd` 和 `conversationTimeZone` 可在 Cordis 配置中覆盖；`conversationCwd` 为空时，新私聊会话使用 DSH 运行目录。每个 Lark Agent 都挂载 DSH `time-context`，在飞书消息不含浏览器时区时使用 `conversationTimeZone`（默认 `Asia/Shanghai`）提供当前时间。管理页连接流程会自动维护允许的用户 Open ID。插件卸载或重载会先停止入站、等待在途消息处理结束，再断开 Channel 并释放其创建或恢复的 Agent。

安装本包会通过 `cordis.patch.yml` 加入一个同时提供 Host 与浏览器 face 的 Lark 条目；Lark 管理页面由该 package root 的 `dsh.client` 声明进入 Web 模块表，不会修改 DeepSeek Harness 源码或数据库格式。
