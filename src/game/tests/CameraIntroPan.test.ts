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

import { Game } from '../scenes/Game';

interface MockTween {
    config: {
        targets: unknown;
        scrollX?: number;
        scrollY?: number;
        duration: number;
        delay?: number;
        ease: string;
        onComplete?: () => void;
    };
    stop: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
}

function createCameraPanHarness(bounds: {
    x?: number;
    y?: number;
    right: number;
    bottom: number;
    camWidth?: number;
    camHeight?: number;
}) {
    const game = new Game();
    const createdTweens: MockTween[] = [];

    const cam = {
        width: bounds.camWidth ?? 1024,
        height: bounds.camHeight ?? 832,
        scrollX: 0,
        scrollY: 0,
        getBounds: () => ({
            x: bounds.x ?? 0,
            y: bounds.y ?? 0,
            right: bounds.right,
            bottom: bounds.bottom,
            width: bounds.right - (bounds.x ?? 0),
            height: bounds.bottom - (bounds.y ?? 0),
        }),
        stopFollow: vi.fn(),
        centerOn: vi.fn(),
        startFollow: vi.fn(),
        setDeadzone: vi.fn(),
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

    const physics = {
        pause: vi.fn(),
        resume: vi.fn(),
    };

    const time = { paused: false };

    const codeRunner = { stop: vi.fn(), run: vi.fn() };
    const hud = { reset: vi.fn() };
    const player = { x: 64, y: 400, reset: vi.fn() };

    Object.assign(game, {
        cameras: { main: cam },
        tweens,
        physics,
        time,
        codeRunner,
        hud,
        player,
    });

    return { game, cam, createdTweens, physics };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('Level intro camera pan', () => {
    test('pans smoothly from right to left on horizontal levels', () => {
        const { game, cam, createdTweens } = createCameraPanHarness({
            right: 2048,
            bottom: 832,
            camWidth: 1024,
            camHeight: 832,
        });

        game['playLevelIntroPan']({ x: 64, y: 400 });

        // Starts at far right (scrollX = 1024), tweens to far left (scrollX = 0)
        expect(cam.scrollX).toBe(1024);
        expect(cam.scrollY).toBe(0);
        expect(createdTweens).toHaveLength(1);
        expect(createdTweens[0].config.targets).toBe(cam);
        expect(createdTweens[0].config.scrollX).toBe(0);
        expect(createdTweens[0].config.scrollY).toBeUndefined();
        expect(createdTweens[0].config.ease).toBe('Sine.easeInOut');
        expect(createdTweens[0].config.duration).toBeGreaterThanOrEqual(1400);
        expect(createdTweens[0].config.duration).toBeLessThanOrEqual(4500);
    });

    test('pans smoothly from top to bottom on vertical levels', () => {
        const { game, cam, createdTweens } = createCameraPanHarness({
            right: 1024,
            bottom: 1024,
            camWidth: 1024,
            camHeight: 832,
        });

        game['playLevelIntroPan']({ x: 64, y: 780 });

        // Starts at top (scrollY = 0), tweens to bottom (scrollY = 192)
        expect(cam.scrollX).toBe(0);
        expect(cam.scrollY).toBe(0);
        expect(createdTweens).toHaveLength(1);
        expect(createdTweens[0].config.targets).toBe(cam);
        expect(createdTweens[0].config.scrollY).toBe(192);
        expect(createdTweens[0].config.scrollX).toBeUndefined();
        expect(createdTweens[0].config.ease).toBe('Sine.easeInOut');
        expect(createdTweens[0].config.duration).toBe(1400);
    });

    test('skips intro pan when the entire level already fits in the viewport', () => {
        const { game, createdTweens } = createCameraPanHarness({
            right: 1024,
            bottom: 832,
            camWidth: 1024,
            camHeight: 832,
        });

        game['playLevelIntroPan']({ x: 64, y: 400 });

        expect(createdTweens).toHaveLength(0);
    });

    test('cancels intro pan when Run is pressed and pauses/resumes cleanly', () => {
        const { game, createdTweens, physics } = createCameraPanHarness({
            right: 1600,
            bottom: 832,
        });

        game['playLevelIntroPan']({ x: 64, y: 400 });
        expect(createdTweens).toHaveLength(1);

        game['handlePauseCode']();
        expect(createdTweens[0].pause).toHaveBeenCalledOnce();

        game['handleResumeCode']();
        expect(createdTweens[0].resume).toHaveBeenCalledOnce();
        expect(physics.resume).not.toHaveBeenCalled();

        game['handleRunCode']('function update() {}');
        expect(createdTweens[0].stop).toHaveBeenCalledOnce();
    });
});
