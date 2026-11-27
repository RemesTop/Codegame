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
    /** Opacity of the sky layer (blends toward canvas backgroundColor if < 1). */
    skyAlpha: number;
    /** Subtle blur strength on the far sky layer so it matches the city softness (0 disables blur). */
    skyBlurStrength: number;
    /** Opacity of the city layer so it blends softly into the sky behind foreground tiles. */
    cityAlpha: number;
    /** Subtle blur strength on the city layer for background depth (0 disables blur). */
    cityBlurStrength: number;
}

export const DEFAULT_PARALLAX_CONFIG: ParallaxConfig = {
    skyTextureKey: 'bg-sky',
    cityTextureKey: 'bg-city',
    skyFactorX: 0.15,
    skyFactorY: 0.1,
    cityFactorX: 0.45,
    cityFactorY: 0.3,
    maxSkyTravelY: 520,
    maxCityTravelY: 440,
    skyAlpha: 0.85,
    skyBlurStrength: 0.5,
    cityAlpha: 1,
    cityBlurStrength: 0.3,
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
    private skySourceWidth: number = 1024;
    private skySourceHeight: number = 768;
    private citySourceWidth: number = 1024;
    private citySourceHeight: number = 768;
    private skyScaleX: number = 1;
    private cityScaleX: number = 1;
    private cityDisplayHeight: number = 768;
    private skyTravelY: number = 0;
    private cityTravelY: number = 0;

    constructor(scene: Phaser.Scene, config: Partial<ParallaxConfig> = {}) {
        this.scene = scene;
        this.config = { ...DEFAULT_PARALLAX_CONFIG, ...config };

        if (!scene.add?.tileSprite) {
            return;
        }

        const { viewWidth, viewHeight, offsetX, offsetY } = this.getViewportMetrics();

        this.skyLayer = scene.add
            .tileSprite(offsetX, offsetY, viewWidth, viewHeight, this.config.skyTextureKey)
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(-20)
            .setAlpha(this.config.skyAlpha);

        this.applyLayerBlur(this.skyLayer, this.config.skyBlurStrength);

        this.skySourceWidth = this.skyLayer.frame?.width || 1024;
        this.skySourceHeight = this.skyLayer.frame?.height || 768;

        this.cityLayer = scene.add
            .tileSprite(offsetX, offsetY, viewWidth, 768, this.config.cityTextureKey)
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(-10)
            .setAlpha(this.config.cityAlpha);

        this.applyLayerBlur(this.cityLayer, this.config.cityBlurStrength);

        this.citySourceWidth = this.cityLayer.frame?.width || 1024;
        this.citySourceHeight = this.cityLayer.frame?.height || 768;

        this.configureForCamera();
    }

    private applyLayerBlur(
        layer: Phaser.GameObjects.TileSprite,
        strength: number
    ): void {
        if (strength > 0 && typeof layer.enableFilters === 'function') {
            layer.enableFilters();
            layer.filters?.internal?.addBlur(0, 2, 2, strength);
        }
    }

    /**
     * Recalculates vertical parallax travel distances based on the current level's camera bounds
     * and resizes the sky layer with enough vertical overscan to stay gap-free.
     */
    public configureForCamera(): void {
        if (!this.skyLayer || !this.cityLayer) return;

        const { viewWidth, viewHeight, offsetX } = this.getViewportMetrics();
        const { scrollRangeY } = this.getScrollBounds();

        this.skyTravelY = Math.min(
            Math.round(scrollRangeY * this.config.skyFactorY),
            this.config.maxSkyTravelY
        );
        this.cityTravelY = Math.min(
            Math.round(scrollRangeY * this.config.cityFactorY),
            this.config.maxCityTravelY
        );

        this.skyScaleX = viewWidth / this.skySourceWidth;
        const skyHeight = viewHeight + this.skyTravelY;
        this.skyLayer.x = offsetX;
        this.skyLayer.setSize(viewWidth, skyHeight);
        this.skyLayer.setTileScale(this.skyScaleX, skyHeight / this.skySourceHeight);

        this.cityScaleX = viewWidth / this.citySourceWidth;
        this.cityDisplayHeight = Math.round(this.citySourceHeight * this.cityScaleX);
        this.cityLayer.x = offsetX;
        this.cityLayer.setSize(viewWidth, this.cityDisplayHeight);
        this.cityLayer.setTileScale(this.cityScaleX, this.cityScaleX);

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

        const { viewHeight, offsetY } = this.getViewportMetrics();
        const { minScrollX, maxScrollX, minScrollY, scrollRangeY } = this.getScrollBounds();

        // Clamp camera scroll so transient unclamped values (e.g. right after centerOn)
        // never cause a 1-frame background jump/flicker
        const clampedScrollX =
            Phaser.Math.Clamp(cam.scrollX, minScrollX, maxScrollX) - minScrollX;

        // Horizontal parallax: seamless repeating via TileSprite tilePositionX (in texture pixels)
        this.skyLayer.tilePositionX =
            (clampedScrollX / this.skyScaleX) * this.config.skyFactorX;
        this.cityLayer.tilePositionX =
            (clampedScrollX / this.cityScaleX) * this.config.cityFactorX;

        // Vertical parallax: smooth bounded vertical shift (no vertical wrapping)
        const tY =
            scrollRangeY > 0
                ? Phaser.Math.Clamp((cam.scrollY - minScrollY) / scrollRangeY, 0, 1)
                : 1;

        this.skyLayer.y = offsetY + (tY === 0 ? 0 : -tY * this.skyTravelY);
        this.cityLayer.y =
            offsetY + viewHeight - this.cityDisplayHeight + (1 - tY) * this.cityTravelY;
    }

    private getViewportMetrics(): {
        viewWidth: number;
        viewHeight: number;
        offsetX: number;
        offsetY: number;
    } {
        const baseWidth = this.scene.scale?.width || 1024;
        const baseHeight = this.scene.scale?.height || 832;
        const zoom = this.scene.cameras?.main?.zoom || 1;
        const viewWidth = baseWidth / zoom;
        const viewHeight = baseHeight / zoom;
        return {
            viewWidth,
            viewHeight,
            offsetX: (baseWidth - viewWidth) / 2,
            offsetY: (baseHeight - viewHeight) / 2,
        };
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
        const zoom = cam.zoom || 1;
        const halfW = cam.width * 0.5;
        const halfH = cam.height * 0.5;
        const displayHalfW = (cam.width / zoom) * 0.5;
        const displayHalfH = (cam.height / zoom) * 0.5;

        const minScrollX = bounds.x - halfW + displayHalfW;
        const maxScrollX = Math.max(minScrollX, bounds.right - halfW - displayHalfW);
        const minScrollY = bounds.y - halfH + displayHalfH;
        const maxScrollY = Math.max(minScrollY, bounds.bottom - halfH - displayHalfH);
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
