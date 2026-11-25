import { describe, expect, test, vi } from 'vitest';

vi.mock('phaser', () => ({
    Math: {
        Clamp: (value: number, min: number, max: number) =>
            Math.max(min, Math.min(max, value)),
    },
}));

import { DEFAULT_PARALLAX_CONFIG, ParallaxBackground } from '../ParallaxBackground';

interface MockTileSprite {
    x: number;
    y: number;
    width: number;
    height: number;
    textureKey: string;
    tilePositionX: number;
    tileScaleX: number;
    tileScaleY: number;
    depth: number;
    scrollFactor: number;
    alpha: number;
    frame: { height: number };
    setOrigin: ReturnType<typeof vi.fn>;
    setScrollFactor: ReturnType<typeof vi.fn>;
    setDepth: ReturnType<typeof vi.fn>;
    setAlpha: ReturnType<typeof vi.fn>;
    setSize: ReturnType<typeof vi.fn>;
    setTileScale: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
}

function createMockScene(options: {
    viewWidth?: number;
    viewHeight?: number;
    boundsRight?: number;
    boundsBottom?: number;
}) {
    const viewWidth = options.viewWidth ?? 1024;
    const viewHeight = options.viewHeight ?? 832;
    const createdSprites: MockTileSprite[] = [];

    const cam = {
        width: viewWidth,
        height: viewHeight,
        scrollX: 0,
        scrollY: 0,
        getBounds: () => ({
            x: 0,
            y: 0,
            right: options.boundsRight ?? viewWidth,
            bottom: options.boundsBottom ?? viewHeight,
        }),
    };

    const scene = {
        scale: { width: viewWidth, height: viewHeight },
        cameras: { main: cam },
        add: {
            tileSprite: vi.fn(
                (x: number, y: number, width: number, height: number, textureKey: string) => {
                    const sprite: MockTileSprite = {
                        x,
                        y,
                        width,
                        height,
                        textureKey,
                        tilePositionX: 0,
                        tileScaleX: 1,
                        tileScaleY: 1,
                        depth: 0,
                        scrollFactor: 1,
                        alpha: 1,
                        frame: { height: 768 },
                        setOrigin: vi.fn(),
                        setScrollFactor: vi.fn((sf: number) => {
                            sprite.scrollFactor = sf;
                            return sprite;
                        }),
                        setDepth: vi.fn((d: number) => {
                            sprite.depth = d;
                            return sprite;
                        }),
                        setAlpha: vi.fn((a: number) => {
                            sprite.alpha = a;
                            return sprite;
                        }),
                        setSize: vi.fn((w: number, h: number) => {
                            sprite.width = w;
                            sprite.height = h;
                            return sprite;
                        }),
                        setTileScale: vi.fn((sx: number, sy: number) => {
                            sprite.tileScaleX = sx;
                            sprite.tileScaleY = sy;
                            return sprite;
                        }),
                        destroy: vi.fn(),
                    };
                    sprite.setOrigin.mockReturnValue(sprite);
                    createdSprites.push(sprite);
                    return sprite;
                }
            ),
        },
    };

    return {
        scene: scene as unknown as Phaser.Scene,
        cam,
        createdSprites,
    };
}

describe('ParallaxBackground', () => {
    test('places sky underneath city and scrolls sky slower than city horizontally', () => {
        const { scene, cam, createdSprites } = createMockScene({
            boundsRight: 2048,
            boundsBottom: 832,
        });

        const bg = new ParallaxBackground(scene);
        const [sky, city] = createdSprites;

        expect(sky.textureKey).toBe('bg-sky');
        expect(city.textureKey).toBe('bg-city');
        expect(sky.depth).toBeLessThan(city.depth);
        expect(city.depth).toBeLessThan(0);
        expect(sky.scrollFactor).toBe(0);
        expect(city.scrollFactor).toBe(0);

        cam.scrollX = 400;
        bg.update();

        expect(sky.tilePositionX).toBeCloseTo(400 * DEFAULT_PARALLAX_CONFIG.skyFactorX);
        expect(city.tilePositionX).toBeCloseTo(400 * DEFAULT_PARALLAX_CONFIG.cityFactorX);
        expect(sky.tilePositionX).toBeLessThan(city.tilePositionX);
        expect(city.tilePositionX).toBeLessThan(400);
    });

    test('scrolls slower vertically on both layers without exposing gaps at top or bottom', () => {
        // 32x32 level (1024x1024) in 1024x832 viewport -> scrollRangeY = 192
        const { scene, cam, createdSprites } = createMockScene({
            boundsRight: 1024,
            boundsBottom: 1024,
        });

        const bg = new ParallaxBackground(scene);
        const [sky, city] = createdSprites;

        expect(DEFAULT_PARALLAX_CONFIG.skyFactorY).toBeLessThan(
            DEFAULT_PARALLAX_CONFIG.skyFactorX
        );
        expect(DEFAULT_PARALLAX_CONFIG.cityFactorY).toBeLessThan(
            DEFAULT_PARALLAX_CONFIG.cityFactorX
        );

        // At top of level (scrollY = 0)
        cam.scrollY = 0;
        bg.update();
        const skyTopY = sky.y;
        const cityTopY = city.y;
        expect(skyTopY).toBe(0);
        expect(skyTopY + sky.height).toBeGreaterThanOrEqual(832);

        // At bottom of level (scrollY = 192)
        cam.scrollY = 192;
        bg.update();
        const skyBottomY = sky.y;
        const cityBottomY = city.y;

        // Both move upward as camera scrolls down, sky slower than city, both slower than camera (192)
        const skyDelta = skyTopY - skyBottomY;
        const cityDelta = cityTopY - cityBottomY;
        expect(skyDelta).toBeGreaterThan(0);
        expect(cityDelta).toBeGreaterThan(skyDelta);
        expect(cityDelta).toBeLessThan(192);

        // At bottom of level, both layers sit flush with bottom of viewport (832)
        expect(skyBottomY + sky.height).toBe(832);
        expect(cityBottomY + city.height).toBe(832);
    });

    test('clamps out-of-bounds camera scrollX so centerOn does not cause a 1-frame flicker', () => {
        // 32-tile wide level (no horizontal scroll: minScrollX = maxScrollX = 0)
        const { scene, cam, createdSprites } = createMockScene({
            boundsRight: 1024,
            boundsBottom: 1024,
        });

        const bg = new ParallaxBackground(scene);
        const [sky, city] = createdSprites;

        // Simulate cam.centerOn(20, 414) leaving scrollX transiently negative before preRender
        cam.scrollX = -492;
        bg.update();

        expect(sky.tilePositionX).toBe(0);
        expect(city.tilePositionX).toBe(0);
    });
});
