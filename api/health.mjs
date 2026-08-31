export function GET() {
  const ready = Boolean(process.env.BLOB_READ_WRITE_TOKEN && process.env.ADMIN_PASS);
  return Response.json(
    { ok: ready, storage: ready ? "vercel-blob" : "not-configured", t: Date.now() },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
