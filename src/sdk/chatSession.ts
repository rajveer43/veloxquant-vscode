/**
 * Wraps a loaded `@veloxquant/sdk` model for the Chat Playground: owns
 * starting the underlying `veloxquant serve` process and stopping it,
 * mirroring `PanelServerManager`'s dispose-on-panel-close discipline — a
 * chat session that loads a model but never stops it on panel close would
 * leak a real inference process, the same failure mode the existing
 * "ask before stopping" logic exists to prevent for the control-plane
 * server.
 */
import type { VeloxQuant as VeloxQuantClient, VeloxQuantModel, Agent, StreamChunk, ToolSpec } from '@veloxquant/sdk' with { 'resolution-mode': 'require' };
import { getVeloxQuantOptions } from './client';

export type ChatSessionState = 'loading' | 'ready' | 'error';

export class ChatSession {
  private model: VeloxQuantModel | undefined;
  private agent: Agent | undefined;
  private stopped = false;

  private constructor() {}

  static async load(modelId: string, method?: string): Promise<ChatSession> {
    const { VeloxQuant, Agent: AgentCtor } = (await import('@veloxquant/sdk')) as { VeloxQuant: typeof VeloxQuantClient; Agent: typeof Agent };
    const session = new ChatSession();
    const client = new VeloxQuant(await getVeloxQuantOptions());
    session.model = await client.load(
      method ? { model: modelId, method, optimize: false } : { model: modelId, optimize: 'auto' }
    );
    session.agentCtor = AgentCtor;
    return session;
  }

  private agentCtor: typeof Agent | undefined;

  get pid(): number | undefined {
    return this.model?.pid;
  }

  get method(): string | undefined {
    return this.model?.method;
  }

  /** Lazily builds (and reuses) an Agent over this session's already-loaded model, for agent-mode toggling in the same webview. */
  private getAgent(): Agent {
    if (!this.model || !this.agentCtor) {
      throw new Error('ChatSession is not loaded.');
    }
    if (!this.agent) {
      this.agent = new this.agentCtor(this.model);
    }
    return this.agent;
  }

  registerTool<Args = Record<string, unknown>>(spec: ToolSpec<Args>): void {
    this.getAgent().tool(spec);
  }

  async *stream(prompt: string, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    if (!this.model) {
      throw new Error('ChatSession is not loaded.');
    }
    yield* this.model.stream({ prompt, signal });
  }

  async runAgent(prompt: string, signal?: AbortSignal): Promise<{ text: string; steps: { toolName: string; args: unknown; result: unknown }[] }> {
    return this.getAgent().run(prompt, { signal });
  }

  /** Stops the underlying server process. Safe to call more than once. */
  async stop(): Promise<void> {
    if (this.stopped || !this.model) {
      return;
    }
    this.stopped = true;
    await this.model.stop();
  }
}
