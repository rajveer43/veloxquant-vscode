/**
 * Thin wrapper over `@veloxquant/sdk`'s list/pull/delete local-model
 * functions, routed through Phase 0's `getVeloxQuantOptions()` so every
 * call uses this extension's own resolved interpreter.
 */
import type { LocalModel, PullModelResult, DeleteModelResult } from '@veloxquant/sdk' with { 'resolution-mode': 'require' };
import { getVeloxQuantOptions } from './client';

async function sdk() {
  return import('@veloxquant/sdk');
}

export async function listLocal(): Promise<LocalModel[]> {
  const { listLocalModels } = await sdk();
  return listLocalModels(await getVeloxQuantOptions());
}

/** No default timeout — downloads can take many minutes (matches `localModels.ts:93-98`'s documented reasoning in the SDK). */
export async function pullLocal(modelId: string): Promise<PullModelResult> {
  const { pullLocalModel } = await sdk();
  return pullLocalModel(modelId, await getVeloxQuantOptions());
}

export async function deleteLocal(modelId: string): Promise<DeleteModelResult> {
  const { deleteLocalModel } = await sdk();
  return deleteLocalModel(modelId, await getVeloxQuantOptions());
}
