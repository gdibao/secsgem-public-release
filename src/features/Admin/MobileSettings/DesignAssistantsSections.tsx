import { Button, Flexbox } from '@lobehub/ui';
import { Input } from 'antd';

import type { MobileFeaturedAssistantV1 } from '@/const/mobileConfig';

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
  type ModelOption,
  moveOrderedItem,
  removeOrderedItem,
  type SelectOption,
  type SelectorStatus,
  sortByOrder,
  updateDesignTool,
} from '../mobileSettingsHelpers';
import { mobileSettingsStyles as styles } from './styles';
import type { MobileSettingsSectionProps } from './types';

export const DesignToolsSection = ({ formValues, tr, updateForm }: MobileSettingsSectionProps) => (
  <section aria-label={tr('admin.mobile.designTools', 'Design Tools')} className={styles.section}>
    <h2 className={styles.sectionTitle}>{tr('admin.mobile.designTools', 'Design Tools')}</h2>
    {sortByOrder(formValues.design.tools).map((tool, index, tools) => (
      <div className={styles.itemRow} key={tool.id}>
        <LabeledField label={tr('admin.mobile.toolLabel', 'Tool {{id}} label', { id: tool.id })}>
          <Input
            aria-label={tr('admin.mobile.toolLabel', 'Tool {{id}} label', { id: tool.id })}
            value={tool.label}
            onChange={(event) =>
              updateForm(updateDesignTool(formValues, tool.id, { label: event.target.value }))
            }
          />
        </LabeledField>
        <LabeledField label={tr('admin.mobile.toolIcon', 'Tool {{id}} icon', { id: tool.id })}>
          <IconSelect
            label={tr('admin.mobile.toolIcon', 'Tool {{id}} icon', { id: tool.id })}
            value={tool.icon}
            onChange={(icon) => updateForm(updateDesignTool(formValues, tool.id, { icon }))}
          />
        </LabeledField>
        <OrderButtons
          label={tr('admin.mobile.target.tool', 'tool {{id}}', { id: tool.id })}
          position={index}
          total={tools.length}
          onMove={(direction) =>
            updateForm({
              ...formValues,
              design: {
                tools: moveOrderedItem(
                  formValues.design.tools,
                  (item) => item.id === tool.id,
                  direction,
                ),
              },
            })
          }
        />
        <AccessibleSwitch
          checked={tool.enabled}
          label={tr('admin.mobile.toolEnabled', 'Tool {{id}} enabled', { id: tool.id })}
          onChange={(enabled) => updateForm(updateDesignTool(formValues, tool.id, { enabled }))}
        />
        <span />
      </div>
    ))}
  </section>
);

export const DiscoverCommunitySection = ({
  formValues,
  tr,
  updateForm,
}: MobileSettingsSectionProps) => (
  <section
    aria-label={tr('admin.mobile.discoverCommunity', 'Discover community')}
    className={styles.section}
  >
    <h2 className={styles.sectionTitle}>
      {tr('admin.mobile.discoverCommunity', 'Discover community')}
    </h2>
    <div className={styles.grid}>
      <LabeledField label={tr('admin.mobile.communityTitle', 'Community section title')}>
        <Input
          aria-label={tr('admin.mobile.communityTitle', 'Community section title')}
          value={formValues.discover.community.title}
          onChange={(event) =>
            updateForm({
              ...formValues,
              discover: {
                ...formValues.discover,
                community: { ...formValues.discover.community, title: event.target.value },
              },
            })
          }
        />
      </LabeledField>
      <AccessibleSwitch
        checked={formValues.discover.community.enabled}
        label={tr('admin.mobile.communityEnabled', 'Show community section')}
        onChange={(enabled) =>
          updateForm({
            ...formValues,
            discover: {
              ...formValues.discover,
              community: { ...formValues.discover.community, enabled },
            },
          })
        }
      />
    </div>
  </section>
);

interface FeaturedAssistantsSectionProps extends MobileSettingsSectionProps {
  assistantOptions: SelectOption[];
  assistantStatus: SelectorStatus;
  modelOptions: ModelOption[];
  modelStatus: SelectorStatus;
  onLoadAssistants: () => void;
  onLoadModels: () => void;
  onRetryAssistants: () => void;
  onRetryModels: () => void;
  selectedAssistantId: string;
  selectedModelValue: string;
  setSelectedAssistantId: (value: string) => void;
  setSelectedModelValue: (value: string) => void;
}

export const FeaturedAssistantsSection = ({
  assistantOptions,
  assistantStatus,
  formValues,
  modelOptions,
  modelStatus,
  onLoadAssistants,
  onLoadModels,
  onRetryAssistants,
  onRetryModels,
  selectedAssistantId,
  selectedModelValue,
  setSelectedAssistantId,
  setSelectedModelValue,
  tr,
  updateForm,
}: FeaturedAssistantsSectionProps) => {
  const selectorUnavailable = Boolean(assistantStatus.error || modelStatus.error);
  const canAdd =
    !selectorUnavailable &&
    formValues.discover.assistants.length < 4 &&
    Boolean(selectedAssistantId && selectedModelValue);

  const addAssistant = () => {
    if (!canAdd) return;
    const assistant = assistantOptions.find((option) => option.value === selectedAssistantId);
    const model = modelOptions.find((option) => option.value === selectedModelValue);
    if (!assistant || !model) return;
    if (formValues.discover.assistants.some((item) => item.assistantId === assistant.value)) return;

    const nextAssistant: MobileFeaturedAssistantV1 = {
      assistantId: assistant.value,
      model: model.model,
      modelLabelOverride: '推荐',
      order: formValues.discover.assistants.length + 1,
      provider: model.provider,
      titleOverride: assistant.label,
    };
    updateForm({
      ...formValues,
      discover: {
        ...formValues.discover,
        assistants: [...formValues.discover.assistants, nextAssistant],
      },
    });
  };

  return (
    <section
      aria-label={tr('admin.mobile.featuredAssistants', 'Featured Assistants')}
      className={styles.section}
    >
      <h2 className={styles.sectionTitle}>
        {tr('admin.mobile.featuredAssistants', 'Featured Assistants')}
      </h2>
      <SelectorAlert
        label={tr('admin.mobile.assistantSelectorUnavailable', 'Assistant selector unavailable.')}
        retryLabel={tr('admin.mobile.retryAssistantSelector', 'Retry assistant selector')}
        status={assistantStatus}
        onRetry={onRetryAssistants}
      />
      <SelectorAlert
        label={tr('admin.mobile.modelSelectorUnavailable', 'Model selector unavailable.')}
        retryLabel={tr('admin.mobile.retryModelSelector', 'Retry model selector')}
        status={modelStatus}
        onRetry={onRetryModels}
      />
      <div className={styles.grid}>
        <Button disabled={assistantStatus.loading} loading={assistantStatus.loading} onClick={onLoadAssistants}>
          {tr('admin.mobile.loadAssistantOptions', 'Load assistant options')}
        </Button>
        <Button disabled={modelStatus.loading} loading={modelStatus.loading} onClick={onLoadModels}>
          {tr('admin.mobile.loadModelOptions', 'Load model options')}
        </Button>
        <SelectField
          disabled={
            assistantStatus.loading || Boolean(assistantStatus.error) || assistantOptions.length === 0
          }
          label={tr('admin.mobile.featuredAssistant', 'Featured assistant')}
          options={assistantOptions}
          value={selectedAssistantId}
          onChange={setSelectedAssistantId}
        />
        <SelectField
          disabled={modelStatus.loading || Boolean(modelStatus.error) || modelOptions.length === 0}
          label={tr('admin.mobile.displayModel', 'Display model')}
          options={modelOptions}
          value={selectedModelValue}
          onChange={setSelectedModelValue}
        />
        <Button disabled={!canAdd} onClick={addAssistant}>
          {tr('admin.mobile.addFeaturedAssistant', 'Add featured assistant')}
        </Button>
      </div>
      <Flexbox gap={8}>
        {sortByOrder(formValues.discover.assistants).map((assistant, index, assistants) => (
          <div className={styles.orderedEntry} key={assistant.assistantId}>
            <div className={styles.grid}>
              <LabeledField
                label={tr('admin.mobile.assistantTitle', 'Assistant {{id}} title', {
                  id: assistant.assistantId,
                })}
              >
                <Input
                  value={assistant.titleOverride ?? ''}
                  aria-label={tr('admin.mobile.assistantTitle', 'Assistant {{id}} title', {
                    id: assistant.assistantId,
                  })}
                  onChange={(event) =>
                    updateForm({
                      ...formValues,
                      discover: {
                        ...formValues.discover,
                        assistants: formValues.discover.assistants.map((item) =>
                          item.assistantId === assistant.assistantId
                            ? { ...item, titleOverride: event.target.value || undefined }
                            : item,
                        ),
                      },
                    })
                  }
                />
              </LabeledField>
              <LabeledField
                label={tr('admin.mobile.assistantDescription', 'Assistant {{id}} description', {
                  id: assistant.assistantId,
                })}
              >
                <Input
                  value={assistant.descriptionOverride ?? ''}
                  aria-label={tr(
                    'admin.mobile.assistantDescription',
                    'Assistant {{id}} description',
                    {
                      id: assistant.assistantId,
                    },
                  )}
                  onChange={(event) =>
                    updateForm({
                      ...formValues,
                      discover: {
                        ...formValues.discover,
                        assistants: formValues.discover.assistants.map((item) =>
                          item.assistantId === assistant.assistantId
                            ? { ...item, descriptionOverride: event.target.value || undefined }
                            : item,
                        ),
                      },
                    })
                  }
                />
              </LabeledField>
              <LabeledField
                label={tr('admin.mobile.assistantModelLabel', 'Assistant {{id}} model label', {
                  id: assistant.assistantId,
                })}
              >
                <Input
                  placeholder="推荐"
                  value={assistant.modelLabelOverride ?? ''}
                  aria-label={tr(
                    'admin.mobile.assistantModelLabel',
                    'Assistant {{id}} model label',
                    {
                      id: assistant.assistantId,
                    },
                  )}
                  onChange={(event) =>
                    updateForm({
                      ...formValues,
                      discover: {
                        ...formValues.discover,
                        assistants: formValues.discover.assistants.map((item) =>
                          item.assistantId === assistant.assistantId
                            ? { ...item, modelLabelOverride: event.target.value || undefined }
                            : item,
                        ),
                      },
                    })
                  }
                />
              </LabeledField>
            </div>
            <Flexbox horizontal gap={4}>
              <OrderButtons
                position={index}
                total={assistants.length}
                label={tr('admin.mobile.target.assistant', 'assistant {{id}}', {
                  id: assistant.assistantId,
                })}
                onMove={(direction) =>
                  updateForm({
                    ...formValues,
                    discover: {
                      ...formValues.discover,
                      assistants: moveOrderedItem(
                        formValues.discover.assistants,
                        (item) => item.assistantId === assistant.assistantId,
                        direction,
                      ),
                    },
                  })
                }
              />
              <RemoveButton
                label={tr('admin.mobile.target.assistant', 'assistant {{id}}', {
                  id: assistant.assistantId,
                })}
                onClick={() =>
                  updateForm({
                    ...formValues,
                    discover: {
                      ...formValues.discover,
                      assistants: removeOrderedItem(
                        formValues.discover.assistants,
                        (item) => item.assistantId === assistant.assistantId,
                      ),
                    },
                  })
                }
              />
            </Flexbox>
          </div>
        ))}
      </Flexbox>
    </section>
  );
};
