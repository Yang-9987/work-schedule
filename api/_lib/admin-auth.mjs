import crypto from "node:crypto";

const TOKEN_TTL_SECONDS = 8 * 60 * 60;

export function adminUser() {
  return process.env.ADMIN_USER || "admin";
}

export function safeEqual(leftValue, rightValue) {
  if (typeof leftValue !== "string" || typeof rightValue !== "string") return false;
  const left = Buffer.from(leftValue);
  const right = Buffer.from(rightValue);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createAdminToken(username) {
  const secret = process.env.ADMIN_PASS;
  if (!secret) return "";
  const payload = Buffer.from(JSON.stringify({
    sub: username,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  })).toString("base64url");
  return payload + "." + sign(payload, secret);
}

export function verifyAdminToken(token) {
  const secret = process.env.ADMIN_PASS;
  if (!secret || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !safeEqual(parts[1], sign(parts[0], secret))) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return payload.sub === adminUser() && Number(payload.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function tokenFromRequest(request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}
