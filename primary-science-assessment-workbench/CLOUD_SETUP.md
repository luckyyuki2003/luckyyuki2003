# 可选云端接口（本次不启用）

默认 `cloud-config.js` 保持空值。本机功能无需账号、服务器或云端 SDK；不会自动创建云项目。以后是否使用云端服务及对应成本，应在接入时重新确认服务商的套餐和配额。

## 本机与云端的边界

- 本机：多份试卷、最近 10 次修改版本、软删除恢复、工程备份，储存在当前浏览器。
- 云端：接口已准备，未配置时登录表单隐藏，跨设备同步不可用。
- 工作台通过 `window.__WBWorkspace.capture/apply/blank` 与原有计算引擎交互；`workspace.js` 管理个人空间；`cloud-config.js` 是接入入口。
- 每份文档保存原始文本、解析题目、分析状态、组卷参数与结果、自建题库、答案显示偏好。内置题库仍随应用分发。
- 云端以文档 UUID 为标识，通过 `save_workbench_document` RPC 携带预期版本号写入。检测到远端更新时保留本机冲突副本，重试后分别同步。
- 退出登录会回到游客空间；账号本机缓存保留，适用于个人设备。

## 未来接入 Supabase

1. 创建项目，在 SQL 编辑器执行 `cloud-schema.sql`。表启用行级读取权限；写入只允许认证用户调用 RPC，函数检查当前用户和预期版本。
2. 启用 Email 登录，将邮件模板设置为包含 `{{ .Token }}` 的验证码邮件；配置邮件服务和发送限制。
3. 在 `cloud-config.js` 填写项目 HTTPS URL 与 publishable/anon 公钥。禁止填写 secret 或 service_role 密钥。
4. 使用 HTTPS 静态托管整个目录，测试两个真实账号间不可读取或覆盖对方文档，以及刷新恢复、登录过期、断网、多设备同时修改。
5. 当前适配器按需从 jsDelivr 加载固定版本 Supabase JS 2.49.8。正式启用前评估 SDK 更新、依赖托管、邮件投递与实际访问地区的网络情况。

数据库的账号数据读取受行级策略约束；认证用户没有直接插入、修改或删除表的权限。软删除和历史版本存放在文档中。若需要永久删除、附件存储、多人协作或学校管理，请另行实现对应服务接口。

参考：[邮箱验证码](https://supabase.com/docs/guides/auth/auth-email-passwordless)、[数据隔离](https://supabase.com/docs/guides/database/postgres/row-level-security)。
