import { prExecutor } from '../src/pr-executor.js';
import { runCodeAgent } from '../src/codeagent.js';

describe('EDIT blocks', () => {
  it('applies an edit to a fixture file', async () => {
    const issue = { number: 1, title: 'Test issue', body: 'Fix the bug in seed/worker/src/pr-executor.js' };
    const tree = 'seed/worker/src/pr-executor.js\nseed/worker/test/edit-test.js';
    const prompt = prExecutor.buildPrompt(issue, tree);
    const out = await runCodeAgent({ AI: true }, prompt);
    expect(out.files).toHaveLength(1);
    expect(out.files[0].path).toBe('seed/worker/src/pr-executor.js');
    expect(out.files[0].edits).toHaveLength(1);
    expect(out.files[0].edits[0].find).toBe('export function buildPrompt(issue, tree, files = {}) {');
    expect(out.files[0].edits[0].replace).toBe('export function buildPrompt(issue, tree) {');
  });
});
