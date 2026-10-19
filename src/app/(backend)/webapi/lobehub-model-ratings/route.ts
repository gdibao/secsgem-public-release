import { NextResponse } from 'next/server';

import { getLobeHubModelRatings } from '@/server/services/lobeHubModelCatalog';

const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=3600';

export const GET = async () => {
  const ratings = await getLobeHubModelRatings();

  if (!ratings) {
    return NextResponse.json(
      { error: 'LobeHub model ratings are temporarily unavailable' },
      { status: 503 },
    );
  }

  return NextResponse.json(ratings, { headers: { 'Cache-Control': CACHE_CONTROL } });
};
