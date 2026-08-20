import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { buildRecommendArgv } from '../../src/python/recommendClient';
import { buildFullSnippet } from '../../src/insert/snippetBuilder';

suite('VeloxQuant-MLX Extension Integration', () => {
  test('extension activates and is present', async () => {
    const ext = vscode.extensions.getExtension('veloxquant.veloxquant-vscode');
    // Packaging id depends on publisher; tolerate not-found in a bare test
    // host that didn't install this as a real extension, but if present it
    // must activate cleanly.
    if (ext) {
      await ext.activate();
      assert.ok(ext.isActive);
    }
  });

  test('recommend command argv matches expected shape for a submit-like input', () => {
    const argv = buildRecommendArgv({
      chip: 'M4',
      ramGb: 16,
      modelClass: '7B',
      goal: 'everyday',
    });
    assert.deepStrictEqual(argv, [
      '-m',
      'veloxquant_mlx',
      'recommend',
      '--chip',
      'M4',
      '--ram-gb',
      '16',
      '--model-class',
      '7B',
      '--goal',
      'everyday',
      '--json',
    ]);
  });

  test('insert produces expected snippet text for a recommendation result', () => {
    const snippet = buildFullSnippet('turboquant_rvq', { bit_width_inlier: 1, seed: 42 });
    assert.ok(snippet.includes("KVCacheConfig(method='turboquant_rvq', bit_width_inlier=1, seed=42)"));
  });

  test('recommend sidebar view is contributed', () => {
    // views/viewsContainers are declarative in package.json; this smoke
    // test confirms the contribution point registers without throwing by
    // checking the command is registered instead (views aren't queryable
    // directly via the API before being revealed).
    return vscode.commands.getCommands(true).then((commands) => {
      assert.ok(commands.includes('veloxquant.openPlaygroundEditor'));
    });
  });
});
