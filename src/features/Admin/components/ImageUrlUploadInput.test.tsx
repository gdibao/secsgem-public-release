import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as AntdModule from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ImageUrlUploadInput from './ImageUrlUploadInput';

const mocks = vi.hoisted(() => ({
  createFile: vi.fn(),
  uploadFileToS3: vi.fn(),
}));

vi.mock('@/services/file', () => ({
  fileService: {
    createFile: mocks.createFile,
  },
}));

vi.mock('@/services/upload', () => ({
  uploadService: {
    uploadFileToS3: mocks.uploadFileToS3,
  },
}));

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof AntdModule>();

  return {
    ...actual,
    message: {
      error: vi.fn(),
      success: vi.fn(),
    },
  };
});

describe('ImageUrlUploadInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes a file proxy URL back to the controlled input when no public URL prefix is configured', async () => {
    mocks.uploadFileToS3.mockResolvedValue({
      data: {
        date: '1',
        dirname: 'admin-assets/1',
        filename: 'logo.png',
        path: 'admin-assets/1/logo.png',
      },
      success: true,
    });
    mocks.createFile.mockResolvedValue({ id: 'file-1', url: '/f/file-1' });

    const onChange = vi.fn();
    const { container } = render(
      <ImageUrlUploadInput
        uploadDirectory="admin-assets"
        value="/old/logo.png"
        onChange={onChange}
      />,
    );

    expect(screen.getByDisplayValue('/old/logo.png')).toBeInTheDocument();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [new File(['image'], 'logo.png', { type: 'image/png' })],
      },
    });

    await waitFor(() =>
      expect(mocks.uploadFileToS3).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({ directory: 'admin-assets' }),
      ),
    );

    await waitFor(() =>
      expect(mocks.createFile).toHaveBeenCalledWith({
        fileType: 'image/png',
        hash: expect.any(String),
        metadata: expect.objectContaining({ path: 'admin-assets/1/logo.png' }),
        name: 'logo.png',
        size: 5,
        source: 'admin-settings',
        url: 'admin-assets/1/logo.png',
      }),
    );

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('/f/file-1'));
  });

  it('writes a public image URL when a public URL prefix is provided', async () => {
    mocks.uploadFileToS3.mockResolvedValue({
      data: {
        date: '1',
        dirname: 'admin-assets/1',
        filename: 'logo.png',
        path: 'admin-assets/1/logo.png',
      },
      success: true,
    });

    const onChange = vi.fn();
    const { container } = render(
      <ImageUrlUploadInput
        publicUrlPrefix="https://cdn.example.com/assets/"
        uploadDirectory="admin-assets"
        value=""
        onChange={onChange}
      />,
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [new File(['image'], 'logo.png', { type: 'image/png' })],
      },
    });

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        'https://cdn.example.com/assets/admin-assets/1/logo.png',
      ),
    );
    expect(mocks.createFile).not.toHaveBeenCalled();
  });
});
