const crypto = require("node:crypto");

const TOKEN_TTL_SECONDS = 8 * 60 * 60;

function safeEqual(leftValue, rightValue) {
  if (typeof leftValue !== "string" || typeof rightValue !== "string") return false;
  const left = Buffer.from(leftValue);
  const right = Buffer.from(rightValue);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createRecord(password, now = new Date()) {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new Error("本地密码需要 8—128 个字符");
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return { version: 1, salt: salt.toString("base64"), hash: hash.toString("base64"), createdAt: now.toISOString() };
}

function validRecord(record) {
  return Boolean(record && record.version === 1 && typeof record.salt === "string"
    && typeof record.hash === "string" && typeof record.createdAt === "string");
}

function verifyPassword(password, record) {
  if (!validRecord(record) || typeof password !== "string") return false;
  try {
    const calculated = crypto.scryptSync(password, Buffer.from(record.salt, "base64"), 64).toString("base64");
    return safeEqual(calculated, record.hash);
  } catch { return false; }
}

function sign(payload, record) {
  return crypto.createHmac("sha256", Buffer.from(record.hash, "base64")).update(payload).digest("base64url");
}

function createToken(record, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!validRecord(record)) return "";
  const payload = Buffer.from(JSON.stringify({ sub: "local-console", exp: nowSeconds + TOKEN_TTL_SECONDS })).toString("base64url");
  return payload + "." + sign(payload, record);
}

function verifyToken(token, record, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!validRecord(record) || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !safeEqual(parts[1], sign(parts[0], record))) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return payload.sub === "local-console" && Number(payload.exp) > nowSeconds;
  } catch { return false; }
}

module.exports = { createRecord, createToken, validRecord, verifyPassword, verifyToken };
