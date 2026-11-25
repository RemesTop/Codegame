import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('phaser', () => ({
    Events: {
        EventEmitter: class {
            on = vi.fn();
            off = vi.fn();
            emit = vi.fn();
            once = vi.fn();
            removeListener = vi.fn();
            removeAllListeners = vi.fn();
        },
    },
    Scenes: {
        Events: {
            SHUTDOWN: 'shutdown',
        },
    },
    Geom: {
        Intersects: {
            RectangleToRectangle: (
                a: { x: number; y: number; width: number; height: number },
                b: { x: number; y: number; width: number; height: number }
            ) =>
                a.x < b.x + b.width &&
                a.x + a.width > b.x &&
                a.y < b.y + b.height &&
                a.y + a.height > b.y,
        },
    },
    Math: {
        Clamp: (value: number, min: number, max: number) =>
            Math.max(min, Math.min(max, value)),
    },
    Physics: {
        Arcade: {
            Sprite: class { },
            Events: {
                WORLD_STEP: 'worldstep',
            },
        },
    },
    Scene: class {
        constructor(_key: string) { }
    },
}));

import {
    findDoorsFromObjects,
    findKeycardsFromObjects,
    type LoadedLevel,
} from '../LevelLoader';
import { Game } from '../scenes/Game';
import { Player } from '../Player';

function createInteractableHarness(options: {
    playerPos: { x: number; y: number };
    keycards?: Array<{ x: number; y: number }>;
    doors?: Array<{ x: number; y: number }>;
}) {
    const game = new Game();
    const colliderCallbacks: Array<() => boolean> = [];
    const createdKeycardSprites: Array<{
        x: number;
        y: number;
        visible: boolean;
        setOrigin: ReturnType<typeof vi.fn>;
        setDepth: ReturnType<typeof vi.fn>;
        setVisible: ReturnType<typeof vi.fn>;
        setY: ReturnType<typeof vi.fn>;
        getBounds: () => { x: number; y: number; width: number; height: number };
        destroy: ReturnType<typeof vi.fn>;
    }> = [];
    const createdDoorSprites: Array<{
        x: number;
        y: number;
        texture: string;
        setOrigin: ReturnType<typeof vi.fn>;
        setDepth: ReturnType<typeof vi.fn>;
        setTexture: ReturnType<typeof vi.fn>;
        refreshBody: ReturnType<typeof vi.fn>;
        getBounds: () => { x: number; y: number; width: number; height: number };
        destroy: ReturnType<typeof vi.fn>;
    }> = [];
    const heldKeycardSprites: Array<{
        x: number;
        y: number;
        alpha: number;
        visible: boolean;
        setOrigin: ReturnType<typeof vi.fn>;
        setScale: ReturnType<typeof vi.fn>;
        setDepth: ReturnType<typeof vi.fn>;
        setVisible: ReturnType<typeof vi.fn>;
        setPosition: ReturnType<typeof vi.fn>;
        setAlpha: ReturnType<typeof vi.fn>;
        destroy: ReturnType<typeof vi.fn>;
    }> = [];

    const sceneAdd = {
        image: vi.fn((x: number, y: number, textureKey: string) => {
            if (textureKey === 'keycard' && createdKeycardSprites.length < (options.keycards?.length ?? 0)) {
                const sprite = {
                    x,
                    y,
                    visible: true,
                    setOrigin: vi.fn(),
                    setDepth: vi.fn(),
                    setVisible: vi.fn((v: boolean) => {
                        sprite.visible = v;
                        return sprite;
                    }),
                    setY: vi.fn((ny: number) => {
                        sprite.y = ny;
                        return sprite;
                    }),
                    getBounds: () => ({
                        x: sprite.x - 16,
                        y: sprite.y - 16,
                        width: 32,
                        height: 32,
                    }),
                    destroy: vi.fn(),
                };
                sprite.setOrigin.mockReturnValue(sprite);
                sprite.setDepth.mockReturnValue(sprite);
                createdKeycardSprites.push(sprite);
                return sprite;
            }

            const held = {
                x,
                y,
                alpha: 1,
                visible: true,
                setOrigin: vi.fn(),
                setScale: vi.fn(),
                setDepth: vi.fn(),
                setVisible: vi.fn((v: boolean) => {
                    held.visible = v;
                    return held;
                }),
                setPosition: vi.fn((nx: number, ny: number) => {
                    held.x = nx;
                    held.y = ny;
                    return held;
                }),
                setAlpha: vi.fn((a: number) => {
                    held.alpha = a;
                    return held;
                }),
                destroy: vi.fn(),
            };
            held.setOrigin.mockReturnValue(held);
            held.setScale.mockReturnValue(held);
            held.setDepth.mockReturnValue(held);
            heldKeycardSprites.push(held);
            return held;
        }),
    };

    const player = Object.create(Player.prototype) as Player;
    Object.assign(player, {
        scene: { add: sceneAdd },
        x: options.playerPos.x,
        y: options.playerPos.y,
        width: 32,
        height: 48,
        displayWidth: 32,
        displayHeight: 48,
        alpha: 1,
        depth: 10,
        movementState: 'STOP',
        hasKeycard: false,
        heldKeycardSprite: null,
        keycardHoverTimeMs: 0,
        sleepParticles: [],
        sleepParticleCooldownMs: 0,
        isSleeping: false,
        spawnX: options.playerPos.x,
        spawnY: options.playerPos.y,
        body: {
            position: { x: options.playerPos.x - 16, y: options.playerPos.y - 24 },
            width: 32,
            height: 48,
            velocity: { x: 0, y: 0 },
            reset: vi.fn((rx: number, ry: number) => {
                player.x = rx;
                player.y = ry;
            }),
        },
        setVelocityX: vi.fn(),
        setAlpha: vi.fn((a: number) => {
            player.alpha = a;
        }),
        getBounds: () => ({
            x: player.x - 16,
            y: player.y - 24,
            width: 32,
            height: 48,
        }),
    });

    const physics = {
        pause: vi.fn(),
        resume: vi.fn(),
        add: {
            staticImage: vi.fn((x: number, y: number, texture: string) => {
                const sprite = {
                    x,
                    y,
                    texture,
                    setOrigin: vi.fn(),
                    setDepth: vi.fn(),
                    setTexture: vi.fn((next: string) => {
                        sprite.texture = next;
                        return sprite;
                    }),
                    refreshBody: vi.fn(),
                    getBounds: () => ({
                        x: sprite.x - 16,
                        y: sprite.y - 32,
                        width: 32,
                        height: 64,
                    }),
                    destroy: vi.fn(),
                };
                sprite.setOrigin.mockReturnValue(sprite);
                sprite.setDepth.mockReturnValue(sprite);
                createdDoorSprites.push(sprite);
                return sprite;
            }),
            collider: vi.fn(
                (_a: unknown, _b: unknown, _cb: unknown, processCb: () => boolean) => {
                    colliderCallbacks.push(processCb);
                    return { destroy: vi.fn() };
                }
            ),
        },
    };

    const level = {
        collidingLayers: [],
        dangerGids: new Set<number>(),
        keycards: options.keycards ?? [],
        doors: options.doors ?? [],
    } as unknown as LoadedLevel;

    Object.assign(game, {
        add: sceneAdd,
        physics,
        player,
        currentLevel: level,
        isSimulating: true,
        hud: { reset: vi.fn() },
        cameras: { main: { centerOn: vi.fn(), stopFollow: vi.fn() } },
    });

    game['spawnLevelInteractables'](level);

    return {
        game,
        player,
        createdKeycardSprites,
        createdDoorSprites,
        heldKeycardSprites,
        colliderCallbacks,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('Point-only Tiled parsing for keycards and doors', () => {
    test('parses only Point objects and centers doors on the bottom tile (y - 16)', () => {
        const mockMap = {
            objects: [
                {
                    objects: [
                        // Valid point key
                        { name: 'key', type: '', point: true, x: 112, y: 208, width: 0, height: 0 },
                        // Ignored rectangle key (points only)
                        { name: 'key', type: '', point: false, x: 200, y: 200, width: 32, height: 32 },
                        // Valid point door (bottom-tile center at y=304 -> 32x64 door center at y=288)
                        { name: 'door', type: '', point: true, x: 400, y: 304, width: 0, height: 0 },
                        // Ignored rectangle door (points only)
                        { name: 'door', type: '', point: false, x: 500, y: 300, width: 32, height: 64 },
                    ],
                },
            ],
        } as unknown as Phaser.Tilemaps.Tilemap;

        expect(findKeycardsFromObjects(mockMap)).toEqual([{ x: 112, y: 208 }]);
        expect(findDoorsFromObjects(mockMap)).toEqual([{ x: 400, y: 288 }]);
    });
});

describe('Keycard pickup, hovering indicator, and locked door behavior', () => {
    test('collecting a keycard hides the world keycard and hovers it to the right of the player', () => {
        const { game, player, createdKeycardSprites, heldKeycardSprites } =
            createInteractableHarness({
                playerPos: { x: 100, y: 200 },
                keycards: [{ x: 108, y: 200 }],
            });

        expect(player.hasKeycard).toBe(false);
        game.update(0, 16);

        expect(player.hasKeycard).toBe(true);
        expect(createdKeycardSprites[0].visible).toBe(false);
        expect(heldKeycardSprites).toHaveLength(1);
        expect(heldKeycardSprites[0].visible).toBe(true);
        expect(heldKeycardSprites[0].setScale).not.toHaveBeenCalled();
        // Steady position to the right side of the player (no hover bob)
        const yAfterFirstFrame = heldKeycardSprites[0].y;
        expect(heldKeycardSprites[0].x).toBeGreaterThan(player.x + 16);
        game.update(500, 16);
        expect(heldKeycardSprites[0].y).toBe(yAfterFirstFrame);
    });

        test('approaching a locked door with a key consumes the key, opens the door permanently, and resets cleanly', () => {
            const {
                game,
                player,
                createdKeycardSprites,
                createdDoorSprites,
                heldKeycardSprites,
                colliderCallbacks,
            } = createInteractableHarness({
                playerPos: { x: 200, y: 300 },
                keycards: [{ x: 100, y: 300 }],
                doors: [{ x: 250, y: 288 }],
            });

            // Without key: collider blocks player (returns true), door stays closed even when close
            expect(colliderCallbacks[0]()).toBe(true);
            game.update(0, 16);
            expect(createdDoorSprites[0].texture).toBe('door-closed');

            // Walk over key to pick it up (far from door: dx = 150 > 80)
            player.x = 100;
            game.update(16, 16);
            expect(player.hasKeycard).toBe(true);
            expect(createdDoorSprites[0].texture).toBe('door-closed');
            expect(colliderCallbacks[0]()).toBe(true);

            // Approach door with key (dx = 50 <= 80) -> consumes key and opens door permanently
            player.x = 200;
            game.update(32, 16);
            expect(player.hasKeycard).toBe(false);
            expect(heldKeycardSprites[0].visible).toBe(false);
            expect(createdDoorSprites[0].texture).toBe('door-open');
            expect(colliderCallbacks[0]()).toBe(false);

            // Pass through and move away from door (dx = 120 > 80) -> door stays permanently open
            player.x = 370;
            game.update(48, 16);
            expect(createdDoorSprites[0].texture).toBe('door-open');
            expect(colliderCallbacks[0]()).toBe(false);

            // Level reset restores world key, hides held key, and closes door again
            game['resetSceneState']();
            expect(player.hasKeycard).toBe(false);
            expect(createdKeycardSprites[0].visible).toBe(true);
            expect(heldKeycardSprites[0].visible).toBe(false);
            expect(createdDoorSprites[0].texture).toBe('door-closed');
            expect(colliderCallbacks[0]()).toBe(true);
        });
    });
