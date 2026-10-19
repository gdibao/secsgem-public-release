import type { FormInstance } from 'antd';
import { useCallback, useEffect, useState } from 'react';

import type { DesktopSettingsValues } from './desktopSettingsForm';

export const useDesktopSettingsFormSync = (
  form: FormInstance<DesktopSettingsValues>,
  hasData: boolean,
  initialValues: DesktopSettingsValues,
  onDirtyChange?: (dirty: boolean) => void,
) => {
  const [dirtyFields, setDirtyFields] = useState<ReadonlySet<keyof DesktopSettingsValues>>(
    () => new Set(),
  );

  useEffect(() => {
    if (!hasData) return;

    const synchronizedValues = Object.fromEntries(
      Object.entries(initialValues).filter(
        ([field]) => !dirtyFields.has(field as keyof DesktopSettingsValues),
      ),
    ) as Partial<DesktopSettingsValues>;
    form.setFieldsValue(synchronizedValues);
  }, [dirtyFields, form, hasData, initialValues]);

  useEffect(() => {
    onDirtyChange?.(dirtyFields.size > 0);
  }, [dirtyFields, onDirtyChange]);

  const markSaved = useCallback(() => setDirtyFields(new Set()), []);
  const markEdited = useCallback(
    (changedValues: Partial<DesktopSettingsValues>, allValues: DesktopSettingsValues) => {
      setDirtyFields((current) => {
        const next = new Set(current);
        let changed = false;

        for (const field of Object.keys(changedValues) as Array<keyof DesktopSettingsValues>) {
          const isDirty = !Object.is(allValues[field], initialValues[field]);
          if (isDirty === next.has(field)) continue;

          changed = true;
          if (isDirty) next.add(field);
          else next.delete(field);
        }

        return changed ? next : current;
      });
    },
    [initialValues],
  );

  return { dirtyFields, markEdited, markSaved };
};
