const ALLOWED_TYPES = new Set([
  "work", "rest", "key", "student_entry", "lesson", "recess", "eye_exercise",
  "lunch", "hygiene", "broadcast", "nap", "club",
]);

function validConfig(config) {
  return config && typeof config === "object" && !Array.isArray(config)
    && Array.isArray(config.schedule) && Array.isArray(config.workdays)
    && config.workdays.length === 7 && config.workdays.every(day => typeof day === "boolean") && Array.isArray(config.tips)
    && config.schedule.every((item) => item && typeof item === "object" && ALLOWED_TYPES.has(item.type)
      && typeof item.name === "string" && item.name.trim() && validTime(item.start)
      && (item.end == null || item.end === "" || validTime(item.end)));
}

const TYPES = new Set(["teaching", "activity", "holiday", "exam"]);

function validCalendar(calendar) {
  return calendar && typeof calendar === "object" && !Array.isArray(calendar)
    && typeof calendar.schoolName === "string" && calendar.schoolName.length <= 40
    && typeof calendar.academicYear === "string" && calendar.academicYear.length <= 30
    && (calendar.schemaVersion == null || calendar.schemaVersion === 3)
    && (calendar.term == null || (calendar.term && typeof calendar.term.name === 'string'
      && validDate(calendar.term.startDate) && validDate(calendar.term.endDate) && validDate(calendar.term.weekStartDate)
      && calendar.term.weekStartDate <= calendar.term.startDate && calendar.term.startDate <= calendar.term.endDate
      && new Date(calendar.term.weekStartDate + 'T00:00:00Z').getUTCDay() === 1
      && Number.isInteger(calendar.term.weekCount) && calendar.term.weekCount > 0 && calendar.term.weekCount <= 60
      && Math.floor((Date.parse(calendar.term.endDate) - Date.parse(calendar.term.weekStartDate)) / 604800000) + 1 === calendar.term.weekCount))
    && (calendar.monthlyPlans == null || (Array.isArray(calendar.monthlyPlans) && calendar.monthlyPlans.length <= 24
      && new Set(calendar.monthlyPlans.map(p => p?.month)).size === calendar.monthlyPlans.length
      && calendar.monthlyPlans.every(p => p && /^\d{4}-(0[1-9]|1[0-2])$/.test(p.month)
        && typeof p.theme === 'string' && p.theme.length <= 100 && Array.isArray(p.items) && p.items.length <= 100
        && p.items.every(i => i && typeof i.id === 'string' && typeof i.title === 'string' && i.title.trim() && i.title.length <= 5000
          && (i.note == null || (typeof i.note === 'string' && i.note.length <= 5000))))))
    && (calendar.dayOverrides == null || (Array.isArray(calendar.dayOverrides) && calendar.dayOverrides.length <= 100
      && new Set(calendar.dayOverrides.map(d => d?.date)).size === calendar.dayOverrides.length
      && calendar.dayOverrides.every(d => d && validDate(d.date) && ['makeup', 'holiday'].includes(d.kind)
        && (d.kind !== 'makeup' || (Number.isInteger(d.teachingWeekday) && d.teachingWeekday >= 1 && d.teachingWeekday <= 7))
        && typeof d.note === 'string' && d.note.length <= 500)))
    && (calendar.notes == null || (Array.isArray(calendar.notes) && calendar.notes.length <= 20 && calendar.notes.every(n => typeof n === 'string' && n.length <= 5000)))
    && Array.isArray(calendar.events) && calendar.events.length <= 500
    && calendar.events.every((event) => event && typeof event.id === "string" && event.id.length <= 80
      && validDate(event.date)
      && typeof event.title === "string" && event.title.length > 0 && event.title.length <= 5000
      && TYPES.has(event.type)
      && typeof (event.note || "") === "string" && (event.note || "").length <= 120);
}

const text = (value, max) => typeof value === 'string' && value.length <= max;
function validDuty(data) {
  return data && text(data.title, 100) && Array.isArray(data.rows) && data.rows.length <= 2000 && data.rows.every(row => {
    if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.date || '')) return false;
    const date = new Date(row.date + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== row.date) return false;
    if (!['normal', 'holiday', 'makeup'].includes(row.type)) return false;
    if (![row.leaders, row.cadres].every(list => Array.isArray(list) && list.length <= 100 && list.every(name => text(name, 100) && name.trim()))) return false;
    if (row.type !== 'holiday' && !row.leaders.length && !row.cadres.length) return false;
    if (row.type === 'holiday' && (row.leaders.length || row.cadres.length)) return false;
    return ['shift', 'location', 'note'].every(key => row[key] == null || text(row[key], 5000));
  });
}

function validTime(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function dataIssues(moduleId, data) {
  const validate = { 'work-schedule': validConfig, 'school-calendar': validCalendar, 'duty-roster': validDuty }[moduleId];
  if (!validate) return ['未知模块'];
  if (validate(data)) return [];
  const key = { 'work-schedule': 'schedule', 'school-calendar': 'events', 'duty-roster': 'rows' }[moduleId];
  const rows = data?.[key];
  if (!Array.isArray(rows)) return ['数据列表格式错误'];
  const limit = moduleId === 'school-calendar' ? 500 : moduleId === 'duty-roster' ? 2000 : Infinity;
  const issues = rows.length > limit ? [`解析后共 ${rows.length} 条，超过 ${limit} 条发布上限`] : [];
  rows.forEach((row, index) => {
    if (!validate({ ...data, [key]: [row] })) issues.push(`第 ${index + 1} 条数据不符合发布格式，请检查日期、类型、必填字段及文本长度`);
  });
  return issues.length ? issues.slice(0, 20) : ['模块标题或其他配置不符合发布格式'];
}
module.exports = { validConfig, validCalendar, validDuty, validDate, dataIssues };
