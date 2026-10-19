import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import ConversationArea from './ConversationArea';
import ChatHeader from './Header';

interface ChatConversationProps {
  mobile?: boolean;
}

const ChatConversation = memo<ChatConversationProps>(({ mobile = false }) => {
  // Get current agent's model info for vision support check
  const agentId = useAgentStore((s) => s.activeAgentId || '');
  const model = useAgentStore(agentSelectors.currentAgentModel);
  const provider = useAgentStore(agentSelectors.currentAgentModelProvider);
  const { handleUploadFiles } = useUploadFiles({ agentId, model, provider });

  return (
    <DragUploadZone style={{ height: '100%', width: '100%' }} onUploadFiles={handleUploadFiles}>
      <Flexbox height={'100%'} style={{ overflow: 'hidden', position: 'relative' }} width={'100%'}>
        {!mobile && <ChatHeader />}
        <ConversationArea mobile={mobile} />
      </Flexbox>
    </DragUploadZone>
  );
});

ChatConversation.displayName = 'ChatConversation';

export default ChatConversation;
