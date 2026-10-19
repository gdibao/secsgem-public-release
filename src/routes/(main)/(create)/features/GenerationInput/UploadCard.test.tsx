import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import UploadCard from './UploadCard';

const mocks = vi.hoisted(() => ({
  uploadWithProgress: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick }: any) => (
    <button data-testid="remove-upload" type="button" onClick={onClick}>
      remove
    </button>
  ),
  Block: ({ children, onClick }: any) => (
    <div data-testid="upload-card" role="button" tabIndex={0} onClick={onClick}>
      {children}
    </div>
  ),
}));

vi.mock('antd', () => ({
  Spin: () => <span data-testid="upload-spinner" />,
}));

vi.mock('@/libs/next/Image', () => ({
  default: ({ src }: { src: string }) => <img alt="" data-testid="preview-img" src={src} />,
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: any) => selector({ uploadWithProgress: mocks.uploadWithProgress }),
}));

describe('UploadCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  it('keeps the local preview visible when upload does not return a file url', async () => {
    mocks.uploadWithProgress.mockResolvedValue(undefined);
    const onUpload = vi.fn();

    const { container } = render(<UploadCard onRemove={vi.fn()} onUpload={onUpload} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, {
      target: {
        files: [new File(['image'], 'ref.png', { type: 'image/png' })],
      },
    });

    await waitFor(() => expect(mocks.uploadWithProgress).toHaveBeenCalled());

    expect(onUpload).not.toHaveBeenCalled();
    expect(screen.getByTestId('preview-img')).toHaveAttribute('src', 'blob:preview');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:preview');
  });
});
