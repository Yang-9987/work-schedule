# 校园工作台架构

项目已从单页“作息时间表”调整为按功能模块组织的校园工作台。当前继续使用原生 HTML、CSS、JavaScript 与 Node.js，避免在第一阶段引入构建工具和迁移风险。

## 目录职责

```text
/
├── index.html                       # 工作台首页与统一功能入口
├── assets/
│   ├── css/app-shell.css            # 全站设计变量、门户和公共导航
│   ├── css/calendar.css             # 校历模块样式
│   ├── js/app-shell.js              # 门户公共行为
│   └── js/calendar.js               # 校历查看与编辑逻辑
├── modules/
│   ├── work-schedule/index.html     # 作息时间表模块
│   └── school-calendar/index.html   # 校历模块
├── api/
│   ├── auth.mjs                     # 统一管理员验证
│   ├── health.mjs                   # 服务健康检查
│   ├── schedule.mjs                 # 作息模块接口
│   ├── config.mjs                   # 作息旧接口实现与兼容入口
│   ├── calendar.mjs                 # 校历管理员查看与编辑接口
│   ├── calendar-sync.mjs            # 智能表格同步接收接口
│   └── _lib/calendar-store.mjs      # 校历校验和 Blob 存储
├── config/
│   └── wecom-calendar.example.json  # 智能表格字段映射模板
├── scripts/
│   └── sync-wecom-calendar.mjs      # 本机企业微信读取与发布程序
├── data/
│   ├── config.json                  # 本地作息数据
│   └── calendar.json                # 本地校历数据
└── server.js                        # 本地静态服务与同构 API
```

## 稳定访问路径

- `/`：校园工作台首页
- `/work-schedule/`：作息时间表
- `/school-calendar/`：公开的校历“开发中”页面；管理员可在页面内登录进入预览与编辑
- `/api/schedule`：读取、发布作息；旧 `/api/config` 继续可用
- `/api/calendar`：管理员令牌验证后读取、发布校历数据；开发阶段不向公开页面返回数据
- `/api/calendar-sync`：使用独立同步密钥接收本机同步程序发布的数据；不接收企业微信凭据
- `/api/auth`：管理员账号和密码验证，并签发登录令牌

## 模块约定

每个新功能使用 `modules/<module-name>/` 存放页面，专属资源放在 `assets/css` 与 `assets/js`，后端接口使用 `/api/<module-name>`。跨模块的颜色、排版、导航和交互基础统一放在 `app-shell` 文件中。

校历数据采用独立结构，避免与作息配置互相影响：

```json
{
  "schoolName": "首师附一小",
  "academicYear": "2026—2027",
  "events": [
    {
      "id": "term-start",
      "date": "2026-09-01",
      "title": "新学期开学",
      "type": "teaching",
      "note": "正式上课"
    }
  ]
}
```

事项类型固定为 `teaching`、`activity`、`holiday`、`exam`。服务端会检查日期、文本长度、类型以及总事项数量。管理员账号默认使用 `admin`，可通过 `ADMIN_USER` 环境变量覆盖；密码只从 `ADMIN_PASS` 环境变量读取。登录后签发 8 小时有效的管理员令牌，校历读取与发布均要求该令牌。

## 企业微信智能表格同步

同步采用单向桥接，避免把企业微信的本机授权凭据部署到公网：

```text
指定智能表格 → 本机 wecom-cli 只读拉取 → 字段映射与校验 → HTTPS 同步接口 → Vercel Blob
```

同步配置保存在被 Git 忽略的 `config/wecom-calendar.local.json`。配置明确指定智能表格链接、子表名称和字段名称，因此不会遍历其他文档；每次同步都会重新校验子表和字段，换表后只需更新配置。网站接收端使用独立的 `CALENDAR_SYNC_SECRET`，不影响管理员账号和密码。

## 数据映射中心

管理后台新增稳定入口 `/admin/mappings/`，用于维护“企业微信智能表格 → 标准数据模型 → 网页展示”的映射。映射不让企业微信列名直接依赖网页 DOM，而是先转换成 `calendar.v1`、`schedule.v1` 或 `duty-roster.v1` 等标准模型。

初始模块注册及映射位于 `config/module-mappings.seed.json`。本地 Node 服务把修改后的配置保存到被 Git 忽略的 `data/module-mappings.json`；Vercel Functions 保存到 Private Blob 的 `admin/module-mappings.json`。两种运行环境共用 `shared/module-mapping-model.cjs` 做结构和必填字段校验。

当前映射中心属于第一阶段基础设施：可以登录、编辑表格链接和子表、调整字段转换、配置网页可见字段、检查配置、保存草稿及发布映射。真实的企业微信字段发现仍由后续本地工作台完成，企业微信凭据不会上传到 Vercel。

完整实施顺序见 `docs/重构路线图.md`。

## 本地工作台

本地工作台入口为 `http://127.0.0.1:3100/local-console/`，通过 `npm run start:console` 启动。该模式强制只监听回环地址，不向局域网开放企业微信读取接口。

本地工作台首次启动时要求设置独立的本地登录密码。密码使用随机盐和 scrypt 哈希保存在被 Git 忽略的 `data/local-console-auth.json`，不保存明文；登录令牌有效期为 8 小时并只存于浏览器会话。除首次设置和登录外，所有本地工作台 API 都要求有效令牌。

本地工作台当前支持检查 `wecom-cli` 版本与授权、选择网页模块、读取指定智能表格的子表和字段、调整字段映射、读取最多 8 行样例数据以及把映射草稿保存到本机。读取接口只返回文档名、子表名、字段名和可读内容，不向页面返回企业微信内部标识。

企业微信连接逻辑位于 `shared/wecom-bridge.cjs`。访问具体子表前会先重新读取子表列表确认目标存在；字段详情通过 `fields list` 获取；样例数据通过限制字段和行数的 `records list` 读取。发现指令性文本时停止预览。
