import { type MetadataRoute } from 'next';

// Keep the app sitemap dynamic and lightweight. Public sitemap URLs are redirected
// to the landing site in Next config, so this route must not hydrate the legacy
// market sitemap generator or bake thousands of XML bodies into Docker images.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return [];
}
