# 发布约定

## 授权边界

用户批准前不得推送、部署、合并 main 或写入生产数据。
代码路线：本地检查 → 用户允许推送 dev → Vercel Preview 验收 → 用户最终批准 → PR 合入 main → Production 验收。
不要通过 CLI --prod 或直接推送 main 绕过此流程。

## Vercel 配置（尚需控制台实际配置，不是已完成）

- Production Branch: main；dev 使用 Preview，不是本地 Development 环境。
- Preview/dev：DATA_ENV=dev，独立 Blob 存储的 BLOB_READ_WRITE_TOKEN，独立 ADMIN_PASS / CALENDAR_SYNC_SECRET。
- Production：DATA_ENV=main，保留现有生产存储的凭据；正常数据路径保留兼容。
- PRODUCTION_DATA_WRITES_ENABLED 默认不设置。用户批准正式数据发布后，才在 Production 设为 true；可随时关闭写入。
- 代码路径额外给 dev 加 dev/ 前缀，但仍应使用独立 Blob 存储，不能只依赖前缀隔离。
- Preview URL 不绑定 rrita.site 或 ssfyx.site；域名切换是独立的批准步骤。
- GitHub main 分支规则：禁止直接推送/强推，要求 PR 和 Release checks 通过；单人仓库需确认审查规则可执行。

## 数据权限

- 作息、校历、值周 GET 公开读取；持有链接的人都可能访问，不等同于企业微信组织身份限制。
- 校历编辑入口 /admin/calendar/；字段映射 /admin/mappings/；写入和历史版本操作要求管理员认证。
- 本地工作台 /local-console/ 和本地预览继续要求本机登录，不部署到 Vercel。

## 发布与回退 API

管理员登录 /api/auth 后使用 Authorization: Bearer <token>。
GET /api/releases?moduleId=school-calendar 列出备份，cursor 用于翻页；moduleId 还支持 work-schedule、duty-roster、mappings。
POST /api/releases：发布 body 为 {moduleId, action:"publish", confirm:"模块名:publish", data}；回退为 {moduleId, action:"rollback", confirm:"模块名:rollback", version}。
首次发布没有旧版本；之后每次先备份当前数据，再通过 ETag 条件更新，备份失败/并发冲突不覆盖。
回退也先备份当前数据，因此可以再次恢复。备份页列出的是曾存在的数据快照；并发失败可能留下重复快照，不代表每条都对应成功发布。
这不是跨模块事务：三个模块必须逐一校验和发布。Git 回滚不等于 Blob 数据回滚。
本地工作台的“发布与版本”窗口调用上述 API，显示目标并要求二次确认。

## 发布前验收

1. npm run check && npm test；确认没有敏感配置/真实导出数据被提交。
2. Vercel Preview 构建和函数运行验收；匿名访问三个展示页，匿名写操作应被拒绝。
3. 在 dev 独立存储中发布测试数据，验证备份、回退和冲突处理；确认正式数据未变化。
4. 校历多行事件、值周时间段、手机端和企业微信内置浏览器实机验收。
5. 使用“完整读取并预览”核对源记录总数和解析后的数据条数；普通快速预览最多 200 行，不可用于发布。
6. 用户批准具体版本和数据后，才允许正式发布。

## 已知待完成

- 本地工作台已提供“发布与版本”窗口及全量分页读取，部分预览、空数据、解析问题或未经两遍核对的数据禁止发布。实现与限制见 [PAGINATED-READ.md](PAGINATED-READ.md)。真实企业微信分页验收完成前不要启用远端发布配置。
- 生产管理员登录限流/防暴力尝试、数据导出/密钥扫描和真实云端集成测试。
- Vercel 环境变量、独立存储、GitHub 分支保护尚未在远端配置。
- 不会将原始企业微信表格链接/内部字段标识附带到公开展示接口中。

## 本地发布窗口配置

启动本地服务前设置 RELEASE_DEV_URL 为已验收的 dev HTTPS 根地址，RELEASE_MAIN_URL 为正式根地址。未配置时窗口锁定对应环境，不会猜测域名。
RELEASE_MAIN_ENABLED 默认为关闭；最终批准后才能设为 true，同时生产 Vercel 仍需 PRODUCTION_DATA_WRITES_ENABLED=true。
目标网站管理员密码仅在验证时发送到明确配置的目标；令牌仅保留在当前窗口内存，切换环境/关闭窗口会清除。禁止重定向，避免凭据发送到另一站点。
发布/回退请求携带 expectedEnvironment=dev 或 main，目标服务必须核对实际环境。上述 API 请求示例也必须带此字段。
此窗口发布的是数据，不会自动推送 Git、部署代码或合入 main。首次 dev 代码部署与凭据配置仍须用户单独批准。
