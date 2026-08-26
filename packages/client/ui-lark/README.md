# @deepseek-ai/dsh-client-ui-lark

Lark/飞书管理页动态插件。官方快速连接完成应用创建后会自动继续当前用户 OAuth；待完成授权由 Host 持久化，设置页重开或 App 重启后会恢复确认按钮。页面也支持写入 App ID 与 write-only App Secret，分别显示 bot/user 身份、私聊 Channel 和应用权限状态，并提供不展示 JSON 的权限模板复制入口。所有业务状态通过 `@deepseek-ai/dsh-lark/remote` 获取。
