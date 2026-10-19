import { MODULE_APP_PACKAGE_MAX_ARCHIVE_BYTES } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { LoaderCircle, Upload } from 'lucide-react';
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { moduleAppService } from '@/services/moduleApp';

type UploadState =
  | { message: string; status: 'error' | 'success' }
  | { status: 'idle' | 'uploading' };

type ModuleAppPackageUploaderProps = {
  onSubmitted?: () => Promise<void> | void;
};

const QUOTA_ERRORS = new Set([
  'MODULE_APP_PACKAGE_DAILY_UPLOAD_LIMIT',
  'MODULE_APP_PACKAGE_OPEN_UPLOAD_LIMIT',
  'MODULE_APP_PACKAGE_STORAGE_QUOTA_EXCEEDED',
]);

const SECURITY_ERRORS = new Set([
  'module_app_package_archive_metadata_invalid',
  'module_app_package_eicar_detected',
  'module_app_package_encrypted_entry',
  'module_app_package_executable_magic',
  'module_app_package_forbidden_extension',
  'module_app_package_nested_archive',
  'module_app_package_symbolic_link',
]);

const getUploadErrorKey = (error: unknown) => {
  const identifier = error instanceof Error ? error.message : '';
  if (QUOTA_ERRORS.has(identifier)) return 'moduleApps.packageUploader.quotaExceeded';
  if (identifier === 'MODULE_APP_PACKAGE_UPLOAD_EXPIRED') {
    return 'moduleApps.packageUploader.expired';
  }
  if (
    identifier === 'module_app_package_actual_size_exceeded' ||
    identifier === 'module_app_package_archive_too_large'
  ) {
    return 'moduleApps.packageUploader.tooLarge';
  }
  if (SECURITY_ERRORS.has(identifier)) return 'moduleApps.packageUploader.securityRejected';
  return 'moduleApps.packageUploader.failure';
};

const ModuleAppPackageUploader = memo<ModuleAppPackageUploaderProps>(({ onSubmitted }) => {
  const { t } = useTranslation('common');
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ status: 'idle' });
  const uploading = state.status === 'uploading';

  const handleFile = async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setState({ message: t('moduleApps.packageUploader.zipOnly'), status: 'error' });
      return;
    }
    if (file.size > MODULE_APP_PACKAGE_MAX_ARCHIVE_BYTES) {
      setState({ message: t('moduleApps.packageUploader.tooLarge'), status: 'error' });
      return;
    }

    setState({ status: 'uploading' });
    try {
      await moduleAppService.uploadPackage(file);
      setState({ message: t('moduleApps.packageUploader.success'), status: 'success' });
      await Promise.resolve(onSubmitted?.()).catch(() => undefined);
    } catch (error) {
      setState({ message: t(getUploadErrorKey(error)), status: 'error' });
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Flexbox horizontal align={'center'} gap={12}>
      <input
        hidden
        accept={'.zip,application/zip,application/x-zip-compressed'}
        aria-label={t('moduleApps.packageUploader.fileLabel')}
        ref={inputRef}
        type={'file'}
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
      <Button
        disabled={uploading}
        htmlType={'button'}
        icon={<Icon icon={uploading ? LoaderCircle : Upload} spin={uploading} />}
        type={'primary'}
        onClick={() => inputRef.current?.click()}
      >
        {t('moduleApps.packageUploader.submit')}
      </Button>
      {'message' in state && (
        <small aria-live={'polite'} role={state.status === 'error' ? 'alert' : 'status'}>
          {state.message}
        </small>
      )}
    </Flexbox>
  );
});

ModuleAppPackageUploader.displayName = 'ModuleAppPackageUploader';

export default ModuleAppPackageUploader;
