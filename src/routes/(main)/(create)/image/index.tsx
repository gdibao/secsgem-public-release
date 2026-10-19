'use client';

import { memo } from 'react';

import CreateGenerationPage from '@/routes/(main)/(create)/features/CreateGenerationPage';

import ImageWorkspace from './features/ImageWorkspace';
import PromptInput from './features/PromptInput';
import { useImageReferenceUpload } from './features/PromptInput/useImageReferenceUpload';

const ImagePage = memo<{ showHeader?: boolean }>(({ showHeader }) => {
  const { canDropImage, handleUploadFiles } = useImageReferenceUpload();

  return (
    <CreateGenerationPage
      PromptInput={PromptInput}
      Workspace={ImageWorkspace}
      dragDisabled={!canDropImage}
      path="/image"
      showHeader={showHeader}
      onUploadFiles={handleUploadFiles}
    />
  );
});

ImagePage.displayName = 'ImagePage';

export const MobileImagePage = memo(() => <ImagePage showHeader={false} />);
MobileImagePage.displayName = 'MobileImagePage';

export default ImagePage;
