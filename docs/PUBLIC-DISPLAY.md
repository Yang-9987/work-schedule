# 展示端与本地工作台

首页、作息、校历、值班和数智校园手册页面是只读展示端，不提供管理入口或登录表单。
公开数据的 GET 接口不要求管理员登录；数据写入、版本读取和回退接口仍需鉴权。

管理操作从 `http://127.0.0.1:3100/local-console/` 执行，包含本地登录、表格映射、完整读取、预览和同步。
本地工作台模式下，旧 `/admin/` 书签跳转到工作台；普通展示服务不提供旧管理页面。
Vercel 部署包排除 `admin/`、`local-console/` 以及对应管理脚本和样式。

## 上线前检查

- 匿名访问首页和四个模块，不出现登录提示或管理入口。
- 手机与电脑检查日期切换、事件内容、值班查人和作息时间轴。
- 未登录请求写入与版本接口仍被拒绝。
- Vercel 自身的 Deployment Protection 与应用代码不同。若预览域名仍要求 Vercel 登录，需另外检查部署保护设置；本次代码修改不变更此设置。
- 先发布 dev，验收通过并获最终批准后才合入 main。

本次界面调整不发布代码、不同步真实数据，也不改变生产域名或凭据。

## PDF 阅读

数智校园手册入口为 `/smart-campus-manual/`，原始文件为 `assets/documents/smart-campus-manual.pdf`。校历和手册共用 `assets/js/pdf-reader.js` 与 `assets/css/calendar-pdf.css`。手机默认逐页图片阅读（含 iPad 桌面 UA），支持页码跳转和浏览器双指缩放，不依赖企业微信内嵌 PDF 能力；电脑确认支持 PDF 时默认内嵌，可切换逐页阅读。禁用 JavaScript 时仍可阅读全部页面。图片模式无法搜索或选择 PDF 文字，可通过“打开 PDF”使用原始文档。

替换 PDF 时必须重新生成对应目录内的全部 JPG，同时更新模块 HTML 的页数、图片列表和尺寸；避免原件与图片版本不一致。当前手册 42 页、校历 2 页。生成命令：`pdftoppm -jpeg -jpegopt quality=85 -scale-to 2000 assets/documents/smart-campus-manual.pdf assets/documents/smart-campus-manual/page`（校历使用 `quality=88` 和 `-scale-to 2400`）。页面使用懒加载，失败时可点击重试。
