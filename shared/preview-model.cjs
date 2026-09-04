const calendarText = require("../assets/js/calendar-text.js");
const CALENDAR_TYPES = {
  teaching: "teaching", "教学": "teaching", "教学安排": "teaching",
  activity: "activity", "活动": "activity", "校园活动": "activity",
  holiday: "holiday", "假期": "holiday", "放假": "holiday", "节假日": "holiday",
  exam: "exam", "考试": "exam"
};

const SCHEDULE_TYPES = {
  work: "work", "工作": "work",
  rest: "rest", "休息": "rest",
  key: "key", "关键节点": "key",
  student_entry: "student_entry", "学生入校": "student_entry",
  lesson: "lesson", "上课": "lesson",
  recess: "recess", "大课间": "recess", "大课间活动": "recess",
  eye_exercise: "eye_exercise", "眼保健操": "eye_exercise", "眼保健操时间": "eye_exercise",
  lunch: "lunch", "午餐": "lunch", "午餐时间": "lunch",
  hygiene: "hygiene", "卫生检查": "hygiene",
  broadcast: "broadcast", "校园广播": "broadcast",
  nap: "nap", "午休": "nap", "午休时间": "nap",
  club: "club", "社团": "club"
};

function text(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("、");
  if (typeof value === "object") return String(value.name || value.userName || value.text || value.title || value.address || "");
  return String(value).trim();
}

function excelDate(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number >= 2958466) return "";
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(number) * 86400000).toISOString().slice(0, 10);
}

function dateValue(value) {
  const raw = text(value);
  if (!raw) return "";
  const serial = excelDate(raw);
  if (serial) return serial;
  const match = raw.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : raw.slice(0, 10);
}

function timeValue(value) {
  const raw = text(value);
  if (!raw) return "";
  const number = Number(raw);
  if (Number.isFinite(number) && number >= 0) {
    const minutes = Math.round((number % 1) * 24 * 60) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  const match = raw.match(/\b(\d{1,2}):(\d{2})\b/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : raw;
}

function mappedType(value, moduleId, target) {
  const raw = text(value);
  if (target !== "type") return raw;
  if (moduleId === "school-calendar") return CALENDAR_TYPES[raw] || "activity";
  if (moduleId === "work-schedule") return SCHEDULE_TYPES[raw] || "work";
  if (moduleId === "duty-roster") return raw ? dutyType(raw) : "";
  return raw;
}

function dutyType(value) {
  const raw = text(value);
  if (!raw || /^(normal|正常|正常值班|值班)$/.test(raw)) return "normal";
  if (/^(holiday|放假|假期|节假日|休息)$/.test(raw)) return "holiday";
  if (/^(makeup|补课|补班|调休上班|补课值班)$/.test(raw)) return "makeup";
  return raw;
}

function people(value) {
  return [...new Set(text(value).split(/[、,，;；\n]+/).map((name) => name.trim()).filter(Boolean))];
}

function transform(value, mapping, moduleId) {
  if (mapping.transform === "date") return dateValue(value);
  if (mapping.transform === "time") return timeValue(value);
  if (mapping.transform === "type-map") return mappedType(value, moduleId, mapping.target);
  return text(value);
}

function sortRecords(records, sort) {
  const [key, direction] = String(sort || "").split(":");
  if (!key) return records;
  return records.sort((a, b) => text(a[key]).localeCompare(text(b[key]), "zh-CN") * (direction === "desc" ? -1 : 1));
}

function normalizedRecords(module, rows) {
  const issues = [];
  const required = new Set(module.schema.fields.filter((field) => field.required).map((field) => field.key));
  const records = rows.map((row, rowIndex) => {
    const record = {};
    for (const mapping of module.mappings) record[mapping.target] = transform(row[mapping.source], mapping, module.id);
    const values = Object.values(record).map(text);
    if (values.every((value) => !value)) return null;
    for (const key of required) {
      if (!text(record[key])) issues.push(`第 ${rowIndex + 1} 行缺少${module.schema.fields.find((field) => field.key === key).label}`);
    }
    return record;
  }).filter(Boolean);
  return { records: sortRecords(records, module.view.sort), issues: issues.slice(0, 20) };
}

function pageData(module, rows) {
  const normalized = normalizedRecords(module, rows);
  if (module.id === "school-calendar") {
    return {
      data: {
        schoolName: "首师附一小",
        academicYear: "2026—2027",
        events: calendarText.expand(normalized.records.map((record, index) => ({
          id: `preview-${index + 1}`,
          date: record.date || "",
          title: record.title || "",
          type: "activity",
          note: ""
        })))
      },
      issues: normalized.issues
    };
  }
  if (module.id === "work-schedule") {
    return {
      data: {
        company: "首师附一小",
        schedule: normalized.records,
        workdays: [false, true, true, true, true, true, false],
        tips: ["当前为本地预览，内容尚未同步到线上。"]
      },
      issues: normalized.issues
    };
  }
  if (module.id === "duty-roster") {
    const issues = normalized.issues.slice();
    const rows = normalized.records.map((record, index) => {
      const type = dutyType(record.type);
      const leaders = people(record.person);
      const cadres = people(record.cadre);
      if (!["normal", "holiday", "makeup"].includes(type)) issues.push(`第 ${index + 1} 条安排类型无法识别：${type}`);
      if (type !== "holiday" && !leaders.length && !cadres.length) issues.push(`第 ${index + 1} 条值班安排缺少人员`);
      if (type === "holiday" && (leaders.length || cadres.length)) issues.push(`第 ${index + 1} 条为放假，已忽略该行人员，请核对`);
      const parsed = new Date(record.date + "T00:00:00Z");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date || "") || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== record.date) issues.push(`第 ${index + 1} 条日期无效，请使用完整年月日`);
      return { ...record, type, leaders: type === "holiday" ? [] : leaders, cadres: type === "holiday" ? [] : cadres };
    });
    return { data: { title: module.name, rows, personnel: [...new Set(rows.flatMap((row) => [...row.leaders, ...row.cadres]))] }, issues: issues.slice(0, 20) };
  }
  return {
    data: { title: module.name, rows: normalized.records },
    issues: normalized.issues
  };
}

module.exports = { dateValue, pageData, text, timeValue };
