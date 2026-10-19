import { shouldChargeCommercialUsage } from '@/business/server/commercialBilling';
import { type LobeChatDatabase } from '@/database/type';

export async function getVideoFreeQuota(
  userId: string,
  _model: string,
  db?: LobeChatDatabase,
): Promise<{ limit: number; used: number } | null> {
  const shouldCharge = await shouldChargeCommercialUsage({
    db: db!,
    provider: 'newapi',
    userId,
  });

  if (!shouldCharge) {
    return { limit: Infinity, used: 0 };
  }

  return null;
}
