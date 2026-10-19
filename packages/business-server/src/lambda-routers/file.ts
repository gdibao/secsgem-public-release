import { TRPCError } from '@trpc/server';

import type { Transaction } from '@/database/type';
import { APP_SETTING_KEYS, getAppSettingValue } from '@/server/services/appSettings';

export interface BusinessFileUploadCheckParams {
  actualSize: number;
  clientIp?: string;
  inputSize: number;
  transaction?: Transaction;
  url: string;
  userId: string;
  workspaceId?: string | null;
}

export async function businessFileUploadCheck(
  _params: BusinessFileUploadCheckParams,
): Promise<void> {
  const [maxInputSizeMb, maxActualSizeMb] = await Promise.all([
    getAppSettingValue(APP_SETTING_KEYS.uploadMaxInputSizeMb),
    getAppSettingValue(APP_SETTING_KEYS.uploadMaxActualSizeMb),
  ]);
  const maxInputBytes =
    typeof maxInputSizeMb === 'number' && maxInputSizeMb > 0 ? maxInputSizeMb * 1024 * 1024 : 0;
  const maxActualBytes =
    typeof maxActualSizeMb === 'number' && maxActualSizeMb > 0 ? maxActualSizeMb * 1024 * 1024 : 0;

  if (maxInputBytes > 0 && _params.inputSize > maxInputBytes) {
    throw new TRPCError({
      code: 'PAYLOAD_TOO_LARGE',
      message: `Declared file size exceeds limit: ${maxInputSizeMb}MB`,
    });
  }

  if (maxActualBytes > 0 && _params.actualSize > maxActualBytes) {
    throw new TRPCError({
      code: 'PAYLOAD_TOO_LARGE',
      message: `Actual file size exceeds limit: ${maxActualSizeMb}MB`,
    });
  }
}

export interface BusinessFileTransferStorageCheckParams {
  additionalSize: number;
  targetUserId: string;
  targetWorkspaceId: string | null;
}

export async function businessFileTransferStorageCheck(
  _params: BusinessFileTransferStorageCheckParams,
): Promise<void> {}
