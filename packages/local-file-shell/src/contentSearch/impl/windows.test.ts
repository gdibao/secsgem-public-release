import { execa } from 'execa';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WindowsContentSearchImpl } from './windows';

vi.mock('execa', () => ({ execa: vi.fn() }));

describe('WindowsContentSearchImpl', () => {
  beforeEach(() => {
    vi.mocked(execa).mockReset();
  });

  it('passes findstr input as arguments without constructing a shell command', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: 'result.txt:matched\r\n' } as never);
    const search = new WindowsContentSearchImpl();

    const result = await (search as any).grepWithFindstr({
      output_mode: 'files_with_matches',
      pattern: 'needle & calc.exe',
      scope: 'C:\\safe',
    });

    expect(execa).toHaveBeenCalledWith(
      'findstr',
      ['/S', '/R', 'needle & calc.exe', '*.*'],
      expect.objectContaining({ cwd: expect.any(String), stdin: 'ignore' }),
    );
    expect(result).toMatchObject({
      engine: 'findstr',
      matches: ['result.txt'],
      success: true,
    });
  });
});
