import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModuleAppPackageUploader from './PackageUploader';

const mockUploadPackage = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, htmlType, icon, ...props }: any) => (
    <button type={htmlType} {...props}>
      {icon}
      {children}
    </button>
  ),
}));

vi.mock('@/services/moduleApp', () => ({
  moduleAppService: { uploadPackage: mockUploadPackage },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ModuleAppPackageUploader', () => {
  beforeEach(() => {
    mockUploadPackage.mockReset().mockResolvedValue({ id: 'package-1' });
  });

  it('uploads a selected ZIP and reports review submission', async () => {
    const onSubmitted = vi.fn();
    render(<ModuleAppPackageUploader onSubmitted={onSubmitted} />);
    const file = new File(['zip-content'], 'package-app.zip', { type: 'application/zip' });

    fireEvent.change(screen.getByLabelText('moduleApps.packageUploader.fileLabel'), {
      target: { files: [file] },
    });

    await waitFor(() => expect(mockUploadPackage).toHaveBeenCalledWith(file));
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent('moduleApps.packageUploader.success');
  });

  it('rejects non-ZIP files before upload', async () => {
    render(<ModuleAppPackageUploader />);

    fireEvent.change(screen.getByLabelText('moduleApps.packageUploader.fileLabel'), {
      target: { files: [new File(['text'], 'package.txt', { type: 'text/plain' })] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('moduleApps.packageUploader.zipOnly');
    expect(mockUploadPackage).not.toHaveBeenCalled();
  });

  it.each([
    ['MODULE_APP_PACKAGE_OPEN_UPLOAD_LIMIT', 'moduleApps.packageUploader.quotaExceeded'],
    ['MODULE_APP_PACKAGE_UPLOAD_EXPIRED', 'moduleApps.packageUploader.expired'],
    ['module_app_package_forbidden_extension', 'moduleApps.packageUploader.securityRejected'],
  ])('shows a specific message for %s', async (code, messageKey) => {
    mockUploadPackage.mockRejectedValueOnce(new Error(code));
    render(<ModuleAppPackageUploader />);
    const file = new File(['zip-content'], 'package-app.zip', { type: 'application/zip' });

    fireEvent.change(screen.getByLabelText('moduleApps.packageUploader.fileLabel'), {
      target: { files: [file] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(messageKey);
  });
});
