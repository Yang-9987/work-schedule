const seed = require("../config/module-mappings.seed.json");

const ALLOWED_TRANSFORMS = new Set(["identity", "trim", "date", "time", "type-map"]);
const ALLOWED_VIEW_TYPES = new Set(["calendar", "timeline", "table", "cards"]);

function cloneSeed() {
  return JSON.parse(JSON.stringify(seed));
}

// Upgrade only the known legacy schema; preserve sources, mappings and other modules.
function upgradeMappingSet(value) {
  const copy = JSON.parse(JSON.stringify(value));
  for (const module of copy.modules || []) {
    if (module.id === "school-calendar" && module.schema?.id === "calendar.v1") {
      module.schema.id = "calendar.v2";
      module.schema.fields = module.schema.fields.filter((field) => ["date", "title"].includes(field.key));
      module.mappings = module.mappings.filter((mapping) => ["date", "title"].includes(mapping.target));
      module.view.visibleFields = ["date", "title"];
    }
    if (module.id !== "duty-roster" || module.schema?.id !== "duty-roster.v1") continue;
    const template = cloneSeed().modules.find((item) => item.id === "duty-roster");
    const oldKeys = new Set(module.schema.fields.map((field) => field.key));
    module.schema.fields = module.schema.fields.map((field) => {
      const next = template.schema.fields.find((item) => item.key === field.key);
      return next ? { ...field, label: next.label, required: next.required } : field;
    }).concat(template.schema.fields.filter((field) => !oldKeys.has(field.key)));
    module.schema.id = template.schema.id;
    module.mappings = module.mappings.map((mapping) => ({ ...mapping, required: mapping.target === "date" }));
  }
  return copy;
}

function isShortText(value, max) {
  return typeof value === "string" && value.length <= max;
}

function validModule(module) {
  if (!module || typeof module !== "object" || Array.isArray(module)) return false;
  if (!isShortText(module.id, 60) || !/^[a-z0-9-]+$/.test(module.id)) return false;
  if (!isShortText(module.name, 60) || !module.name) return false;
  if (!isShortText(module.route, 120) || !module.route.startsWith("/")) return false;
  if (!module.schema || !isShortText(module.schema.id, 80) || !Array.isArray(module.schema.fields)) return false;
  if (module.schema.fields.length < 1 || module.schema.fields.length > 50) return false;

  const targetFields = new Set();
  for (const field of module.schema.fields) {
    if (!field || !isShortText(field.key, 60) || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field.key)) return false;
    if (!isShortText(field.label, 60) || !isShortText(field.type, 30)) return false;
    if (targetFields.has(field.key)) return false;
    targetFields.add(field.key);
  }

  if (!module.source || module.source.type !== "wecom-smartsheet") return false;
  if (!isShortText(module.source.name, 100) || !isShortText(module.source.sheet, 100)) return false;
  if (!isShortText(module.source.documentUrl || "", 500)) return false;
  if (module.source.documentUrl) {
    let url;
    try { url = new URL(module.source.documentUrl); } catch { return false; }
    if (url.protocol !== "https:") return false;
  }
  if (!Array.isArray(module.source.fields) || module.source.fields.length > 100) return false;
  const sourceFields = new Set();
  for (const field of module.source.fields) {
    if (!field || !isShortText(field.name, 100) || !field.name || !isShortText(field.type, 30)) return false;
    sourceFields.add(field.name);
  }

  if (!Array.isArray(module.mappings) || module.mappings.length > 100) return false;
  const mappedTargets = new Set();
  for (const mapping of module.mappings) {
    if (!mapping || !sourceFields.has(mapping.source) || !targetFields.has(mapping.target)) return false;
    if (!ALLOWED_TRANSFORMS.has(mapping.transform)) return false;
    if (mappedTargets.has(mapping.target)) return false;
    mappedTargets.add(mapping.target);
  }
  for (const field of module.schema.fields) {
    if (field.required && !mappedTargets.has(field.key)) return false;
  }

  if (!module.view || !ALLOWED_VIEW_TYPES.has(module.view.type)) return false;
  if (!Array.isArray(module.view.visibleFields) || module.view.visibleFields.some((key) => !targetFields.has(key))) return false;
  if (!isShortText(module.view.sort || "", 100)) return false;
  return true;
}

function validMappingSet(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Number.isInteger(value.version) && value.version > 0
    && Array.isArray(value.modules) && value.modules.length > 0 && value.modules.length <= 30
    && new Set(value.modules.map((module) => module.id)).size === value.modules.length
    && value.modules.every(validModule);
}

function prepareForSave(value, action, now = new Date()) {
  const copy = JSON.parse(JSON.stringify(value));
  copy.updatedAt = now.toISOString();
  copy.modules = copy.modules.map((module) => ({
    ...module,
    revision: Number(module.revision || 0) + 1,
    mappingState: action === "publish" ? "published" : "draft",
    publishedAt: action === "publish" ? now.toISOString() : (module.publishedAt || null),
  }));
  return copy;
}

module.exports = { ALLOWED_TRANSFORMS, cloneSeed, prepareForSave, validMappingSet, upgradeMappingSet };
