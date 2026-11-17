import * as Phaser from 'phaser';
import {
    getLevelDefinition,
    LevelDefinition,
    TiledLayerJson,
    TiledProperty,
    TILESETS,
} from './Levels/levels';

export interface LoadedLevel {
    definition: LevelDefinition;
    map: Phaser.Tilemaps.Tilemap;
    layers: Phaser.Tilemaps.TilemapLayer[];
    collidingLayers: Phaser.Tilemaps.TilemapLayer[];
    solidGids: number[];
    rampLeftGids: Set<number>;
    rampRightGids: Set<number>;
    spawn: { x: number; y: number };
    destroy: () => void;
}

function getPropertyBoolean(
    properties: TiledProperty[] | undefined,
    name: string,
    fallback: boolean
): boolean {
    const match = properties?.find((prop) => prop.name === name);
    if (match && typeof match.value === 'boolean') {
        return match.value;
    }
    return fallback;
}

/**
 * Collects all tile layers from a Tiled map (including nested group layers)
 * in render order, along with whether each layer participates in physics collisions.
 */
function collectTileLayerMeta(
    layers: TiledLayerJson[],
    prefix: string = ''
): Array<{ fullName: string; collides: boolean }> {
    const result: Array<{ fullName: string; collides: boolean }> = [];

    for (const layer of layers) {
        if (layer.type === 'group' && layer.layers) {
            result.push(...collectTileLayerMeta(layer.layers, `${prefix}${layer.name}/`));
        } else if (layer.type === 'tilelayer') {
            result.push({
                fullName: `${prefix}${layer.name}`,
                collides: getPropertyBoolean(layer.properties, 'collides', true),
            });
        }
    }

    return result;
}

function findSpawnFromObjects(
    map: Phaser.Tilemaps.Tilemap,
    fallback: { x: number; y: number }
): { x: number; y: number } {
    for (const objectLayer of map.objects) {
        for (const obj of objectLayer.objects) {
            const objName = (obj.name ?? '').toLowerCase();
            const objType = (obj.type ?? '').toLowerCase();
            if (objName === 'spawn' || objName === 'player' || objType === 'spawn') {
                if (typeof obj.x === 'number' && typeof obj.y === 'number') {
                    return { x: obj.x, y: obj.y };
                }
            }
        }
    }
    return { ...fallback };
}

/**
 * Loads Tiled JSON levels (with embedded tilesets) and 32x32 tilesets into a Phaser scene.
 */
export class LevelLoader {
    /**
     * Preloads all registered tileset textures into Phaser's texture cache.
     * Expects `scene.load.setPath('assets')` to already be configured.
     */
    static preload(scene: Phaser.Scene): void {
        for (const tileset of Object.values(TILESETS)) {
            if (!scene.textures.exists(tileset.textureKey)) {
                scene.load.image(tileset.textureKey, tileset.imagePath);
            }
        }
    }

    /**
     * Instantiates the requested level, builds tilemap layers, applies solid tile
     * collision flags, configures world/camera bounds, and returns the LoadedLevel handle.
     */
    static load(scene: Phaser.Scene, levelId: number): LoadedLevel {
        const definition = getLevelDefinition(levelId);
        const cacheKey = `level-map-${definition.id}`;

        if (scene.cache.tilemap.exists(cacheKey)) {
            scene.cache.tilemap.remove(cacheKey);
        }
        scene.cache.tilemap.add(cacheKey, {
            format: Phaser.Tilemaps.Formats.TILED_JSON,
            data: definition.mapData,
        });

        const map = scene.make.tilemap({ key: cacheKey });

        const phaserTilesets: Phaser.Tilemaps.Tileset[] = [];
        const solidGids: number[] = [];
        const rampLeftGids = new Set<number>();
        const rampRightGids = new Set<number>();

        for (const mapTileset of map.tilesets) {
            const config = TILESETS[mapTileset.name];
            if (!config) {
                throw new Error(`Missing tileset config for "${mapTileset.name}".`);
            }

            const added = map.addTilesetImage(
                mapTileset.name,
                config.textureKey,
                config.tileWidth,
                config.tileHeight,
                config.margin ?? 0,
                config.spacing ?? 0
            );

            if (!added) {
                throw new Error(`Failed to attach tileset image "${config.textureKey}" to map.`);
            }
            phaserTilesets.push(added);

            // Convert 0-based local tile indices into Tiled GIDs for this tileset
            for (const [localIndexStr, shape] of Object.entries(config.tileShapes)) {
                const gid = added.firstgid + Number(localIndexStr);
                if (shape === 'solid') {
                    solidGids.push(gid);
                } else if (shape === 'ramp-left') {
                    rampLeftGids.add(gid);
                } else if (shape === 'ramp-right') {
                    rampRightGids.add(gid);
                }
            }
        }

        const layerMeta = collectTileLayerMeta(definition.mapData.layers);
        const layers: Phaser.Tilemaps.TilemapLayer[] = [];
        const collidingLayers: Phaser.Tilemaps.TilemapLayer[] = [];

        for (const meta of layerMeta) {
            const layer = map.createLayer(meta.fullName, phaserTilesets, 0, 0, false);
            if (!(layer instanceof Phaser.Tilemaps.TilemapLayer)) {
                continue;
            }
            layers.push(layer);

            if (meta.collides) {
                // Only full solid tiles are marked colliding in Phaser's face calculator;
                // 45-degree ramps are handled separately so adjacent solids keep their top/side faces.
                if (solidGids.length > 0) {
                    layer.setCollision(solidGids);
                }
                collidingLayers.push(layer);
            }
        }

        // Configure physics bounds to match level dimensions while keeping bottom open
        scene.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
        scene.physics.world.setBoundsCollision(true, true, true, false);

        // Center maps smaller than the viewport, or allow full scrolling on larger maps
        const viewWidth = scene.scale.width;
        const viewHeight = scene.scale.height;
        const boundsX = map.widthInPixels < viewWidth ? -(viewWidth - map.widthInPixels) / 2 : 0;
        const boundsY = map.heightInPixels < viewHeight ? -(viewHeight - map.heightInPixels) / 2 : 0;
        scene.cameras.main.setBounds(
            boundsX,
            boundsY,
            Math.max(map.widthInPixels, viewWidth),
            Math.max(map.heightInPixels, viewHeight)
        );

        const spawn = findSpawnFromObjects(map, definition.spawn);

        return {
            definition,
            map,
            layers,
            collidingLayers,
            solidGids,
            rampLeftGids,
            rampRightGids,
            spawn,
            destroy: () => {
                for (const layer of layers) {
                    layer.destroy();
                }
                map.destroy();
            },
        };
    }
}
