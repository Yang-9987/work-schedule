import { versionedStore } from './versioned-store.mjs';

export const CALENDAR_PATH = "school-calendar/calendar.json";
export const FALLBACK_CALENDAR = {
  schoolName: "首师附一小",
  academicYear: "2026—2027",
  events: [
    { id: "term-start", date: "2026-09-01", title: "新学期开学", type: "teaching", note: "正式上课" },
  ],
};

const TYPES = new Set(["teaching", "activity", "holiday", "exam"]);

export function validCalendar(calendar) {
  return calendar && typeof calendar === "object" && !Array.isArray(calendar)
    && typeof calendar.schoolName === "string" && calendar.schoolName.length <= 40
    && typeof calendar.academicYear === "string" && calendar.academicYear.length <= 30
    && Array.isArray(calendar.events) && calendar.events.length <= 500
    && calendar.events.every((event) => event && typeof event.id === "string" && event.id.length <= 80
      && /^\d{4}-\d{2}-\d{2}$/.test(event.date)
      && typeof event.title === "string" && event.title.length > 0 && event.title.length <= 5000
      && TYPES.has(event.type)
      && typeof (event.note || "") === "string" && (event.note || "").length <= 120);
}

export async function readCalendar() {
  return await versionedStore.read('school-calendar') || { schoolName: '首师附一小', academicYear: '2026—2027', events: [] };
}
export const writeCalendar = calendar => versionedStore.write('school-calendar', calendar);
