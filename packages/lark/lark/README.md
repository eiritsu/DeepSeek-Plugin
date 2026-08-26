# @deepseek-ai/dsh-lark

侧载式 Lark/飞书集成。Host 插件通过 DSH Credentials 保存 App Secret，通过 Host Remote 向管理页提供不含秘密值的状态，通过官方 `@larksuite/cli` 执行业务命令，并注册 `lark_cli` 工具。审批层读取官方 CLI 的 `Risk: read` 命令声明，只读查询直接执行，数据变更命令进入 DSH approval 流程。

默认快速连接在后台运行官方 `config init --new`，用户通过官方页面批准后，平台按 `PersonalAgent` 模板创建应用并把生成的凭据交给 CLI；页面不要求用户手填 App ID 或 App Secret。高级方式可连接已有自建应用，插件通过官方 `config init --app-secret-stdin` 接口同步凭据，Secret 不进入 argv、浏览器响应或日志。

两种方式都把 OAuth token 和 CLI 配置隔离在 `$DSH_HOME/lark-cli`，不读取系统级 `~/.lark-cli`。经 SHA-256 校验的官方 v1.0.90 二进制按平台下载到 `$DSH_HOME/lark-cli-bin/v1.0.90`，不会写入插件安装目录。管理页先显示应用/Bot 连接，再显示用户 OAuth；只有应用连接完成后才能授权当前用户。应用权限已获取不等于用户已登录，查询个人日历等用户数据前必须完成用户 OAuth。待完成的用户授权由 Host Credentials 保存，关闭设置页、重启 App 或重载插件后仍可继续；功能更新改变用户权限集合时，旧授权请求自动失效，下一次授权使用当前版本的完整权限。两个身份可以同时使用；清除连接会移除该目录管理的应用配置和 token。

权限页通过官方 Open Platform 应用信息接口分别核验 tenant 与 user scope；批量导入模板包含该检查所需的最小应用身份权限 `application:application:self_manage`，不申请可读取企业全部应用信息的高级权限 `admin:app.info:readonly`。任一层未开通时都不会显示“已获取”。复制按钮只把批量导入模板写入剪贴板，不在页面或 Remote 日志中渲染 JSON。用户 OAuth 仅请求同一模板中的 user scope，使应用后台权限与个人授权保持对应。

安装本包会通过 `cordis.patch.yml` 同时加入 Host 插件和 Lark 管理页面，不会修改 DeepSeek Harness 源码或数据库格式。
