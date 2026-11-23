import { beforeEach, expect, test, vi } from 'vitest';
import { EventBus } from '../EventBus';
import type { RobotAPI } from '../CodeRunner';

type PlayerMock = {
  height: number;
  moveRight: ReturnType<typeof vi.fn>;
  moveLeft: ReturnType<typeof vi.fn>;
  stopMoving: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
};

type HudMock = {
  registerTrack: ReturnType<typeof vi.fn>;
  evaluateTrackedVariables: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
};

type RunnerMock = {
  stop: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  player: undefined as PlayerMock | undefined,
  hud: undefined as HudMock | undefined,
  runner: undefined as RunnerMock | undefined,
  api: undefined as RobotAPI | undefined,
}));

vi.mock('phaser', () => ({
  Events: {
    EventEmitter: class {
      on = vi.fn();
      off = vi.fn();
      emit = vi.fn();
      removeListener = vi.fn();
      removeAllListeners = vi.fn();
    },
  },
  Scenes: {
    Events: {
      SHUTDOWN: 'shutdown',
    },
  },
  Scene: class {
    constructor(_key: string) {}
  },
}));

vi.mock('../Player', () => ({
  Player: class {
    height = 48;
    moveRight = vi.fn();
    moveLeft = vi.fn();
    stopMoving = vi.fn();
    reset = vi.fn();

    constructor() {
      mocks.player = this;
    }
  },
}));

vi.mock('../GameHUD', () => ({
  GameHUD: class {
    registerTrack = vi.fn();
    evaluateTrackedVariables = vi.fn();
    reset = vi.fn();

    constructor() {
      mocks.hud = this;
    }
  },
}));

vi.mock('../CodeRunner', () => ({
  CodeRunner: class {
    stop = vi.fn();
    run = vi.fn();

    constructor(_scene: unknown, api: RobotAPI) {
      mocks.api = api;
      mocks.runner = this;
    }
  },
}));

import { Game } from '../scenes/Game';

function getValue<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected Game.create() to initialize its dependencies');
  }
  return value;
}

function createGame(): Game {
  const game = new Game();

  Object.assign(game, {
    add: {
      image: vi.fn(),
      rectangle: vi.fn(() => ({})),
    },
    physics: {
      world: { enable: vi.fn() },
      add: { collider: vi.fn() },
    },
    events: { on: vi.fn() },
  });

  game.create();
  return game;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.player = undefined;
  mocks.hud = undefined;
  mocks.runner = undefined;
  mocks.api = undefined;
});

test('Game API calls are forwarded to Player and HUD', () => {
  const game = createGame();
  const player = getValue(mocks.player);
  const hud = getValue(mocks.hud);
  const api = getValue(mocks.api);
  const getter = () => 42;

  api.moveRight();
  api.moveLeft();
  api.stop();
  api.track('answer', getter);

  expect(player.moveRight).toHaveBeenCalledOnce();
  expect(player.moveLeft).toHaveBeenCalledOnce();
  expect(player.stopMoving).toHaveBeenCalledOnce();
  expect(hud.registerTrack).toHaveBeenCalledWith('answer', getter);
  expect(EventBus.on).toHaveBeenCalledWith(
    'run-code',
    expect.any(Function),
    game,
  );
  expect(EventBus.on).toHaveBeenCalledWith(
    'stop-code',
    expect.any(Function),
    game,
  );
});

test('run-code handler resets player and HUD before running the code', () => {
  const game = createGame();
  const player = getValue(mocks.player);
  const hud = getValue(mocks.hud);
  const runner = getValue(mocks.runner);

  game['handleRunCode']('function start() {}');

  expect(runner.stop).toHaveBeenCalledOnce();
  expect(player.reset).toHaveBeenCalledOnce();
  expect(hud.reset).toHaveBeenCalledOnce();
  expect(runner.run).toHaveBeenCalledWith('function start() {}');
});

test('stop-code handler stops execution, resets state, and emits code-stopped', () => {
  const game = createGame();
  const player = getValue(mocks.player);
  const hud = getValue(mocks.hud);
  const runner = getValue(mocks.runner);

  game['handleStopCode']();

  expect(runner.stop).toHaveBeenCalledOnce();
  expect(player.reset).toHaveBeenCalledOnce();
  expect(hud.reset).toHaveBeenCalledOnce();
  expect(EventBus.emit).toHaveBeenCalledWith('code-stopped');
});
