import type { DesktopReleaseChannel } from '@lobechat/types';
import { z } from 'zod';

const DESKTOP_RELEASE_DISPATCH_TIMEOUT_MS = 10_000;
const DESKTOP_RELEASE_RECONCILE_CLOCK_SKEW_MS = 5 * 60_000;
const DESKTOP_RELEASE_WORKFLOW_FILE = 'comhub-desktop-release.yml';
const DEFAULT_GITHUB_REF = 'main';
const DEFAULT_GITHUB_REPOSITORY = 'maheshenga/comhub';
const GITHUB_REPOSITORY_PATTERN = /^[\w.-]+\/[\w.-]+$/;

export interface DesktopReleaseAutomationHealth {
  configured: boolean;
  ref: null | string;
  repository: null | string;
  tokenConfigured: boolean;
  workflowFile: string;
}

export const getDesktopReleaseAutomationHealth = (
  env: Record<string, string | undefined> = process.env,
): DesktopReleaseAutomationHealth => {
  const repository = env.DESKTOP_RELEASE_GITHUB_REPOSITORY || DEFAULT_GITHUB_REPOSITORY;
  const ref = env.DESKTOP_RELEASE_GITHUB_REF || DEFAULT_GITHUB_REF;
  const repositoryValid = GITHUB_REPOSITORY_PATTERN.test(repository);
  const refValid = ref.trim().length > 0;
  const tokenConfigured = Boolean(env.DESKTOP_RELEASE_GITHUB_TOKEN?.trim());

  return {
    configured: repositoryValid && refValid && tokenConfigured,
    ref: refValid ? ref : null,
    repository: repositoryValid ? repository : null,
    tokenConfigured,
    workflowFile: DESKTOP_RELEASE_WORKFLOW_FILE,
  };
};

type DispatchInput = {
  channel: DesktopReleaseChannel;
  releaseId: string;
  releaseNotes: string;
  version: string;
};

type RetryInput = DispatchInput & {
  workflowRunId?: null | string;
};

type DispatchOptions = {
  fetcher?: typeof fetch;
  ref?: string;
  repository?: string;
  token?: string;
};

type ReconcileInput = {
  channel: DesktopReleaseChannel;
  dispatchedAt: Date;
  releaseId: string;
  version: string;
  workflowRunId?: null | string;
};

const workflowRunSchema = z
  .object({
    conclusion: z.string().max(64).nullable(),
    created_at: z.string().datetime(),
    display_title: z.string().max(512),
    event: z.string().max(64),
    head_branch: z.string().max(255),
    html_url: z.string().url().max(2048),
    id: z.number().int().positive(),
    path: z.string().max(512),
    run_attempt: z.number().int().positive(),
    status: z.string().max(64),
    updated_at: z.string().datetime(),
  })
  .passthrough();

const workflowRunListSchema = z
  .object({ workflow_runs: z.array(workflowRunSchema).max(100) })
  .passthrough();

export type DesktopReleaseWorkflowReconciliation =
  | {
      conclusion: null | string;
      createdAt: string;
      state: 'matched';
      status: string;
      updatedAt: string;
      workflowRunAttempt: number;
      workflowRunId: string;
      workflowRunUrl: string;
    }
  | {
      candidateCount: number;
      reason: 'multiple-matches' | 'not-found';
      state: 'unresolved';
    };

export type DesktopReleaseDispatchDelivery = 'ambiguous' | 'definitive';

export class DesktopReleaseDispatchError extends Error {
  constructor(
    public readonly code:
      'github-dispatch-failed' | 'github-dispatch-timeout' | 'github-token-missing',
    public readonly summary: string,
    public readonly delivery: DesktopReleaseDispatchDelivery,
  ) {
    super(summary);
    this.name = 'DesktopReleaseDispatchError';
  }
}

export class DesktopReleaseReconcileError extends Error {
  constructor(
    public readonly code:
      'github-reconcile-failed' | 'github-reconcile-timeout' | 'github-token-missing',
    public readonly summary: string,
  ) {
    super(summary);
    this.name = 'DesktopReleaseReconcileError';
  }
}

const getToken = (options: DispatchOptions) =>
  options.token ?? process.env.DESKTOP_RELEASE_GITHUB_TOKEN;

const resolveGithubTarget = (options: DispatchOptions) => {
  const repository =
    options.repository ??
    process.env.DESKTOP_RELEASE_GITHUB_REPOSITORY ??
    DEFAULT_GITHUB_REPOSITORY;
  if (!GITHUB_REPOSITORY_PATTERN.test(repository)) {
    throw new DesktopReleaseReconcileError(
      'github-reconcile-failed',
      'Desktop release reconciliation is unavailable.',
    );
  }

  return {
    ref: options.ref ?? process.env.DESKTOP_RELEASE_GITHUB_REF ?? DEFAULT_GITHUB_REF,
    repository,
  };
};

const getWorkflowRunName = (input: Pick<ReconcileInput, 'channel' | 'releaseId' | 'version'>) =>
  `ComHub Desktop ${input.version} (${input.channel}) [${input.releaseId}]`;

const isExpectedWorkflowRun = (
  run: z.infer<typeof workflowRunSchema>,
  input: ReconcileInput,
  ref: string,
) => {
  const createdAt = new Date(run.created_at).getTime();
  const dispatchedAt = input.dispatchedAt.getTime();
  const workflowPath = `.github/workflows/${DESKTOP_RELEASE_WORKFLOW_FILE}`;
  const expectedWorkflowPaths = [
    workflowPath,
    `${workflowPath}@${ref}`,
    `${workflowPath}@refs/heads/${ref}`,
  ];

  return (
    run.display_title === getWorkflowRunName(input) &&
    run.event === 'workflow_dispatch' &&
    run.head_branch === ref &&
    expectedWorkflowPaths.includes(run.path) &&
    createdAt >= dispatchedAt - DESKTOP_RELEASE_RECONCILE_CLOCK_SKEW_MS &&
    createdAt <= dispatchedAt + DESKTOP_RELEASE_RECONCILE_CLOCK_SKEW_MS &&
    (!input.workflowRunId || String(run.id) === input.workflowRunId)
  );
};

const normalizeWorkflowRun = (
  run: z.infer<typeof workflowRunSchema>,
  repository: string,
): Extract<DesktopReleaseWorkflowReconciliation, { state: 'matched' }> => {
  const workflowRunId = String(run.id);
  const expectedUrl = `https://github.com/${repository}/actions/runs/${workflowRunId}`;
  if (run.html_url !== expectedUrl) {
    throw new DesktopReleaseReconcileError(
      'github-reconcile-failed',
      'GitHub returned an invalid desktop release workflow run.',
    );
  }

  return {
    conclusion: run.conclusion,
    createdAt: run.created_at,
    state: 'matched',
    status: run.status,
    updatedAt: run.updated_at,
    workflowRunAttempt: run.run_attempt,
    workflowRunId,
    workflowRunUrl: expectedUrl,
  };
};

const parseGithubResponse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DesktopReleaseReconcileError(
      'github-reconcile-failed',
      'GitHub reconciliation returned an invalid response.',
    );
  }
  return parsed.data;
};

const fetchGithubWorkflowJson = async (
  url: string,
  options: DispatchOptions,
  token: string,
): Promise<unknown> => {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DESKTOP_RELEASE_DISPATCH_TIMEOUT_MS);

  try {
    const response = await (options.fetcher ?? fetch)(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'comhub-desktop-release-reconciler',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new DesktopReleaseReconcileError(
        'github-reconcile-failed',
        `GitHub reconciliation failed (${response.status}).`,
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof DesktopReleaseReconcileError) throw error;
    if (timedOut || controller.signal.aborted) {
      throw new DesktopReleaseReconcileError(
        'github-reconcile-timeout',
        'GitHub reconciliation timed out.',
      );
    }
    throw new DesktopReleaseReconcileError(
      'github-reconcile-failed',
      'GitHub reconciliation failed.',
    );
  } finally {
    clearTimeout(timeout);
  }
};

export const dispatchDesktopReleaseWorkflow = async (
  input: DispatchInput,
  options: DispatchOptions = {},
): Promise<void> => {
  const token = getToken(options);
  if (!token) {
    throw new DesktopReleaseDispatchError(
      'github-token-missing',
      'Desktop release dispatch is unavailable.',
      'definitive',
    );
  }

  const repository =
    options.repository ??
    process.env.DESKTOP_RELEASE_GITHUB_REPOSITORY ??
    DEFAULT_GITHUB_REPOSITORY;
  const ref = options.ref ?? process.env.DESKTOP_RELEASE_GITHUB_REF ?? DEFAULT_GITHUB_REF;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DESKTOP_RELEASE_DISPATCH_TIMEOUT_MS);

  try {
    const response = await (options.fetcher ?? fetch)(
      `https://api.github.com/repos/${repository}/actions/workflows/${DESKTOP_RELEASE_WORKFLOW_FILE}/dispatches`,
      {
        body: JSON.stringify({
          inputs: {
            channel: input.channel,
            release_id: input.releaseId,
            release_notes: input.releaseNotes,
            version: input.version,
          },
          ref,
        }),
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'comhub-desktop-release-dispatcher',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        method: 'POST',
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const ambiguous = response.status === 408 || response.status >= 500;
      throw new DesktopReleaseDispatchError(
        'github-dispatch-failed',
        ambiguous
          ? `GitHub dispatch delivery is unknown (${response.status}).`
          : `GitHub dispatch failed (${response.status}).`,
        ambiguous ? 'ambiguous' : 'definitive',
      );
    }
  } catch (error) {
    if (error instanceof DesktopReleaseDispatchError) throw error;
    if (timedOut || controller.signal.aborted) {
      throw new DesktopReleaseDispatchError(
        'github-dispatch-timeout',
        'GitHub dispatch timed out.',
        'ambiguous',
      );
    }
    throw new DesktopReleaseDispatchError(
      'github-dispatch-failed',
      'GitHub dispatch delivery is unknown.',
      'ambiguous',
    );
  } finally {
    clearTimeout(timeout);
  }
};

const rerunDesktopReleaseWorkflow = async (
  workflowRunId: string,
  options: DispatchOptions,
): Promise<void> => {
  const token = getToken(options);
  if (!token) {
    throw new DesktopReleaseDispatchError(
      'github-token-missing',
      'Desktop release dispatch is unavailable.',
      'definitive',
    );
  }

  const repository =
    options.repository ??
    process.env.DESKTOP_RELEASE_GITHUB_REPOSITORY ??
    DEFAULT_GITHUB_REPOSITORY;
  if (!GITHUB_REPOSITORY_PATTERN.test(repository) || !/^\d+$/.test(workflowRunId)) {
    throw new DesktopReleaseDispatchError(
      'github-dispatch-failed',
      'Desktop release rerun is unavailable.',
      'definitive',
    );
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DESKTOP_RELEASE_DISPATCH_TIMEOUT_MS);

  try {
    const response = await (options.fetcher ?? fetch)(
      `https://api.github.com/repos/${repository}/actions/runs/${workflowRunId}/rerun`,
      {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'comhub-desktop-release-retrier',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        method: 'POST',
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const ambiguous = response.status === 408 || response.status >= 500;
      throw new DesktopReleaseDispatchError(
        'github-dispatch-failed',
        ambiguous
          ? `GitHub rerun delivery is unknown (${response.status}).`
          : `GitHub rerun failed (${response.status}).`,
        ambiguous ? 'ambiguous' : 'definitive',
      );
    }
  } catch (error) {
    if (error instanceof DesktopReleaseDispatchError) throw error;
    if (timedOut || controller.signal.aborted) {
      throw new DesktopReleaseDispatchError(
        'github-dispatch-timeout',
        'GitHub rerun timed out.',
        'ambiguous',
      );
    }
    throw new DesktopReleaseDispatchError(
      'github-dispatch-failed',
      'GitHub rerun delivery is unknown.',
      'ambiguous',
    );
  } finally {
    clearTimeout(timeout);
  }
};

export const retryDesktopReleaseWorkflow = async (
  input: RetryInput,
  options: DispatchOptions = {},
): Promise<void> => {
  if (!input.workflowRunId) {
    return dispatchDesktopReleaseWorkflow(input, options);
  }

  return rerunDesktopReleaseWorkflow(input.workflowRunId, options);
};

export const reconcileDesktopReleaseWorkflow = async (
  input: ReconcileInput,
  options: DispatchOptions = {},
): Promise<DesktopReleaseWorkflowReconciliation> => {
  const token = getToken(options);
  if (!token) {
    throw new DesktopReleaseReconcileError(
      'github-token-missing',
      'Desktop release reconciliation is unavailable.',
    );
  }

  const { ref, repository } = resolveGithubTarget(options);
  if (input.workflowRunId) {
    const run = parseGithubResponse(
      workflowRunSchema,
      await fetchGithubWorkflowJson(
        `https://api.github.com/repos/${repository}/actions/runs/${input.workflowRunId}`,
        options,
        token,
      ),
    );
    if (!isExpectedWorkflowRun(run, input, ref)) {
      throw new DesktopReleaseReconcileError(
        'github-reconcile-failed',
        'GitHub returned an unrelated desktop release workflow run.',
      );
    }
    return normalizeWorkflowRun(run, repository);
  }

  const earliestRunAt = new Date(
    input.dispatchedAt.getTime() - DESKTOP_RELEASE_RECONCILE_CLOCK_SKEW_MS,
  );
  const query = new URLSearchParams({
    branch: ref,
    created: `>=${earliestRunAt.toISOString()}`,
    event: 'workflow_dispatch',
    per_page: '100',
  });
  const response = parseGithubResponse(
    workflowRunListSchema,
    await fetchGithubWorkflowJson(
      `https://api.github.com/repos/${repository}/actions/workflows/${DESKTOP_RELEASE_WORKFLOW_FILE}/runs?${query}`,
      options,
      token,
    ),
  );
  const candidates = response.workflow_runs.filter((run) => isExpectedWorkflowRun(run, input, ref));

  if (candidates.length !== 1) {
    return {
      candidateCount: candidates.length,
      reason: candidates.length === 0 ? 'not-found' : 'multiple-matches',
      state: 'unresolved',
    };
  }

  return normalizeWorkflowRun(candidates[0]!, repository);
};
