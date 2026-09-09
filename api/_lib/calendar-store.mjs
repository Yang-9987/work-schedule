import { versionedStore } from './versioned-store.mjs';

export const CALENDAR_PATH = "school-calendar/calendar.json";
export const FALLBACK_CALENDAR = {
  schoolName: "首师附一小",
  academicYear: "2026—2027",
  events: [
    { id: "term-start", date: "2026-09-01", title: "新学期开学", type: "teaching", note: "正式上课" },
  ],
};

import { validCalendar } from '../../shared/data-validation.cjs';
export { validCalendar };

export async function readCalendar() {
  return await versionedStore.read('school-calendar') || { schoolName: '首师附一小', academicYear: '2026—2027', events: [] };
}
export const writeCalendar = calendar => versionedStore.write('school-calendar', calendar);
