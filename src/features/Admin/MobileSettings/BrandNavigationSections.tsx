import { Input } from 'antd';
import { useEffect, useState } from 'react';

import { IconSelect, LabeledField, OrderButtons } from '../MobileSettingsControls';
import { moveNavigationItem, sortByOrder, updateNavigationItem } from '../mobileSettingsHelpers';
import { mobileSettingsStyles as styles } from './styles';
import type { MobileSettingsSectionProps } from './types';

const BrandLogoPreview = ({ alt, url }: { alt: string; url: string | null }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);

  if (!url || failed) return <span>{failed ? 'Logo unavailable' : 'No logo configured'}</span>;

  return <img alt={alt} height={32} src={url} width={32} onError={() => setFailed(true)} />;
};

export const BrandSection = ({ formValues, tr, updateForm }: MobileSettingsSectionProps) => (
  <section aria-label={tr('admin.mobile.brand', 'Brand')} className={styles.section}>
    <h2 className={styles.sectionTitle}>{tr('admin.mobile.brand', 'Brand')}</h2>
    <div className={styles.grid}>
      <LabeledField label={tr('admin.mobile.brandDisplayName', 'Brand display name')}>
        <Input
          aria-label={tr('admin.mobile.brandDisplayName', 'Brand display name')}
          value={formValues.brand.displayName ?? ''}
          onChange={(event) =>
            updateForm({
              ...formValues,
              brand: { ...formValues.brand, displayName: event.target.value || null },
            })
          }
        />
      </LabeledField>
      <LabeledField label={tr('admin.mobile.brandLogoUrl', 'Brand logo URL')}>
        <Input
          aria-label={tr('admin.mobile.brandLogoUrl', 'Brand logo URL')}
          value={formValues.brand.logoUrl ?? ''}
          onChange={(event) =>
            updateForm({
              ...formValues,
              brand: { ...formValues.brand, logoUrl: event.target.value || null },
            })
          }
        />
      </LabeledField>
      <div>
        <div>{tr('admin.mobile.brandLogoPreview', 'Logo preview')}</div>
        <BrandLogoPreview
          alt={formValues.brand.displayName || 'Mobile brand'}
          url={formValues.brand.logoUrl}
        />
      </div>
    </div>
  </section>
);

export const BottomNavigationSection = ({
  formValues,
  tr,
  updateForm,
}: MobileSettingsSectionProps) => (
  <section
    aria-label={tr('admin.mobile.bottomNavigation', 'Bottom Navigation')}
    className={styles.section}
  >
    <h2 className={styles.sectionTitle}>
      {tr('admin.mobile.bottomNavigation', 'Bottom Navigation')}
    </h2>
    {sortByOrder(formValues.navigation.items).map((item, index, items) => (
      <div className={styles.itemRow} key={item.id}>
        <LabeledField label={tr('admin.mobile.tabLabel', 'Tab {{id}} label', { id: item.id })}>
          <Input
            aria-label={tr('admin.mobile.tabLabel', 'Tab {{id}} label', { id: item.id })}
            value={item.label}
            onChange={(event) =>
              updateForm(updateNavigationItem(formValues, item.id, { label: event.target.value }))
            }
          />
        </LabeledField>
        <LabeledField label={tr('admin.mobile.tabPath', 'Tab {{id}} path', { id: item.id })}>
          <Input
            aria-label={tr('admin.mobile.tabPath', 'Tab {{id}} path', { id: item.id })}
            value={item.path}
            onChange={(event) =>
              updateForm(updateNavigationItem(formValues, item.id, { path: event.target.value }))
            }
          />
        </LabeledField>
        <LabeledField label={tr('admin.mobile.tabIcon', 'Tab {{id}} icon', { id: item.id })}>
          <IconSelect
            label={tr('admin.mobile.tabIcon', 'Tab {{id}} icon', { id: item.id })}
            value={item.icon}
            onChange={(icon) => updateForm(updateNavigationItem(formValues, item.id, { icon }))}
          />
        </LabeledField>
        <OrderButtons
          label={item.id}
          position={index}
          total={items.length}
          onMove={(direction) => updateForm(moveNavigationItem(formValues, item.id, direction))}
        />
      </div>
    ))}
  </section>
);
