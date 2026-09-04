// The SDK obtains short-lived OIDC credentials from the Vercel runtime.
// Local callers still need an explicit token; a store ID alone is not auth.
export function hasBlobConfig(env = process.env) {
  return Boolean(env.BLOB_READ_WRITE_TOKEN || (env.BLOB_STORE_ID &&
    (env.VERCEL_OIDC_TOKEN || (env.VERCEL === '1' && ['preview', 'production'].includes(env.VERCEL_ENV)))));
}
