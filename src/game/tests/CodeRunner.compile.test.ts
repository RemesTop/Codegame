import { beforeEach, expect, test, vi } from 'vitest';

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

import { compilePlayerCode } from '../CodeRunner';

let api: {
  moveRight: ReturnType<typeof vi.fn>;
  moveLeft: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  track: ReturnType<typeof vi.fn>;
};
let sleepfn: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  api = {
    moveRight: vi.fn(),
    moveLeft: vi.fn(),
    stop: vi.fn(),
    track: vi.fn(),
  };
  sleepfn = vi.fn();
});

test('compilePlayerCode should return start and update functions', () => {
  const result = compilePlayerCode(
    `
      function start() {
        moveRight();
      }
      function update() {
        moveLeft();
      }
    `,
    api,
    sleepfn,
  );

  expect(result.start).toBeTypeOf('function');
  expect(result.update).toBeTypeOf('function');
});

test('compilePlayerCode should reject scripts without start() or update()', () => {
  expect(() =>
    compilePlayerCode('const value = 42;', api, sleepfn),
  ).toThrow('No update() or start() function found');
});

test('compilePlayerCode should reject undeclared assignments in strict mode', async () => {
  const result = compilePlayerCode(
    `
      function start() {
        playerCount = 1;
      }
    `,
    api,
    sleepfn,
  );

  await expect(result.start!()).rejects.toThrow(ReferenceError);
});

test('compilePlayerCode should keep top-level variables in the update closure', async () => {
  const result = compilePlayerCode(
    `
      let count = 0;
      function update() {
        count++;
        track('count');
      }
    `,
    api,
    sleepfn,
  );

  await result.update?.();
  expect(api.track.mock.calls[0][1]()).toBe(1);

  await result.update?.();
  expect(api.track.mock.calls[1][1]()).toBe(2);
});

test('compilePlayerCode should shadow browser globals', async () => {
  const result = compilePlayerCode(
    `
      function start() {
        track('windowValue', () => window);
        track('documentValue', () => document);
        track('fetchValue', () => fetch);
        track('evalValue', () => eval);
        track('functionValue', () => Function);
        track('globalThisValue', () => globalThis);
        track('selfValue', () => self);
      }
    `,
    api,
    sleepfn,
  );

  await result.start?.();

  expect(api.track).toHaveBeenCalledTimes(7);
  for (const [, getter] of api.track.mock.calls) {
    expect(getter()).toBeUndefined();
  }
});

test('compilePlayerCode should support arrow helpers that call sleep', async () => {
  const sleep = vi.fn().mockResolvedValue(undefined);
  const script = compilePlayerCode(
    `
      const pause = () => sleep(10);
      function start() {
        pause();
        moveRight();
      }
    `,
    api,
    sleep,
  );

  await script.start?.();

  expect(sleep).toHaveBeenCalledWith(10);
  expect(api.moveRight).toHaveBeenCalledTimes(1);
});
