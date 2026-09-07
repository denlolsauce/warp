/**
 * Public URL for a delivered asset. In production this is the CDN in front of
 * the R2 bucket; in dev, with no base configured, keys resolve against the
 * app's own /public so seeded demo assets render without object storage.
 */
export function assetPublicUrl(storageKey: string): string {
  const base = process.env.NEXT_PUBLIC_ASSET_BASE_URL ?? "";
  return `${base.replace(/\/$/, "")}/${storageKey.replace(/^\//, "")}`;
}
