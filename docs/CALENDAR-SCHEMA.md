# 校历数据结构 v3

依据《首都师大附中第一小学2026-2027学年第一学期校历.pdf》整理。
完整参考数据保存在 `config/calendars/2026-2027-term1.json`；本地 `data/calendar.json` 已更新。参考数据不自动发布至线上。

| 字段 | 含义 |
| --- | --- |
| schemaVersion | 新结构为 3，仍接受无版本号的旧校历 |
| schoolName / academicYear | 学校名称、学年 |
| term | 学期名称、起始日期、校历覆盖结束日期、第一周周一、总周数 |
| events | 有具体日期的事项，继续使用 id/date/title/type/note |
| monthlyPlans | 月份 month（YYYY-MM）、主题 theme、待定事项 items（id/title/note） |
| dayOverrides | 调课或放假说明；makeup 的 teachingWeekday 使用 1 至 7 表示周一至周日 |
| notes | 文档末尾的全局说明，按文本展示 |

第一周以 2026-08-31 为周一锚点，实际显示从 9 月 1 日开始，第 21 周截至 2027-01-24。结束日期表示原文表格覆盖范围，不推断寒假起始日。2027 年 1 月沿用本学期周次。

原文共整理 117 条日期事项、5 个月的 44 条月度事项、2 条调课说明。PDF 中标题的排版换行已合并，真正的多事项按条保存；第二页重复的 11 月事项去重。月度事项中已有的时间范围保留在标题中，不擅自转换成逐日活动。节假日仅按原文标注。

## 智能表格映射与预览

`calendar.v3` 支持 date、title、month、theme、type、note。title 必填；每条记录需要有效 date，或无 date 时提供 YYYY-MM 格式的 month。同一天多行事件仍按原规则拆分。无日期的事项归入 monthlyPlans，不添加虚构日期。同月份出现不同主题会阻止发布。

现有 v1/v2 映射读取时升级并保留原表格来源及日期/事件映射。月份、主题、类型、说明是可选映射，需绑定源表中真实存在的列，不自动修改企业微信表格。学期、学校、调课和全局说明保存在模块的 calendarSettings 中，预览会带入这些配置。月度事项来自源表，导入时应包含完整事项；导入是替换，不与 PDF 数据自动合并。

本地和线上接口共用 shared/data-validation.cjs 校验。旧版独立 sync:calendar 脚本仍是日期/事件导入通道；需要月度事项时使用本地控制台的 v3 映射与预览流程。

验证：npm run check；npm test。覆盖旧结构兼容、映射升级、无日期事项、无效月份、跨年周次和调课字段。
