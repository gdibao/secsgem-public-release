import useSWRMutation from 'swr/mutation';

import { docmeeService } from '@/services/docmee';

export const useDocmeeToken = (recordId?: string) =>
  useSWRMutation(['docmee-ppt-token', recordId], () => docmeeService.createPptToken(recordId));
