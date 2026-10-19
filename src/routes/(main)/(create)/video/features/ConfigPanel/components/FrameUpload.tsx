import { memo } from 'react';

import { ImageUpload } from '@/routes/(main)/(create)/image/features/ConfigPanel';
import { useVideoGenerationConfigParam } from '@/store/video/slices/generationConfig/hooks';

interface FrameUploadProps {
  paramName: 'endImageUrl' | 'imageUrl';
}

const FrameUpload = memo<FrameUploadProps>(({ paramName }) => {
  const { value, setValue, maxFileSize, imageConstraints } =
    useVideoGenerationConfigParam(paramName);
  const setFrameValue = setValue as unknown as (next: string | null) => void;

  const handleChange = (
    data?: string | { dimensions?: { height: number; width: number }; url: string },
  ) => {
    const url = typeof data === 'string' ? data : data?.url;
    setFrameValue(url ?? null);
  };

  return (
    <ImageUpload
      imageConstraints={imageConstraints}
      maxFileSize={maxFileSize}
      placeholderHeight={120}
      value={value}
      onChange={handleChange}
    />
  );
});

export default FrameUpload;
