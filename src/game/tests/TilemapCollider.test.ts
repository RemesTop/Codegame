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

interface TestTileSpec {
    index: number;
    left: number;
    top: number;
    size?: number;
}

function runWorldStep(options: {
    prevX: number;
    prevY: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    width?: number;
    height?: number;
    tiles: TestTileSpec[];
    onSolidCollide?: (body: {
        position: { x: number; y: number };
        velocity: { x: number; y: number };
        height: number;
        blocked: { down: boolean; left: boolean; right: boolean; up: boolean; none: boolean };
    }) => void;
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
                collide: vi.fn(() => {
                    options.onSolidCollide?.(body);
                }),
            },
        },
    };

    const mappedTiles = options.tiles.map((t) => {
        const size = t.size ?? 64;
        return {
            index: t.index,
            x: Math.floor(t.left / size),
            y: Math.floor(t.top / size),
            getLeft: () => t.left,
            getRight: () => t.left + size,
            getTop: () => t.top,
            getBottom: () => t.top + size,
        };
    });

    const tileGrid = new Map<string, (typeof mappedTiles)[number]>();
    for (const mt of mappedTiles) {
        tileGrid.set(`${mt.x},${mt.y}`, mt);
    }

    const level = {
        solidGids: [1, 2, 3],
        collidingLayers: [
            {
                getTilesWithinWorldXY: vi.fn(() => mappedTiles),
                getTileAt: vi.fn((tx: number, ty: number) => tileGrid.get(`${tx},${ty}`) ?? null),
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

        describe('TilemapCollider ramps & ceiling slopes', () => {
            test('jumping upward into a ceiling ramp stops at ceilY while keeping horizontal momentum', () => {
                // Ceiling ramp '/' (32) at x=1152..1216, y=1088..1152 -> at x=1184, ceilY = 1120.
                const body = runWorldStep({
                    prevX: 1178,
                    prevY: 1130,
                    x: 1184,
                    y: 1114,
                    vx: 380,
                    vy: -800,
                    tiles: [{ index: 32, left: 1152, top: 1088 }],
                });

                expect(body.position.y).toBe(1120);
                // Horizontal speed is preserved, and upward vy glides along the 45-degree slope (-380)
                expect(body.velocity.x).toBe(380);
                expect(body.velocity.y).toBe(-380);
                expect(body.blocked.up).toBe(true);
            });

                test('airborne sideways hit against a ceiling ramp glides smoothly without killing horizontal speed', () => {
                    // Moving left in mid-air into '/' ceiling ramp (32): glides down to ceilY keeping vx=-380
                    const body = runWorldStep({
                        prevX: 1184,
                        prevY: 1120,
                        x: 1178,
                        y: 1120,
                        vx: -380,
                        vy: 0,
                        tiles: [{ index: 32, left: 1152, top: 1088 }],
                    });

                    expect(body.position.y).toBe(1126);
                    expect(body.velocity.x).toBe(-380);
                });

                test('grounded wedge under a ceiling ramp pushes horizontally out instead of shoving through the floor', () => {
                    // Floor at y=1600 keeps body.position.y = 1488 (blocked.down = true);
                    // ceiling ramp '/' (32) at (1152, 1440..1504) has ceilY=1488 at x=1168 and ceilY=1494 at x=1162.
                    const body = runWorldStep({
                        prevX: 1168,
                        prevY: 1488,
                        x: 1162,
                        y: 1488,
                        vx: -380,
                        vy: 20,
                        tiles: [{ index: 32, left: 1152, top: 1440 }],
                        onSolidCollide: (b) => {
                            if (b.position.y + b.height >= 1600) {
                                b.position.y = 1600 - b.height;
                                b.blocked.down = true;
                                b.blocked.none = false;
                            }
                        },
                    });

                    // Stays on top of floor (y=1488) and pushes X right out of the wedge (x=1168)
                    expect(body.position.y).toBe(1488);
                    expect(body.position.x).toBe(1168);
                    expect(body.blocked.left).toBe(true);
                });

                    test('connected ramp beam (floor ramp adjacent to ceiling ramp) does not trigger fake internal back-walls', () => {
                        // '/' ramp (23) at (1088, 1088) with adjacent 'r' ceiling ramp (32) at (1152, 1088).
                        // Descending left across x=1152 seam must NOT zero velocity.x on an internal back-wall.
                        const body = runWorldStep({
                            prevX: 1151,
                            prevY: 980,
                            x: 1145,
                            y: 984,
                            vx: -380,
                            vy: 20,
                            tiles: [
                                { index: 23, left: 1088, top: 1088 },
                                { index: 32, left: 1152, top: 1088 },
                            ],
                        });

                        expect(body.velocity.x).toBe(-380);
                        expect(body.blocked.left).toBe(false);
                    });
                });
