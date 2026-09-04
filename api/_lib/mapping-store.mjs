import model from "../../shared/module-mapping-model.cjs";
import { versionedStore } from './versioned-store.mjs';

export async function readMappings() {
  const data = await versionedStore.read('mappings');
  return model.validMappingSet(data) ? model.upgradeMappingSet(data) : model.cloneSeed();
}
export const writeMappings = mappingSet => versionedStore.write('mappings', mappingSet);
