import { spawnSync } from 'node:child_process';

/**
 * @test-decision merge-process-runner
 * @test-action Keep one child-process seam and batch compatible commands; callers should not duplicate spawn, timeout, or failure normalization.
 */
export function runProcess(command, args = [], options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

/**
 * @test-decision merge-process-runner
 * @test-action Keep one child-process seam and batch compatible commands; callers should not duplicate spawn, timeout, or failure normalization.
 */
export function childProcessFailure(label, { status, signal, stdout = '', stderr = '', error } = {}) {
  const output = [stderr, stdout].filter((value) => value && value.trim()).join('\n').trim();
  const details = error?.message ?? output;
  const silentFailure = status !== 0 && !signal && !details;
  const sandboxHint = silentFailure
    ? ' No output was captured; restricted child-process execution in a sandbox or CI runner is a possible cause. Rerun this test on the host runner as described in AGENTS.md.'
    : '';
  return `${label} exited with code=${status ?? 'null'} signal=${signal ?? 'none'}${details ? `: ${details}` : ''}.${sandboxHint}`;
}
