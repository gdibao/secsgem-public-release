import { describe, expect, it, vi } from 'vitest';

import { runModuleAppAction } from './runModuleAppAction';

const APP_ID = '00000000-0000-4000-8000-000000000001';
const allowEntitlement = async () => undefined;

describe('runModuleAppAction record actions', () => {
  it('checks current entitlement before creating a run', async () => {
    const assertEntitlement = vi
      .fn()
      .mockRejectedValue(new Error('MODULE_APP_ENTITLEMENT_SUSPENDED'));
    const model = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
    };

    await expect(
      runModuleAppAction({
        action: {
          id: 'run_action',
          inputSchema: { fields: [] },
          moduleMultiplier: 1,
          name: 'Run',
          outputSchema: {},
          runtimeConfig: {},
          runtimeType: 'record_create',
        },
        appId: APP_ID,
        assertEntitlement,
        input: {},
        model: model as never,
        scopeType: 'personal',
        userId: 'u1',
      }),
    ).rejects.toThrow('MODULE_APP_ENTITLEMENT_SUSPENDED');
    expect(assertEntitlement).toHaveBeenCalledOnce();
    expect(model.createRun).not.toHaveBeenCalled();
  });

  it('runs executable actions through the injected runner and rechecks entitlement before success', async () => {
    const assertEntitlement = vi.fn().mockResolvedValue(undefined);
    const model = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
    };
    const runner = vi.fn().mockResolvedValue({
      output: { matches: [{ id: 'job-1' }] },
      preview: '',
    });

    await expect(
      runModuleAppAction({
        action: {
          id: 'search',
          inputSchema: { fields: [] },
          moduleMultiplier: 1,
          name: 'Search',
          outputSchema: {},
          runtimeConfig: { functionKey: 'search_jobs' },
          runtimeType: 'executable_action',
        },
        appId: APP_ID,
        assertEntitlement,
        input: { query: 'jobs' },
        model: model as never,
        runner,
        scopeType: 'personal',
        userId: 'u1',
      }),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(runner).toHaveBeenCalledOnce();
    expect(assertEntitlement).toHaveBeenCalledTimes(2);
    expect(model.updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        output: { matches: [{ id: 'job-1' }] },
        runId: 'run-1',
        status: 'succeeded',
      }),
    );
  });

  it.each([
    'MODULE_APP_RUNTIME_REQUEST_FAILED',
    'MODULE_APP_RUNTIME_TIMEOUT',
    'MODULE_APP_RUNTIME_OUTPUT_INVALID',
  ])('persists executable action failure %s as a terminal run', async (message) => {
    const model = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
    };

    await expect(
      runModuleAppAction({
        action: {
          id: 'search',
          inputSchema: { fields: [] },
          moduleMultiplier: 1,
          name: 'Search',
          outputSchema: {},
          runtimeConfig: { functionKey: 'search_jobs' },
          runtimeType: 'executable_action',
        },
        appId: APP_ID,
        assertEntitlement: allowEntitlement,
        input: { query: 'jobs' },
        model: model as never,
        runner: vi.fn().mockRejectedValue(new Error(message)),
        scopeType: 'personal',
        userId: 'u1',
      }),
    ).resolves.toMatchObject({ preview: 'module_app_run_failed', status: 'failed' });
    expect(model.updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: message,
        errorType: 'module_app_runtime_error',
        output: {},
        runId: 'run-1',
        status: 'failed',
      }),
    );
  });

  it('starts workflow actions as durable queued runs', async () => {
    const model = {
      createRun: vi.fn().mockResolvedValue({ id: 'legacy-run-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
    };
    const workflowEngine = {
      start: vi.fn().mockResolvedValue({ id: 'workflow-run-1', status: 'queued' }),
    };
    const workflow = {
      edges: [],
      key: 'candidate_review',
      nodes: [
        {
          config: {},
          key: 'load',
          retry: { initialDelayMs: 1000, maxAttempts: 1, multiplier: 2 },
          timeoutMs: 30_000,
          type: 'function' as const,
        },
      ],
      startNodeKey: 'load',
      version: 1,
    };

    await expect(
      runModuleAppAction({
        action: {
          id: 'run_workflow',
          inputSchema: { fields: [] },
          moduleMultiplier: 1,
          name: 'Run workflow',
          outputSchema: {},
          runtimeConfig: {},
          runtimeType: 'workflow_step',
        },
        appId: APP_ID,
        assertEntitlement: allowEntitlement,
        idempotencyKey: 'request-1',
        input: { candidateId: 'candidate-1' },
        installationId: '00000000-0000-4000-8000-000000000010',
        model: model as never,
        scopeType: 'personal',
        userId: 'u1',
        workflow,
        workflowEngine,
      }),
    ).resolves.toMatchObject({ runId: 'workflow-run-1', status: 'queued' });
    expect(workflowEngine.start).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'request-1',
        input: { candidateId: 'candidate-1' },
        workflow,
      }),
    );
    expect(model.updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        output: { workflowRunId: 'workflow-run-1' },
        runId: 'legacy-run-1',
        status: 'queued',
      }),
    );
  });

  it('persists workflow start failures instead of leaving queued legacy runs', async () => {
    const model = {
      createRun: vi.fn().mockResolvedValue({ id: 'legacy-run-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
    };
    const workflowEngine = { start: vi.fn().mockRejectedValue(new Error('dispatch unavailable')) };
    const workflow = {
      edges: [],
      key: 'candidate_review',
      nodes: [
        {
          config: {},
          key: 'load',
          retry: { initialDelayMs: 1000, maxAttempts: 1, multiplier: 2 },
          timeoutMs: 30_000,
          type: 'function' as const,
        },
      ],
      startNodeKey: 'load',
      version: 1,
    };
    await expect(
      runModuleAppAction({
        action: {
          id: 'run_workflow',
          inputSchema: { fields: [] },
          moduleMultiplier: 1,
          name: 'Run workflow',
          outputSchema: {},
          runtimeConfig: {},
          runtimeType: 'workflow_step',
        },
        appId: APP_ID,
        assertEntitlement: allowEntitlement,
        input: {},
        installationId: '00000000-0000-4000-8000-000000000010',
        model: model as never,
        scopeType: 'personal',
        userId: 'u1',
        workflow,
        workflowEngine,
      }),
    ).resolves.toMatchObject({ preview: 'module_app_run_failed', status: 'failed' });
    expect(model.updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: 'dispatch unavailable',
        runId: 'legacy-run-1',
        status: 'failed',
      }),
    );
  });

  it('does not charge credits for record_create', async () => {
    const model = {
      createRecord: vi.fn().mockResolvedValue({ id: 'record-1' }),
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
    };

    const result = await runModuleAppAction({
      action: {
        id: 'create_record',
        inputSchema: { fields: [] },
        moduleMultiplier: 1,
        name: 'Create',
        outputSchema: {},
        runtimeConfig: {},
        runtimeType: 'record_create',
      },
      appId: APP_ID,
      assertEntitlement: allowEntitlement,
      input: { title: 'A' },
      model: model as never,
      scopeType: 'personal',
      userId: 'u1',
    });

    expect(result).toMatchObject({
      artifactIds: [],
      billing: { chargedCredits: 0, fixedServiceFeeCharged: false },
      preview: 'A',
      runId: 'run-1',
      status: 'succeeded',
    });
    expect(model.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: APP_ID,
        collectionKey: 'records',
        data: { title: 'A' },
        scopeType: 'personal',
        title: 'A',
        userId: 'u1',
      }),
    );
    expect(model.updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        billing: { chargedCredits: 0, fixedServiceFeeCharged: false },
        output: { preview: 'A', recordId: 'record-1' },
        runId: 'run-1',
        status: 'succeeded',
      }),
    );
  });

  it('does not charge credits for record_update', async () => {
    const model = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateRecord: vi.fn().mockResolvedValue({ id: 'record-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
    };

    const result = await runModuleAppAction({
      action: {
        id: 'update_record',
        inputSchema: { fields: [] },
        moduleMultiplier: 1,
        name: 'Update',
        outputSchema: {},
        runtimeConfig: { collectionKey: 'items' },
        runtimeType: 'record_update',
      },
      appId: APP_ID,
      assertEntitlement: allowEntitlement,
      input: { title: 'Updated' },
      model: model as never,
      recordId: 'record-1',
      scopeType: 'personal',
      userId: 'u1',
    });

    expect(result.billing.chargedCredits).toBe(0);
    expect(model.updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionKey: 'items',
        recordId: 'record-1',
        title: 'Updated',
      }),
    );
  });

  it('does not charge credits for record_archive', async () => {
    const model = {
      archiveRecord: vi.fn().mockResolvedValue({ ok: true }),
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
    };

    const result = await runModuleAppAction({
      action: {
        id: 'archive_record',
        inputSchema: { fields: [] },
        moduleMultiplier: 1,
        name: 'Archive',
        outputSchema: {},
        runtimeConfig: {},
        runtimeType: 'record_archive',
      },
      appId: APP_ID,
      assertEntitlement: allowEntitlement,
      input: {},
      model: model as never,
      recordId: 'record-1',
      scopeType: 'personal',
      userId: 'u1',
    });

    expect(result).toMatchObject({
      billing: { chargedCredits: 0, fixedServiceFeeCharged: false },
      preview: 'Archived',
      status: 'succeeded',
    });
    expect(model.archiveRecord).toHaveBeenCalledWith({
      appId: APP_ID,
      recordId: 'record-1',
      userId: 'u1',
    });
  });

  it('builds fixed and external API billing snapshots for api_action', async () => {
    const creditAdapter = {
      release: vi.fn().mockResolvedValue({ status: 'released' }),
      reserve: vi.fn().mockResolvedValue({ id: 'reservation-1', status: 'active' }),
      settle: vi.fn().mockResolvedValue({ status: 'settled' }),
    };
    const model = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
    };

    const result = await runModuleAppAction({
      action: {
        id: 'lookup',
        inputSchema: { fields: [] },
        moduleMultiplier: 1,
        name: 'Lookup',
        outputSchema: {},
        runtimeConfig: {},
        runtimeType: 'api_action',
      },
      appId: APP_ID,
      assertEntitlement: allowEntitlement,
      billing: {
        chargeMode: 'external_api',
        defaultMultiplier: 1,
        externalApiCostCredits: 7,
        failureFixedFeePolicy: 'do_not_charge',
        fixedServiceFeeCredits: 5,
      },
      creditAdapter,
      input: { keyword: 'apple' },
      model: model as never,
      runner: vi.fn().mockResolvedValue({
        actualAiCredits: 0,
        artifactIds: [],
        output: { definition: 'fruit' },
        preview: 'fruit',
      }),
      scopeType: 'workspace',
      userId: 'u1',
      workspaceId: 'workspace-1',
    });

    expect(result.billing).toMatchObject({
      chargedCredits: 7,
      chargeMode: 'external_api',
      externalApiCostCredits: 7,
      fixedServiceFeeCharged: false,
      fixedServiceFeeCredits: 5,
    });
    expect(creditAdapter.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 7,
        payer: { scopeType: 'workspace', workspaceId: 'workspace-1' },
      }),
    );
    expect(creditAdapter.settle).toHaveBeenCalledWith(
      expect.objectContaining({ actualAmount: 7, reservationId: 'reservation-1' }),
    );
    expect(creditAdapter.release).not.toHaveBeenCalled();
    expect(model.updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        billing: expect.objectContaining({ chargedCredits: 7 }),
        output: { definition: 'fruit' },
        status: 'succeeded',
      }),
    );
  });

  it('builds AI usage billing snapshots with action and app multipliers', async () => {
    const model = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
    };

    const result = await runModuleAppAction({
      action: {
        id: 'generate',
        inputSchema: { fields: [] },
        moduleMultiplier: 2,
        name: 'Generate',
        outputSchema: {},
        runtimeConfig: {},
        runtimeType: 'content_generation',
      },
      appId: APP_ID,
      assertEntitlement: allowEntitlement,
      billing: {
        chargeMode: 'ai_usage',
        defaultMultiplier: 1.5,
        externalApiCostCredits: 0,
        failureFixedFeePolicy: 'do_not_charge',
        fixedServiceFeeCredits: 2,
      },
      input: { topic: 'apple' },
      model: model as never,
      runner: vi.fn().mockResolvedValue({
        actualAiCredits: 10,
        artifactIds: [],
        output: { text: 'Apple note' },
        preview: 'Apple note',
      }),
      scopeType: 'personal',
      userId: 'u1',
    });

    expect(result.billing).toMatchObject({
      actualAiCredits: 10,
      chargedCredits: 30,
      chargeMode: 'ai_usage',
      fixedServiceFeeCharged: false,
      fixedServiceFeeCredits: 2,
      multiplier: 3,
    });
  });

  it('settles only the external component when a hybrid action fails', async () => {
    const creditAdapter = {
      release: vi.fn().mockResolvedValue({ status: 'released' }),
      reserve: vi.fn().mockResolvedValue({ id: 'reservation-1', status: 'active' }),
      settle: vi.fn().mockResolvedValue({ status: 'settled' }),
    };
    const model = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
    };

    const result = await runModuleAppAction({
      action: {
        id: 'lookup',
        inputSchema: { fields: [] },
        moduleMultiplier: 1,
        name: 'Lookup',
        outputSchema: {},
        runtimeConfig: {},
        runtimeType: 'api_action',
      },
      appId: APP_ID,
      assertEntitlement: allowEntitlement,
      billing: {
        chargeMode: 'hybrid',
        defaultMultiplier: 1,
        externalApiCostCredits: 7,
        failureFixedFeePolicy: 'do_not_charge',
        fixedServiceFeeCredits: 5,
      },
      creditAdapter,
      input: {},
      model: model as never,
      runner: vi.fn().mockRejectedValue(new Error('upstream failed')),
      scopeType: 'personal',
      userId: 'u1',
    });

    expect(result).toMatchObject({
      billing: expect.objectContaining({
        chargedCredits: 7,
        externalApiCostCredits: 7,
        fixedServiceFeeCharged: false,
      }),
      status: 'failed',
    });
    expect(creditAdapter.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 12, payer: { scopeType: 'personal', userId: 'u1' } }),
    );
    expect(creditAdapter.settle).toHaveBeenCalledWith(
      expect.objectContaining({ actualAmount: 7, reservationId: 'reservation-1' }),
    );
  });

  it('does not charge the fixed component when artifact persistence fails', async () => {
    const creditAdapter = {
      release: vi.fn().mockResolvedValue({ status: 'released' }),
      reserve: vi.fn().mockResolvedValue({ id: 'reservation-1', status: 'active' }),
      settle: vi.fn().mockResolvedValue({ status: 'settled' }),
    };
    const model = {
      createArtifact: vi.fn().mockResolvedValue({ id: 'artifact-1' }),
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
    };

    const result = await runModuleAppAction({
      action: {
        id: 'generate',
        inputSchema: { fields: [] },
        moduleMultiplier: 1,
        name: 'Generate',
        outputSchema: {},
        runtimeConfig: {},
        runtimeType: 'content_generation',
      },
      appId: APP_ID,
      artifactStorage: {
        uploadBuffer: vi.fn().mockRejectedValue(new Error('artifact storage failed')),
      },
      assertEntitlement: allowEntitlement,
      billing: {
        chargeMode: 'hybrid',
        defaultMultiplier: 1,
        externalApiCostCredits: 7,
        failureFixedFeePolicy: 'do_not_charge',
        fixedServiceFeeCredits: 5,
      },
      creditAdapter,
      input: {},
      model: model as never,
      runner: vi.fn().mockResolvedValue({
        actualAiCredits: 3,
        artifacts: [{ content: 'result', fileName: 'result.txt', mimeType: 'text/plain' }],
      }),
      scopeType: 'personal',
      userId: 'u1',
    });

    expect(result).toMatchObject({
      billing: expect.objectContaining({
        actualAiCredits: 3,
        chargedCredits: 10,
        fixedServiceFeeCharged: false,
      }),
      status: 'failed',
    });
    expect(creditAdapter.settle).toHaveBeenCalledWith(
      expect.objectContaining({ actualAmount: 7, reservationId: 'reservation-1' }),
    );
  });

  it('releases a fixed-only reservation when the action fails without a charge', async () => {
    const creditAdapter = {
      release: vi.fn().mockResolvedValue({ status: 'released' }),
      reserve: vi.fn().mockResolvedValue({ id: 'reservation-1', status: 'active' }),
      settle: vi.fn().mockResolvedValue({ status: 'settled' }),
    };
    const model = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
    };

    const result = await runModuleAppAction({
      action: {
        id: 'fixed_action',
        inputSchema: { fields: [] },
        moduleMultiplier: 1,
        name: 'Fixed action',
        outputSchema: {},
        runtimeConfig: {},
        runtimeType: 'server_action',
      },
      appId: APP_ID,
      assertEntitlement: allowEntitlement,
      billing: {
        chargeMode: 'fixed',
        defaultMultiplier: 1,
        externalApiCostCredits: 7,
        failureFixedFeePolicy: 'do_not_charge',
        fixedServiceFeeCredits: 5,
      },
      creditAdapter,
      input: {},
      model: model as never,
      runner: vi.fn().mockRejectedValue(new Error('action failed')),
      scopeType: 'personal',
      userId: 'u1',
    });

    expect(result).toMatchObject({
      billing: expect.objectContaining({ chargedCredits: 0, externalApiCostCredits: 0 }),
      status: 'failed',
    });
    expect(creditAdapter.reserve).toHaveBeenCalledWith(expect.objectContaining({ amount: 5 }));
    expect(creditAdapter.release).toHaveBeenCalledWith({
      reason: 'run_completed_without_non_ai_charge',
      reservationId: 'reservation-1',
    });
    expect(creditAdapter.settle).not.toHaveBeenCalled();
  });

  it('fails closed before execution when a non-AI charge has no credit adapter', async () => {
    const runner = vi.fn().mockResolvedValue({ output: {}, preview: 'should not run' });
    const model = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
    };

    const result = await runModuleAppAction({
      action: {
        id: 'fixed_action',
        inputSchema: { fields: [] },
        moduleMultiplier: 1,
        name: 'Fixed action',
        outputSchema: {},
        runtimeConfig: {},
        runtimeType: 'server_action',
      },
      appId: APP_ID,
      assertEntitlement: allowEntitlement,
      billing: {
        chargeMode: 'fixed',
        defaultMultiplier: 1,
        externalApiCostCredits: 0,
        failureFixedFeePolicy: 'do_not_charge',
        fixedServiceFeeCredits: 5,
      },
      input: {},
      model: model as never,
      runner,
      scopeType: 'personal',
      userId: 'u1',
    });

    expect(result).toMatchObject({
      billing: expect.objectContaining({ chargedCredits: 0 }),
      status: 'failed',
    });
    expect(runner).not.toHaveBeenCalled();
    expect(model.updateRun).toHaveBeenCalledWith(
      expect.objectContaining({ errorMessage: 'MODULE_APP_ACTION_CREDIT_ADAPTER_REQUIRED' }),
    );
  });

  it('uses the built-in API action runner when no explicit runner is provided', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      headers: { get: () => 'application/json' },
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: { summary: 'fruit' } }),
    });
    const model = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
      writeAuditLog: vi.fn().mockResolvedValue({ ok: true }),
    };

    const result = await runModuleAppAction({
      action: {
        id: 'lookup',
        inputSchema: { fields: [] },
        moduleMultiplier: 1,
        name: 'Lookup',
        outputSchema: {},
        runtimeConfig: {
          bodyTemplate: { keyword: '{{keyword}}' },
          responsePath: 'data.summary',
          url: 'https://{{host}}/search',
        },
        runtimeType: 'api_action',
      },
      appId: APP_ID,
      assertEntitlement: allowEntitlement,
      fetchImpl,
      input: { host: 'api.example.com', keyword: 'apple' },
      model: model as never,
      outboundHosts: ['api.example.com'],
      resolveHostname: () => ['93.184.216.34'],
      scopeType: 'personal',
      userId: 'u1',
    });

    expect(result).toMatchObject({
      preview: 'fruit',
      status: 'succeeded',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(model.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'module_app.run_succeeded',
        resourceId: APP_ID,
      }),
    );
  });

  it('writes artifacts returned by the built-in content generation runner', async () => {
    const artifactStorage = {
      uploadBuffer: vi.fn().mockResolvedValue({ key: 'stored/module-app-result.md' }),
    };
    const model = {
      createArtifact: vi.fn().mockResolvedValue({ id: 'artifact-1' }),
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
      writeAuditLog: vi.fn().mockResolvedValue({ ok: true }),
    };

    const textGenerator = vi.fn().mockResolvedValue({
      actualAiCredits: 4,
      text: 'Apple note',
    });
    const result = await runModuleAppAction({
      action: {
        id: 'generate',
        inputSchema: { fields: [] },
        moduleMultiplier: 1,
        name: 'Generate',
        outputSchema: {},
        runtimeConfig: {
          artifactNameTemplate: '{{topic}}.md',
          promptTemplate: 'Write about {{topic}}',
        },
        runtimeType: 'content_generation',
      },
      appId: APP_ID,
      assertEntitlement: allowEntitlement,
      artifactStorage,
      input: { topic: 'apple' },
      model: model as never,
      scopeType: 'personal',
      textGenerator,
      userId: 'u1',
    });

    expect(result).toMatchObject({
      artifactIds: ['artifact-1'],
      preview: 'Apple note',
      status: 'succeeded',
    });
    expect(textGenerator).toHaveBeenCalledWith(expect.objectContaining({ chargeAiUsage: false }));
    expect(artifactStorage.uploadBuffer).toHaveBeenCalledWith(
      expect.stringMatching(
        /^module-apps\/00000000-0000-4000-8000-000000000001\/run-1\/.+-apple\.md$/,
      ),
      expect.any(Buffer),
      'text/markdown',
    );
    expect(model.createArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: APP_ID,
        fileName: 'apple.md',
        mimeType: 'text/markdown',
        runId: 'run-1',
        sizeBytes: Buffer.byteLength('Apple note'),
        storageKey: 'stored/module-app-result.md',
      }),
    );
    expect(model.updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({ artifactIds: ['artifact-1'] }),
        status: 'succeeded',
      }),
    );
  });

  it('persists failed billable runs with redacted errors and audit events', async () => {
    const creditAdapter = {
      release: vi.fn().mockResolvedValue({ status: 'released' }),
      reserve: vi.fn().mockResolvedValue({ id: 'reservation-1', status: 'active' }),
      settle: vi.fn().mockResolvedValue({ status: 'settled' }),
    };
    const model = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
      writeAuditLog: vi.fn().mockResolvedValue({ ok: true }),
    };

    const result = await runModuleAppAction({
      action: {
        id: 'lookup',
        inputSchema: { fields: [] },
        moduleMultiplier: 1,
        name: 'Lookup',
        outputSchema: {},
        runtimeConfig: {},
        runtimeType: 'api_action',
      },
      appId: APP_ID,
      assertEntitlement: allowEntitlement,
      billing: {
        chargeMode: 'external_api',
        defaultMultiplier: 1,
        externalApiCostCredits: 7,
        failureFixedFeePolicy: 'do_not_charge',
        fixedServiceFeeCredits: 5,
      },
      creditAdapter,
      input: { keyword: 'apple' },
      model: model as never,
      resolvedSecrets: { apiKey: 'secret-token' },
      runner: vi.fn().mockRejectedValue(new Error('upstream leaked secret-token')),
      scopeType: 'personal',
      userId: 'u1',
    });

    expect(result).toMatchObject({
      artifactIds: [],
      preview: 'module_app_run_failed',
      status: 'failed',
    });
    expect(model.updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        billing: expect.objectContaining({
          chargedCredits: 7,
          fixedServiceFeeCharged: false,
        }),
        errorMessage: 'upstream leaked [REDACTED]',
        errorType: 'module_app_runtime_error',
        status: 'failed',
      }),
    );
    expect(model.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'module_app.run_failed',
        metadata: expect.objectContaining({
          errorMessage: 'upstream leaked [REDACTED]',
        }),
        resourceId: APP_ID,
      }),
    );
  });

  it('runs approved server actions through an injected host adapter', async () => {
    const model = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
    };
    const serverAction = vi.fn().mockResolvedValue({
      output: { notificationId: 'notification-1' },
      preview: 'Notification created',
    });

    await expect(
      runModuleAppAction({
        action: {
          id: 'notify',
          inputSchema: { fields: [] },
          moduleMultiplier: 1,
          name: 'Notify',
          outputSchema: {},
          runtimeConfig: { actionKey: 'notifications.create' },
          runtimeType: 'server_action',
        },
        appId: APP_ID,
        assertEntitlement: allowEntitlement,
        input: { content: 'Finished', title: 'Module App' },
        installationId: '00000000-0000-4000-8000-000000000010',
        model: model as never,
        scopeType: 'personal',
        serverAction,
        userId: 'u1',
      }),
    ).resolves.toMatchObject({ preview: 'Notification created', status: 'succeeded' });
    expect(serverAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionKey: 'notifications.create',
        input: { content: 'Finished', title: 'Module App' },
        installationId: '00000000-0000-4000-8000-000000000010',
      }),
    );
  });
});
