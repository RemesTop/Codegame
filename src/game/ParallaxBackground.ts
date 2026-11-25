import * as Phaser from 'phaser';

export interface ParallaxConfig {
    skyTextureKey: string;
    cityTextureKey: string;
    /** Horizontal scroll factor for the far sky layer (foreground tiles = 1.0). */
    skyFactorX: number;
    /** Vertical scroll factor for the far sky layer (slower than horizontal). */
    skyFactorY: number;
    /** Horizontal scroll factor for the midground city layer (faster than sky, slower than tiles). */
    cityFactorX: number;
    /** Vertical scroll factor for the midground city layer (slower than horizontal). */
    cityFactorY: number;
    /** Maximum vertical parallax offset (px) for the sky layer on very tall maps. */
    maxSkyTravelY: number;
    /** Maximum vertical parallax offset (px) for the city layer on very tall maps. */
    maxCityTravelY: number;
}

export const DEFAULT_PARALLAX_CONFIG: ParallaxConfig = {
    skyTextureKey: 'bg-sky',
    cityTextureKey: 'bg-city',
    skyFactorX: 0.15,
    skyFactorY: 0.1,
    cityFactorX: 0.45,
    cityFactorY: 0.3,
    maxSkyTravelY: 260,
    maxCityTravelY: 220,
};

/**
 * Renders a 2-layer parallax background pinned to the camera viewport:
 * 1. Far sky layer (underneath, slowest horizontal and vertical scroll).
 * 2. Midground city layer (above sky, behind tiles; faster than sky, still slower than tiles).
 *
 * Horizontal scrolling tiles seamlessly via TileSprite.tilePositionX.
 * Vertical scrolling shifts layer Y within bounded travel so neither the sky gradient
 * nor the city skyline ever wraps vertically or exposes empty gaps.
 */
export class ParallaxBackground {
    private scene: Phaser.Scene;
    private config: ParallaxConfig;
    private skyLayer: Phaser.GameObjects.TileSprite | null = null;
    private cityLayer: Phaser.GameObjects.TileSprite | null = null;
    private skySourceHeight: number = 768;
    private citySourceHeight: number = 768;
    private skyTravelY: number = 0;
    private cityTravelY: number = 0;

    constructor(scene: Phaser.Scene, config: Partial<ParallaxConfig> = {}) {
        this.scene = scene;
        this.config = { ...DEFAULT_PARALLAX_CONFIG, ...config };

        if (!scene.add?.tileSprite) {
            return;
        }

        const viewWidth = scene.scale?.width || 1024;
        const viewHeight = scene.scale?.height || 832;

        this.skyLayer = scene.add
            .tileSprite(0, 0, viewWidth, viewHeight, this.config.skyTextureKey)
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(-20);

        this.skySourceHeight = this.skyLayer.frame?.height || 768;

        this.cityLayer = scene.add
            .tileSprite(0, 0, viewWidth, 768, this.config.cityTextureKey)
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(-10);

        this.citySourceHeight = this.cityLayer.frame?.height || 768;
        this.cityLayer.setSize(viewWidth, this.citySourceHeight);

        this.configureForCamera();
    }

    /**
     * Recalculates vertical parallax travel distances based on the current level's camera bounds
     * and resizes the sky layer with enough vertical overscan to stay gap-free.
     */
    public configureForCamera(): void {
        if (!this.skyLayer || !this.cityLayer) return;

        const viewWidth = this.scene.scale?.width || 1024;
        const viewHeight = this.scene.scale?.height || 832;
        const { scrollRangeY } = this.getScrollBounds();

        this.skyTravelY = Math.min(
            Math.round(scrollRangeY * this.config.skyFactorY),
            this.config.maxSkyTravelY
        );
        this.cityTravelY = Math.min(
            Math.round(scrollRangeY * this.config.cityFactorY),
            this.config.maxCityTravelY
        );

        const skyHeight = viewHeight + this.skyTravelY;
        this.skyLayer.setSize(viewWidth, skyHeight);
        this.skyLayer.setTileScale(1, skyHeight / this.skySourceHeight);

        this.cityLayer.setSize(viewWidth, this.citySourceHeight);
        this.cityLayer.setTileScale(1, 1);

        this.update();
    }

    /**
     * Syncs both parallax layers with the main camera's current scrollX and scrollY.
     * Should be called every frame (including during intro pans and preview scrolling).
     */
    public update(): void {
        if (!this.skyLayer || !this.cityLayer) return;

        const cam = this.scene.cameras?.main;
        if (!cam) return;

        const viewHeight = this.scene.scale?.height || 832;
        const { minScrollX, maxScrollX, minScrollY, scrollRangeY } = this.getScrollBounds();

        // Clamp camera scroll so transient unclamped values (e.g. right after centerOn)
        // never cause a 1-frame background jump/flicker
        const clampedScrollX = Phaser.Math.Clamp(cam.scrollX, minScrollX, maxScrollX);

        // Horizontal parallax: seamless repeating via TileSprite tilePositionX
        this.skyLayer.tilePositionX = clampedScrollX * this.config.skyFactorX;
        this.cityLayer.tilePositionX = clampedScrollX * this.config.cityFactorX;

        // Vertical parallax: smooth bounded vertical shift (no vertical wrapping)
        const tY =
            scrollRangeY > 0
                ? Phaser.Math.Clamp((cam.scrollY - minScrollY) / scrollRangeY, 0, 1)
                : 1;

        this.skyLayer.y = tY === 0 ? 0 : -tY * this.skyTravelY;
        this.cityLayer.y =
            viewHeight - this.citySourceHeight + (1 - tY) * this.cityTravelY;
    }

    private getScrollBounds(): {
        minScrollX: number;
        maxScrollX: number;
        minScrollY: number;
        scrollRangeY: number;
    } {
        const cam = this.scene.cameras?.main;
        if (!cam || typeof cam.getBounds !== 'function') {
            return { minScrollX: 0, maxScrollX: 0, minScrollY: 0, scrollRangeY: 0 };
        }

        const bounds = cam.getBounds();
        const minScrollX = bounds.x;
        const maxScrollX = Math.max(bounds.x, bounds.right - cam.width);
        const minScrollY = bounds.y;
        const maxScrollY = Math.max(bounds.y, bounds.bottom - cam.height);
        return {
            minScrollX,
            maxScrollX,
            minScrollY,
            scrollRangeY: Math.max(0, maxScrollY - minScrollY),
        };
    }

    public destroy(): void {
        this.skyLayer?.destroy();
        this.skyLayer = null;
        this.cityLayer?.destroy();
        this.cityLayer = null;
    }
}
