'use client';

import { Button, Input, message, Space, Upload } from 'antd';
import { sha256 } from 'js-sha256';
import { ImageUpIcon } from 'lucide-react';
import { type CSSProperties, memo, useState } from 'react';

import { fileService } from '@/services/file';
import { uploadService } from '@/services/upload';

type ImageUrlUploadInputProps = {
  disabled?: boolean;
  onChange?: (value: string) => void;
  placeholder?: string;
  publicUrlPrefix?: string;
  style?: CSSProperties;
  uploadDirectory?: string;
  value?: string;
};

const DEFAULT_UPLOAD_DIRECTORY = 'admin-assets';

const toPublicImageUrl = (path: string, publicUrlPrefix?: string) => {
  const normalizedPath = path.trim();
  const normalizedPrefix = publicUrlPrefix?.trim();

  if (!normalizedPath || !normalizedPrefix || /^https?:\/\//.test(normalizedPath)) {
    return normalizedPath;
  }

  return `${normalizedPrefix.replace(/\/+$/, '')}/${normalizedPath.replace(/^\/+/, '')}`;
};

const createUploadedImageUrl = async ({
  file,
  path,
  publicUrlPrefix,
  metadata,
}: {
  file: File;
  metadata: Record<string, unknown>;
  path: string;
  publicUrlPrefix?: string;
}) => {
  const publicUrl = toPublicImageUrl(path, publicUrlPrefix);

  if (publicUrl !== path) return publicUrl;

  const hash = sha256(await file.arrayBuffer());
  const record = await fileService.createFile({
    fileType: file.type,
    hash,
    metadata,
    name: file.name,
    size: file.size,
    source: 'admin-settings',
    url: path,
  });

  return record.url;
};

const ImageUrlUploadInput = memo<ImageUrlUploadInputProps>(
  ({
    disabled,
    onChange,
    placeholder,
    publicUrlPrefix,
    style,
    uploadDirectory = DEFAULT_UPLOAD_DIRECTORY,
    value,
  }) => {
    const [uploading, setUploading] = useState(false);

    const handleBeforeUpload = async (file: File) => {
      if (!file.type.startsWith('image/')) {
        message.error('请选择图片文件');
        return Upload.LIST_IGNORE;
      }

      setUploading(true);

      try {
        const result = await uploadService.uploadFileToS3(file, { directory: uploadDirectory });
        const imageUrl = await createUploadedImageUrl({
          file,
          metadata: result.data,
          path: result.data.path,
          publicUrlPrefix,
        });
        onChange?.(imageUrl);
        message.success('图片已上传');
      } catch {
        message.error('图片上传失败，请检查文件存储配置');
      } finally {
        setUploading(false);
      }

      return Upload.LIST_IGNORE;
    };

    return (
      <Space.Compact style={{ width: '100%', ...style }}>
        <Input
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
        />
        <Upload
          accept="image/*"
          beforeUpload={handleBeforeUpload}
          disabled={disabled || uploading}
          itemRender={() => null}
          maxCount={1}
          showUploadList={false}
        >
          <Button disabled={disabled || uploading} icon={<ImageUpIcon size={16} />} loading={uploading}>
            上传图片
          </Button>
        </Upload>
      </Space.Compact>
    );
  },
);

ImageUrlUploadInput.displayName = 'ImageUrlUploadInput';

export default ImageUrlUploadInput;
