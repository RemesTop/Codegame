import * as Phaser from 'phaser';
import { LoadedLevel } from './LevelLoader';

/**
 * Handles Arcade Physics collisions against a loaded Tiled level, supporting:
 * 1. 45-degree left-facing ('/') and right-facing ('\') ramp tiles.
 * 2. Full 32x32 solid tiles via Phaser's TilemapLayer AABB collision.
 *
 * Ramps are resolved before solid tiles on each physics step so the player
 * smoothly climbs onto and descends across ramp-to-solid tile seams without snagging.
 */
export class TilemapCollider {
    private scene: Phaser.Scene;
    private sprite: Phaser.Physics.Arcade.Sprite;
    private level: LoadedLevel;
    private wasOnGround: boolean = false;
    private attached: boolean = false;

    constructor(
        scene: Phaser.Scene,
        sprite: Phaser.Physics.Arcade.Sprite,
        level: LoadedLevel
    ) {
        this.scene = scene;
        this.sprite = sprite;
        this.level = level;
        this.attach();
    }

    public attach(): void {
        if (this.attached) return;
        this.scene.physics.world.on(
            Phaser.Physics.Arcade.Events.WORLD_STEP,
            this.onWorldStep,
            this
        );
        this.attached = true;
    }

    public reset(): void {
        this.wasOnGround = false;
    }

    public setLevel(level: LoadedLevel): void {
        this.level = level;
        this.wasOnGround = false;
    }

    public destroy(): void {
        if (!this.attached) return;
        this.scene.physics.world.off(
            Phaser.Physics.Arcade.Events.WORLD_STEP,
            this.onWorldStep,
            this
        );
        this.attached = false;
    }

    private onWorldStep(): void {
        const body = this.sprite.body as Phaser.Physics.Arcade.Body | null;
        if (!body || !body.enable) return;

        // Pass 1: Resolve 45-degree ramps first so transitions onto solid tiles never snag
        this.resolveRampCollisions(body);

        // Pass 2: Resolve standard solid AABB tiles
        for (const layer of this.level.collidingLayers) {
            this.scene.physics.world.collide(this.sprite, layer);
        }

        // Remember grounded state for smooth downhill slope snapping on the next step
        this.wasOnGround = body.blocked.down;
    }

    private resolveRampCollisions(body: Phaser.Physics.Arcade.Body): void {
        if (
            this.level.rampLeftGids.size === 0 &&
            this.level.rampRightGids.size === 0 &&
            this.level.ceilingRampLeftGids.size === 0 &&
            this.level.ceilingRampRightGids.size === 0
        ) {
            return;
        }

        const prevLeft = body.prev.x;
        const prevRight = body.prev.x + body.width;
        const prevTop = body.prev.y;
        const prevBottom = body.prev.y + body.height;

        // Downhill snap keeps the player glued to 45-degree slopes when walking down
        const downSnap =
            this.wasOnGround && body.velocity.y >= 0
                ? Math.min(36, Math.abs(body.deltaX()) + 12)
                : 0;
        const upSnap = Math.max(
            32,
            Math.abs(body.deltaX()) + Math.abs(body.deltaY()) + 16
        );

        let bestRampY: number | null = null;
        let bestCeilingY: number | null = null;

        for (const layer of this.level.collidingLayers) {
            const tiles = layer.getTilesWithinWorldXY(
                body.position.x - 1,
                body.position.y - 1,
                body.width + 2,
                body.height + downSnap + 2,
                { isNotEmpty: true }
            );

            for (const tile of tiles) {
                const isLeftRamp = this.level.rampLeftGids.has(tile.index);
                const isRightRamp = this.level.rampRightGids.has(tile.index);
                const isCeilingLeft = this.level.ceilingRampLeftGids.has(tile.index);
                const isCeilingRight = this.level.ceilingRampRightGids.has(tile.index);
                if (!isLeftRamp && !isRightRamp && !isCeilingLeft && !isCeilingRight) {
                    continue;
                }

                const tileLeft = tile.getLeft();
                const tileRight = tile.getRight();
                const tileTop = tile.getTop();
                const tileBottom = tile.getBottom();
                const tileWidth = tileRight - tileLeft;
                const tileHeight = tileBottom - tileTop;

                if (tileWidth <= 0 || tileHeight <= 0) continue;

                // Must overlap horizontally with this ramp tile
                if (body.right <= tileLeft || body.position.x >= tileRight) {
                    continue;
                }

                if (isCeilingLeft || isCeilingRight) {
                    // 1. Flat top surface when standing/landing on top of an upside-down ramp
                    if (
                        prevBottom <= tileTop + 4 &&
                        body.bottom > tileTop &&
                        body.velocity.y >= 0
                    ) {
                        bestRampY =
                            bestRampY === null ? tileTop : Math.min(bestRampY, tileTop);
                        continue;
                    }

                    // 2. Exposed vertical back-wall on the solid side of the ceiling corner
                    if (
                        isCeilingLeft &&
                        prevLeft >= tileRight - 2 &&
                        body.position.y < tileBottom - 12 &&
                        body.bottom > tileTop
                    ) {
                        body.position.x = tileRight;
                        body.updateCenter();
                        if (body.velocity.x < 0) body.velocity.x = 0;
                        body.blocked.left = true;
                        body.blocked.none = false;
                        continue;
                    }

                    if (
                        isCeilingRight &&
                        prevRight <= tileLeft + 2 &&
                        body.position.y < tileBottom - 12 &&
                        body.bottom > tileTop
                    ) {
                        body.position.x = tileLeft - body.width;
                        body.updateCenter();
                        if (body.velocity.x > 0) body.velocity.x = 0;
                        body.blocked.right = true;
                        body.blocked.none = false;
                        continue;
                    }

                    // 3. 45-degree sloped underside ceiling collision
                    let ceilY: number;
                    if (isCeilingLeft) {
                        // Solid top-right: underside falls from (tileLeft, tileTop) to (tileRight, tileBottom)
                        const sampleX = Phaser.Math.Clamp(body.right, tileLeft, tileRight);
                        const t = (sampleX - tileLeft) / tileWidth;
                        ceilY = tileTop + t * tileHeight;
                    } else {
                        // Solid top-left: underside rises from (tileLeft, tileBottom) to (tileRight, tileTop)
                        const sampleX = Phaser.Math.Clamp(body.position.x, tileLeft, tileRight);
                        const t = (sampleX - tileLeft) / tileWidth;
                        ceilY = tileBottom - t * tileHeight;
                    }

                    if (
                        body.velocity.y <= 0 &&
                        prevTop >= tileTop - 4 &&
                        body.position.y < ceilY &&
                        body.bottom > ceilY
                    ) {
                        bestCeilingY =
                            bestCeilingY === null ? ceilY : Math.max(bestCeilingY, ceilY);
                    }
                    continue;
                }

                // 1. Flat underside ceiling collision when jumping up into a ramp from below
                if (
                    prevTop >= tileBottom - 2 &&
                    body.position.y < tileBottom &&
                    body.bottom > tileBottom
                ) {
                    body.position.y = tileBottom;
                    body.updateCenter();
                    if (body.velocity.y < 0) body.velocity.y = 0;
                    body.blocked.up = true;
                    body.blocked.none = false;
                    continue;
                }

                // 2. Exposed vertical back-wall collision for standalone ramps
                if (
                    isLeftRamp &&
                    prevLeft >= tileRight - 2 &&
                    body.bottom > tileTop + 12 &&
                    body.position.y < tileBottom
                ) {
                    body.position.x = tileRight;
                    body.updateCenter();
                    if (body.velocity.x < 0) body.velocity.x = 0;
                    body.blocked.left = true;
                    body.blocked.none = false;
                    continue;
                }

                if (
                    isRightRamp &&
                    prevRight <= tileLeft + 2 &&
                    body.bottom > tileTop + 12 &&
                    body.position.y < tileBottom
                ) {
                    body.position.x = tileLeft - body.width;
                    body.updateCenter();
                    if (body.velocity.x > 0) body.velocity.x = 0;
                    body.blocked.right = true;
                    body.blocked.none = false;
                    continue;
                }

                // 3. Calculate slope surface Y at the leading edge of the player's footprint
                let rampY: number;
                if (isLeftRamp) {
                    // '/' ramp: rises from bottom-left (tileLeft, tileBottom) to top-right (tileRight, tileTop)
                    const sampleX = Phaser.Math.Clamp(body.right, tileLeft, tileRight);
                    const t = (sampleX - tileLeft) / tileWidth;
                    rampY = tileBottom - t * tileHeight;
                } else {
                    // '\' ramp: falls from top-left (tileLeft, tileTop) to bottom-right (tileRight, tileBottom)
                    const sampleX = Phaser.Math.Clamp(body.position.x, tileLeft, tileRight);
                    const t = (sampleX - tileLeft) / tileWidth;
                    rampY = tileTop + t * tileHeight;
                }

                // Do not pull the player down if they are jumping upward away from the slope
                if (body.velocity.y < 0 && prevBottom > rampY + 4) {
                    continue;
                }

                if (
                    body.bottom >= rampY - downSnap &&
                    body.bottom <= rampY + upSnap &&
                    prevBottom <= tileBottom + 4
                ) {
                    bestRampY =
                        bestRampY === null ? rampY : Math.min(bestRampY, rampY);
                }
            }
        }

        if (bestRampY !== null) {
            body.position.y = bestRampY - body.height;
            body.updateCenter();
            if (body.velocity.y > 0) {
                body.velocity.y = 0;
            }
            body.blocked.down = true;
            body.blocked.none = false;
            body.touching.down = true;
            body.touching.none = false;
        }

        if (bestCeilingY !== null) {
            body.position.y = bestCeilingY;
            body.updateCenter();
            if (body.velocity.y < 0) {
                body.velocity.y = 0;
            }
            body.blocked.up = true;
            body.blocked.none = false;
            body.touching.up = true;
            body.touching.none = false;
        }
    }
}
