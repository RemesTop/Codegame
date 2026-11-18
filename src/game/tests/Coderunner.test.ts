import { test, expect, vi, beforeEach } from 'vitest';
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

import {
  CodeRunner,
  injectLoopProtection,
  injectAsyncSleep,
  injectTrackGetters,
  compilePlayerCode,
} from '../CodeRunner';

const mockTimer = {
  remove: vi.fn(),
  callback: undefined as (() => Promise<void>) | undefined,
};

let sleepCallback: (() => void) | undefined;

const scene = {
  time: {
    addEvent: vi.fn((config: any) => {
      mockTimer.callback = () => config.callback.call(config.callbackScope);

      return mockTimer;
    }),

    delayedCall: vi.fn((ms: number, callback: () => void) => {
      sleepCallback = callback;
    }),
  },
} as any;

const api = {
  moveRight: vi.fn(),
  moveLeft: vi.fn(),
  stop: vi.fn(),
  track: vi.fn(),
};

const sleepfn = vi.fn();

const testRunner = new CodeRunner(scene, api);

beforeEach(() => {
  vi.clearAllMocks();
  mockTimer.callback = undefined;
});

test('Coderunner.run should run start() and there moverRight()', () => {
  const rawCode = `
        function start() {
            moveRight();
        }
    `;

  testRunner.run(rawCode);

  expect(api.moveRight).toHaveBeenCalledTimes(1);
});

test('Coderunner.run should loop update() since start() does not exist', async () => {
  const rawCode = `
        function update() {
            moveLeft();
        }
    `;

  await testRunner.run(rawCode);
  await mockTimer.callback?.();

  expect(api.moveLeft).toHaveBeenCalledTimes(1);
});

test('CodeRunner should remove timer when stopped', async () => {
  const rawCode = `
        function update() {
            moveLeft();
        }
    `;

  await testRunner.run(rawCode);

  mockTimer.remove.mockClear();

  testRunner.stop();

  expect(mockTimer.remove).toHaveBeenCalledTimes(1);
  expect(testRunner.isRunning()).toBe(false);
});

test('CodeRunner should prevent overlapping update executions', async () => {
  const rawCode = `
        function update() {
            sleep(100000)
            moveLeft();
        }
    `;

  await testRunner.run(rawCode);

  const firstTick = mockTimer.callback?.();

  await mockTimer.callback?.();
  await mockTimer.callback?.();

  expect(api.moveLeft).not.toHaveBeenCalled();

  sleepCallback?.();

  await firstTick;

  expect(api.moveLeft).toHaveBeenCalledTimes(1);
});

test('injectLoopProtection should catch the infinite loop and throw Error', () => {
  const rawCode = `
        function start() {
            while(true) {
            }
        }
    `;

  const protectedCode = injectLoopProtection(rawCode);

  const format = new Function(`${protectedCode}
    return start;
    `);

  const loopTest = format();

  expect(() => loopTest()).toThrow(
    'Infinite loop detected: exceeded 10,000 iterations in a single tick',
  );
});

test('injectLoopProtection should pass the code without errors', () => {
  const rawCode = `
        function start() {
          console.log("No infinite loop")
        }
    `;

  const result = injectLoopProtection(rawCode);

  expect(result).toBe(rawCode);
});

test('injectLoopProtection should stop execution', async () => {
  const emitSpy = vi.spyOn(EventBus, 'emit');

  const rawCode = `
        function start() {
            while(true) {
            }
        }
    `;
  await testRunner.run(rawCode);

  await mockTimer.callback?.();

  expect(emitSpy).toHaveBeenCalledWith(
    'code-error',
    expect.stringContaining('Infinite loop detected'),
  );
});

test('injectAsyncSleep should pass the code and return with async', () => {
  const rawCode = `
        function start() {
          sleep(100);
        }
    `;

  const result = injectAsyncSleep(rawCode);

  expect(result).toContain('async function start()');
  expect(result).toContain('await sleep(100)');
});

test("injectTrackGetters should transform track(myVar) and track('myVar') into track(myVar, () => myVar)", () => {
  const rawCode1 = `
        track(myVar)
    `;

  const rawCode2 = `
      track('myVar')
  `;

  const result1 = injectTrackGetters(rawCode1);
  const result2 = injectTrackGetters(rawCode2);

  expect(result1).toContain("track('myVar', () => myVar)");
  expect(result2).toContain("track('myVar', () => myVar)");
});

test('compilePlayerCode should return start and update functions', () => {
  const rawCode = `
        function start() {
            moveRight();
        }

        function update() {
            moveLeft();
        }
    `;

  const result = compilePlayerCode(rawCode, api, sleepfn);

  expect(result).toHaveProperty('start');
  expect(result).toHaveProperty('update');

  expect(typeof result.start).toBe('function');
  expect(typeof result.update).toBe('function');
});
