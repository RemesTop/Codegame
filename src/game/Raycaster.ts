import * as Phaser from 'phaser';
import { LoadedLevel } from './LevelLoader';

export type DetectTargetType = 'any' | 'ground' | 'goal' | string;

export interface DetectObjectTarget {
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface RaycastHit {
    distance: number;
    x: number;
    y: number;
    type: string;
}

interface Point2D {
    x: number;
    y: number;
}

/**
 * Normalizes any angle in degrees into [0, 360).
 * - 0 = straight right
 * - 90 = straight up
 * - 180 = straight left
 * - 270 = straight down
 * - Negative angles wrap clockwise (e.g. -10 -> 350)
 * - Angles >= 360 wrap around (e.g. 370 -> 10)
 */
export function normalizeAngle(angle: number = 0): number {
    const numeric = Number(angle);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    const wrapped = ((numeric % 360) + 360) % 360;
    return wrapped === 360 ? 0 : wrapped;
}

/**
 * Converts a normalized angle (0 = right, 90 = up) into a unit direction vector
 * in Phaser world coordinates (+X right, +Y down).
 */
export function angleToDirection(angle: number = 0): { dx: number; dy: number } {
    const normalized = normalizeAngle(angle);
    const rad = (normalized * Math.PI) / 180;
    const rawDx = Math.cos(rad);
    const rawDy = -Math.sin(rad);

    // Snap near-zero components on cardinal angles to exact 0
    return {
        dx: Math.abs(rawDx) < 1e-12 ? 0 : rawDx,
        dy: Math.abs(rawDy) < 1e-12 ? 0 : rawDy,
    };
}

/**
 * Computes the nearest intersection distance t >= 0 between a ray (origin + t * dir)
 * and an axis-aligned bounding box [minX, maxX] x [minY, maxY].
 * Returns null if the ray misses the box.
 */
export function rayIntersectAABB(
    originX: number,
    originY: number,
    dirX: number,
    dirY: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
): number | null {
    let txMin: number;
    let txMax: number;

    if (dirX === 0) {
        if (originX < minX || originX > maxX) return null;
        txMin = -Infinity;
        txMax = Infinity;
    } else {
        const invX = 1 / dirX;
        const t1 = (minX - originX) * invX;
        const t2 = (maxX - originX) * invX;
        txMin = Math.min(t1, t2);
        txMax = Math.max(t1, t2);
    }

    let tyMin: number;
    let tyMax: number;

    if (dirY === 0) {
        if (originY < minY || originY > maxY) return null;
        tyMin = -Infinity;
        tyMax = Infinity;
    } else {
        const invY = 1 / dirY;
        const t1 = (minY - originY) * invY;
        const t2 = (maxY - originY) * invY;
        tyMin = Math.min(t1, t2);
        tyMax = Math.max(t1, t2);
    }

    const tEnter = Math.max(txMin, tyMin);
    const tExit = Math.min(txMax, tyMax);

    if (tExit < 0 || tEnter > tExit) {
        return null;
    }

    return tEnter >= 0 ? tEnter : 0;
}

/**
 * Computes the intersection distance t >= 0 between a ray and a 2D line segment (p1 -> p2).
 */
function rayIntersectSegment(
    originX: number,
    originY: number,
    dirX: number,
    dirY: number,
    p1: Point2D,
    p2: Point2D
): number | null {
    const edgeX = p2.x - p1.x;
    const edgeY = p2.y - p1.y;
    const denom = dirX * edgeY - dirY * edgeX;

    if (Math.abs(denom) < 1e-9) {
        return null;
    }

    const wx = p1.x - originX;
    const wy = p1.y - originY;

    const t = (wx * edgeY - wy * edgeX) / denom;
    const u = (wx * dirY - wy * dirX) / denom;

    if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9) {
        return t;
    }
    return null;
}

/**
 * Checks whether a point lies inside (or on the boundary of) a 2D triangle.
 */
function isPointInTriangle(p: Point2D, a: Point2D, b: Point2D, c: Point2D): boolean {
    const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
    const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
    const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);

    const hasNeg = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
    const hasPos = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;

    return !(hasNeg && hasPos);
}

/**
 * Computes the nearest intersection distance t >= 0 between a ray and a solid 2D triangle.
 */
export function rayIntersectTriangle(
    originX: number,
    originY: number,
    dirX: number,
    dirY: number,
    a: Point2D,
    b: Point2D,
    c: Point2D
): number | null {
    if (isPointInTriangle({ x: originX, y: originY }, a, b, c)) {
        return 0;
    }

    const hits = [
        rayIntersectSegment(originX, originY, dirX, dirY, a, b),
        rayIntersectSegment(originX, originY, dirX, dirY, b, c),
        rayIntersectSegment(originX, originY, dirX, dirY, c, a),
    ];

    let best: number | null = null;
    for (const t of hits) {
        if (t !== null && (best === null || t < best)) {
            best = t;
        }
    }
    return best;
}

/**
 * Computes how far a ray travels from (originX, originY) until it exits the level bounds.
 */
function computeMaxRayDistance(
    originX: number,
    originY: number,
    dirX: number,
    dirY: number,
    mapWidth: number,
    mapHeight: number
): number {
    let tExit = Infinity;

    if (dirX > 0) {
        tExit = Math.min(tExit, (mapWidth - originX) / dirX);
    } else if (dirX < 0) {
        tExit = Math.min(tExit, (0 - originX) / dirX);
    }

    if (dirY > 0) {
        tExit = Math.min(tExit, (mapHeight - originY) / dirY);
    } else if (dirY < 0) {
        tExit = Math.min(tExit, (0 - originY) / dirY);
    }

    if (!Number.isFinite(tExit) || tExit <= 0) {
        return Math.hypot(mapWidth, mapHeight);
    }

    return tExit;
}

/**
 * Performs an exact raycast against colliding tilemap layers (solid tiles + 45-degree ramps)
 * and rectangular scene objects (such as the level goal).
 */
export function castRay(
    originX: number,
    originY: number,
    angle: number,
    level: LoadedLevel,
    objects: DetectObjectTarget[] = []
): { hit: RaycastHit | null; endX: number; endY: number } {
    const { dx, dy } = angleToDirection(angle);
    const mapWidth = level.map.widthInPixels;
    const mapHeight = level.map.heightInPixels;
    const maxDistance = computeMaxRayDistance(originX, originY, dx, dy, mapWidth, mapHeight);

    let bestDistance = maxDistance;
    let bestHit: RaycastHit | null = null;

    // 0. Treat the left (x = 0) and right (x = mapWidth) edges of the level as solid 'ground'
    if (dx !== 0) {
        const edgeX = dx < 0 ? 0 : mapWidth;
        const tEdge = (edgeX - originX) / dx;
        if (tEdge >= 0 && tEdge <= maxDistance + 1e-6) {
            const hitY = originY + dy * tEdge;
            if (hitY >= 0 && hitY <= mapHeight) {
                bestDistance = tEdge;
                bestHit = {
                    distance: tEdge,
                    x: edgeX,
                    y: hitY,
                    type: 'ground',
                };
            }
        }
    }

    // 1. Check rectangular scene objects (e.g. goal)
    for (const obj of objects) {
        const t = rayIntersectAABB(
            originX,
            originY,
            dx,
            dy,
            obj.x,
            obj.y,
            obj.x + obj.width,
            obj.y + obj.height
        );
        if (t !== null && t < bestDistance) {
            bestDistance = t;
            bestHit = {
                distance: t,
                x: originX + dx * t,
                y: originY + dy * t,
                type: obj.type.toLowerCase(),
            };
        }
    }

    // 2. Traverse colliding tile layers using 2D grid DDA (Amanatides & Woo)
    const tileW = level.map.tileWidth;
    const tileH = level.map.tileHeight;
    const mapCols = level.map.width;
    const mapRows = level.map.height;
    const solidGidSet = new Set<number>(level.solidGids);

    if (tileW > 0 && tileH > 0 && level.collidingLayers.length > 0) {
        let col = Math.floor(originX / tileW);
        let row = Math.floor(originY / tileH);

        const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
        const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

        const tDeltaX = dx !== 0 ? Math.abs(tileW / dx) : Infinity;
        const tDeltaY = dy !== 0 ? Math.abs(tileH / dy) : Infinity;

        let tMaxX =
            dx > 0
                ? ((col + 1) * tileW - originX) / dx
                : dx < 0
                    ? (col * tileW - originX) / dx
                    : Infinity;
        let tMaxY =
            dy > 0
                ? ((row + 1) * tileH - originY) / dy
                : dy < 0
                    ? (row * tileH - originY) / dy
                    : Infinity;

        let tCurrent = 0;
        const maxSteps = (mapCols + mapRows) * 2 + 4;

        for (let step = 0; step < maxSteps && tCurrent <= bestDistance; step++) {
            if (col >= 0 && col < mapCols && row >= 0 && row < mapRows) {
                const tileLeft = col * tileW;
                const tileTop = row * tileH;
                const tileRight = tileLeft + tileW;
                const tileBottom = tileTop + tileH;

                for (const layer of level.collidingLayers) {
                    const tile = layer.getTileAt(col, row);
                    if (!tile || tile.index < 0) continue;

                    let t: number | null = null;

                    if (solidGidSet.has(tile.index)) {
                        t = rayIntersectAABB(
                            originX,
                            originY,
                            dx,
                            dy,
                            tileLeft,
                            tileTop,
                            tileRight,
                            tileBottom
                        );
                    } else if (level.rampLeftGids.has(tile.index)) {
                        // '/' floor ramp: solid bottom-right triangle
                        t = rayIntersectTriangle(
                            originX,
                            originY,
                            dx,
                            dy,
                            { x: tileLeft, y: tileBottom },
                            { x: tileRight, y: tileTop },
                            { x: tileRight, y: tileBottom }
                        );
                    } else if (level.rampRightGids.has(tile.index)) {
                        // '\' floor ramp: solid bottom-left triangle
                        t = rayIntersectTriangle(
                            originX,
                            originY,
                            dx,
                            dy,
                            { x: tileLeft, y: tileTop },
                            { x: tileRight, y: tileBottom },
                            { x: tileLeft, y: tileBottom }
                        );
                    } else if (level.ceilingRampLeftGids.has(tile.index)) {
                        // Upside-down ceiling corner: solid top-right triangle
                        t = rayIntersectTriangle(
                            originX,
                            originY,
                            dx,
                            dy,
                            { x: tileLeft, y: tileTop },
                            { x: tileRight, y: tileTop },
                            { x: tileRight, y: tileBottom }
                        );
                    } else if (level.ceilingRampRightGids.has(tile.index)) {
                        // Upside-down ceiling corner: solid top-left triangle
                        t = rayIntersectTriangle(
                            originX,
                            originY,
                            dx,
                            dy,
                            { x: tileLeft, y: tileTop },
                            { x: tileRight, y: tileTop },
                            { x: tileLeft, y: tileBottom }
                        );
                    }

                    if (t !== null && t < bestDistance) {
                        bestDistance = t;
                        bestHit = {
                            distance: t,
                            x: originX + dx * t,
                            y: originY + dy * t,
                            type: 'ground',
                        };
                    }
                }
            }

            if (tMaxX < tMaxY) {
                tCurrent = tMaxX;
                tMaxX += tDeltaX;
                col += stepX;
            } else if (tMaxY < tMaxX) {
                tCurrent = tMaxY;
                tMaxY += tDeltaY;
                row += stepY;
            } else {
                tCurrent = tMaxX;
                tMaxX += tDeltaX;
                tMaxY += tDeltaY;
                col += stepX;
                row += stepY;
            }
        }
    }

    const endX = bestHit ? bestHit.x : originX + dx * maxDistance;
    const endY = bestHit ? bestHit.y : originY + dy * maxDistance;

    return { hit: bestHit, endX, endY };
}

/**
 * Manages raycasting and fading visual ray lines inside a Phaser scene.
 */
export class Raycaster {
    private scene: Phaser.Scene;
    private activeVisuals: Map<number, Phaser.GameObjects.Graphics> = new Map();
    private lastVisualTimeByAngle: Map<number, number> = new Map();
    private readonly fadeDurationMs: number = 260;
    private readonly visualCooldownMs: number = 300;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    /**
     * Casts a ray from (originX, originY) at the given angle (0 = right, 90 = up).
     * - Without `maxDistance`: returns the rounded pixel distance if the first hit matches
     *   `type` (or `'any'`), otherwise `undefined`. Draws a fading white line on hit.
     * - With `maxDistance`: returns `true` if a matching hit is within `maxDistance` pixels,
     *   otherwise `false`. Draws a fading white line only when `true`.
     */
    public detect(
        originX: number,
        originY: number,
        level: LoadedLevel | null,
        objects: DetectObjectTarget[] = [],
        angle: number = 0,
        type: DetectTargetType = 'any',
        maxDistance?: number
    ): number | boolean | undefined {
        const hasDistanceLimit = maxDistance !== undefined;

        if (!level) {
            return hasDistanceLimit ? false : undefined;
        }

        const normalizedAngle = normalizeAngle(angle);
        const normalizedType =
            typeof type === 'string' && type.trim() !== ''
                ? type.trim().toLowerCase()
                : 'any';

        const { hit, endX, endY } = castRay(originX, originY, normalizedAngle, level, objects);

        if (!hit || (normalizedType !== 'any' && hit.type !== normalizedType)) {
            return hasDistanceLimit ? false : undefined;
        }

        const roundedDistance = Math.round(hit.distance);

        if (hasDistanceLimit) {
            const limit = Number(maxDistance);
            if (!Number.isFinite(limit) || roundedDistance > limit) {
                return false;
            }
            this.drawFadingRay(normalizedAngle, originX, originY, endX, endY);
            return true;
        }

        this.drawFadingRay(normalizedAngle, originX, originY, endX, endY);
        return roundedDistance;
    }

    private drawFadingRay(
        normalizedAngle: number,
        startX: number,
        startY: number,
        endX: number,
        endY: number
    ): void {
        if (!this.scene.add?.graphics) {
            return;
        }

        // Throttle visual pulses per angle so repeated update() ticks don't spam the screen
        const now = this.scene.time?.now ?? Date.now();
        const lastDrawn = this.lastVisualTimeByAngle.get(normalizedAngle);
        if (lastDrawn !== undefined && now - lastDrawn < this.visualCooldownMs) {
            return;
        }
        this.lastVisualTimeByAngle.set(normalizedAngle, now);

        const existing = this.activeVisuals.get(normalizedAngle);
        if (existing) {
            this.scene.tweens?.killTweensOf(existing);
            existing.destroy();
            this.activeVisuals.delete(normalizedAngle);
        }

        const gfx = this.scene.add.graphics();
        gfx.setDepth(15);
        gfx.lineStyle(2, 0xffffff, 0.9);
        gfx.lineBetween(startX, startY, endX, endY);
        this.activeVisuals.set(normalizedAngle, gfx);

        if (this.scene.tweens?.add) {
            this.scene.tweens.add({
                targets: gfx,
                alpha: 0,
                duration: this.fadeDurationMs,
                ease: 'Quad.easeOut',
                onComplete: () => {
                    if (this.activeVisuals.get(normalizedAngle) === gfx) {
                        this.activeVisuals.delete(normalizedAngle);
                    }
                    gfx.destroy();
                },
            });
        }
    }

    /**
     * Immediately removes all active fading ray visuals (e.g. on Stop, Reset, or level change).
     */
    public clearVisuals(): void {
        for (const gfx of this.activeVisuals.values()) {
            this.scene.tweens?.killTweensOf(gfx);
            gfx.destroy();
        }
        this.activeVisuals.clear();
        this.lastVisualTimeByAngle.clear();
    }

    public destroy(): void {
        this.clearVisuals();
    }
}
