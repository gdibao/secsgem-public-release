import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Trash2 } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { moduleAppService } from '@/services/moduleApp';

type InstallationSecretMetadata = {
  createdAt: Date | string;
  secretKey: string;
  updatedAt: Date | string;
};

type InstallationSecretState = {
  items: InstallationSecretMetadata[];
  missingKeys: string[];
  ready: boolean;
  requiredKeys: string[];
};

interface InstallationSecretsProps {
  installationId: string;
  onChange?: () => Promise<unknown> | void;
  workspaceId?: string;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  error: css`
    margin: 0;
    font-size: 13px;
    color: ${cssVar.colorError};
  `,
  field: css`
    min-width: 0;
    height: 40px;
    padding-block: 0;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};
    outline: none;

    &:focus-visible {
      border-color: ${cssVar.colorPrimary};
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBg};
    }
  `,
  heading: css`
    margin: 0;

    font-size: 18px;
    font-weight: 600;
    line-height: 26px;
    color: ${cssVar.colorText};
  `,
  key: css`
    min-width: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
  row: css`
    display: grid;
    grid-template-columns: minmax(120px, 0.65fr) minmax(180px, 1fr) auto auto;
    gap: 10px;
    align-items: center;

    min-height: 58px;
    padding-block: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    @media (width < 600px) {
      grid-template-columns: minmax(0, 1fr) auto;

      & > input {
        grid-column: 1 / -1;
        grid-row: 2;
      }
    }
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 8px;

    padding-block-start: 20px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  status: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const InstallationSecrets = memo<InstallationSecretsProps>(
  ({ installationId, onChange, workspaceId }) => {
    const { t } = useTranslation('common');
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [savingKey, setSavingKey] = useState<string>();
    const [error, setError] = useState(false);
    const scope = useMemo(() => ({ installationId, workspaceId }), [installationId, workspaceId]);
    const secrets = useSWR<InstallationSecretState>(
      ['moduleApp.listInstallationSecrets', installationId, workspaceId],
      () => moduleAppService.listInstallationSecrets(scope) as Promise<InstallationSecretState>,
    );
    const configuredKeys = useMemo(
      () => new Set(secrets.data?.items.map((item) => item.secretKey)),
      [secrets.data],
    );
    const loading = secrets.isLoading || (!secrets.data && !secrets.error);
    const requiredKeys = secrets.data?.requiredKeys ?? [];

    const save = async (secretKey: string) => {
      const value = drafts[secretKey];
      if (!value) return;

      setError(false);
      setSavingKey(secretKey);
      try {
        await moduleAppService.upsertInstallationSecret({ ...scope, secretKey, value });
        setDrafts((current) =>
          current[secretKey] === value ? { ...current, [secretKey]: '' } : current,
        );
        await secrets.mutate();
        await onChange?.();
      } catch {
        setError(true);
      } finally {
        setSavingKey(undefined);
      }
    };

    const remove = (secretKey: string) => {
      confirmModal({
        content: t('moduleApps.secrets.deleteConfirm', { key: secretKey }),
        okButtonProps: { danger: true },
        title: t('moduleApps.secrets.delete'),
        onOk: async () => {
          setError(false);
          try {
            await moduleAppService.deleteInstallationSecret({ ...scope, secretKey });
            await secrets.mutate();
            await onChange?.();
          } catch {
            setError(true);
          }
        },
      });
    };

    if (!loading && !secrets.error && requiredKeys.length === 0) return null;

    return (
      <section
        aria-busy={loading}
        className={styles.section}
        data-testid="module-app-installation-secrets"
      >
        <h2 className={styles.heading}>{t('moduleApps.secrets.title')}</h2>
        {secrets.error || error ? (
          <p className={styles.error} role="alert">
            {t('moduleApps.secrets.error')}
          </p>
        ) : null}
        {loading ? <div className={styles.status}>{t('moduleApps.secrets.loading')}</div> : null}
        {requiredKeys.map((secretKey) => {
          const configured = configuredKeys.has(secretKey);
          const inputId = `module-app-secret-${installationId}-${secretKey}`;

          return (
            <div className={styles.row} key={secretKey}>
              <div>
                <label className={styles.key} htmlFor={inputId}>
                  {secretKey}
                </label>
                <div className={styles.status}>
                  {t(
                    loading
                      ? 'moduleApps.secrets.loading'
                      : configured
                        ? 'moduleApps.secrets.configured'
                        : 'moduleApps.secrets.notConfigured',
                  )}
                </div>
              </div>
              <input
                autoComplete="new-password"
                className={styles.field}
                disabled={loading}
                id={inputId}
                maxLength={16 * 1024}
                placeholder={configured ? '********' : undefined}
                type="password"
                value={drafts[secretKey] ?? ''}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [secretKey]: event.target.value }))
                }
              />
              <Button
                disabled={loading || !drafts[secretKey]}
                loading={savingKey === secretKey}
                type="primary"
                onClick={() => void save(secretKey)}
              >
                {t(configured ? 'moduleApps.secrets.rotate' : 'moduleApps.secrets.set')}
              </Button>
              <Button
                aria-label={t('moduleApps.secrets.deleteKey', { key: secretKey })}
                disabled={loading || savingKey === secretKey || !configured}
                icon={<Trash2 aria-hidden size={16} />}
                title={t('moduleApps.secrets.deleteKey', { key: secretKey })}
                type="text"
                onClick={() => remove(secretKey)}
              />
            </div>
          );
        })}
      </section>
    );
  },
);

InstallationSecrets.displayName = 'InstallationSecrets';

export default InstallationSecrets;
