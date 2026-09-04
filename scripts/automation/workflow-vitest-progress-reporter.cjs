'use strict';

const fs = require('fs');

function emit(event) {
  const dest = process.env.TEE_VITEST_PROGRESS_FILE;
  if (!dest) return;
  try {
    fs.appendFileSync(dest, `${JSON.stringify(event)}\n`);
  } catch {
    /* display-only sidecar; never fail the suite */
  }
}

function countAllTests(files) {
  let total = 0;
  for (const file of files ?? []) {
    if (file && typeof file.allTests === 'function') {
      total += [...file.allTests()].length;
      continue;
    }
    total += countTasks(file?.tasks);
  }
  return total;
}

function countTasks(tasks) {
  if (!Array.isArray(tasks)) return 0;
  let total = 0;
  for (const task of tasks) {
    if (task?.type === 'test' || task?.type === 'chore') total += 1;
    if (Array.isArray(task?.tasks)) total += countTasks(task.tasks);
  }
  return total;
}

function testName(testCase) {
  if (!testCase) return '';
  if (typeof testCase.fullName === 'string') return testCase.fullName;
  if (typeof testCase.name === 'string') return testCase.name;
  return '';
}

function testState(testCase) {
  const result = typeof testCase?.result === 'function' ? testCase.result() : testCase?.result;
  return result?.state ?? 'unknown';
}

module.exports = function vitestProgressReporter() {
  let completed = 0;
  let total = 0;
  return {
    onCollected(files) {
      total = countAllTests(files);
      emit({ type: 'collected', completed, total });
    },
    onTestCaseResult(testCase) {
      completed += 1;
      const current = testName(testCase);
      const state = testState(testCase);
      emit({
        type: 'case',
        completed,
        total,
        current,
        failed: state === 'failed',
        state,
      });
    },
  };
};
