import { NextResponse } from 'next/server';

import { getLobeHubModelCatalog } from '@/server/services/lobeHubModelCatalog';

const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=3600';

export const GET = async () => {
  const catalog = await getLobeHubModelCatalog();

  if (!catalog) {
    return NextResponse.json(
      { error: 'LobeHub model catalog is temporarily unavailable' },
      { status: 503 },
    );
  }

  return NextResponse.json(catalog, { headers: { 'Cache-Control': CACHE_CONTROL } });
};
