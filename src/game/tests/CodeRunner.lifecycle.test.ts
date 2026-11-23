import { beforeEach, expect, test, vi } from 'vitest';
import { EventBus } from '../EventBus';

vi.mock('phaser', () => ({
  Events: {
    EventEmitter: class {
      on = vi.fn();
      off = vi.fn();
      emit = vi.fn();
      once = vi.fn();
      removeAllListeners = vi.fn();
    },
  },
}));

import { CodeRunner } from '../CodeRunner';

type MockTimer = {
  remove: ReturnType<typeof vi.fn>;
  callback: (() => Promise<void>) | undefined;
};

let mockTimer: MockTimer;
let mockTimers: MockTimer[];
let sleepCallback: (() => void) | undefined;
let scene: any;
let api: {
  moveRight: ReturnType<typeof vi.fn>;
  moveLeft: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  track: ReturnType<typeof vi.fn>;
};
let testRunner: CodeRunner;

beforeEach(() => {
  vi.clearAllMocks();
  mockTimer = {
    remove: vi.fn(),
    callback: undefined,
  };
  mockTimers = [];
  sleepCallback = undefined;

  scene = {
    time: {
      addEvent: vi.fn((config: any) => {
        const timer: MockTimer = {
          remove: vi.fn(),
          callback: () => config.callback.call(config.callbackScope),
        };

        mockTimer = timer;
        mockTimers.push(timer);
        return timer;
      }),
      delayedCall: vi.fn((_ms: number, callback: () => void) => {
        sleepCallback = callback;
      }),
    },
  };

  api = {
    moveRight: vi.fn(),
    moveLeft: vi.fn(),
    stop: vi.fn(),
    track: vi.fn(),
  };

  testRunner = new CodeRunner(scene, api);
});

test('run should execute start()', async () => {
  await testRunner.run(`
    function start() {
      moveRight();
    }
  `);

  expect(api.moveRight).toHaveBeenCalledTimes(1);
});

test('run should execute update() on a timer when start() is absent', async () => {
  await testRunner.run(`
    function update() {
      moveLeft();
    }
  `);
  await mockTimer.callback?.();

  expect(api.moveLeft).toHaveBeenCalledTimes(1);
});

test('stop should remove the update timer and clear running state', async () => {
  await testRunner.run(`
    function update() {
      moveLeft();
    }
  `);

  mockTimer.remove.mockClear();
  testRunner.stop();

  expect(mockTimer.remove).toHaveBeenCalledTimes(1);
  expect(testRunner.isRunning()).toBe(false);
});

test('update ticks should not overlap while a previous tick sleeps', async () => {
  await testRunner.run(`
    function update() {
      sleep(100000);
      moveLeft();
    }
  `);

  const firstTick = mockTimer.callback?.();
  await mockTimer.callback?.();
  await mockTimer.callback?.();

  expect(api.moveLeft).not.toHaveBeenCalled();

  sleepCallback?.();
  await firstTick;

  expect(api.moveLeft).toHaveBeenCalledTimes(1);
});

test('an infinite loop should stop execution and emit code-error', async () => {
  const emitSpy = vi.spyOn(EventBus, 'emit');

  await testRunner.run(`
    function start() {
      while (true) {}
    }
  `);

  expect(emitSpy).toHaveBeenCalledWith(
    'code-error',
    expect.stringContaining('Infinite loop detected'),
  );
  expect(testRunner.isRunning()).toBe(false);
});

test('run should emit code-started before executing start()', async () => {
  const emitSpy = vi.spyOn(EventBus, 'emit');

  await testRunner.run(`
    function start() {
      moveRight();
    }
  `);

  expect(emitSpy).toHaveBeenCalledWith('code-started');
  expect(api.moveRight).toHaveBeenCalledTimes(1);
  expect(emitSpy.mock.invocationCallOrder[0]).toBeLessThan(
    api.moveRight.mock.invocationCallOrder[0],
  );
});

test('start() sleep should finish before the update timer is created', async () => {
  const runPromise = testRunner.run(`
    function start() {
      sleep(100);
      moveRight();
    }
    function update() {}
  `);

  expect(scene.time.addEvent).not.toHaveBeenCalled();
  sleepCallback?.();
  await runPromise;

  expect(api.moveRight).toHaveBeenCalledTimes(1);
  expect(scene.time.addEvent).toHaveBeenCalledTimes(1);
});

test('stopping during start sleep should cancel the remaining start code', async () => {
  const runPromise = testRunner.run(`
    function start() {
      sleep(100);
      moveRight();
    }
  `);

  testRunner.stop();
  sleepCallback?.();
  await runPromise;

  expect(api.moveRight).not.toHaveBeenCalled();
  expect(scene.time.addEvent).not.toHaveBeenCalled();
});

test('restarting should invalidate sleep from the previous start()', async () => {
  const oldRun = testRunner.run(`
    function start() {
      sleep(100);
      moveRight();
    }
  `);

  await testRunner.run(`
    function start() {
      moveLeft();
    }
  `);

  sleepCallback?.();
  await oldRun;

  expect(api.moveLeft).toHaveBeenCalledTimes(1);
  expect(api.moveRight).not.toHaveBeenCalled();
});

test('runtime update errors should stop execution and emit code-error', async () => {
  const emitSpy = vi.spyOn(EventBus, 'emit');

  await testRunner.run(`
    function update() {
      throw new Error('bad update');
    }
  `);

  mockTimer.remove.mockClear();
  await mockTimer.callback?.();

  expect(emitSpy).toHaveBeenCalledWith(
    'code-error',
    'Runtime error in update(): bad update',
  );
  expect(mockTimer.remove).toHaveBeenCalledTimes(1);
  expect(testRunner.isRunning()).toBe(false);
});

test('runtime start errors should emit code-error', async () => {
  const emitSpy = vi.spyOn(EventBus, 'emit');

  await testRunner.run(`
    function start() {
      throw new Error('bad start');
    }
  `);

  expect(emitSpy).toHaveBeenCalledWith('code-error', 'bad start');
  expect(testRunner.isRunning()).toBe(false);
});

test('recursive update errors should stop the runner and emit code-error', async () => {
  const emitSpy = vi.spyOn(EventBus, 'emit');

  await testRunner.run(`
    const recurse = () => recurse();
    function update() {
      recurse();
    }
  `);

  mockTimer.remove.mockClear();
  await mockTimer.callback?.();

  expect(emitSpy).toHaveBeenCalledWith(
    'code-error',
    expect.stringMatching(/^Runtime error in update\(\):/),
  );
  expect(mockTimer.remove).toHaveBeenCalledTimes(1);
  expect(testRunner.isRunning()).toBe(false);
});

test('compile syntax errors should emit code-error and stop execution', async () => {
  const emitSpy = vi.spyOn(EventBus, 'emit');

  await testRunner.run(`
    function start( {
      moveRight();
    }
  `);

  expect(emitSpy).toHaveBeenCalledWith('code-error', expect.any(String));
  expect(testRunner.isRunning()).toBe(false);
});

test('stopping during update sleep should skip later movement', async () => {
  await testRunner.run(`
    function update() {
      sleep(100);
      moveLeft();
    }
  `);

  const tick = mockTimer.callback?.();
  testRunner.stop();
  sleepCallback?.();
  await tick;

  expect(api.moveLeft).not.toHaveBeenCalled();
  expect(testRunner.isRunning()).toBe(false);
});

test('restarting during update sleep should cancel the previous update', async () => {
  await testRunner.run(`
    function update() {
      sleep(100);
      moveLeft();
    }
  `);

  const previousTick = mockTimer.callback?.();
  const previousSleepCallback = sleepCallback;

  await testRunner.run(`
    function update() {
      moveRight();
    }
  `);

  previousSleepCallback?.();
  await previousTick;

  expect(api.moveLeft).not.toHaveBeenCalled();
  await mockTimer.callback?.();
  expect(api.moveRight).toHaveBeenCalledTimes(1);
  expect(testRunner.isRunning()).toBe(true);
});

test('sleep should refresh post-tick state before and after the delay', async () => {
  const onPostTick = vi.fn();
  const runner = new CodeRunner(scene, api, onPostTick);

  const runPromise = runner.run(`
    function start() {
      sleep(50);
      moveRight();
    }
  `);

  expect(onPostTick).toHaveBeenCalledTimes(2);
  expect(scene.time.delayedCall).toHaveBeenCalledWith(
    50,
    expect.any(Function),
  );

  sleepCallback?.();
  expect(onPostTick).toHaveBeenCalledTimes(3);

  await runPromise;
  expect(onPostTick).toHaveBeenCalledTimes(4);
});

test('re-running should remove the old timer and keep the new timer active', async () => {
  await testRunner.run(`
    function update() {
      moveRight();
    }
  `);
  await testRunner.run(`
    function update() {
      moveLeft();
    }
  `);

  expect(scene.time.addEvent).toHaveBeenCalledTimes(2);
  expect(mockTimers[0].remove).toHaveBeenCalledTimes(1);
  expect(mockTimers[1].remove).not.toHaveBeenCalled();
  expect(testRunner.isRunning()).toBe(true);
});

test('a start-only script should not create an update timer', async () => {
  await testRunner.run(`
    function start() {
      moveRight();
    }
  `);

  expect(scene.time.addEvent).not.toHaveBeenCalled();
  expect(testRunner.isRunning()).toBe(false);
  expect(api.moveRight).toHaveBeenCalledTimes(1);
});

test('sleep should normalize each invalid duration to zero', async () => {
  const runPromise = testRunner.run(`
    function start() {
      sleep(NaN);
      sleep(-100);
      sleep("not-a-number");
      moveRight();
    }
  `);

  for (let i = 0; i < 3; i++) {
    await Promise.resolve();
    sleepCallback?.();
  }
  await runPromise;

  expect(scene.time.delayedCall).toHaveBeenNthCalledWith(
    1,
    0,
    expect.any(Function),
  );
  expect(scene.time.delayedCall).toHaveBeenNthCalledWith(
    2,
    0,
    expect.any(Function),
  );
  expect(scene.time.delayedCall).toHaveBeenNthCalledWith(
    3,
    0,
    expect.any(Function),
  );
  expect(scene.time.delayedCall).toHaveBeenCalledTimes(3);
});
