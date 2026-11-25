import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TILESETS } from '../Levels/levels';
import type { LoadedLevel } from '../LevelLoader';

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
            RectangleToRectangle: vi.fn(() => false),
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

import { EventBus } from '../EventBus';
import { Game } from '../scenes/Game';

interface MockTween {
    config: {
        targets: unknown;
        alpha?: number;
        x?: number;
        duration: number;
        ease: string;
        onComplete?: () => void;
    };
    stop: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
}

function createDangerTestHarness(options: {
    playerBox: { x: number; y: number; width: number; height: number };
    dangerTiles: Array<{ index: number; left: number; top: number; size?: number }>;
    dangerGids?: number[];
    enableSlideOverlay?: boolean;
    mapHeight?: number;
    cameraBottom?: number;
}) {
    const game = new Game();
    const createdTweens: MockTween[] = [];
    const createdOverlays: Array<{
        x: number;
        y: number;
        textureKey: string;
        setOrigin: ReturnType<typeof vi.fn>;
        setDisplaySize: ReturnType<typeof vi.fn>;
        setScrollFactor: ReturnType<typeof vi.fn>;
        setDepth: ReturnType<typeof vi.fn>;
        destroy: ReturnType<typeof vi.fn>;
    }> = [];
    const existingTextures = new Set<string>();

    const player = {
        x: options.playerBox.x + options.playerBox.width / 2,
        y: options.playerBox.y + options.playerBox.height / 2,
        alpha: 1,
        body: {
            position: { x: options.playerBox.x, y: options.playerBox.y },
            width: options.playerBox.width,
            height: options.playerBox.height,
        },
        update: vi.fn(),
        stopMoving: vi.fn(),
        setVelocity: vi.fn(),
        reset: vi.fn(function (this: { alpha: number; x: number; y: number }) {
            this.alpha = 1;
            this.x = 20;
            this.y = 414;
        }),
        getBounds: () => ({
            left: options.playerBox.x,
            top: options.playerBox.y,
            width: options.playerBox.width,
            height: options.playerBox.height,
        }),
    };

    const tiles = options.dangerTiles.map((t) => {
        const size = t.size ?? 32;
        return {
            index: t.index,
            getLeft: () => t.left,
            getRight: () => t.left + size,
            getTop: () => t.top,
            getBottom: () => t.top + size,
        };
    });

    const layer = {
        getTilesWithinWorldXY: vi.fn(() => tiles),
    };

    const level = {
        collidingLayers: [layer],
        dangerGids: new Set(options.dangerGids ?? [37]),
        ...(options.mapHeight !== undefined
            ? { map: { heightInPixels: options.mapHeight } }
            : {}),
    } as unknown as LoadedLevel;

    const codeRunner = {
        stop: vi.fn(),
        run: vi.fn(),
    };
    const hud = {
        reset: vi.fn(),
    };
    const raycaster = {
        clearVisuals: vi.fn(),
    };
    const tilemapCollider = {
        reset: vi.fn(),
    };
    const physics = {
        pause: vi.fn(),
        resume: vi.fn(),
    };
    const cameras = {
        main: {
            stopFollow: vi.fn(),
            centerOn: vi.fn(),
            startFollow: vi.fn(),
            setDeadzone: vi.fn(),
            ...(options.cameraBottom !== undefined
                ? { getBounds: vi.fn(() => ({ bottom: options.cameraBottom })) }
                : {}),
        },
    };
    const time = {
        paused: false,
    };
    const tweens = {
        add: vi.fn((config: MockTween['config']) => {
            const tween: MockTween = {
                config,
                stop: vi.fn(),
                pause: vi.fn(),
                resume: vi.fn(),
            };
            createdTweens.push(tween);
            return tween;
        }),
    };

    const extraSceneProps: Record<string, unknown> = {};
    if (options.enableSlideOverlay) {
        extraSceneProps.scale = { width: 1024, height: 768 };
        extraSceneProps.textures = {
            exists: vi.fn((key: string) => existingTextures.has(key)),
            createCanvas: vi.fn((key: string) => {
                existingTextures.add(key);
                const gradient = { addColorStop: vi.fn() };
                const ctx = {
                    createLinearGradient: vi.fn(() => gradient),
                    fillStyle: '',
                    fillRect: vi.fn(),
                };
                return {
                    getContext: () => ctx,
                    refresh: vi.fn(),
                };
            }),
        };
        extraSceneProps.add = {
            image: vi.fn((x: number, y: number, textureKey: string) => {
                const overlay = {
                    x,
                    y,
                    textureKey,
                    setOrigin: vi.fn(),
                    setDisplaySize: vi.fn(),
                    setScrollFactor: vi.fn(),
                    setDepth: vi.fn(),
                    destroy: vi.fn(),
                };
                overlay.setOrigin.mockReturnValue(overlay);
                overlay.setDisplaySize.mockReturnValue(overlay);
                overlay.setScrollFactor.mockReturnValue(overlay);
                overlay.setDepth.mockReturnValue(overlay);
                createdOverlays.push(overlay);
                return overlay;
            }),
        };
    }

    Object.assign(game, {
        player,
        currentLevel: level,
        isSimulating: true,
        codeRunner,
        hud,
        raycaster,
        tilemapCollider,
        physics,
        cameras,
        time,
        tweens,
        ...extraSceneProps,
    });

    return {
        game,
        player,
        codeRunner,
        hud,
        raycaster,
        tilemapCollider,
        physics,
        cameras,
        time,
        createdTweens,
        createdOverlays,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('Danger tile configuration & death sequence', () => {
    test('TilesetV0 registers local tile index 36 as danger', () => {
        expect(TILESETS.TilesetV0.tileShapes[36]).toBe('danger');
    });

    test('touching a danger tile stops execution, slowly fades the player out, and resets after fade completes', () => {
        const {
            game,
            player,
            codeRunner,
            hud,
            raycaster,
            tilemapCollider,
            physics,
            cameras,
            createdTweens,
        } = createDangerTestHarness({
            // Overlaps danger tile at (96..128, 480..512)
            playerBox: { x: 96, y: 440, width: 32, height: 48 },
            dangerTiles: [{ index: 37, left: 96, top: 480 }],
        });

        game.update(0, 16);

        // Immediately on touch: code stops, physics freezes, fade-out tween starts,
        // and button stays in Stop/Reset state (code-stopped not emitted until reset)
        expect(codeRunner.stop).toHaveBeenCalledOnce();
        expect(player.stopMoving).toHaveBeenCalledOnce();
        expect(player.setVelocity).toHaveBeenCalledWith(0, 0);
        expect(physics.pause).toHaveBeenCalledOnce();
        expect(EventBus.emit).not.toHaveBeenCalledWith('code-stopped');
        expect(player.reset).not.toHaveBeenCalled();
        expect(hud.reset).not.toHaveBeenCalled();

        expect(createdTweens).toHaveLength(1);
        expect(createdTweens[0].config.targets).toBe(player);
        expect(createdTweens[0].config.alpha).toBe(0);
        expect(createdTweens[0].config.duration).toBe(900);

        // Simulate the fade finishing
        player.alpha = 0;
        createdTweens[0].config.onComplete?.();

        // Game resets cleanly and emits code-stopped after fade-out completes
        expect(player.reset).toHaveBeenCalledOnce();
        expect(player.alpha).toBe(1);
        expect(hud.reset).toHaveBeenCalledOnce();
        expect(raycaster.clearVisuals).toHaveBeenCalledOnce();
        expect(tilemapCollider.reset).toHaveBeenCalledOnce();
        expect(cameras.main.centerOn).toHaveBeenCalledWith(20, 414);
        expect(EventBus.emit).toHaveBeenCalledWith('code-stopped');
    });

    test('standing adjacent to a danger tile without overlapping does not kill the player', () => {
        const { game, codeRunner, createdTweens } = createDangerTestHarness({
            // Bottom edge is exactly y=480 (flush with danger tile top y=480, no overlap)
            playerBox: { x: 96, y: 432, width: 32, height: 48 },
            dangerTiles: [{ index: 37, left: 96, top: 480 }],
        });

        game.update(0, 16);

        expect(codeRunner.stop).not.toHaveBeenCalled();
        expect(createdTweens).toHaveLength(0);
    });

    test('pausing and resuming during death fade pauses and resumes the tween without resuming simulation', () => {
        const { game, physics, createdTweens } = createDangerTestHarness({
            playerBox: { x: 96, y: 440, width: 32, height: 48 },
            dangerTiles: [{ index: 37, left: 96, top: 480 }],
        });

        game.update(0, 16);
        expect(createdTweens).toHaveLength(1);

        game['handlePauseCode']();
        expect(createdTweens[0].pause).toHaveBeenCalledOnce();

        game['handleResumeCode']();
        expect(createdTweens[0].resume).toHaveBeenCalledOnce();
        expect(physics.resume).not.toHaveBeenCalled();
    });

    test('running code during death fade cancels the tween and prevents a delayed reset', () => {
        const { game, player, codeRunner, createdTweens } = createDangerTestHarness({
            playerBox: { x: 96, y: 440, width: 32, height: 48 },
            dangerTiles: [{ index: 37, left: 96, top: 480 }],
        });

        game.update(0, 16);
        expect(createdTweens).toHaveLength(1);

        game['handleRunCode']('function update() {}');

        expect(createdTweens[0].stop).toHaveBeenCalledOnce();
        expect(player.reset).toHaveBeenCalledOnce();
        expect(codeRunner.run).toHaveBeenCalledWith('function update() {}');

        // Even if a stale onComplete fired, it must not reset the newly running game
        createdTweens[0].config.onComplete?.();
        expect(player.reset).toHaveBeenCalledOnce();
    });

    test('slides a feathered black fade across the screen on death reset and resets at full-black midpoint', () => {
        const {
            game,
            player,
            hud,
            cameras,
            createdTweens,
            createdOverlays,
        } = createDangerTestHarness({
            playerBox: { x: 96, y: 440, width: 32, height: 48 },
            dangerTiles: [{ index: 37, left: 96, top: 480 }],
            enableSlideOverlay: true,
        });

        game.update(0, 16);
        expect(createdTweens).toHaveLength(1);

        // Complete player fade-out -> starts Phase 1 of sliding black fade; still not stopped yet
        createdTweens[0].config.onComplete?.();
        expect(createdOverlays).toHaveLength(1);
        expect(createdOverlays[0].x).toBe(-1536);
        expect(createdTweens).toHaveLength(2);
        expect(createdTweens[1].config.x).toBe(-256);
        expect(player.reset).not.toHaveBeenCalled();
        expect(EventBus.emit).not.toHaveBeenCalledWith('code-stopped');

        // Complete Phase 1 (screen is now 100% black) -> resets scene, emits code-stopped, and starts Phase 2 slide out
        createdTweens[1].config.onComplete?.();
        expect(player.reset).toHaveBeenCalledOnce();
        expect(hud.reset).toHaveBeenCalledOnce();
        expect(cameras.main.centerOn).toHaveBeenCalledWith(20, 414);
        expect(EventBus.emit).toHaveBeenCalledWith('code-stopped');
        expect(createdTweens).toHaveLength(3);
        expect(createdTweens[2].config.x).toBe(1024);
        expect(createdOverlays[0].destroy).not.toHaveBeenCalled();

        // Complete Phase 2 -> destroys white overlay
        createdTweens[2].config.onComplete?.();
        expect(createdOverlays[0].destroy).toHaveBeenCalledOnce();
    });

    test('sliding black fade plays on Stop after a run, supports pause/resume, and cancels on Run', () => {
        const {
            game,
            player,
            physics,
            createdTweens,
            createdOverlays,
        } = createDangerTestHarness({
            playerBox: { x: 96, y: 400, width: 32, height: 48 },
            dangerTiles: [],
            enableSlideOverlay: true,
        });

        game['handleRunCode']('function update() {}');
        expect(player.reset).toHaveBeenCalledTimes(1);

        // Stopping a started run triggers the sliding white fade
        game['handleStopCode']();
        expect(createdOverlays).toHaveLength(1);
        expect(createdTweens).toHaveLength(1);
        expect(player.reset).toHaveBeenCalledTimes(1);

        // Pause and resume during slide
        game['handlePauseCode']();
        expect(createdTweens[0].pause).toHaveBeenCalledOnce();
        game['handleResumeCode']();
        expect(createdTweens[0].resume).toHaveBeenCalledOnce();
        expect(physics.resume).toHaveBeenCalledTimes(1); // Only from initial handleRunCode

        // Running again mid-slide cancels the slide and destroys the overlay
        game['handleRunCode']('function update() {}');
        expect(createdTweens[0].stop).toHaveBeenCalledOnce();
        expect(createdOverlays[0].destroy).toHaveBeenCalledOnce();
        expect(player.reset).toHaveBeenCalledTimes(2);
    });
});

describe('Falling far off the map', () => {
    test('falling slightly below the map bottom does not kill the player yet', () => {
        const { game, codeRunner, createdTweens } = createDangerTestHarness({
            // Center y = 1100 + 24 = 1124, within 320px margin below mapHeight 1024
            playerBox: { x: 96, y: 1100, width: 32, height: 48 },
            dangerTiles: [],
            mapHeight: 1024,
            cameraBottom: 1024,
        });

        game.update(0, 16);

        expect(codeRunner.stop).not.toHaveBeenCalled();
        expect(createdTweens).toHaveLength(0);
    });

    test('falling far below the map kills the player and resets via the sliding black fade without an off-screen sprite fade', () => {
        const {
            game,
            player,
            codeRunner,
            hud,
            physics,
            cameras,
            createdTweens,
            createdOverlays,
        } = createDangerTestHarness({
            // Center y = 1350 + 24 = 1374 > 1024 + 320 (1344)
            playerBox: { x: 96, y: 1350, width: 32, height: 48 },
            dangerTiles: [],
            enableSlideOverlay: true,
            mapHeight: 1024,
            cameraBottom: 1024,
        });

        game.update(0, 16);

        // Immediately stops code, halts player, pauses physics, and starts Phase 1 slide (no sprite fade tween)
        expect(codeRunner.stop).toHaveBeenCalledOnce();
        expect(player.stopMoving).toHaveBeenCalledOnce();
        expect(player.setVelocity).toHaveBeenCalledWith(0, 0);
        expect(physics.pause).toHaveBeenCalledOnce();
        expect(createdOverlays).toHaveLength(1);
        expect(createdTweens).toHaveLength(1);
        expect(createdTweens[0].config.targets).toBe(createdOverlays[0]);
        expect(player.reset).not.toHaveBeenCalled();
        expect(EventBus.emit).not.toHaveBeenCalledWith('code-stopped');

        // Midpoint of slide resets the scene and emits code-stopped
        createdTweens[0].config.onComplete?.();
        expect(player.reset).toHaveBeenCalledOnce();
        expect(hud.reset).toHaveBeenCalledOnce();
        expect(cameras.main.centerOn).toHaveBeenCalledWith(20, 414);
        expect(EventBus.emit).toHaveBeenCalledWith('code-stopped');
    });

    test('respects camera bottom when map is shorter than the viewport', () => {
        const { game, player, codeRunner } = createDangerTestHarness({
            // Map height is 512, camera bottom is 640 -> death threshold is 960
            // Center y = 900 + 24 = 924 (below 512 + 320 = 832, but above 640 + 320 = 960)
            playerBox: { x: 96, y: 900, width: 32, height: 48 },
            dangerTiles: [],
            mapHeight: 512,
            cameraBottom: 640,
        });

        game.update(0, 16);
        expect(codeRunner.stop).not.toHaveBeenCalled();

        // Now move player past 960
        player.y = 961;
        game.update(0, 16);
        expect(codeRunner.stop).toHaveBeenCalledOnce();
    });
});
