import { Flexbox, type FlexboxProps } from '@lobehub/ui';
import { type TypewriterEffectProps } from '@lobehub/ui/awesome';
import { TypewriterEffect } from '@lobehub/ui/awesome';
import { Avatar, Text } from '@lobehub/ui/base-ui';
import { LoadingDots } from '@lobehub/ui/chat';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';

interface LobeMessageProps extends Omit<FlexboxProps, 'children'> {
  fontSize?: number;
  logoUrl?: string;
  sentences: TypewriterEffectProps['sentences'];
}

const LobeMessage = memo<LobeMessageProps>(({ logoUrl, sentences, fontSize = 24, ...rest }) => {
  const { i18n } = useTranslation();
  const locale = i18n.language;

  return (
    <Flexbox gap={8} {...rest}>
      {logoUrl ? (
        <Avatar avatar={logoUrl} size={fontSize * 2} />
      ) : (
        <ProductLogo size={fontSize * 2} />
      )}
      <Text as={'h1'} fontSize={fontSize} weight={'bold'}>
        <TypewriterEffect
          cursorCharacter={<LoadingDots size={fontSize} variant={'pulse'} />}
          cursorFade={false}
          deletePauseDuration={1000}
          deletingSpeed={32}
          hideCursorWhileTyping={'afterTyping'}
          key={locale}
          pauseDuration={16_000}
          sentences={sentences}
          typingSpeed={64}
        />
      </Text>
    </Flexbox>
  );
});

export default LobeMessage;
