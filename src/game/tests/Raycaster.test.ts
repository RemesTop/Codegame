import { describe, expect, test, vi } from 'vitest';
import {
    angleToDirection,
    castRay,
    DetectObjectTarget,
    normalizeAngle,
    Raycaster,
} from '../Raycaster';
import type { LoadedLevel } from '../LevelLoader';

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

function createMockLevel(
    grid: number[][],
    options?: {
        solidGids?: number[];
        rampLeftGids?: number[];
        rampRightGids?: number[];
        ceilingRampLeftGids?: number[];
        ceilingRampRightGids?: number[];
        dangerGids?: number[];
        tileSize?: number;
    }
): LoadedLevel {
    const tileSize = options?.tileSize ?? 32;
    const rows = grid.length;
    const cols = grid[0]?.length ?? 0;

    const layer = {
        getTileAt: (col: number, row: number) => {
            const index = grid[row]?.[col] ?? -1;
            return index > 0 ? { index } : null;
        },
    };

    return {
        definition: {
            id: 1,
            name: 'Test Level',
            mapData: { layers: [] },
            spawn: { x: 0, y: 0 },
            starterCode: '',
        },
        map: {
            tileWidth: tileSize,
            tileHeight: tileSize,
            width: cols,
            height: rows,
            widthInPixels: cols * tileSize,
            heightInPixels: rows * tileSize,
        } as unknown as LoadedLevel['map'],
        layers: [layer as unknown as LoadedLevel['layers'][number]],
        collidingLayers: [layer as unknown as LoadedLevel['collidingLayers'][number]],
        solidGids: options?.solidGids ?? [1],
        rampLeftGids: new Set(options?.rampLeftGids ?? [2]),
        rampRightGids: new Set(options?.rampRightGids ?? [3]),
        ceilingRampLeftGids: new Set(options?.ceilingRampLeftGids ?? [4]),
        ceilingRampRightGids: new Set(options?.ceilingRampRightGids ?? [5]),
        dangerGids: new Set(options?.dangerGids ?? [6]),
        spawn: { x: 0, y: 0 },
        goal: null,
        keycards: [],
        doors: [],
        destroy: vi.fn(),
    };
}

function createMockScene() {
    const graphicsInstances: Array<{
        setDepth: ReturnType<typeof vi.fn>;
        lineStyle: ReturnType<typeof vi.fn>;
        lineBetween: ReturnType<typeof vi.fn>;
        destroy: ReturnType<typeof vi.fn>;
    }> = [];
    const tweenConfigs: Array<{
        targets: unknown;
        alpha: number;
        duration: number;
        onComplete?: () => void;
    }> = [];

    const clock = { now: 1000 };

    const scene = {
        time: clock,
        add: {
            graphics: vi.fn(() => {
                const gfx = {
                    setDepth: vi.fn(),
                    lineStyle: vi.fn(),
                    lineBetween: vi.fn(),
                    destroy: vi.fn(),
                };
                graphicsInstances.push(gfx);
                return gfx;
            }),
        },
        tweens: {
            add: vi.fn((config) => {
                tweenConfigs.push(config);
                return config;
            }),
            killTweensOf: vi.fn(),
        },
    };

    return {
        scene: scene as unknown as Phaser.Scene,
        clock,
        graphicsInstances,
        tweenConfigs,
    };
}

describe('normalizeAngle & angleToDirection', () => {
    test('normalizes positive, negative, and >360 angles into [0, 360)', () => {
        expect(normalizeAngle(0)).toBe(0);
        expect(normalizeAngle(90)).toBe(90);
        expect(normalizeAngle(-10)).toBe(350);
        expect(normalizeAngle(-90)).toBe(270);
        expect(normalizeAngle(360)).toBe(0);
        expect(normalizeAngle(370)).toBe(10);
        expect(normalizeAngle(-370)).toBe(350);
        expect(normalizeAngle(Number.NaN)).toBe(0);
    });

    test('converts angles to Phaser world directions (0=right, 90=up, 180=left, 270=down)', () => {
        expect(angleToDirection(0)).toEqual({ dx: 1, dy: 0 });
        expect(angleToDirection(90)).toEqual({ dx: 0, dy: -1 });
        expect(angleToDirection(180)).toEqual({ dx: -1, dy: 0 });
        expect(angleToDirection(270)).toEqual({ dx: 0, dy: 1 });

        const slightDownRight = angleToDirection(-10);
        expect(slightDownRight.dx).toBeGreaterThan(0.98);
        expect(slightDownRight.dy).toBeGreaterThan(0.17);
    });
});

describe('castRay & Raycaster.detect', () => {
    test('detects solid tiles straight right (default) and straight up (90)', () => {
        // 5x5 grid of 32x32 tiles:
        // Row 0 has a ceiling tile at col 2 (x: 64..96, y: 0..32)
        // Row 2 has a wall tile at col 4 (x: 128..160, y: 64..96)
        const level = createMockLevel([
            [0, 0, 1, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 1],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
        ]);
        const { scene } = createMockScene();
        const raycaster = new Raycaster(scene);

        // Origin at center of tile (col 2, row 2) = (80, 80)
        // Default angle=0 (right), type='any' -> hits wall at x=128 -> 48px = 1.5 tiles = 15 units
        expect(raycaster.detect(80, 80, level)).toBe(15);

        // Angle=90 (up), type='ground' -> hits ceiling bottom at y=32 -> 48px = 15 units
        expect(raycaster.detect(80, 80, level, [], 90, 'ground')).toBe(15);

        // Angle=180 (left) -> hits the left edge of the level (x=0) as 'ground' -> 80px = 2.5 tiles = 25 units
        expect(raycaster.detect(80, 80, level, [], 180, 'ground')).toBe(25);

        // Angle=270 (down) -> nothing there -> undefined (and <= comparisons are safely false)
        const miss = raycaster.detect(80, 80, level, [], 270, 'ground');
        expect(miss).toBeUndefined();
        expect((miss as unknown as number) <= 5).toBe(false);
    });

    test('classifies the left and right level edges as ground', () => {
        // Empty 5x5 level (160x160 pixels = 50x50 units)
        const level = createMockLevel([
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
        ]);
        const { scene } = createMockScene();
        const raycaster = new Raycaster(scene);

        // From (64, 80): left edge at x=0 is 2 tiles (20 units); right edge at x=160 is 3 tiles (30 units)
        expect(raycaster.detect(64, 80, level, [], 180, 'ground')).toBe(20);
        expect(raycaster.detect(64, 80, level, [], 0, 'ground')).toBe(30);
        expect(raycaster.detect(64, 80, level, [], 0, 'any')).toBe(30);
        expect(raycaster.detect(64, 80, level, [], 0, 'goal')).toBeUndefined();

        // Straight up and straight down do not hit the side edges
        expect(raycaster.detect(64, 80, level, [], 90, 'ground')).toBeUndefined();
        expect(raycaster.detect(64, 80, level, [], 270, 'ground')).toBeUndefined();
    });

    test('wraps negative angles clockwise and angles > 360', () => {
        // Solid tile at (col 2, row 4) -> y: 128..160
        const level = createMockLevel([
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 1],
            [0, 0, 0, 0, 0],
            [0, 0, 1, 0, 0],
        ]);
        const { scene } = createMockScene();
        const raycaster = new Raycaster(scene);

        // -90 wraps to 270 (straight down) -> hits y=128 from y=80 -> 48px = 15 units
        expect(raycaster.detect(80, 80, level, [], -90, 'ground')).toBe(15);

        // 360 + 0 wraps to 0 (straight right) -> hits x=128 from x=80 -> 48px = 15 units
        expect(raycaster.detect(80, 80, level, [], 360, 'ground')).toBe(15);
    });

    test('filters by type and returns null if first hit is a different type', () => {
        // Wall at col 4 (x: 128..160, y: 64..96)
        const level = createMockLevel([
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 1],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
        ]);
        const { scene } = createMockScene();
        const raycaster = new Raycaster(scene);

        // Goal placed IN FRONT of the wall at x: 96..112, y: 64..96 (16px = 0.5 tiles = 5 units from x=80)
        const goalInFront: DetectObjectTarget[] = [
            { type: 'goal', x: 96, y: 64, width: 16, height: 32 },
        ];
        expect(raycaster.detect(80, 80, level, goalInFront, 0, 'any')).toBe(5);
        expect(raycaster.detect(80, 80, level, goalInFront, 0, 'goal')).toBe(5);
        // Looking for ground, but goal is hit first -> undefined
        expect(raycaster.detect(80, 80, level, goalInFront, 0, 'ground')).toBeUndefined();

        // Goal placed BEHIND the wall at x: 144..160
        const goalBehind: DetectObjectTarget[] = [
            { type: 'goal', x: 144, y: 64, width: 16, height: 32 },
        ];
        // Looking for goal, but wall is hit first -> undefined
        expect(raycaster.detect(80, 80, level, goalBehind, 0, 'goal')).toBeUndefined();
        expect(raycaster.detect(80, 80, level, goalBehind, 0, 'ground')).toBe(15);
    });

    test('intersects 45-degree ramp geometry accurately instead of full tile box', () => {
        // '/' ramp-left (gid=2) at (col 2, row 1) -> x: 64..96, y: 32..64
        // Its sloped edge goes from (64, 64) to (96, 32).
        // A ray shooting right from (16, 48) hits the slope at x=80 (midpoint), not x=64!
        const level = createMockLevel([
            [0, 0, 0, 0],
            [0, 0, 2, 0],
            [0, 0, 0, 0],
        ]);

        const { hit } = castRay(16, 48, 0, level);
        expect(hit).not.toBeNull();
        expect(hit!.type).toBe('ground');
        expect(hit!.distance).toBeCloseTo(64, 5); // 80 - 16 = 64
    });

    test('draws a fading white line with per-angle cooldown and cleans up', () => {
        const level = createMockLevel([
            [0, 0, 1],
        ]);
        const { scene, clock, graphicsInstances, tweenConfigs } = createMockScene();
        const raycaster = new Raycaster(scene);

        raycaster.detect(16, 16, level, [], 0, 'ground');

        expect(graphicsInstances).toHaveLength(1);
        expect(graphicsInstances[0].lineStyle).toHaveBeenCalledWith(4, 0xffffff, 0.9);
        expect(graphicsInstances[0].lineBetween).toHaveBeenCalledWith(16, 16, 64, 16);
        expect(tweenConfigs).toHaveLength(1);
        expect(tweenConfigs[0].alpha).toBe(0);
        expect(tweenConfigs[0].duration).toBe(260);

        // Calling again within cooldown (100ms later) still returns distance (15 units) but skips drawing
        clock.now += 100;
        expect(raycaster.detect(16, 16, level, [], 360, 'ground')).toBe(15);
        expect(graphicsInstances).toHaveLength(1);

        // After cooldown elapses (300ms total), draws a new ray and replaces any previous one
        clock.now += 200;
        expect(raycaster.detect(16, 16, level, [], 0, 'ground')).toBe(15);
        expect(graphicsInstances).toHaveLength(2);
        expect(graphicsInstances[0].destroy).toHaveBeenCalledOnce();

        // Simulate second tween finishing
        tweenConfigs[1].onComplete?.();
        expect(graphicsInstances[1].destroy).toHaveBeenCalledOnce();

        // clearVisuals resets cooldown and cleans up active rays immediately
        raycaster.clearVisuals();
        raycaster.detect(16, 16, level, [], 0, 'ground');
        expect(graphicsInstances).toHaveLength(3);
        raycaster.clearVisuals();
        expect(graphicsInstances[2].destroy).toHaveBeenCalledOnce();

        // Misses and wrong-type hits should not draw a ray
        expect(raycaster.detect(16, 16, level, [], 90, 'ground')).toBeUndefined();
        expect(raycaster.detect(16, 16, level, [], 0, 'goal')).toBeUndefined();
        expect(graphicsInstances).toHaveLength(3);
    });

    test('returns boolean when maxDistance is provided and draws ray only on true', () => {
        // Wall at col 2 -> x: 64..96, so distance from x=16 is 48px = 15 units
        const level = createMockLevel([[0, 0, 1]]);
        const { scene, clock, graphicsInstances } = createMockScene();
        const raycaster = new Raycaster(scene);

        // Farther than maxDistance (15 > 14) -> false, no ray drawn
        expect(raycaster.detect(16, 16, level, [], 0, 'ground', 14)).toBe(false);
        expect(graphicsInstances).toHaveLength(0);

        // Wrong type within maxDistance -> false, no ray drawn
        expect(raycaster.detect(16, 16, level, [], 0, 'goal', 50)).toBe(false);
        expect(graphicsInstances).toHaveLength(0);

        // Miss (straight up) -> false, no ray drawn
        expect(raycaster.detect(16, 16, level, [], 90, 'ground', 50)).toBe(false);
        expect(graphicsInstances).toHaveLength(0);

        // Exact boundary (15 <= 15) -> true, draws ray
        expect(raycaster.detect(16, 16, level, [], 0, 'ground', 15)).toBe(true);
        expect(graphicsInstances).toHaveLength(1);

        // Within maxDistance after cooldown -> true, draws ray
        clock.now += 300;
        expect(raycaster.detect(16, 16, level, [], 0, 'ground', 50)).toBe(true);
        expect(graphicsInstances).toHaveLength(2);
    });

    test('compilePlayerCode exposes detect() in the player sandbox', async () => {
        const detectMock = vi.fn().mockReturnValue(42);
        const trackMock = vi.fn();
        const script = compilePlayerCode(
            `
            function start() {
                const dist = detect(90, 'ground');
                track('dist', dist);
            }
            `,
            {
                moveRight: vi.fn(),
                moveLeft: vi.fn(),
                stop: vi.fn(),
                jump: vi.fn(),
                detect: detectMock,
                track: trackMock,
            },
            vi.fn()
        );

        await script.start?.();

        expect(detectMock).toHaveBeenCalledWith(90, 'ground');
        expect(trackMock).toHaveBeenCalledWith('dist', 42);
    });

    test('detects danger tiles with type "danger" and "any"', () => {
        // Danger tile (gid=6) at col 3, solid wall (gid=1) behind it at col 4
        const level = createMockLevel([
            [0, 0, 0, 6, 1],
        ]);
        const { scene } = createMockScene();
        const raycaster = new Raycaster(scene);

        // Origin at (16, 16) -> danger tile starts at x=96 -> 80px = 2.5 tiles = 25 units
        expect(raycaster.detect(16, 16, level, [], 0, 'danger')).toBe(25);
        expect(raycaster.detect(16, 16, level, [], 0, 'any')).toBe(25);
        // Danger tile blocks line-of-sight to the ground tile behind it
        expect(raycaster.detect(16, 16, level, [], 0, 'ground')).toBeUndefined();
    });
});
