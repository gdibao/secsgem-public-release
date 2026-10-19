import type {
  CreateAgentCronJobData,
  UpdateAgentCronJobData,
} from '@/database/schemas/agentCronJob';
import { lambdaClient } from '@/libs/trpc/client';

type CreateAgentCronJobInput = Omit<CreateAgentCronJobData, 'userId'> & {
  templateId?: string;
};

class AgentCronJobService {
  create = async (data: CreateAgentCronJobInput) => {
    return lambdaClient.agentCronJob.create.mutate(data);
  };

  delete = async (id: string) => {
    return lambdaClient.agentCronJob.delete.mutate({ id });
  };

  getById = async (id: string) => {
    return lambdaClient.agentCronJob.findById.query({ id });
  };

  update = async (id: string, data: UpdateAgentCronJobData) => {
    return lambdaClient.agentCronJob.update.mutate({ data, id });
  };
}

export const agentCronJobService = new AgentCronJobService();
