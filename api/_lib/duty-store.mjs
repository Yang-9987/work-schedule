import { versionedStore } from './versioned-store.mjs';

import { validDuty } from '../../shared/data-validation.cjs';
export { validDuty };
export const readDuty = () => versionedStore.read('duty-roster');
export const writeDuty = data => versionedStore.write('duty-roster', data);
