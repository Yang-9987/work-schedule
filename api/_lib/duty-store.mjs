import { versionedStore } from './versioned-store.mjs';

const text = (value, max) => typeof value === 'string' && value.length <= max;
export function validDuty(data) {
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
export const readDuty = () => versionedStore.read('duty-roster');
export const writeDuty = data => versionedStore.write('duty-roster', data);
