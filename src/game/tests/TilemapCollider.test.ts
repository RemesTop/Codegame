import { describe, expect, test, vi } from 'vitest';

vi.mock('phaser', () => ({
    Math: {
        Clamp: (value: number, min: number, max: number) =>
            Math.max(min, Math.min(max, value)),
    },
    Physics: {
        Arcade: {
            Events: {
                WORLD_STEP: 'worldstep',
            },
        },
    },
}));

import { TilemapCollider } from '../TilemapCollider';
import type { LoadedLevel } from '../LevelLoader';

function runWorldStep(options: {
    prevX: number;
    prevY: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    width?: number;
    height?: number;
    tiles: Array<{ index: number; left: number; top: number; size?: number }>;
}) {
    const stepHandlers: Array<() => void> = [];
    const width = options.width ?? 62;
    const height = options.height ?? 112;

    const body = {
        enable: true,
        width,
        height,
        prev: { x: options.prevX, y: options.prevY },
        position: { x: options.x, y: options.y },
        velocity: { x: options.vx, y: options.vy },
        blocked: { none: true, up: false, down: false, left: false, right: false },
        touching: { none: true, up: false, down: false, left: false, right: false },
        get right() {
            return this.position.x + this.width;
        },
        get bottom() {
            return this.position.y + this.height;
        },
        deltaX() {
            return this.position.x - this.prev.x;
        },
        deltaY() {
            return this.position.y - this.prev.y;
        },
        updateCenter: vi.fn(),
    };

    const scene = {
        physics: {
            world: {
                on: vi.fn((_ev: string, fn: () => void, ctx: unknown) => {
                    stepHandlers.push(fn.bind(ctx));
                }),
                off: vi.fn(),
                collide: vi.fn(),
            },
        },
    };

    const mappedTiles = options.tiles.map((t) => {
        const size = t.size ?? 64;
        return {
            index: t.index,
            getLeft: () => t.left,
            getRight: () => t.left + size,
            getTop: () => t.top,
            getBottom: () => t.top + size,
        };
    });

    const level = {
        collidingLayers: [
            {
                getTilesWithinWorldXY: vi.fn(() => mappedTiles),
            },
        ],
        rampLeftGids: new Set([23]),
        rampRightGids: new Set([22]),
        ceilingRampLeftGids: new Set([31]),
        ceilingRampRightGids: new Set([32]),
    } as unknown as LoadedLevel;

    new TilemapCollider(scene as never, { body } as never, level);
    for (const handler of stepHandlers) {
        handler();
    }

    return body;
}

describe('TilemapCollider ceiling ramps', () => {
    test('jumping upward into a ceiling ramp stops at ceilY without pushing below prevTop', () => {
        // Ceiling ramp '/' (32) at x=1152..1216, y=1088..1152.
        // At x=1184 (midpoint), ceilY = 1152 - 32 = 1120.
        const body = runWorldStep({
            prevX: 1184,
            prevY: 1130,
            x: 1184,
            y: 1114,
            vx: 0,
            vy: -800,
            tiles: [{ index: 32, left: 1152, top: 1088 }],
        });

        expect(body.position.y).toBe(1120);
        expect(body.position.y).toBeLessThanOrEqual(1130);
        expect(body.velocity.y).toBe(0);
        expect(body.blocked.up).toBe(true);
    });

    test('moving sideways into a low ceiling ramp never pushes Y downward through the floor', () => {
        // Ceiling ramp '/' (32) at x=1152..1216, y=1472..1536 above solid ground at y=1600.
        // Player jumped slightly (prevY=1475, bottom=1587) and moved left to x=1178 (ceilY=1510 > prevY).
        const body = runWorldStep({
            prevX: 1216,
            prevY: 1475,
            x: 1178,
            y: 1475,
            vx: -380,
            vy: 100,
            tiles: [{ index: 32, left: 1152, top: 1472 }],
        });

        // Must block X at prevX and NEVER push Y down past prevY (1475) into the floor at 1600
        expect(body.position.x).toBe(1216);
        expect(body.position.y).toBe(1475);
        expect(body.velocity.x).toBe(0);
        expect(body.blocked.left).toBe(true);
    });

    test('walking on top of a ramp bridge ignores the ceiling ramp underneath', () => {
        // Floor ramp '/' (23) at (1088, 1088), ceiling ramp '/' (32) underneath at (1152, 1088).
        // Player stands on floor ramp (prevY=990, way above tileTop=1088).
        const body = runWorldStep({
            prevX: 1110,
            prevY: 990,
            x: 1116,
            y: 990,
            vx: 380,
            vy: 20,
            tiles: [
                { index: 23, left: 1088, top: 1088 },
                { index: 32, left: 1152, top: 1088 },
            ],
        });

        expect(body.position.x).toBe(1116);
        expect(body.blocked.right).toBe(false);
    });
});
