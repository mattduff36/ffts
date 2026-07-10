import { describe, expect, it } from 'vitest';
import { parseTerminalActivity } from '@/scripts/finalise-activity-guard';

describe('finalise activity guard', () => {
  it('detects running terminal-visible Agent Review output', () => {
    const activity = parseTerminalActivity('1.txt', [
      '---',
      'pid: 123',
      'cwd: |',
      '  D:/Websites/ffts',
      'active_command: Agent Review',
      '---',
      'Reviewing your changes...',
    ].join('\n'));

    expect(activity?.isRunning).toBe(true);
    expect(activity?.isAgentReview).toBe(true);
    expect(activity?.pid).toBe(123);
  });

  it('detects a running finalise command from command metadata', () => {
    const activity = parseTerminalActivity('2.txt', [
      '---',
      'pid: 456',
      'cwd: "d:\\Websites\\ffts"',
      'command: "npm run finalise:full:push"',
      'started_at: 2026-05-19T22:08:57.699Z',
      'running_for_ms: 195257',
      '---',
      '> ffts@0.1.0 finalise:full:push',
    ].join('\n'));

    expect(activity?.isRunning).toBe(true);
    expect(activity?.isFinalise).toBe(true);
    expect(activity?.startedAt).toBe('2026-05-19T22:08:57.699Z');
  });

  it('does not treat completed finalise output as running', () => {
    const activity = parseTerminalActivity('3.txt', [
      '---',
      'pid: 789',
      'cwd: "d:\\Websites\\ffts"',
      'command: "npm run finalise"',
      'started_at: 2026-05-19T22:08:57.699Z',
      '---',
      'Finalise complete.',
      '---',
      'exit_code: 0',
      'elapsed_ms: 1000',
      '---',
    ].join('\n'));

    expect(activity?.isRunning).toBe(false);
    expect(activity?.isFinalise).toBe(true);
  });
});
