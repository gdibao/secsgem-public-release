import type { MobilePublicConfigV1 } from '@/const/mobileConfig';

export type MobileSettingsTranslate = (
  key: string,
  defaultValue: string,
  values?: Record<string, unknown>,
) => string;

export interface MobileSettingsSectionProps {
  formValues: MobilePublicConfigV1;
  tr: MobileSettingsTranslate;
  updateForm: (next: MobilePublicConfigV1) => void;
}
