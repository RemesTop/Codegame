import * as Phaser from 'phaser';
import { LoadedLevel } from './LevelLoader';

interface ActiveCeilingHit {
    ceilY: number;
    penetration: number;
    /** Horizontal push direction out of the solid ceiling triangle: -1 for '\' (solid top-right), +1 for '/' (solid top-left). */
    pushDirX: -1 | 1;
}

/**
 * Handles Arcade Physics collisions against a loaded Tiled level, supporting:
 * 1. 45-degree left-facing ('/') and right-facing ('\') floor ramp tiles.
 * 2. Full 64x64 solid tiles and closed doors via Phaser's AABB collision.
 * 3. 45-degree ceiling-ramp undersides with smooth momentum-preserving sliding
 *    and post-ceiling solid/door separation so the player can never be pushed
 *    through floors or closed doors.
 */
export class TilemapCollider {
    private scene: Phaser.Scene;
    private sprite: Phaser.Physics.Arcade.Sprite;
    private level: LoadedLevel;
    private solidGidSet: Set<number>;
    private getBlockingObjects?: () => Phaser.GameObjects.GameObject[];
    private wasOnGround: boolean = false;
    private attached: boolean = false;

    constructor(
        scene: Phaser.Scene,
        sprite: Phaser.Physics.Arcade.Sprite,
        level: LoadedLevel,
        getBlockingObjects?: () => Phaser.GameObjects.GameObject[]
    ) {
        this.scene = scene;
        this.sprite = sprite;
        this.level = level;
        this.solidGidSet = new Set(level.solidGids ?? []);
        this.getBlockingObjects = getBlockingObjects;
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
        this.solidGidSet = new Set(level.solidGids ?? []);
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

        const prevLeft = body.prev.x;
        const prevRight = body.prev.x + body.width;
        const prevTop = body.prev.y;
        const prevBottom = body.prev.y + body.height;

            // Pass 1: Resolve 45-degree floor ramps before solid tiles so ramp-to-solid seams never snag
            this.resolveFloorRamps(body, prevLeft, prevRight, prevTop, prevBottom);

            // Pass 2: Resolve standard solid AABB tiles and closed doors
            this.collideSolidsAndDoors();

            // Pass 3: Resolve 45-degree ceiling undersides with momentum-preserving slide.
            // If adjusted while airborne, re-run solid/door collision and resolve any tight
            // floor-to-ceiling wedge horizontally so the player can never be shoved through
            // a solid floor or closed door.
            const ceilingHit = this.findDeepestCeilingHit(body, prevTop);
            if (ceilingHit) {
                this.applyCeilingResolution(body, prevTop, ceilingHit);
                this.collideSolidsAndDoors();

                // If floor/door collision pushed the player back up into the ceiling wedge,
                // push horizontally out of the wedge without touching Y.
                const postHit = this.findDeepestCeilingHit(body, prevTop);
                if (postHit && body.blocked.down) {
                    body.position.x += postHit.pushDirX * postHit.penetration;
                    body.updateCenter();
                    if (postHit.pushDirX < 0 && body.velocity.x > 0) {
                        body.velocity.x = 0;
                        body.blocked.right = true;
                        body.blocked.none = false;
                    } else if (postHit.pushDirX > 0 && body.velocity.x < 0) {
                        body.velocity.x = 0;
                        body.blocked.left = true;
                        body.blocked.none = false;
                    }
                    this.collideSolidsAndDoors();
                }
            }

            // Remember grounded state for smooth downhill slope snapping on the next step
            this.wasOnGround = body.blocked.down;
        }

    private collideSolidsAndDoors(): void {
        for (const layer of this.level.collidingLayers) {
            this.scene.physics.world.collide(this.sprite, layer);
        }
        const blockers = this.getBlockingObjects?.();
        if (blockers) {
            for (const obj of blockers) {
                this.scene.physics.world.collide(this.sprite, obj);
            }
        }
    }

    /**
     * Returns true when tile (tx, ty) contains a solid, floor-ramp, or ceiling-ramp tile,
     * meaning the shared edge between (tx, ty) and an adjacent ramp is internal (not exposed to air).
     */
    private isNeighborOccupied(
        layer: Phaser.Tilemaps.TilemapLayer,
        tx: number,
        ty: number
    ): boolean {
        if (typeof layer.getTileAt !== 'function') {
            return false;
        }
        const neighbor = layer.getTileAt(tx, ty);
        if (!neighbor || neighbor.index <= 0) {
            return false;
        }
        const gid = neighbor.index;
        return (
            this.solidGidSet.has(gid) ||
            this.level.rampLeftGids.has(gid) ||
            this.level.rampRightGids.has(gid) ||
            this.level.ceilingRampLeftGids.has(gid) ||
            this.level.ceilingRampRightGids.has(gid)
        );
    }

    private resolveFloorRamps(
        body: Phaser.Physics.Arcade.Body,
        prevLeft: number,
        prevRight: number,
        prevTop: number,
        prevBottom: number
    ): void {
        if (
            this.level.rampLeftGids.size === 0 &&
            this.level.rampRightGids.size === 0 &&
            this.level.ceilingRampLeftGids.size === 0 &&
            this.level.ceilingRampRightGids.size === 0
        ) {
            return;
        }

        // Downhill snap keeps the player glued to 45-degree slopes when walking down
        const downSnap =
            this.wasOnGround && body.velocity.y >= 0
                    ? Math.min(20, Math.abs(body.deltaX()) + 6)
                    : 0;
        const upSnap = Math.max(
            32,
            Math.abs(body.deltaX()) + Math.abs(body.deltaY()) + 16
        );

        let bestRampY: number | null = null;

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

                if (body.right <= tileLeft || body.position.x >= tileRight) {
                    continue;
                }

                if (isCeilingLeft || isCeilingRight) {
                    // 1. Exposed flat top surface of a standalone ceiling-ramp tile
                    if (
                        !this.isNeighborOccupied(layer, tile.x, tile.y - 1) &&
                        prevBottom <= tileTop + 4 &&
                        body.bottom > tileTop &&
                        body.velocity.y >= 0
                    ) {
                        bestRampY =
                            bestRampY === null ? tileTop : Math.min(bestRampY, tileTop);
                        continue;
                    }

                    // 2. Exposed vertical back-wall on the solid side of a standalone ceiling-ramp
                    if (
                        isCeilingLeft &&
                        !this.isNeighborOccupied(layer, tile.x + 1, tile.y) &&
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
                        !this.isNeighborOccupied(layer, tile.x - 1, tile.y) &&
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

                    continue;
                }

                // 1. Exposed flat underside when jumping up into a standalone floor ramp from below
                if (
                    !this.isNeighborOccupied(layer, tile.x, tile.y + 1) &&
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

                // 2. Exposed vertical back-wall only when no neighboring tile adjoins that side
                if (
                    isLeftRamp &&
                    !this.isNeighborOccupied(layer, tile.x + 1, tile.y) &&
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
                    !this.isNeighborOccupied(layer, tile.x - 1, tile.y) &&
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

                // 3. Calculate 45-degree slope surface Y at the leading edge of the player's footprint
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
    }

    private findDeepestCeilingHit(
                body: Phaser.Physics.Arcade.Body,
                prevTop: number
            ): ActiveCeilingHit | null {
                if (
                    this.level.ceilingRampLeftGids.size === 0 &&
                    this.level.ceilingRampRightGids.size === 0
                ) {
                    return null;
                }

                const maxHorizontalStep = Math.abs(body.deltaX()) + 6;
                let deepest: ActiveCeilingHit | null = null;

                for (const layer of this.level.collidingLayers) {
                    const tiles = layer.getTilesWithinWorldXY(
                        body.position.x - 1,
                        body.position.y - 1,
                        body.width + 2,
                        body.height + 2,
                        { isNotEmpty: true }
                    );

                    for (const tile of tiles) {
                        const isCeilingLeft = this.level.ceilingRampLeftGids.has(tile.index);
                        const isCeilingRight = this.level.ceilingRampRightGids.has(tile.index);
                        if (!isCeilingLeft && !isCeilingRight) {
                            continue;
                        }

                                const tileLeft = tile.getLeft();
                                const tileRight = tile.getRight();
                                const tileTop = tile.getTop();
                                const tileBottom = tile.getBottom();
                                const tileWidth = tileRight - tileLeft;
                                const tileHeight = tileBottom - tileTop;

                                if (tileWidth <= 0 || tileHeight <= 0) continue;
                                if (body.right <= tileLeft || body.position.x >= tileRight) continue;

                                let ceilY: number;
                                let pushDirX: -1 | 1;
                                if (isCeilingLeft) {
                                    // '\' underside: solid top-right, open air down-left (-X)
                                    const sampleX = Phaser.Math.Clamp(body.right, tileLeft, tileRight);
                                    const t = (sampleX - tileLeft) / tileWidth;
                                    ceilY = tileTop + t * tileHeight;
                                    pushDirX = -1;
                                } else {
                                    // '/' underside: solid top-left, open air down-right (+X)
                                    const sampleX = Phaser.Math.Clamp(body.position.x, tileLeft, tileRight);
                                    const t = (sampleX - tileLeft) / tileWidth;
                                    ceilY = tileBottom - t * tileHeight;
                                    pushDirX = 1;
                                }

                                // Ignore ceiling tiles below the player's feet when walking on top of a ramp bridge
                                if (
                                    prevTop >= tileTop - maxHorizontalStep &&
                                    body.position.y < ceilY &&
                                    body.bottom > ceilY
                                ) {
                                    const penetration = ceilY - body.position.y;
                                    if (!deepest || penetration > deepest.penetration) {
                                        deepest = { ceilY, penetration, pushDirX };
                                    }
                                }
                            }
                        }

                        return deepest;
                    }

    private applyCeilingResolution(
                        body: Phaser.Physics.Arcade.Body,
                        prevTop: number,
                        hit: ActiveCeilingHit
                    ): void {
                        const { ceilY, penetration, pushDirX } = hit;

                        if(body.blocked.down) {
                        // Player is standing on a solid floor or floor-ramp: push purely horizontally
                        // out of the low ceiling wedge without touching Y.
                        body.position.x += pushDirX * penetration;
                        body.updateCenter();
                        if (pushDirX < 0 && body.velocity.x > 0) {
                            body.velocity.x = 0;
                            body.blocked.right = true;
                            body.blocked.none = false;
                        } else if (pushDirX > 0 && body.velocity.x < 0) {
                            body.velocity.x = 0;
                            body.blocked.left = true;
                            body.blocked.none = false;
                        }
                        return;
                    }

                    // Airborne: slide smoothly along the 45-degree ceiling underside without killing
                    // horizontal momentum, provided the downward step stays small (<= 16px, well
                    // within tileBias=32 so any floor below separates cleanly).
                    if (ceilY - prevTop <= 16) {
                        body.position.y = ceilY;
                        body.updateCenter();

                        // Deflect upward velocity along the 45-degree slope instead of zeroing vx:
                        // - Moving toward the rising side of the ceiling: vy can keep rising at |vx|.
                        // - Moving straight up or toward the descending side: vy follows the slope downward.
                        const movingUpSlope =
                            (pushDirX === 1 && body.velocity.x > 0) ||
                            (pushDirX === -1 && body.velocity.x < 0);
                        const minAllowedVy = movingUpSlope
                            ? -Math.abs(body.velocity.x)
                            : pushDirX * body.velocity.x < 0
                                ? Math.abs(body.velocity.x) * 0.35
                                : 0;

                        if (body.velocity.y < minAllowedVy) {
                            body.velocity.y = minAllowedVy;
                        }

                        body.blocked.up = true;
                        body.blocked.none = false;
                        body.touching.up = true;
                        body.touching.none = false;
                    } else {
                        // Large sideways overlap fallback: push horizontally out of the triangle
                        body.position.x += pushDirX * penetration;
                        body.updateCenter();
                    }
                }
            }
