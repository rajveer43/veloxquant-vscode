import type { MethodInfo } from '@veloxquant/sdk' with { 'resolution-mode': 'require' };
import { getVeloxQuantOptions } from './client';

export async function listServableMethods(): Promise<MethodInfo[]> {
  const { listMethods } = await import('@veloxquant/sdk');
  const result = await listMethods({ servableOnly: true }, await getVeloxQuantOptions());
  return result.methods.filter((method) => method.isServable);
}
