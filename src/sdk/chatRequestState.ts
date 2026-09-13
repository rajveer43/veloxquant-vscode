export interface ActiveChatRequest {
  id: string;
  controller: AbortController;
}

export class ChatRequestCoordinator {
  private active: ActiveChatRequest | undefined;

  begin(id: string): ActiveChatRequest | undefined {
    if (this.active) return undefined;
    this.active = { id, controller: new AbortController() };
    return this.active;
  }

  get current(): ActiveChatRequest | undefined {
    return this.active;
  }

  isActive(id: string): boolean {
    return this.active?.id === id && !this.active.controller.signal.aborted;
  }

  abort(id?: string): boolean {
    if (!this.active || (id && this.active.id !== id)) return false;
    this.active.controller.abort();
    return true;
  }

  finish(id: string): boolean {
    if (this.active?.id !== id) return false;
    this.active = undefined;
    return true;
  }
}
