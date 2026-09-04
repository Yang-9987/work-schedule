import { hasBlobConfig } from './_lib/blob-config.mjs';
export function GET() {
  const ready = Boolean(hasBlobConfig() && process.env.ADMIN_PASS);
  return Response.json(
    { ok: ready, storage: ready ? "vercel-blob" : "not-configured", t: Date.now() },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
