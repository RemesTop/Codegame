import { test, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  Physics: {
    Arcade: {
      Sprite: class {},
    },
  },
}));

import { Player } from '../Player';

function createPlayer(): Player {
  const player = Object.create(Player.prototype) as Player;
  player.movementState = 'STOP';
  return player;
}

test('moveRight should set the player movement state to RIGHT', () => {
  const player = createPlayer();

  player.moveRight();

  expect(player.movementState).toBe('RIGHT');
});

test('moveLeft should set the player movement state to LEFT', () => {
  const player = createPlayer();

  player.moveLeft();

  expect(player.movementState).toBe('LEFT');
});

test('stopMoving should set the player movement state to STOP', () => {
  const player = createPlayer();

  player.stopMoving();

  expect(player.movementState).toBe('STOP');
});
