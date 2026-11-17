import level1Data from './Level-1.json';

/**
 * Collision shape of a single tile within a 32x32 tileset.
 * - 'solid': Full 32x32 blocking tile.
 * - 'ramp-left': 45-degree slope facing left (rises from bottom-left to top-right).
 * - 'ramp-right': 45-degree slope facing right (falls from top-left to bottom-right).
 */
export type TileShape = 'solid' | 'ramp-left' | 'ramp-right';

export interface TilesetConfig {
    /** Tileset name matching the embedded tileset name in Tiled JSON. */
    name: string;
    /** Phaser texture cache key. */
    textureKey: string;
    /** Path relative to public/assets/. */
    imagePath: string;
    tileWidth: number;
    tileHeight: number;
    margin?: number;
    spacing?: number;
    /** Maps 0-based local tile index inside the tileset grid to its collision shape. */
    tileShapes: Record<number, TileShape>;
}

export interface TiledProperty {
    name: string;
    type?: string;
    value: unknown;
}

export interface TiledLayerJson {
    name: string;
    type: string;
    properties?: TiledProperty[];
    layers?: TiledLayerJson[];
}

export interface TiledMapJson {
    layers: TiledLayerJson[];
    [key: string]: unknown;
}

export interface LevelDefinition {
    id: number;
    name: string;
    mapData: TiledMapJson;
    spawn: {
        x: number;
        y: number;
    };
}

/**
 * Registry of all 32x32 tilesets available to levels.
 * Add new tilesets here when expanding the game with additional tile art.
 */
export const TILESETS: Record<string, TilesetConfig> = {
    Tileset1: {
        name: 'Tileset1',
        textureKey: 'Tileset1',
        imagePath: 'tiles/Tileset1.png',
        tileWidth: 32,
        tileHeight: 32,
        margin: 0,
        spacing: 0,
        tileShapes: {
            0: 'solid',
            1: 'solid',
            2: 'ramp-left',
            3: 'ramp-right',
        },
    },
};

/**
 * Ordered list of levels in the game.
 * Additional levels can be appended here and wired to a level select menu later.
 */
export const LEVELS: LevelDefinition[] = [
    {
        id: 1,
        name: 'Level 1',
        mapData: level1Data as TiledMapJson,
        spawn: {
            x: 544,
            y: 384,
        },
    },
];

/**
 * Looks up a level definition by numeric ID.
 */
export function getLevelDefinition(levelId: number): LevelDefinition {
    const level = LEVELS.find((entry) => entry.id === levelId);
    if (!level) {
        throw new Error(`Level ${levelId} is not defined in LEVELS.`);
    }
    return level;
}
