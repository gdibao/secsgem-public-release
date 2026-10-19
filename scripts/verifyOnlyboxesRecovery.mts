import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const output = process.argv[2];
if (!output) throw new Error('Evidence file required');
// Read only sandbox configuration into this process; never print or persist credentials.
const raw = execFileSync(
  'ssh',
  [
    '-o',
    'BatchMode=yes',
    'kaifa@192.168.100.125',
    'docker exec fab125-comhub-1 node -e ' +
      JSON.stringify(
        'const keys=["SANDBOX_PROVIDER","ONLYBOXES_BASE_URL","ONLYBOXES_JIT_SIGNING_KEY","ONLYBOXES_JIT_ISSUER","ONLYBOXES_JIT_TTL_SEC"]; console.log(JSON.stringify(Object.fromEntries(keys.map(k=>[k,process.env[k]]))))',
      ),
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);
Object.assign(process.env, JSON.parse(raw), { ONLYBOXES_LEASE_TTL_SEC: '120' });
const { OnlyboxesSandboxProvider } =
  await import('../apps/server/src/services/sandbox/providers/onlyboxes');
const stamp = Date.now().toString();
const provider = new OnlyboxesSandboxProvider({
  userId: `fab-recovery-${stamp}`,
  topicId: 'a',
  marketService: undefined as never,
});
const other = new OnlyboxesSandboxProvider({
  userId: `fab-recovery-other-${stamp}`,
  topicId: 'b',
  marketService: undefined as never,
});
const file = `/tmp/fab-recovery-${stamp}.txt`;
const evidence = { checkedAt: new Date().toISOString(), checks: [] as unknown[], ok: false };
const call = async (name: string, command: string, expected: string, instance = provider) => {
  try {
    const result = await instance.callTool('runCommand', { command, timeout: 15000 });
    const data = result.result as { stdout?: string; output?: string; exitCode?: number };
    const stdout = data?.stdout ?? data?.output ?? '';
    const ok = result.success && data?.exitCode === 0 && stdout.includes(expected);
    evidence.checks.push({ name, ok, exitCode: data?.exitCode, error: result.error?.name ?? null });
    return ok;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    const safeMessage = message.split(process.env.ONLYBOXES_JIT_SIGNING_KEY || '__absent_key__').join('[redacted]')
      .replace(/obx_jit_v1\.[A-Za-z0-9_.-]+/g, '[redacted]');
    evidence.checks.push({
      name,
      ok: false,
      error: error instanceof Error ? error.name : 'unknown',
      message: safeMessage.slice(0, 240),
    });
    return false;
  }
};
try {
  const created = await call(
    'write-independent-test-file',
    `printf 'fab-recovery-ok' > '${file}'; cat '${file}'`,
    'fab-recovery-ok',
  );
  if (created) {
    await call('same-session-read', `cat '${file}'`, 'fab-recovery-ok');
    await call(
      'other-user-and-topic-isolation',
      `test ! -e '${file}' && printf isolated`,
      'isolated',
      other,
    );
    await call('python-runtime', "python3 -c 'print(17*19)'", '323');
    const failure = await provider.callTool('runCommand', { command: 'exit 7', timeout: 15000 });
    evidence.checks.push({
      name: 'nonzero-exit-reported',
      ok: (failure.result as any)?.exitCode === 7,
    });
    await call('failure-recovery', 'printf recovered', 'recovered');
    await call(
      'network-isolation',
      `python3 - <<'PY'\nimport socket\ns=socket.socket();s.settimeout(3)\ntry:\n s.connect(('1.1.1.1',443));print('network-open')\nexcept OSError:\n print('network-blocked')\nfinally:\n s.close()\nPY`,
      'network-blocked',
    );
    await call(
      'remove-only-own-test-file',
      `rm -- '${file}'; test ! -e '${file}' && printf removed`,
      'removed',
    );
  }
  evidence.ok = evidence.checks.length === 8 && evidence.checks.every((c: any) => c.ok);
} finally {
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(evidence));
}
if (!evidence.ok) process.exitCode = 1;
