import { TypedEmitter } from '../services/events';
import { SerialQueue } from '../services/queue';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('SerialQueue', () => {
  it('runs jobs one at a time, in order', async () => {
    const queue = new SerialQueue<{ id: string }, string>();
    const started: string[] = [];
    let active = 0;
    let maxActive = 0;

    const jobs = ['a', 'b', 'c'].map(id =>
      queue.enqueue({ id }, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        started.push(id);
        await tick();
        active -= 1;
        return id;
      })
    );

    await expect(Promise.all(jobs)).resolves.toEqual(['a', 'b', 'c']);
    expect(started).toEqual(['a', 'b', 'c']);
    expect(maxActive).toBe(1);
    expect(queue.length).toBe(0);
    expect(queue.isRunning).toBe(false);
  });

  it('keeps draining after a job rejects', async () => {
    const queue = new SerialQueue<{ id: string }, string>();

    const failing = queue.enqueue({ id: 'bad' }, async () => {
      throw new Error('nope');
    });
    const after = queue.enqueue({ id: 'good' }, async () => 'ok');

    await expect(failing).rejects.toThrow('nope');
    await expect(after).resolves.toBe('ok');
  });

  it('dropQueued settles dropped jobs and leaves the rest queued', async () => {
    const queue = new SerialQueue<{ id: string; source: string }, string | null>();

    let release: () => void = () => {};
    const running = queue.enqueue({ id: 'running', source: 'auto' }, async () => {
      await new Promise<void>(resolve => {
        release = resolve;
      });
      return 'done';
    });

    const autoQueued = queue.enqueue({ id: 'auto-2', source: 'auto' }, async () => 'auto');
    const manualQueued = queue.enqueue({ id: 'manual', source: 'manual' }, async () => 'manual');

    expect(queue.length).toBe(2);

    const dropped = queue.dropQueued(
      meta => meta.source === 'auto',
      task => task.resolve(null)
    );

    expect(dropped).toBe(1);
    expect(queue.length).toBe(1);
    await expect(autoQueued).resolves.toBeNull();

    // Unblock the running job before awaiting the manual one: it only starts
    // once the queue is free again.
    release();
    await expect(running).resolves.toBe('done');
    await expect(manualQueued).resolves.toBe('manual');
  });

  it('does not let an emit-time unsubscribe skip other handlers', async () => {
    // Guards the pattern used by DownloadEvents: handlers must be copied
    // before dispatch so an `off()` inside a handler is safe.
    const emitter = new TypedEmitter<{ ping: number }>();
    const seen: string[] = [];

    const second = () => seen.push('second');
    emitter.on('ping', () => {
      seen.push('first');
      emitter.off('ping', second);
    });
    emitter.on('ping', second);

    emitter.emit('ping', 1);
    expect(seen).toEqual(['first', 'second']);
  });
});
