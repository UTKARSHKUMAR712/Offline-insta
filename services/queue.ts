export interface SerialTask<Meta, Result> {
  readonly meta: Meta;
  readonly run: () => Promise<Result>;
  readonly resolve: (value: Result) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * Strictly serial task queue. Every job waits for the previous one to settle,
 * and a failing job never blocks the rest of the queue.
 */
export class SerialQueue<Meta, Result> {
  private tasks: SerialTask<Meta, Result>[] = [];
  private running = false;

  get length(): number {
    return this.tasks.length;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Adds a job and resolves/rejects with the job's own outcome. */
  enqueue(meta: Meta, run: () => Promise<Result>): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      this.tasks.push({ meta, run, resolve, reject });
      void this.drain();
    });
  }

  /**
   * Removes still-queued jobs matching `predicate` and hands each one to
   * `settle` so its caller's promise resolves instead of hanging forever.
   * Returns how many jobs were dropped.
   */
  dropQueued(
    predicate: (meta: Meta) => boolean,
    settle: (task: SerialTask<Meta, Result>) => void
  ): number {
    const kept: SerialTask<Meta, Result>[] = [];
    const dropped: SerialTask<Meta, Result>[] = [];

    for (const task of this.tasks) {
      (predicate(task.meta) ? dropped : kept).push(task);
    }

    this.tasks = kept;
    dropped.forEach(settle);
    return dropped.length;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      while (this.tasks.length > 0) {
        const task = this.tasks.shift();
        if (!task) break;
        try {
          task.resolve(await task.run());
        } catch (error) {
          task.reject(error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
