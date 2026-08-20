import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
    const extensionTestsPath = path.resolve(__dirname, './index');

    // Pinned to a known-good stable release rather than "latest": at the
    // time this harness was written, the very newest VS Code build shipped
    // a MacOS/Code launcher that @vscode/test-electron could not drive
    // (see CHANGELOG note in this repo's test/suite/README expectations).
    // 1.85.x is also our package.json engines.vscode floor, so it is a
    // meaningful compatibility target in its own right.
    await runTests({ extensionDevelopmentPath, extensionTestsPath, version: '1.85.2' });
  } catch (err) {
    console.error('Failed to run integration tests:', err);
    process.exit(1);
  }
}

void main();
