import level1Data from './Level-1.json';
import level2Data from './Level-2.json';

/**
 * Collision shape of a single tile within a 32x32 tileset.
 * Any tile not listed in `tileShapes` defaults to `'solid'`.
 * - 'solid': Full 32x32 blocking tile (default).
 * - 'none': Non-colliding pass-through tile.
 * - 'ramp-left': 45-degree floor slope facing left (rises from bottom-left to top-right).
 * - 'ramp-right': 45-degree floor slope facing right (falls from top-left to bottom-right).
 * - 'ceiling-ramp-left': 45-degree upside-down ceiling corner facing left (solid top-right, '\' underside).
 * - 'ceiling-ramp-right': 45-degree upside-down ceiling corner facing right (solid top-left, '/' underside).
 * - 'danger': Full 32x32 hazardous tile that kills the player on contact.
 */
export type TileShape =
    | 'solid'
    | 'none'
    | 'ramp-left'
    | 'ramp-right'
    | 'ceiling-ramp-left'
    | 'ceiling-ramp-right'
    | 'danger';

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
    /** Overrides for non-solid tiles (0-based local tile index -> shape). Unlisted tiles default to 'solid'. */
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
    starterCode: string;
}

const LEVEL_1_STARTER_CODE = `//Javascript
let counter = 0;
let direction = 'right';

//Track your own variable in the game HUD
track(counter);
track(direction);

//Runs once when you press run
function start() {
    moveRight();
    
    //Pause the function for 1000ms with sleep(1000)
    sleep(1200);
    jump();
    sleep(1000);
    jump();
    sleep(2000);
}

//After start() completes, update() function runs every 100ms
function update() {
    counter++;

    if (counter < 20) {
        moveLeft();
        direction = 'left';
    } else if (counter < 45) {
        jump();
        moveLeft();
        direction = 'left';
    }else {
        stop();
        direction = 'stopped';
    }
}
`;

const LEVEL_2_STARTER_CODE = `// Level 2


//track(something);

function start() {
    moveRight();
    sleep(500);    
    jump();
    sleep(1000);
    jump();
    sleep(500);

}

function update(){

}
`;

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
            2: 'ramp-left',
            3: 'ramp-right',
        },
    },
    TilesetV0: {
        name: 'TilesetV0',
        textureKey: 'TilesetV0',
        imagePath: 'tiles/TilesetV0.png',
        tileWidth: 32,
        tileHeight: 32,
        margin: 0,
        spacing: 0,
        tileShapes: {
            21: 'ramp-right',
            22: 'ramp-left',
            30: 'ceiling-ramp-left',
            31: 'ceiling-ramp-right',
            36: 'danger',
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
        starterCode: LEVEL_1_STARTER_CODE,
    },
    {
        id: 2,
        name: 'Level 2',
        mapData: level2Data as TiledMapJson,
        spawn: {
            x: 27,
            y: 907,
        },
        starterCode: LEVEL_2_STARTER_CODE,
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

/**
 * Reads the active level ID from the `?level=` URL query parameter,
 * falling back to the first level if missing or invalid.
 */
export function getLevelIdFromUrl(): number {
    if (typeof window === 'undefined') {
        return LEVELS[0].id;
    }

    const raw = new URLSearchParams(window.location.search).get('level');
    if (raw !== null && raw.trim() !== '') {
        const parsed = Number(raw);
        if (
            Number.isInteger(parsed) &&
            LEVELS.some((entry) => entry.id === parsed)
        ) {
            return parsed;
        }
    }

    return LEVELS[0].id;
}

export type AppPage = 'menu' | 'game' | 'levels' | 'instructions';

/**
 * Reads the active page from the `?page=` URL query parameter.
 */
export function getPageFromUrl(): AppPage {
    if (typeof window === 'undefined') {
        return 'game';
    }

    const raw = new URLSearchParams(window.location.search).get('page');
    if (raw === 'levels') return 'levels';
    if (raw === 'game') return 'game';
    if (raw === 'instructions') return 'instructions';
    return 'menu';
}

/**
 * Updates the browser address bar with `?level=<levelId>` (and optional `page=levels`)
 * without reloading the page.
 */
export function setLevelIdInUrl(
    levelId: number,
    replace: boolean = false,
    page: AppPage = 'game',
): void {
    if (typeof window === 'undefined') {
        return;
    }

    const url = new URL(window.location.href);
    const nextLevel = String(levelId);
    const nextPage = page;
    const alreadyMatches =
        url.searchParams.get('level') === nextLevel &&
        url.searchParams.get('page') === nextPage;

    url.searchParams.set('level', nextLevel);
    url.searchParams.set('page', nextPage);

    if (replace || alreadyMatches) {
        window.history.replaceState({ levelId, page }, '', url.toString());
    } else {
        window.history.pushState({ levelId, page }, '', url.toString());
    }
}
