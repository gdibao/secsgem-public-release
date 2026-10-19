// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DesktopReleaseDispatchError,
  dispatchDesktopReleaseWorkflow,
  getDesktopReleaseAutomationHealth,
  reconcileDesktopReleaseWorkflow,
  retryDesktopReleaseWorkflow,
} from './github';

describe('getDesktopReleaseAutomationHealth', () => {
  it('reports readiness without exposing the GitHub token', () => {
    const result = getDesktopReleaseAutomationHealth({
      DESKTOP_RELEASE_GITHUB_REF: 'release',
      DESKTOP_RELEASE_GITHUB_REPOSITORY: 'owner/repo',
      DESKTOP_RELEASE_GITHUB_TOKEN: 'secret-token',
    });

    expect(result).toEqual({
      configured: true,
      ref: 'release',
      repository: 'owner/repo',
      tokenConfigured: true,
      workflowFile: 'comhub-desktop-release.yml',
    });
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('reports invalid targets and a missing token as unavailable', () => {
    expect(
      getDesktopReleaseAutomationHealth({
        DESKTOP_RELEASE_GITHUB_REF: '',
        DESKTOP_RELEASE_GITHUB_REPOSITORY: 'invalid',
        DESKTOP_RELEASE_GITHUB_TOKEN: '',
      }),
    ).toMatchObject({ configured: false, repository: null, tokenConfigured: false });
  });
});

describe('dispatchDesktopReleaseWorkflow', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('dispatches the fixed workflow with the frozen release id', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await dispatchDesktopReleaseWorkflow(
      { channel: 'stable', releaseId: 'release-1', releaseNotes: 'notes', version: '2.4.0' },
      { fetcher, token: 'secret' },
    );

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/repos/maheshenga/comhub/actions/workflows/comhub-desktop-release.yml/dispatches',
      expect.objectContaining({
        body: JSON.stringify({
          inputs: {
            channel: 'stable',
            release_id: 'release-1',
            release_notes: 'notes',
            version: '2.4.0',
          },
          ref: 'main',
        }),
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': 'Bearer secret',
          'Content-Type': 'application/json',
          'User-Agent': 'comhub-desktop-release-dispatcher',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        method: 'POST',
      }),
    );
  });

  it('uses configured repository and ref overrides', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await dispatchDesktopReleaseWorkflow(
      { channel: 'canary', releaseId: 'release-1', releaseNotes: '', version: '2.4.0' },
      { fetcher, ref: 'release-branch', repository: 'owner/repo', token: 'secret' },
    );

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/actions/workflows/comhub-desktop-release.yml/dispatches',
      expect.objectContaining({ body: expect.stringContaining('"ref":"release-branch"') }),
    );
  });

  it('requires the configured GitHub token without exposing it', async () => {
    vi.stubEnv('DESKTOP_RELEASE_GITHUB_TOKEN', '');

    await expect(
      dispatchDesktopReleaseWorkflow({
        channel: 'stable',
        releaseId: 'release-1',
        releaseNotes: 'notes',
        version: '2.4.0',
      }),
    ).rejects.toMatchObject({
      code: 'github-token-missing',
      delivery: 'definitive',
      message: 'Desktop release dispatch is unavailable.',
    });
  });

  it('aborts and clears the timeout when the dispatch exceeds ten seconds', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );

    const dispatch = dispatchDesktopReleaseWorkflow(
      { channel: 'stable', releaseId: 'release-1', releaseNotes: 'notes', version: '2.4.0' },
      { fetcher: fetcher as typeof fetch, token: 'secret' },
    );
    const rejection = expect(dispatch).rejects.toMatchObject({
      code: 'github-dispatch-timeout',
      delivery: 'ambiguous',
    });

    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns a bounded redacted summary for GitHub failures', async () => {
    const token = 'super-secret-token';
    const releaseNotes = 'private release notes';
    const rawBody = `${token} ${releaseNotes} ${'x'.repeat(2_000)}`;
    const fetcher = vi.fn().mockResolvedValue(new Response(rawBody, { status: 422 }));

    await expect(
      dispatchDesktopReleaseWorkflow(
        { channel: 'stable', releaseId: 'release-1', releaseNotes, version: '2.4.0' },
        { fetcher, token },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(DesktopReleaseDispatchError);
      expect((error as DesktopReleaseDispatchError).code).toBe('github-dispatch-failed');
      expect((error as DesktopReleaseDispatchError).delivery).toBe('definitive');
      expect((error as DesktopReleaseDispatchError).summary).toBe('GitHub dispatch failed (422).');
      expect((error as DesktopReleaseDispatchError).summary).not.toContain(token);
      expect((error as DesktopReleaseDispatchError).summary).not.toContain(releaseNotes);
      return true;
    });
  });

  it.each([408, 503])(
    'treats an initial dispatch %s response as ambiguous delivery',
    async (status) => {
      const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));

      await expect(
        dispatchDesktopReleaseWorkflow(
          {
            channel: 'stable',
            releaseId: 'release-1',
            releaseNotes: 'notes',
            version: '2.4.0',
          },
          { fetcher, token: 'secret' },
        ),
      ).rejects.toMatchObject({
        code: 'github-dispatch-failed',
        delivery: 'ambiguous',
        summary: `GitHub dispatch delivery is unknown (${status}).`,
      });
    },
  );

  it('classifies transport failures as ambiguous without exposing transport details', async () => {
    const token = 'super-secret-token';
    const releaseNotes = 'private release notes';
    const fetcher = vi.fn().mockRejectedValue(new Error(`${token} ${releaseNotes} transport`));

    await expect(
      dispatchDesktopReleaseWorkflow(
        { channel: 'stable', releaseId: 'release-1', releaseNotes, version: '2.4.0' },
        { fetcher, token },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(DesktopReleaseDispatchError);
      expect((error as DesktopReleaseDispatchError).code).toBe('github-dispatch-failed');
      expect((error as DesktopReleaseDispatchError).delivery).toBe('ambiguous');
      expect((error as DesktopReleaseDispatchError).summary).toBe(
        'GitHub dispatch delivery is unknown.',
      );
      expect((error as DesktopReleaseDispatchError).summary).not.toContain(token);
      expect((error as DesktopReleaseDispatchError).summary).not.toContain(releaseNotes);
      return true;
    });
  });

  it('reruns a failed workflow when the release has a bound run', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));

    await retryDesktopReleaseWorkflow(
      {
        channel: 'stable',
        releaseId: 'release-1',
        releaseNotes: 'notes',
        version: '2.4.0',
        workflowRunId: '1234567890',
      },
      { fetcher, token: 'secret' },
    );

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/repos/maheshenga/comhub/actions/runs/1234567890/rerun',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer secret',
          'User-Agent': 'comhub-desktop-release-retrier',
        }),
        method: 'POST',
      }),
    );
  });

  it('dispatches a new workflow when a failed release has no bound run', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await retryDesktopReleaseWorkflow(
      {
        channel: 'canary',
        releaseId: 'release-1',
        releaseNotes: 'notes',
        version: '2.4.0-canary.1',
      },
      { fetcher, token: 'secret' },
    );

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/repos/maheshenga/comhub/actions/workflows/comhub-desktop-release.yml/dispatches',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('treats a rerun 5xx response as ambiguous delivery', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      retryDesktopReleaseWorkflow(
        {
          channel: 'stable',
          releaseId: 'release-1',
          releaseNotes: 'notes',
          version: '2.4.0',
          workflowRunId: '1234567890',
        },
        { fetcher, token: 'secret' },
      ),
    ).rejects.toMatchObject({
      delivery: 'ambiguous',
      summary: 'GitHub rerun delivery is unknown (503).',
    });
  });

  it('treats a rerun client rejection as definitive', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 409 }));

    await expect(
      retryDesktopReleaseWorkflow(
        {
          channel: 'stable',
          releaseId: 'release-1',
          releaseNotes: 'notes',
          version: '2.4.0',
          workflowRunId: '1234567890',
        },
        { fetcher, token: 'secret' },
      ),
    ).rejects.toMatchObject({
      delivery: 'definitive',
      summary: 'GitHub rerun failed (409).',
    });
  });
});

describe('reconcileDesktopReleaseWorkflow', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('returns the only workflow run whose display title contains the immutable release identity', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        workflow_runs: [
          {
            conclusion: null,
            created_at: '2026-07-22T10:00:05Z',
            display_title: 'ComHub Desktop 2.4.0 (stable) [release-2]',
            event: 'workflow_dispatch',
            head_branch: 'main',
            html_url: 'https://github.com/maheshenga/comhub/actions/runs/101',
            id: 101,
            path: '.github/workflows/comhub-desktop-release.yml@main',
            run_attempt: 1,
            status: 'in_progress',
            updated_at: '2026-07-22T10:01:00Z',
          },
          {
            conclusion: null,
            created_at: '2026-07-22T10:00:02Z',
            display_title: 'ComHub Desktop 2.4.0 (stable) [release-1]',
            event: 'workflow_dispatch',
            head_branch: 'main',
            html_url: 'https://github.com/maheshenga/comhub/actions/runs/100',
            id: 100,
            path: '.github/workflows/comhub-desktop-release.yml@refs/heads/main',
            run_attempt: 1,
            status: 'queued',
            updated_at: '2026-07-22T10:00:02Z',
          },
        ],
      }),
    );

    await expect(
      reconcileDesktopReleaseWorkflow(
        {
          channel: 'stable',
          dispatchedAt: new Date('2026-07-22T10:00:00Z'),
          releaseId: 'release-1',
          version: '2.4.0',
        },
        { fetcher, token: 'secret' },
      ),
    ).resolves.toEqual({
      conclusion: null,
      createdAt: '2026-07-22T10:00:02Z',
      state: 'matched',
      status: 'queued',
      updatedAt: '2026-07-22T10:00:02Z',
      workflowRunAttempt: 1,
      workflowRunId: '100',
      workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/100',
    });

    const requestUrl = new URL(fetcher.mock.calls[0]![0]);
    expect(requestUrl.pathname).toBe(
      '/repos/maheshenga/comhub/actions/workflows/comhub-desktop-release.yml/runs',
    );
    expect(requestUrl.searchParams.get('branch')).toBe('main');
    expect(requestUrl.searchParams.get('event')).toBe('workflow_dispatch');
    expect(requestUrl.searchParams.get('per_page')).toBe('100');
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      method: 'GET',
    });
  });

  it('keeps an unmatched release unresolved instead of inferring a failure', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ workflow_runs: [] }));

    await expect(
      reconcileDesktopReleaseWorkflow(
        {
          channel: 'canary',
          dispatchedAt: new Date('2026-07-22T10:00:00Z'),
          releaseId: 'release-1',
          version: '2.4.0-canary.1',
        },
        { fetcher, token: 'secret' },
      ),
    ).resolves.toEqual({ candidateCount: 0, reason: 'not-found', state: 'unresolved' });
  });

  it('accepts a uniquely named run within the bounded clock-skew window', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        workflow_runs: [
          {
            conclusion: null,
            created_at: '2026-07-22T09:59:58Z',
            display_title: 'ComHub Desktop 2.4.0 (stable) [release-1]',
            event: 'workflow_dispatch',
            head_branch: 'main',
            html_url: 'https://github.com/maheshenga/comhub/actions/runs/100',
            id: 100,
            path: '.github/workflows/comhub-desktop-release.yml@refs/heads/main',
            run_attempt: 1,
            status: 'queued',
            updated_at: '2026-07-22T10:00:02Z',
          },
        ],
      }),
    );

    await expect(
      reconcileDesktopReleaseWorkflow(
        {
          channel: 'stable',
          dispatchedAt: new Date('2026-07-22T10:00:00Z'),
          releaseId: 'release-1',
          version: '2.4.0',
        },
        { fetcher, token: 'secret' },
      ),
    ).resolves.toMatchObject({ state: 'matched', workflowRunId: '100' });
  });

  it('redacts malformed GitHub responses behind a stable reconciliation error', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ workflow_runs: [{ private_detail: 'must-not-leak' }] }));

    await expect(
      reconcileDesktopReleaseWorkflow(
        {
          channel: 'stable',
          dispatchedAt: new Date('2026-07-22T10:00:00Z'),
          releaseId: 'release-1',
          version: '2.4.0',
        },
        { fetcher, token: 'secret' },
      ),
    ).rejects.toMatchObject({
      code: 'github-reconcile-failed',
      message: 'GitHub reconciliation returned an invalid response.',
    });
  });

  it('does not choose between duplicate runs for the same release', async () => {
    const run = {
      conclusion: null,
      created_at: '2026-07-22T10:00:02Z',
      display_title: 'ComHub Desktop 2.4.0 (stable) [release-1]',
      event: 'workflow_dispatch',
      head_branch: 'main',
      html_url: 'https://github.com/maheshenga/comhub/actions/runs/100',
      id: 100,
      path: '.github/workflows/comhub-desktop-release.yml@refs/heads/main',
      run_attempt: 1,
      status: 'queued',
      updated_at: '2026-07-22T10:00:02Z',
    };
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        workflow_runs: [
          run,
          {
            ...run,
            html_url: 'https://github.com/maheshenga/comhub/actions/runs/101',
            id: 101,
          },
        ],
      }),
    );

    await expect(
      reconcileDesktopReleaseWorkflow(
        {
          channel: 'stable',
          dispatchedAt: new Date('2026-07-22T10:00:00Z'),
          releaseId: 'release-1',
          version: '2.4.0',
        },
        { fetcher, token: 'secret' },
      ),
    ).resolves.toEqual({ candidateCount: 2, reason: 'multiple-matches', state: 'unresolved' });
  });

  it('revalidates immutable release identity for an already-bound workflow run', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        conclusion: null,
        created_at: '2026-07-22T10:00:02Z',
        display_title: 'ComHub Desktop 2.4.0 (stable) [release-1]',
        event: 'workflow_dispatch',
        head_branch: 'main',
        html_url: 'https://github.com/maheshenga/comhub/actions/runs/100',
        id: 100,
        path: '.github/workflows/comhub-desktop-release.yml@refs/heads/main',
        run_attempt: 2,
        status: 'in_progress',
        updated_at: '2026-07-22T10:01:00Z',
      }),
    );

    await expect(
      reconcileDesktopReleaseWorkflow(
        {
          channel: 'stable',
          dispatchedAt: new Date('2026-07-22T10:00:00Z'),
          releaseId: 'release-1',
          version: '2.4.0',
          workflowRunId: '100',
        },
        { fetcher, token: 'secret' },
      ),
    ).resolves.toMatchObject({
      state: 'matched',
      workflowRunAttempt: 2,
      workflowRunId: '100',
    });
  });

  it('rejects an already-bound run whose immutable release identity does not match', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        conclusion: null,
        created_at: '2026-07-22T10:00:02Z',
        display_title: 'ComHub Desktop 2.4.0 (stable) [another-release]',
        event: 'workflow_dispatch',
        head_branch: 'main',
        html_url: 'https://github.com/maheshenga/comhub/actions/runs/100',
        id: 100,
        path: '.github/workflows/comhub-desktop-release.yml@refs/heads/main',
        run_attempt: 2,
        status: 'in_progress',
        updated_at: '2026-07-22T10:01:00Z',
      }),
    );

    await expect(
      reconcileDesktopReleaseWorkflow(
        {
          channel: 'stable',
          dispatchedAt: new Date('2026-07-22T10:00:00Z'),
          releaseId: 'release-1',
          version: '2.4.0',
          workflowRunId: '100',
        },
        { fetcher, token: 'secret' },
      ),
    ).rejects.toMatchObject({
      code: 'github-reconcile-failed',
      message: 'GitHub returned an unrelated desktop release workflow run.',
    });
  });

  it.each([
    ['event', { event: 'push' }],
    ['branch', { head_branch: 'canary' }],
    ['workflow path', { path: '.github/workflows/other.yml@refs/heads/main' }],
    ['earliest creation bound', { created_at: '2026-07-22T09:54:59Z' }],
    ['latest creation bound', { created_at: '2026-07-22T10:05:01Z' }],
    [
      'bound run id',
      {
        html_url: 'https://github.com/maheshenga/comhub/actions/runs/101',
        id: 101,
      },
    ],
  ])('rejects an already-bound run with the wrong %s', async (_field, override) => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        conclusion: null,
        created_at: '2026-07-22T10:00:02Z',
        display_title: 'ComHub Desktop 2.4.0 (stable) [release-1]',
        event: 'workflow_dispatch',
        head_branch: 'main',
        html_url: 'https://github.com/maheshenga/comhub/actions/runs/100',
        id: 100,
        path: '.github/workflows/comhub-desktop-release.yml@refs/heads/main',
        run_attempt: 2,
        status: 'in_progress',
        updated_at: '2026-07-22T10:01:00Z',
        ...override,
      }),
    );

    await expect(
      reconcileDesktopReleaseWorkflow(
        {
          channel: 'stable',
          dispatchedAt: new Date('2026-07-22T10:00:00Z'),
          releaseId: 'release-1',
          version: '2.4.0',
          workflowRunId: '100',
        },
        { fetcher, token: 'secret' },
      ),
    ).rejects.toMatchObject({
      code: 'github-reconcile-failed',
      message: 'GitHub returned an unrelated desktop release workflow run.',
    });
  });
});
