import { test, expect, vi } from 'vitest';

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

const mockTimer = {
  remove: vi.fn(),
  callback: undefined as (() => Promise<void>) | undefined,
};

const scene = {
  time: {
    addEvent: vi.fn((config: any) => {
      mockTimer.callback = () => config.callback.call(config.callbackScope);

      return mockTimer;
    }),
  },
} as any;

const api = {
  moveRight: vi.fn(),
  moveLeft: vi.fn(),
  stop: vi.fn(),
  track: vi.fn(),
};

test('Coderunner.run should run start() and there moverRight()', () => {
  const testRunner = new CodeRunner(scene, api);

  const rawCode = `
        function start() {
            moveRight();
        }
    `;

  testRunner.run(rawCode);

  expect(api.moveRight).toHaveBeenCalledTimes(1);
});

test('Coderunner.run should loop update() since start() does not exist', async () => {
  const testRunner = new CodeRunner(scene, api);

  const rawCode = `
        function update() {
            moveLeft();
        }
    `;

  await testRunner.run(rawCode);
  await mockTimer.callback?.();

  expect(api.moveLeft).toHaveBeenCalledTimes(1);
});
