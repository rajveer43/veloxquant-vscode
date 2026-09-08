/**
 * Single source of truth for building `VeloxQuantOptions` (the options bag
 * every `@veloxquant/sdk` call takes) from this extension's own interpreter
 * resolution.
 *
 * `@veloxquant/sdk` has its own, independent interpreter-resolution logic
 * (falls back to `VELOXQUANT_PYTHON` env var, then a bare `python3`) that
 * this extension deliberately never invokes: `resolveInterpreter()` in
 * `../python/interpreter.ts` is already the extension's one and only
 * interpreter policy (setting -> Python extension -> none, never a bare
 * `python3` fallback), and every SDK-backed feature must see the exact same
 * interpreter the Recommend/Compression Lab features use. Passing an
 * explicit `pythonPath` here makes the SDK's own fallback chain dead code
 * from this extension's point of view — that's intentional, not a gap.
 *
 * Every SDK call site (chat playground, local model management, agent demo,
 * benchmark) must go through `getVeloxQuantOptions()` rather than calling
 * `resolveInterpreter()` or constructing `VeloxQuantOptions` itself, so this
 * policy is encoded in exactly one place.
 */
import type { VeloxQuantOptions } from '@veloxquant/sdk' with { 'resolution-mode': 'require' };
import type { InterpreterResolution } from '../python/interpreter';

/**
 * `resolve` is injectable purely so this function's mapping logic can be
 * unit-tested without loading the `vscode` module (which `../python/
 * interpreter` imports at its top level) — every real call site should call
 * this with no arguments, which lazily loads the real `resolveInterpreter`.
 */
export async function getVeloxQuantOptions(
  resolve?: () => Promise<InterpreterResolution>
): Promise<VeloxQuantOptions> {
  const resolveFn = resolve ?? (await import('../python/interpreter.js')).resolveInterpreter;
  const resolution = await resolveFn();
  return resolution.path ? { pythonPath: resolution.path } : {};
}
