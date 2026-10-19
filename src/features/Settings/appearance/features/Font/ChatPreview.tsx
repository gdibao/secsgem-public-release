import type { MarkdownProps } from '@lobehub/ui';
import { Center, Markdown } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useBrandName } from '@/features/Brand/useBrandName';

const ChatPreview = ({ fontSize }: Pick<MarkdownProps, 'fontSize'>) => {
  const { t } = useTranslation('welcome');
  const brandName = useBrandName();
  return (
    <Center>
      <Markdown fontSize={fontSize} variant={'chat'}>
        {t('guide.defaultMessageWithoutCreate', {
          appName: brandName,
        })}
      </Markdown>
    </Center>
  );
};

export default ChatPreview;
