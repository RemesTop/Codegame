import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('phaser', () => ({
  Physics: {
    Arcade: {
      Sprite: class {},
    },
  },
}));

import { Player, type MovementState } from '../Player';

function createPlayer(
  velocityX = 0,
  movementState: MovementState = 'STOP',
  y = 100,
) {
  const player = Object.create(Player.prototype) as Player;
  const body = { velocity: { x: velocityX } };
  const setVelocityX = vi.fn((value: number) => {
    body.velocity.x = value;
  });
  const setVelocityY = vi.fn();

  Object.assign(player, {
    body,
    movementState,
    scene: { scale: { height: 600 } },
    y,
    maxSpeedX: 240,
    accelerationX: 650,
    decelerationX: 750,
    setVelocityX,
    setVelocityY,
  });

  return { player, body, setVelocityX, setVelocityY };
}

beforeEach(() => {
  vi.clearAllMocks();
});

test('update accelerates the player to the right using delta time', () => {
  const { player, body, setVelocityX, setVelocityY } = createPlayer(
    0,
    'RIGHT',
  );

  player.update(100);

  expect(setVelocityX).toHaveBeenCalledWith(65);
  expect(body.velocity.x).toBe(65);
  expect(setVelocityY).not.toHaveBeenCalled();
});

test('update accelerates the player to the left', () => {
  const { player, body } = createPlayer(0, 'LEFT');

  player.update(100);

  expect(body.velocity.x).toBe(-65);
});

test('update caps horizontal velocity at the target speed', () => {
  const { player, body } = createPlayer(230, 'RIGHT');

  player.update(1000);

  expect(body.velocity.x).toBe(240);
});

test('update decelerates toward zero without overshooting', () => {
  const { player, body } = createPlayer(20, 'STOP');

  player.update(100);

  expect(body.velocity.x).toBe(0);
});

test('update stops vertical velocity after the player falls below the screen', () => {
  const { player, setVelocityY } = createPlayer(0, 'STOP', 801);

  player.update(16);

  expect(setVelocityY).toHaveBeenCalledWith(0);
});