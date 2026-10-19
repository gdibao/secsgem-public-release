'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import Conversation from './features/Conversation';
import Portal from './features/Portal';
import TelemetryNotification from './features/TelemetryNotification';

const ChatPage = memo<{ mobile?: boolean }>(({ mobile = false }) => {
  return (
    <>
      <Flexbox
        horizontal={!mobile}
        height={'100%'}
        style={{ overflow: 'hidden', position: 'relative' }}
        width={'100%'}
      >
        <Conversation mobile={mobile} />
        <Portal mobile={mobile} />
      </Flexbox>
      <TelemetryNotification mobile={mobile} />
    </>
  );
});

export default ChatPage;
