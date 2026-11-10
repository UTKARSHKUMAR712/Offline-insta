import type { DownloadEventMap } from './types';

type Handler<Payload> = (payload: Payload) => void;

/**
 * Minimal typed emitter. Keeping the payload types in one place means a renamed
 * field fails to compile at every publisher and subscriber, not at runtime.
 */
export class TypedEmitter<Events extends object> {
  private readonly handlers: { [K in keyof Events]?: Handler<Events[K]>[] } = {};

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    const list = this.handlers[event] ?? (this.handlers[event] = []);
    list.push(handler);
  }

  off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    const list = this.handlers[event];
    if (!list) return;
    this.handlers[event] = list.filter(item => item !== handler) as typeof list;
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const list = this.handlers[event];
    if (!list) return;
    // Copy so a handler that unsubscribes mid-emit can't skip its neighbours.
    ([...list] as Handler<Events[K]>[]).forEach(handler => handler(payload));
  }
}

/** Process-wide download events consumed by the tray and the feed screens. */
export const DownloadEvents = new TypedEmitter<DownloadEventMap>();
