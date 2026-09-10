import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  archiveSupersededFinaliseFailureArtifact,
  assertRepairClosureClearanceAllowed,
  clearFinaliseRepairClosureArtifacts,
  getFinaliseFailurePath,
  getFinaliseRepairCompletePath,
  incrementFinaliseRepairAttempt,
  markFinaliseRepairComplete,
  readFinaliseFailureArtifact,
  readFinaliseRepairCompleteArtifact,
  writeFinaliseFailureArtifact,
} from '@/scripts/automation/finalise-failure';
import { readOrdinaryFinaliseCache } from '@/scripts/automation/finalise-checkpoint';
import {
  getWorkflowPaths,
  loadWorkflowReviewState,
} from '@/scripts/automation/workflow-events';

const roots: string[] = [];

function makeRepo(): string {
  const root = path.join(
    tmpdir(),
    `finalise-repair-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  mkdirSync(path.join(root, 'app'), { recursive: true });
  const packageJson = {
    name: 'repair-fixture',
    private: true,
    scripts: {
      build:
        "node -e \"const fs=require('fs');fs.mkdirSync('.next',{recursive:true});fs.writeFileSync('.next/BUILD_ID','ok')\"",
    },
  };
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(packageJson), 'utf8');
  writeFileSync(path.join(root, 'package-lock.json'), '{}', 'utf8');
  writeFileSync(path.join(root, 'tsconfig.json'), '{}', 'utf8');
  writeFileSync(path.join(root, 'app', 'page.tsx'), 'export default null;', 'utf8');
  roots.push(root);
  return root;
}

function runRepair(repoRoot: string) {
  return spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.join(process.cwd(), 'scripts', 'finalise-repair.ts'),
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: false,
    }
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('targeted finalise repair', () => {
  it('TEE-REPAIR-001 reruns allowlisted step, keeps repair-complete evidence, and blocks repeat repair', () => {
    const repoRoot = makeRepo();
    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise',
      failedStep: 'build',
      command: 'npm run build',
    });
    writeFileSync(path.join(repoRoot, 'app', 'page.tsx'), 'export default 1;', 'utf8');

    const result = runRepair(repoRoot);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(path.join(repoRoot, '.next', 'BUILD_ID'))).toBe(true);
    expect(existsSync(getFinaliseFailurePath(repoRoot))).toBe(false);
    expect(existsSync(getFinaliseRepairCompletePath(repoRoot))).toBe(true);
    const complete = readFinaliseRepairCompleteArtifact(repoRoot);
    expect(complete?.status).toBe('awaiting_finalise_closure');
    expect(complete?.originalFailure.failedStep).toBe('build');
    expect(readOrdinaryFinaliseCache(repoRoot, 'finalise')?.steps.build?.status).toBe('passed');
    expect(result.stdout).toMatch(/original finalise command once/iu);

    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise',
      failedStep: 'build',
      command: 'npm run build',
    });
    const blocked = runRepair(repoRoot);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toMatch(/awaiting original finalise closure/iu);

    clearFinaliseRepairClosureArtifacts({
      repoRoot,
      mode: 'finalise',
      workstreamId: null,
      checkpointId: null,
    });
    expect(existsSync(getFinaliseRepairCompletePath(repoRoot))).toBe(false);
  }, 15_000);

  it('archives a repairable failure only after its exact candidate changes', () => {
    const repoRoot = makeRepo();
    spawnSync('git', ['init'], { cwd: repoRoot, encoding: 'utf8' });
    spawnSync('git', ['add', '.'], { cwd: repoRoot, encoding: 'utf8' });
    spawnSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture'],
      { cwd: repoRoot, encoding: 'utf8' }
    );
    const failure = writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise-full',
      failedStep: 'test-run',
      command: 'npm run test:run',
    });

    expect(archiveSupersededFinaliseFailureArtifact(repoRoot)).toEqual({
      archived: false,
      reason: 'same-candidate',
    });

    writeFileSync(path.join(repoRoot, 'app', 'page.tsx'), 'export default 2;', 'utf8');
    const archived = archiveSupersededFinaliseFailureArtifact(repoRoot);
    expect(archived.archived).toBe(true);
    expect(archived.reason).toBe('candidate-changed');
    expect(archived.archivePath && existsSync(archived.archivePath)).toBe(true);
    expect(existsSync(getFinaliseFailurePath(repoRoot))).toBe(false);
    expect(
      JSON.parse(readFileSync(archived.archivePath!, 'utf8')) as {
        inputFingerprint: string;
      }
    ).toMatchObject({ inputFingerprint: failure.inputFingerprint });
  });

  it('fails closed for malformed gates and artifact replacement during repair', () => {
    const repoRoot = makeRepo();
    const failurePath = getFinaliseFailurePath(repoRoot);
    mkdirSync(path.dirname(failurePath), { recursive: true });
    writeFileSync(
      failurePath,
      JSON.stringify({
        schemaVersion: '1',
        originalMode: 'finalise-full',
        failedStep: 'test-run',
        command: 'npm run arbitrary',
        inputFingerprint: 'not-a-fingerprint',
        safetyFingerprint: 'also-invalid',
        workstreamId: null,
        checkpointId: null,
        createdAt: new Date().toISOString(),
        repairAttemptCount: 0,
      }),
      'utf8'
    );
    expect(archiveSupersededFinaliseFailureArtifact(repoRoot)).toEqual({
      archived: false,
      reason: 'missing-or-malformed',
    });
    expect(existsSync(failurePath)).toBe(true);
    expect(() =>
      assertRepairClosureClearanceAllowed({
        repoRoot,
        mode: 'finalise-full',
        workstreamId: null,
      })
    ).toThrow(/malformed/iu);

    rmSync(failurePath, { force: true });
    const first = writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise-full',
      failedStep: 'test-run',
      command: 'npm run test:run',
    });
    writeFileSync(path.join(repoRoot, 'tsconfig.json'), '{"changed":true}', 'utf8');
    const replacement = writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise-full',
      failedStep: 'test-run',
      command: 'npm run test:run',
    });
    expect(() => incrementFinaliseRepairAttempt(repoRoot, first)).toThrow(
      /changed before targeted repair claim/iu
    );
    expect(() => markFinaliseRepairComplete(repoRoot, first)).toThrow(
      /changed during targeted repair/iu
    );
    expect(readFinaliseFailureArtifact(repoRoot)?.inputFingerprint).toBe(
      replacement.inputFingerprint
    );
  });

  it('rejects malformed repair-complete evidence and recovers a dead-owner lock', () => {
    const repoRoot = makeRepo();
    const failure = writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise',
      failedStep: 'build',
      command: 'npm run build',
    });
    markFinaliseRepairComplete(repoRoot, failure);
    const completePath = getFinaliseRepairCompletePath(repoRoot);
    const malformed = JSON.parse(readFileSync(completePath, 'utf8')) as {
      command: string;
    };
    malformed.command = 'npm run arbitrary';
    writeFileSync(completePath, JSON.stringify(malformed), 'utf8');
    expect(readFinaliseRepairCompleteArtifact(repoRoot)).toBeNull();
    expect(() =>
      assertRepairClosureClearanceAllowed({
        repoRoot,
        mode: 'finalise',
        workstreamId: null,
      })
    ).toThrow(/malformed/iu);

    const deadLockRepo = makeRepo();
    const lockPath = path.join(
      deadLockRepo,
      'docs_private',
      'automation',
      'finalise-gate-mutation.lock'
    );
    mkdirSync(path.dirname(lockPath), { recursive: true });
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 2_147_483_647,
        token: 'dead-owner-token',
        createdAt: '2020-01-01T00:00:00.000Z',
      }),
      'utf8'
    );
    expect(() =>
      writeFinaliseFailureArtifact({
        repoRoot: deadLockRepo,
        originalMode: 'finalise',
        failedStep: 'build',
        command: 'npm run build',
      })
    ).not.toThrow();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('validates any remaining closure gate before release mutations', () => {
    const finaliseSource = readFileSync(
      path.join(process.cwd(), 'scripts', 'finalise.ts'),
      'utf8'
    );
    const gateIndex = finaliseSource.indexOf(
      "run.step('Validate finalise failure gate before mutation'"
    );
    expect(gateIndex).toBeGreaterThan(-1);
    for (const laterOperation of [
      "console.log(`\\n==> Run pending local migrations",
      "console.log('\\n==> Commit workspace changes')",
      "console.log('\\n==> Push authorised SHA to origin/main')",
      "run.finish('passed')",
    ]) {
      expect(finaliseSource.indexOf(laterOperation)).toBeGreaterThan(gateIndex);
    }
  });

  it('refuses database and stale failure artifacts', () => {
    const repoRoot = makeRepo();
    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise',
      failedStep: 'migrations',
      command: 'run-pending-migrations',
    });
    expect(runRepair(repoRoot).status).not.toBe(0);

    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise',
      failedStep: 'build',
      command: 'npm run build',
    });
    const failurePath = getFinaliseFailurePath(repoRoot);
    const stale = JSON.parse(readFileSync(failurePath, 'utf8')) as { createdAt: string };
    stale.createdAt = '2020-01-01T00:00:00.000Z';
    writeFileSync(failurePath, JSON.stringify(stale), 'utf8');
    const staleResult = runRepair(repoRoot);
    expect(staleResult.status).not.toBe(0);
    expect(staleResult.stderr).toMatch(/stale/iu);
  }, 15_000);

  it('TEE-REPAIR-001 refuses clearing repair-complete when mode/workstream/checkpoint mismatch', () => {
    const repoRoot = makeRepo();
    const failure = writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise',
      failedStep: 'build',
      command: 'npm run build',
      workstreamId: 'ws_repair_1',
      checkpointId: 'ckpt_1',
    });
    expect(failure.checkpointId).toBe('ckpt_1');
    markFinaliseRepairComplete(repoRoot, failure, { checkpointId: 'ckpt_1' });

    expect(() =>
      assertRepairClosureClearanceAllowed({
        repoRoot,
        mode: 'finalise-full',
        workstreamId: 'ws_repair_1',
        checkpointId: 'ckpt_1',
      })
    ).toThrow(/mode mismatch/iu);

    expect(() =>
      assertRepairClosureClearanceAllowed({
        repoRoot,
        mode: 'finalise',
        workstreamId: 'ws_other',
        checkpointId: 'ckpt_1',
      })
    ).toThrow(/workstream mismatch/iu);

    expect(() =>
      assertRepairClosureClearanceAllowed({
        repoRoot,
        mode: 'finalise',
        workstreamId: 'ws_repair_1',
        checkpointId: 'ckpt_other',
      })
    ).toThrow(/checkpoint mismatch/iu);

    expect(() =>
      assertRepairClosureClearanceAllowed({
        repoRoot,
        mode: 'finalise',
        workstreamId: 'ws_repair_1',
        checkpointId: 'ckpt_1',
      })
    ).not.toThrow();

    expect(() =>
      clearFinaliseRepairClosureArtifacts({
        repoRoot,
        mode: 'finalise-full',
        workstreamId: 'ws_repair_1',
        checkpointId: 'ckpt_1',
      })
    ).toThrow(/mode mismatch/iu);

    clearFinaliseRepairClosureArtifacts({
      repoRoot,
      mode: 'finalise',
      workstreamId: 'ws_repair_1',
      checkpointId: 'ckpt_1',
    });
    expect(existsSync(getFinaliseRepairCompletePath(repoRoot))).toBe(false);
  });

  it('TEE-REPAIR-001 refuses clearing a failure artifact without matching identity', () => {
    const repoRoot = makeRepo();
    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise',
      failedStep: 'build',
      command: 'npm run build',
      workstreamId: 'ws_fail_1',
      checkpointId: 'ckpt_fail_1',
    });
    expect(() =>
      clearFinaliseRepairClosureArtifacts({
        repoRoot,
        mode: 'finalise',
        workstreamId: 'ws_fail_1',
        checkpointId: 'ckpt_other',
      })
    ).toThrow(/checkpoint mismatch/iu);
    expect(existsSync(getFinaliseFailurePath(repoRoot))).toBe(true);
  });

  it('TEE-PUSH-001: repair CLI and package script never push', () => {
    const repairSource = readFileSync(
      path.join(process.cwd(), 'scripts', 'finalise-repair.ts'),
      'utf8'
    );
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts['finalise:repair']).toBe('tsx scripts/finalise-repair.ts');
    expect(repairSource).not.toMatch(/git\s+push/iu);
    expect(repairSource).not.toMatch(/--push/iu);
    expect(packageJson.scripts['finalise:repair']).not.toMatch(/push/iu);
  });

  it('TEE-INDEPENDENCE-001: new finalise modules stay repository-local', () => {
    const files = [
      'scripts/automation/finalise-checkpoint.ts',
      'scripts/automation/finalise-failure.ts',
      'scripts/automation/workflow-finalise-correlation.ts',
      'scripts/finalise-repair.ts',
    ];
    for (const relative of files) {
      const text = readFileSync(path.join(process.cwd(), relative), 'utf8');
      expect(text, relative).not.toContain('avsworklog');
      expect(text, relative).not.toMatch(/D:\\\\Websites\\\\(?!ffts)/iu);
    }
  });

  it('persists repeated repair-cycle history after successful targeted checks', () => {
    const repoRoot = makeRepo();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      clearFinaliseRepairClosureArtifacts({
        repoRoot,
        mode: 'finalise',
        workstreamId: null,
        checkpointId: null,
      });
      writeFinaliseFailureArtifact({
        repoRoot,
        originalMode: 'finalise',
        failedStep: 'build',
        command: 'npm run build',
      });
      const result = runRepair(repoRoot);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    }
    const state = loadWorkflowReviewState(getWorkflowPaths(repoRoot).statePath);
    expect(state.pendingAnomalySignals?.[0]?.flags).toContain(
      'targeted-repair-cycle-exceeded'
    );
  }, 25_000);
});
