import { test, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  Scenes: {
    Events: {
      POST_UPDATE: 'postupdate',
    },
  },
  Physics: {
    Arcade: {
      Sprite: class {
        scene: unknown;
        x: number;
        y: number;
        alpha = 1;
        depth = 10;
        width = 64;
        height = 96;
        displayWidth = 64;
        displayHeight = 96;
        body: {
          position: { x: number; y: number };
          width: number;
          height: number;
          velocity: { x: number; y: number };
          onFloor: () => boolean;
          reset: (rx: number, ry: number) => void;
        };
        constructor(scene: unknown, x: number, y: number) {
          this.scene = scene;
          this.x = x;
          this.y = y;
          this.body = {
            position: { x: x - 32, y: y - 48 },
            width: 64,
            height: 96,
            velocity: { x: 0, y: 0 },
            onFloor: () => true,
            reset: (rx: number, ry: number) => {
              this.x = rx;
              this.y = ry;
              this.body.position = { x: rx - 32, y: ry - 48 };
              this.body.velocity = { x: 0, y: 0 };
            },
          };
        }
        setCollideWorldBounds = vi.fn();
        setBounce = vi.fn();
        setMaxVelocity = vi.fn();
        setVelocityX = vi.fn((vx: number) => {
          this.body.velocity.x = vx;
        });
        setAlpha = vi.fn((a: number) => {
          this.alpha = a;
        });
        destroy = vi.fn();
      },
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

test('Player.preload loads all 8 character part textures and rig animates/flips cleanly', () => {
  const loadedKeys = new Map<string, string>();
  const mockContainers: Array<{
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    alpha: number;
    rotation: number;
    children: unknown[];
    setPosition: ReturnType<typeof vi.fn>;
    setScale: ReturnType<typeof vi.fn>;
    setDepth: ReturnType<typeof vi.fn>;
    setAlpha: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }> = [];

  const mockScene = {
    load: {
      image: vi.fn((key: string, path: string) => {
        loadedKeys.set(key, path);
      }),
    },
    textures: {
      exists: vi.fn((key: string) => loadedKeys.has(key)),
    },
    make: {
      graphics: vi.fn(() => ({
        fillStyle: vi.fn(),
        fillRect: vi.fn(),
        lineStyle: vi.fn(),
        strokeRect: vi.fn(),
        generateTexture: vi.fn((key: string) => loadedKeys.set(key, '__generated__')),
        destroy: vi.fn(),
      })),
    },
    add: {
      existing: vi.fn(),
      image: vi.fn((x: number, y: number, textureKey: string) => {
        const img = {
          x,
          y,
          textureKey,
          rotation: 0,
          setOrigin: vi.fn(() => img),
        };
        return img;
      }),
      container: vi.fn((x: number, y: number, children: unknown[] = []) => {
        const c = {
          x,
          y,
          scaleX: 1,
          scaleY: 1,
          alpha: 1,
          rotation: 0,
          children,
          setPosition: vi.fn((nx: number, ny: number) => {
            c.x = nx;
            c.y = ny;
            return c;
          }),
          setScale: vi.fn((sx: number, sy: number) => {
            c.scaleX = sx;
            c.scaleY = sy;
            return c;
          }),
          setDepth: vi.fn(() => c),
          setAlpha: vi.fn((a: number) => {
            c.alpha = a;
            return c;
          }),
          destroy: vi.fn(),
        };
        mockContainers.push(c);
        return c;
      }),
    },
    physics: {
      add: { existing: vi.fn() },
      world: { setBoundsCollision: vi.fn() },
    },
    events: {
      on: vi.fn(),
      off: vi.fn(),
    },
  };

  Player.preload(mockScene as never);
  expect(loadedKeys.size).toBe(8);
  expect(loadedKeys.get('player-head')).toBe('Player/character_head.png');

  const player = new Player(mockScene as never, 200, 300);
  const rootContainer = mockContainers[mockContainers.length - 1];
  expect(rootContainer.scaleX).toBeGreaterThan(0);

  // Move left -> rig flips horizontally (negative scaleX)
  player.moveLeft();
  player.update(100);
  expect(rootContainer.scaleX).toBeLessThan(0);

  // Death fade syncs rig alpha, and reset restores facing right + full alpha
  player.alpha = 0.25;
  player.syncHeldKeycardAlpha();
  expect(rootContainer.alpha).toBe(0.25);

  player.reset();
  expect(rootContainer.scaleX).toBeGreaterThan(0);
  expect(rootContainer.alpha).toBe(1);
});
