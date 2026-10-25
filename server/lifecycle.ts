import { RoomFailure } from './rooms/service.js';

// Track asynchronous work independently of HTTP connection lifetime. A caller
// can disconnect during image decoding or password hashing without cancelling it.
export class PendingWork {
  private pending = new Set<Promise<unknown>>();
  private stopping = false;

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(new RoomFailure('SERVER_STOPPING', 'The server is restarting. Reconnect shortly.', 503));
    const result = Promise.resolve().then(work);
    this.pending.add(result);
    void result.finally(() => this.pending.delete(result)).catch(() => {});
    return result;
  }

  async close() {
    this.stopping = true;
    await Promise.allSettled(this.pending);
  }
}
