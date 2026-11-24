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
            Sprite: class {},
            Events: {
                WORLD_STEP: 'worldstep',
            },
        },
    },
    Scene: class {
        constructor(_key: string) {}
    },
}));

import { EventBus } from '../EventBus';
import { Game } from '../scenes/Game';

interface MockTween {
    config: {
        targets: unknown;
        alpha: number;
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
}) {
    const game = new Game();
    const createdTweens: MockTween[] = [];

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

        // Immediately on touch: code stops, physics freezes, fade-out tween starts, reset has NOT happened yet
        expect(codeRunner.stop).toHaveBeenCalledOnce();
        expect(player.stopMoving).toHaveBeenCalledOnce();
        expect(player.setVelocity).toHaveBeenCalledWith(0, 0);
        expect(physics.pause).toHaveBeenCalledOnce();
        expect(EventBus.emit).toHaveBeenCalledWith('code-stopped');
        expect(player.reset).not.toHaveBeenCalled();
        expect(hud.reset).not.toHaveBeenCalled();

        expect(createdTweens).toHaveLength(1);
        expect(createdTweens[0].config.targets).toBe(player);
        expect(createdTweens[0].config.alpha).toBe(0);
        expect(createdTweens[0].config.duration).toBeGreaterThanOrEqual(1000);

        // Simulate the fade finishing
        player.alpha = 0;
        createdTweens[0].config.onComplete?.();

        // Game resets cleanly after fade-out completes
        expect(player.reset).toHaveBeenCalledOnce();
        expect(player.alpha).toBe(1);
        expect(hud.reset).toHaveBeenCalledOnce();
        expect(raycaster.clearVisuals).toHaveBeenCalledOnce();
        expect(tilemapCollider.reset).toHaveBeenCalledOnce();
        expect(cameras.main.centerOn).toHaveBeenCalledWith(20, 414);
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
});
