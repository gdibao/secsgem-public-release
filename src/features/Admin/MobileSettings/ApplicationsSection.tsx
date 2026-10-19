import { Button, Flexbox } from '@lobehub/ui';
import { Input } from 'antd';

import {
  AccessibleSwitch,
  IconSelect,
  LabeledField,
  OrderButtons,
  RemoveButton,
  SelectField,
  SelectorAlert,
} from '../MobileSettingsControls';
import {
  moveArrayItem,
  moveOrderedItem,
  type SelectOption,
  type SelectorStatus,
  sortByOrder,
  updateBuiltinApp,
} from '../mobileSettingsHelpers';
import { mobileSettingsStyles as styles } from './styles';
import type { MobileSettingsSectionProps } from './types';

interface ApplicationsSectionProps extends MobileSettingsSectionProps {
  moduleAppOptions: SelectOption[];
  moduleAppStatus: SelectorStatus;
  onLoadModuleApps: () => void;
  onRetryModuleApps: () => void;
  selectedModuleAppId: string;
  setSelectedModuleAppId: (value: string) => void;
}

export const ApplicationsSection = ({
  formValues,
  moduleAppOptions,
  moduleAppStatus,
  onLoadModuleApps,
  onRetryModuleApps,
  selectedModuleAppId,
  setSelectedModuleAppId,
  tr,
  updateForm,
}: ApplicationsSectionProps) => {
  const canAdd = !moduleAppStatus.error && Boolean(selectedModuleAppId);
  const addModuleApp = () => {
    if (!canAdd || formValues.applications.featuredModuleAppIds.includes(selectedModuleAppId)) {
      return;
    }
    updateForm({
      ...formValues,
      applications: {
        ...formValues.applications,
        featuredModuleAppIds: [
          ...formValues.applications.featuredModuleAppIds,
          selectedModuleAppId,
        ],
      },
    });
  };

  return (
    <section aria-label={tr('admin.mobile.appEntries', 'App Entries')} className={styles.section}>
      <h2 className={styles.sectionTitle}>{tr('admin.mobile.appEntries', 'App Entries')}</h2>
      <SelectorAlert
        label={tr('admin.mobile.moduleAppSelectorUnavailable', 'Module app selector unavailable.')}
        retryLabel={tr('admin.mobile.retryModuleAppSelector', 'Retry module app selector')}
        status={moduleAppStatus}
        onRetry={onRetryModuleApps}
      />
      <div className={styles.grid}>
        <Button
          disabled={moduleAppStatus.loading}
          loading={moduleAppStatus.loading}
          onClick={onLoadModuleApps}
        >
          {tr('admin.mobile.loadModuleAppOptions', 'Load module app options')}
        </Button>
        <SelectField
          disabled={
            moduleAppStatus.loading || Boolean(moduleAppStatus.error) || moduleAppOptions.length === 0
          }
          label={tr('admin.mobile.featuredModuleApp', 'Featured module app')}
          options={moduleAppOptions}
          value={selectedModuleAppId}
          onChange={setSelectedModuleAppId}
        />
        <Button disabled={!canAdd} onClick={addModuleApp}>
          {tr('admin.mobile.addModuleApp', 'Add module app')}
        </Button>
      </div>
      <Flexbox gap={8}>
        {formValues.applications.featuredModuleAppIds.map((id, index, ids) => (
          <div className={styles.orderedEntry} key={id}>
            <span>{moduleAppOptions.find((option) => option.value === id)?.label ?? id}</span>
            <Flexbox horizontal gap={4}>
              <OrderButtons
                label={tr('admin.mobile.target.moduleApp', 'module app {{id}}', { id })}
                position={index}
                total={ids.length}
                onMove={(direction) =>
                  updateForm({
                    ...formValues,
                    applications: {
                      ...formValues.applications,
                      featuredModuleAppIds: moveArrayItem(
                        formValues.applications.featuredModuleAppIds,
                        id,
                        direction,
                      ),
                    },
                  })
                }
              />
              <RemoveButton
                label={tr('admin.mobile.target.moduleApp', 'module app {{id}}', { id })}
                onClick={() =>
                  updateForm({
                    ...formValues,
                    applications: {
                      ...formValues.applications,
                      featuredModuleAppIds: formValues.applications.featuredModuleAppIds.filter(
                        (appId) => appId !== id,
                      ),
                    },
                  })
                }
              />
            </Flexbox>
          </div>
        ))}
      </Flexbox>
      {sortByOrder(formValues.applications.builtins).map((app, index, apps) => (
        <div className={styles.itemRow} key={app.id}>
          <LabeledField
            label={tr('admin.mobile.builtinLabel', 'Builtin {{id}} label', { id: app.id })}
          >
            <Input
              aria-label={tr('admin.mobile.builtinLabel', 'Builtin {{id}} label', { id: app.id })}
              value={app.label}
              onChange={(event) =>
                updateForm(updateBuiltinApp(formValues, app.id, { label: event.target.value }))
              }
            />
          </LabeledField>
          <LabeledField
            label={tr('admin.mobile.builtinPath', 'Builtin {{id}} path', { id: app.id })}
          >
            <Input
              aria-label={tr('admin.mobile.builtinPath', 'Builtin {{id}} path', { id: app.id })}
              value={app.path}
              onChange={(event) =>
                updateForm(updateBuiltinApp(formValues, app.id, { path: event.target.value }))
              }
            />
          </LabeledField>
          <LabeledField
            label={tr('admin.mobile.builtinIcon', 'Builtin {{id}} icon', { id: app.id })}
          >
            <IconSelect
              label={tr('admin.mobile.builtinIcon', 'Builtin {{id}} icon', { id: app.id })}
              value={app.icon}
              onChange={(icon) => updateForm(updateBuiltinApp(formValues, app.id, { icon }))}
            />
          </LabeledField>
          <AccessibleSwitch
            checked={app.enabled}
            label={tr('admin.mobile.builtinEnabled', 'Builtin {{id}} enabled', { id: app.id })}
            onChange={(enabled) => updateForm(updateBuiltinApp(formValues, app.id, { enabled }))}
          />
          <OrderButtons
            label={tr('admin.mobile.target.builtin', 'builtin {{id}}', { id: app.id })}
            position={index}
            total={apps.length}
            onMove={(direction) =>
              updateForm({
                ...formValues,
                applications: {
                  ...formValues.applications,
                  builtins: moveOrderedItem(
                    formValues.applications.builtins,
                    (item) => item.id === app.id,
                    direction,
                  ),
                },
              })
            }
          />
        </div>
      ))}
    </section>
  );
};
