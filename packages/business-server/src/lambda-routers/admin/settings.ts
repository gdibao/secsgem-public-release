import { router } from '@/libs/trpc/lambda';

import { adminSettingsReadProcedures } from '../../appSettings/readers/adminProcedures';
import { mobilePublicationReadProcedures } from '../../appSettings/readers/mobilePublicationProcedures';
import { publicSettingsProcedures } from '../../appSettings/readers/publicProcedures';
import { adminSettingsWriteProcedures } from '../../appSettings/writers/adminProcedures';
import { mobilePublicationWriteProcedures } from '../../appSettings/writers/mobilePublicationProcedures';
import { runtimeSettingsWriteProcedures } from '../../appSettings/writers/runtimeProcedures';

export { validateDefaultAgentModelUsability } from '../../appSettings/procedureShared';
export {
  buildUserGlobalSettingsSyncValues,
  syncUserGlobalSettingsDefaultsToUserSettings,
} from '../../appSettings/writers/adminProcedures';

export const adminSettingsRouter = router({
  ...publicSettingsProcedures,
  ...mobilePublicationReadProcedures,
  ...adminSettingsReadProcedures,
  ...adminSettingsWriteProcedures,
  ...mobilePublicationWriteProcedures,
  ...runtimeSettingsWriteProcedures,
});
