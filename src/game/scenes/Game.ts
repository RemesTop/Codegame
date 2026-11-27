import * as Phaser from 'phaser';
import { EventBus } from '../EventBus';
import { GameHUD } from '../GameHUD';
import { CodeRunner, RobotAPI } from '../CodeRunner';
import { Player } from '../Player';
import { LevelLoader, LoadedLevel } from '../LevelLoader';
import { getLevelIdFromUrl } from '../Levels/levels';
import { TilemapCollider } from '../TilemapCollider';
import { DetectObjectTarget, pixelsToUnits, Raycaster } from '../Raycaster';
import { ParallaxBackground } from '../ParallaxBackground';

interface KeycardEntity {
    sprite: Phaser.GameObjects.Image;
    baseY: number;
    collected: boolean;
}

interface DoorEntity {
    sprite: Phaser.Physics.Arcade.Image;
    collider: Phaser.Physics.Arcade.Collider;
    isOpen: boolean;
}

interface TeleportBeamBar {
    rect: Phaser.GameObjects.Rectangle;
    baseY: number;
    riseHeight: number;
    progress: number;
}

export class Game extends Phaser.Scene {
    private player!: Player;
    private currentLevelId: number = 1;
    private currentLevel: LoadedLevel | null = null;
    private tilemapCollider: TilemapCollider | null = null;
    private goalMarker: Phaser.GameObjects.Image | null = null;
    private goalTeleportBars: TeleportBeamBar[] = [];
    private keycardEntities: KeycardEntity[] = [];
    private doorEntities: DoorEntity[] = [];
    private readonly doorOpenRangeX: number = 160;
    private readonly doorOpenRangeY: number = 128;
    private isSimulating: boolean = false;
    private isDying: boolean = false;
    private isResetting: boolean = false;
    private hasRunStarted: boolean = false;
    private deathTween: Phaser.Tweens.Tween | null = null;
    private resetTween: Phaser.Tweens.Tween | null = null;
    private introPanTween: Phaser.Tweens.Tween | null = null;
    private resetOverlay: Phaser.GameObjects.Image | null = null;
    private readonly deathFadeDurationMs: number = 900;
    private readonly resetSlideHalfDurationMs: number = 350;
    private readonly introPanSpeedPxPerSec: number = 360;
    private readonly introPanMinDurationMs: number = 1400;
    private readonly introPanMaxDurationMs: number = 4500;
    private readonly introPanDelayMs: number = 200;
    private readonly fallDeathMarginPx: number = 640;
    private isPaused: boolean = false;
    private resumeAsSimulating: boolean = false;

    // --- Sub-components ---
    private hud!: GameHUD;
    private codeRunner!: CodeRunner;
    private raycaster!: Raycaster;
    private parallaxBg: ParallaxBackground | null = null;

    constructor() {
        super('Game');
    }

    preload() {
        this.load.setPath('assets');
        this.load.image('bg-sky', 'bg_neon_SKY.png');
        this.load.image('bg-city', 'bg_blue_CITY.png');
        this.load.image('keycard', 'keycard1.png');
        this.load.image('door-closed', 'Locked-door-1.png');
        this.load.image('door-open', 'Locked-door-2.png');
        this.load.image('goal-teleport', 'teleport1.png');
        Player.preload(this);
        LevelLoader.preload(this);
    }

    create() {
        // Render 64x64 tiles at 0.5x zoom on a 1024x832 canvas for crisp 1:1 screen resolution
        this.cameras.main?.setZoom?.(0.5);

        // 2-layer parallax background (far starry sky underneath, city skyline on top)
        this.parallaxBg = new ParallaxBackground(this);

        // Load initial level from URL query param (?level=...)
        this.currentLevelId = getLevelIdFromUrl();
        this.loadLevel(this.currentLevelId);

        // Initialize HUD for tracked variables in top-right corner
        this.hud = new GameHUD(this);
        this.raycaster = new Raycaster(this);

        // Define the whitelisted API exposed to player code
        const api: RobotAPI = {
            moveRight: () => this.player.moveRight(),
            moveLeft: () => this.player.moveLeft(),
            stop: () => this.player.stopMoving(),
            jump: () => this.player.jump(),
            detect: (angle?: number, type?: string, maxDistance?: number) =>
                this.detect(angle, type, maxDistance),
            track: (label: string, valueOrGetter?: any) =>
                this.hud.registerTrack(label, valueOrGetter),
        };

        // Initialize CodeRunner with scene, API, post-tick HUD refresh, and sleep particle state callback
        this.codeRunner = new CodeRunner(
            this,
            api,
            () => this.hud.evaluateTrackedVariables(),
            (isSleeping: boolean) => this.player?.setSleeping(isSleeping)
        );

        // --- Preview Camera Panning / Scrolling (active while frozen before Run) ---
        this.setupPreviewCameraControls();

        // --- Hover World Coordinate Readout ---
        this.setupHoverCoordTracking();

        // --- Phaser <-> React Communication ---
        EventBus.on('run-code', this.handleRunCode, this);
        EventBus.on('stop-code', this.handleStopCode, this);
        EventBus.on('pause-code', this.handlePauseCode, this);
        EventBus.on('resume-code', this.handleResumeCode, this);
        EventBus.on('load-level', this.handleLoadLevel, this);
        EventBus.on('code-error', this.freezeSimulation, this);

        // Clean up when this scene is destroyed or restarted
        this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
            EventBus.off('run-code', this.handleRunCode, this);
            EventBus.off('stop-code', this.handleStopCode, this);
            EventBus.off('pause-code', this.handlePauseCode, this);
            EventBus.off('resume-code', this.handleResumeCode, this);
            EventBus.off('load-level', this.handleLoadLevel, this);
            EventBus.off('code-error', this.freezeSimulation, this);
            this.handleStopCode(true);
            this.parallaxBg?.destroy();
            this.parallaxBg = null;
            this.raycaster?.destroy();
            this.tilemapCollider?.destroy();
            this.tilemapCollider = null;
            this.destroyLevelInteractables();
            this.destroyGoalTeleportEffect();
            this.goalMarker?.destroy();
            this.goalMarker = null;
            this.currentLevel?.destroy();
            this.currentLevel = null;
        });

        EventBus.emit('current-scene-ready', this);
    }

    /**
     * Loads a level by ID, spawns or repositions the player, and attaches tile/ramp collisions.
     */
    public loadLevel(levelId: number): void {
        this.cancelDeathSequence();
        this.cancelResetTransition();
        this.cancelIntroPan();
        this.hasRunStarted = false;
        this.currentLevelId = levelId;
        this.raycaster?.clearVisuals();
        this.tilemapCollider?.destroy();
        this.tilemapCollider = null;
        this.destroyLevelInteractables();
        this.destroyGoalTeleportEffect();
        this.goalMarker?.destroy();
        this.goalMarker = null;
        this.currentLevel?.destroy();

        const loaded = LevelLoader.load(this, levelId);
        this.currentLevel = loaded;

        if (loaded.goal) {
            this.goalMarker = this.add
                .image(loaded.goal.x, loaded.goal.y, 'goal-teleport')
                .setOrigin(0.5, 0.5)
                .setScale(2)
                .setDepth(5);
            this.spawnGoalTeleportEffect(loaded.goal.x, loaded.goal.y);
        }

        if (!this.player) {
            this.player = new Player(this, loaded.spawn.x, loaded.spawn.y);
            this.player.setDepth(10);
        } else {
            this.player.setSpawnPosition(loaded.spawn.x, loaded.spawn.y);
            this.player.reset();
        }

        this.tilemapCollider = new TilemapCollider(this, this.player, loaded);
        this.spawnLevelInteractables(loaded);
        this.cameras.main.centerOn(loaded.spawn.x, loaded.spawn.y);

        // Keep player and game logic frozen until Run is pressed
        this.freezeSimulation();

        // Play a one-time overview camera pan across the level
        this.playLevelIntroPan(loaded.spawn);

        // Sync parallax background bounds and initial scroll position with the loaded level
        this.parallaxBg?.configureForCamera();
    }

    /**
     * Plays a one-time smooth camera pan when a level loads:
     * - Horizontal levels: scrolls smoothly from right to left.
     * - Vertical levels: scrolls smoothly from top to bottom.
     * Automatically cancels if the user scrolls/drags, runs code, or switches levels.
     */
    private playLevelIntroPan(spawn: { x: number; y: number }): void {
        this.cancelIntroPan();

        const cam = this.cameras?.main;
        if (!cam || typeof cam.getBounds !== 'function' || !this.tweens?.add) {
            return;
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

        const scrollRangeX = maxScrollX - minScrollX;
        const scrollRangeY = maxScrollY - minScrollY;

        if (scrollRangeX <= 0 && scrollRangeY <= 0) {
            return;
        }

        const isHorizontal = scrollRangeX > 0 && scrollRangeX >= scrollRangeY;
        const distance = isHorizontal ? scrollRangeX : scrollRangeY;
        const duration = Phaser.Math.Clamp(
            Math.round((distance / this.introPanSpeedPxPerSec) * 1000),
            this.introPanMinDurationMs,
            this.introPanMaxDurationMs
        );

        if (isHorizontal) {
            const targetY = Phaser.Math.Clamp(
                spawn.y - halfH,
                minScrollY,
                maxScrollY
            );
            cam.scrollX = maxScrollX;
            cam.scrollY = targetY;

            this.introPanTween = this.tweens.add({
                targets: cam,
                scrollX: minScrollX,
                duration,
                delay: this.introPanDelayMs,
                ease: 'Sine.easeInOut',
                onComplete: () => {
                    this.introPanTween = null;
                },
            });
        } else {
            const targetX = Phaser.Math.Clamp(
                spawn.x - halfW,
                minScrollX,
                maxScrollX
            );
            cam.scrollX = targetX;
            cam.scrollY = minScrollY;

            this.introPanTween = this.tweens.add({
                targets: cam,
                scrollY: maxScrollY,
                duration,
                delay: this.introPanDelayMs,
                ease: 'Sine.easeInOut',
                onComplete: () => {
                    this.introPanTween = null;
                },
            });
        }
    }

    private cancelIntroPan(): void {
        if (this.introPanTween) {
            this.introPanTween.stop();
            this.introPanTween = null;
        }
    }

    /**
     * Enables mouse-wheel scrolling and click-drag panning across the level
     * while the simulation is frozen before Run is pressed.
     */
    private setupPreviewCameraControls(): void {
        let isDragging = false;
        let lastPointerX = 0;
        let lastPointerY = 0;

        this.input.on(
            'wheel',
            (
                _pointer: Phaser.Input.Pointer,
                _currentlyOver: Phaser.GameObjects.GameObject[],
                deltaX: number,
                deltaY: number
            ) => {
                if (this.isSimulating || this.isDying || this.isResetting) return;
                this.cancelIntroPan();

                const cam = this.cameras.main;
                const wheelScale = 1;
                const zoom = cam.zoom || 1;
                const scaledX = (deltaX * wheelScale) / zoom;
                const scaledY = (deltaY * wheelScale) / zoom;

                const bounds = cam.getBounds();
                const displayWidth = cam.width / zoom;
                const displayHeight = cam.height / zoom;
                const canScrollY = bounds.height > displayHeight;
                const canScrollX = bounds.width > displayWidth;

                if (canScrollY) {
                    this.scrollCameraBy(scaledX, scaledY);
                } else if (canScrollX) {
                    // For horizontal-only levels, map vertical mouse wheel to horizontal scroll
                    this.scrollCameraBy(scaledX !== 0 ? scaledX : scaledY, 0);
                }
            }
        );

        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (this.isSimulating || this.isDying || this.isResetting) return;
            this.cancelIntroPan();
            isDragging = true;
            lastPointerX = pointer.x;
            lastPointerY = pointer.y;
        });

        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (
                !isDragging ||
                this.isSimulating ||
                this.isDying ||
                this.isResetting ||
                !pointer.isDown
            ) {
                isDragging = false;
                return;
            }
            const zoom = this.cameras.main.zoom || 1;
            const dx = (lastPointerX - pointer.x) / zoom;
            const dy = (lastPointerY - pointer.y) / zoom;
            lastPointerX = pointer.x;
            lastPointerY = pointer.y;
            this.scrollCameraBy(dx, dy);
        });

        this.input.on('pointerup', () => {
            isDragging = false;
        });
    }

    /**
     * Tracks the pointer's world coordinates inside the game canvas and emits
     * them to React so the footer can display `(x, y)` next to the level name.
     */
    private setupHoverCoordTracking(): void {
        let lastX: number | null = null;
        let lastY: number | null = null;

        // Keep Phaser's cached canvas bounds in sync with CSS scaling on window resize
        const onWindowResize = () => {
            this.scale.updateBounds();
        };
        window.addEventListener('resize', onWindowResize);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            window.removeEventListener('resize', onWindowResize);
        });

        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
            const tileW = this.currentLevel?.map.tileWidth ?? 64;
            const tileH = this.currentLevel?.map.tileHeight ?? 64;
            const mapHeight = this.currentLevel?.map.heightInPixels ?? this.scale.height;
            const x = Math.round(pixelsToUnits(worldPoint.x, tileW));
            const y = Math.round(pixelsToUnits(mapHeight - worldPoint.y, tileH));
            if (x !== lastX || y !== lastY) {
                lastX = x;
                lastY = y;
                EventBus.emit('pointer-coords', { x, y });
            }
        });

        this.input.on('gameout', () => {
            if (lastX !== null || lastY !== null) {
                lastX = null;
                lastY = null;
                EventBus.emit('pointer-coords', null);
            }
        });
    }

    private scrollCameraBy(dx: number, dy: number): void {
        const cam = this.cameras.main;
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

        cam.scrollX = Phaser.Math.Clamp(cam.scrollX + dx, minScrollX, maxScrollX);
        cam.scrollY = Phaser.Math.Clamp(cam.scrollY + dy, minScrollY, maxScrollY);
    }

    private followPlayerCamera(): void {
        const cam = this.cameras.main;
        cam.centerOn(this.player.x, this.player.y);
        cam.startFollow(this.player, true, 0.12, 0.06);
        cam.setDeadzone(360, 360);
        this.parallaxBg?.update();
    }

    /**
     * Phaser's internal render & physics loop running at ~60fps.
     * Frozen until Run is pressed; delegates player kinematics to Player.update().
     */
    update(time: number, delta: number) {
        this.parallaxBg?.update();
        this.animateWorldKeycards(time);
        this.updateGoalTeleportEffect(delta);
        if (!this.isSimulating || !this.player) return;
        this.player.update(delta);
        this.checkKeycardPickups();
        this.updateDoors();
        if (this.checkDangerTouched()) return;
        if (this.checkFallenOffMap()) return;
        this.checkGoalReached();
    }

    /**
     * Spawns thin wide opaque blue bars that rise continuously from the teleporter base.
     */
    private spawnGoalTeleportEffect(goalX: number, goalY: number): void {
        this.destroyGoalTeleportEffect();
        if (!this.add?.rectangle) return;

        const barCount = 4;
        const barWidth = 48;
        const barHeight = 6;
        const baseY = goalY + 22;
        const riseHeight = 72;

        for (let i = 0; i < barCount; i++) {
            const progress = i / barCount;
            const rect = this.add
                .rectangle(
                    Math.round(goalX),
                    Math.round(baseY - progress * riseHeight),
                    barWidth,
                    barHeight,
                    0x38bdf8,
                    1
                )
                .setStrokeStyle(2, 0xffffff, 1)
                .setOrigin(0.5, 0.5)
                .setDepth(6);

            this.goalTeleportBars.push({
                rect,
                baseY,
                riseHeight,
                progress,
            });
        }
    }

    private updateGoalTeleportEffect(delta: number): void {
        if (this.goalTeleportBars.length === 0 || this.isPaused) return;

        const cycleMs = 1400;
        const step = delta / cycleMs;

        for (const bar of this.goalTeleportBars) {
            bar.progress = (bar.progress + step) % 1;
            bar.rect.setY(Math.round(bar.baseY - bar.progress * bar.riseHeight));
            bar.rect.setAlpha(
                bar.progress > 0.8 ? (1 - bar.progress) / 0.2 : 1
            );
        }
    }

    private destroyGoalTeleportEffect(): void {
        for (const bar of this.goalTeleportBars) {
            bar.rect.destroy();
        }
        this.goalTeleportBars = [];
    }

    private spawnLevelInteractables(loaded: LoadedLevel): void {
        for (const kc of loaded.keycards) {
            const sprite = this.add
                .image(kc.x, kc.y, 'keycard')
                .setOrigin(0.5, 0.5)
                .setDepth(6);
            this.keycardEntities.push({
                sprite,
                baseY: kc.y,
                collected: false,
            });
        }

        for (const door of loaded.doors) {
            const sprite = this.physics.add
                .staticImage(door.x, door.y, 'door-closed')
                .setOrigin(0.5, 0.5)
                .setDepth(4);
            sprite.refreshBody();

            const entity: DoorEntity = {
                sprite,
                collider: null as unknown as Phaser.Physics.Arcade.Collider,
                isOpen: false,
            };

            // Block while the door is closed; once unlocked with a keycard it stays open
            entity.collider = this.physics.add.collider(
                this.player,
                sprite,
                undefined,
                () => !entity.isOpen,
                this
            );

            this.doorEntities.push(entity);
        }
    }

    private destroyLevelInteractables(): void {
        for (const kc of this.keycardEntities) {
            kc.sprite.destroy();
        }
        this.keycardEntities = [];

        for (const door of this.doorEntities) {
            door.collider.destroy();
            door.sprite.destroy();
        }
        this.doorEntities = [];
    }

    private resetLevelInteractables(): void {
        for (const kc of this.keycardEntities) {
            kc.collected = false;
            kc.sprite.setVisible(true);
            kc.sprite.setY(kc.baseY);
        }

        for (const door of this.doorEntities) {
            door.isOpen = false;
            door.sprite.setTexture('door-closed');
            const body = door.sprite.body as Phaser.Physics.Arcade.StaticBody | null;
            if (body) {
                body.enable = true;
            }
        }
    }

    private animateWorldKeycards(time: number): void {
        for (const kc of this.keycardEntities) {
            if (kc.collected) continue;
            kc.sprite.setY(kc.baseY + Math.sin(time / 350) * 6);
        }
    }

    private checkKeycardPickups(): void {
        if (!this.player || this.keycardEntities.length === 0) return;

        const playerBounds = this.player.getBounds();
        for (const kc of this.keycardEntities) {
            if (kc.collected) continue;
            const keyBounds = kc.sprite.getBounds();
            if (Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, keyBounds)) {
                kc.collected = true;
                kc.sprite.setVisible(false);
                this.player.setHasKeycard(true);
            }
        }
    }

    private updateDoors(): void {
        if (!this.player || !this.player.hasKeycard || this.doorEntities.length === 0) {
            return;
        }

        for (const door of this.doorEntities) {
            if (door.isOpen) continue;

            const dx = Math.abs(this.player.x - door.sprite.x);
            const dy = Math.abs(this.player.y - door.sprite.y);
            if (dx <= this.doorOpenRangeX && dy <= this.doorOpenRangeY) {
                door.isOpen = true;
                door.sprite.setTexture('door-open');
                const body = door.sprite.body as Phaser.Physics.Arcade.StaticBody | null;
                if (body) {
                    body.enable = false;
                }
                this.player.setHasKeycard(false);
                break;
            }
        }
    }

    private detect(
        angle: number = 0,
        type: string = 'any',
        maxDistance?: number
    ): number | boolean | undefined {
        if (!this.player || !this.currentLevel || !this.raycaster) {
            return maxDistance !== undefined ? false : undefined;
        }

        const objects: DetectObjectTarget[] = [];
        if (this.goalMarker) {
            const bounds = this.goalMarker.getBounds();
            objects.push({
                type: 'goal',
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
            });
        }

        for (const kc of this.keycardEntities) {
            if (kc.collected) continue;
            const bounds = kc.sprite.getBounds();
            objects.push({
                type: 'key',
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
            });
        }

        for (const door of this.doorEntities) {
            if (door.isOpen) continue;
            const bounds = door.sprite.getBounds();
            objects.push({
                type: 'door',
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
            });
        }

        return this.raycaster.detect(
            this.player.x,
            this.player.y,
            this.currentLevel,
            objects,
            angle,
            type,
            maxDistance
        );
    }

    /**
     * Checks whether the player's hitbox overlaps any 'danger' tile on a colliding layer.
     */
    private isTouchingDangerTile(): boolean {
        if (
            !this.player ||
            !this.currentLevel ||
            this.currentLevel.dangerGids.size === 0
        ) {
            return false;
        }

        const body = this.player.body as Phaser.Physics.Arcade.Body | null;
        let left: number;
        let top: number;
        let width: number;
        let height: number;

        if (body) {
            left = body.position.x;
            top = body.position.y;
            width = body.width;
            height = body.height;
        } else {
            const bounds = this.player.getBounds();
            left = bounds.left;
            top = bounds.top;
            width = bounds.width;
            height = bounds.height;
        }

        const right = left + width;
        const bottom = top + height;
        // Extend hitbox slightly above the tile so walking over flush ground danger
        // tiles kills the player, while insetting the sides and bottom so danger tiles
        // placed on diagonal ramp corners cannot clip through and kill from underneath.
        const topExtend = 2;
        const sideInset = 6;
        const bottomInset = 6;

        for (const layer of this.currentLevel.collidingLayers) {
            const tiles = layer.getTilesWithinWorldXY(
                left,
                top,
                width,
                height + topExtend,
                {
                    isNotEmpty: true,
                }
            );

            for (const tile of tiles) {
                if (!this.currentLevel.dangerGids.has(tile.index)) {
                    continue;
                }

                const tileLeft = tile.getLeft() + sideInset;
                const tileRight = tile.getRight() - sideInset;
                const tileTop = tile.getTop() - topExtend;
                const tileBottom = tile.getBottom() - bottomInset;

                if (
                    right > tileLeft &&
                    left < tileRight &&
                    bottom > tileTop &&
                    top < tileBottom
                ) {
                    return true;
                }
            }
        }

        return false;
    }

    private checkDangerTouched(): boolean {
        if (!this.isSimulating || this.isDying) return false;
        if (!this.isTouchingDangerTile()) return false;

        this.triggerPlayerDeath();
        return true;
    }

    /**
     * Returns the world Y threshold below which the player is considered
     * to have fallen far off the map, or null if level bounds are unavailable.
     */
    private getFallDeathY(): number | null {
        const mapBottom =
            this.currentLevel?.map?.heightInPixels ??
            this.physics?.world?.bounds?.bottom;
        if (typeof mapBottom !== 'number') {
            return null;
        }

        const cameraBottom = this.cameras?.main?.getBounds?.()?.bottom;
        const bottomEdge =
            typeof cameraBottom === 'number'
                ? Math.max(mapBottom, cameraBottom)
                : mapBottom;

        return bottomEdge + this.fallDeathMarginPx;
    }

    private checkFallenOffMap(): boolean {
        if (!this.isSimulating || this.isDying) return false;
        const fallDeathY = this.getFallDeathY();
        if (fallDeathY === null || this.player.y <= fallDeathY) return false;

        this.triggerPlayerDeath(true);
        return true;
    }

    /**
     * Kills the player (e.g. on touching a danger tile or falling off the map),
     * optionally fades the sprite out, and smoothly resets the level with a
     * sliding black fade once finished.
     */
    private triggerPlayerDeath(skipFade: boolean = false): void {
        this.isDying = true;
        this.codeRunner.stop();
        this.player.stopMoving();
        this.player.setVelocity(0, 0);
        this.freezeSimulation();

        const completeDeathReset = () => {
            this.resetSceneState();
            EventBus.emit('code-stopped');
        };

        if (!skipFade && this.tweens?.add) {
            this.deathTween = this.tweens.add({
                targets: this.player,
                alpha: 0,
                duration: this.deathFadeDurationMs,
                ease: 'Linear',
                onUpdate: () => {
                    this.player.syncHeldKeycardAlpha?.();
                },
                onComplete: () => {
                    if (!this.isDying) return;
                    this.deathTween = null;
                    this.isDying = false;
                    this.playResetSlideTransition(completeDeathReset);
                },
            });
        } else {
            this.isDying = false;
            this.playResetSlideTransition(completeDeathReset);
        }
    }

    private cancelDeathSequence(): void {
        if (this.deathTween) {
            this.deathTween.stop();
            this.deathTween = null;
        }
        this.isDying = false;
    }

    /**
     * Generates (once) a horizontal black gradient texture with soft feathered edges
     * and a full-viewport solid black middle, so sliding it across the screen fades
     * smoothly to black and back out while hiding the camera and spawn reset snap.
     */
    private ensureResetFadeTexture(viewWidth: number, feather: number): string | null {
        if (!this.textures?.exists || !this.textures?.createCanvas) {
            return null;
        }

        const totalWidth = viewWidth + feather * 2;
        const textureKey = `reset-black-slide-${totalWidth}`;
        if (this.textures.exists(textureKey)) {
            return textureKey;
        }

        const canvasTex = this.textures.createCanvas(textureKey, totalWidth, 2);
        if (!canvasTex) {
            return null;
        }

        const ctx = canvasTex.getContext();
        const gradient = ctx.createLinearGradient(0, 0, totalWidth, 0);
        const leftStop = feather / totalWidth;
        const rightStop = (feather + viewWidth) / totalWidth;

        gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        gradient.addColorStop(leftStop, 'rgba(0, 0, 0, 1)');
        gradient.addColorStop(rightStop, 'rgba(0, 0, 0, 1)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, totalWidth, 2);
        canvasTex.refresh();

        return textureKey;
    }

    /**
     * Slides a feathered black fade across the viewport from left to right.
     * Invokes `onMidpointReset` once the viewport is completely black, then
     * continues sliding out to the right to reveal the reset level.
     */
    private playResetSlideTransition(onMidpointReset: () => void): void {
        this.cancelResetTransition();

        const baseWidth = this.scale?.width || 1024;
        const baseHeight = this.scale?.height || 832;
        const zoom = this.cameras?.main?.zoom || 1;
        const viewWidth = baseWidth / zoom;
        const viewHeight = baseHeight / zoom;
        const offsetX = (baseWidth - viewWidth) / 2;
        const offsetY = (baseHeight - viewHeight) / 2;
        const feather = Math.round(viewWidth * 0.25);
        const totalWidth = viewWidth + feather * 2;
        const textureKey = this.ensureResetFadeTexture(viewWidth, feather);

        if (!textureKey || !this.add?.image || !this.tweens?.add) {
            onMidpointReset();
            return;
        }

        const startX = offsetX - totalWidth;
        const midX = offsetX - feather;
        const endX = offsetX + viewWidth;

        const overlay = this.add
            .image(startX, offsetY, textureKey)
            .setOrigin(0, 0)
            .setDisplaySize(totalWidth, viewHeight)
            .setScrollFactor(0)
            .setDepth(1000);

        this.resetOverlay = overlay;
        this.isResetting = true;

        // Phase 1: Slide feathered black curtain in from left until screen is 100% black
        this.resetTween = this.tweens.add({
            targets: overlay,
            x: midX,
            duration: this.resetSlideHalfDurationMs,
            ease: 'Quad.easeIn',
            onComplete: () => {
                if (!this.isResetting || this.resetOverlay !== overlay) return;

                onMidpointReset();

                // Phase 2: Continue sliding out to the right to smoothly reveal the reset level
                this.resetTween = this.tweens.add({
                    targets: overlay,
                    x: endX,
                    duration: this.resetSlideHalfDurationMs,
                    ease: 'Quad.easeOut',
                    onComplete: () => {
                        if (this.resetOverlay !== overlay) return;
                        this.cancelResetTransition();
                    },
                });
            },
        });
    }

    private cancelResetTransition(): void {
        if (this.resetTween) {
            this.resetTween.stop();
            this.resetTween = null;
        }
        if (this.resetOverlay) {
            this.resetOverlay.destroy();
            this.resetOverlay = null;
        }
        this.isResetting = false;
    }

    private resetSceneState(): void {
        this.hasRunStarted = false;
        this.raycaster?.clearVisuals();
        this.tilemapCollider?.reset();
        this.resetLevelInteractables();
        this.player.reset();
        this.hud.reset();
        this.cameras.main.centerOn(this.player.x, this.player.y);
        this.parallaxBg?.update();
    }

    private checkGoalReached(): void {
        if (!this.isSimulating || !this.goalMarker) return;

        const playerBounds = this.player.getBounds();
        const goalBounds = this.goalMarker.getBounds();
        if (!Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, goalBounds)) {
            return;
        }

        this.codeRunner.stop();
        this.player.stopMoving();
        this.player.setVelocity(0, 0);
        this.freezeSimulation();
        EventBus.emit('code-stopped');
        EventBus.emit('level-complete', this.currentLevelId);
    }

    private freezeSimulation() {
        this.isSimulating = false;
        this.physics.pause();
        this.cameras.main.stopFollow();
    }

    private resumeSimulation() {
        this.isSimulating = true;
        this.physics.resume();
        this.followPlayerCamera();
    }

    private handleRunCode(rawCode: string) {
        if (this.isPaused) return;
        this.cancelDeathSequence();
        this.cancelResetTransition();
        this.cancelIntroPan();
        this.hasRunStarted = true;
        this.codeRunner.stop();
        this.raycaster?.clearVisuals();
        this.tilemapCollider?.reset();
        this.resetLevelInteractables();
        this.player.reset();
        this.hud.reset();
        this.resumeSimulation();
        this.codeRunner.run(rawCode);
    }

    private handleStopCode(skipTransition: boolean = false) {
        const shouldAnimate =
            !skipTransition &&
            !this.isResetting &&
            (this.hasRunStarted || this.isDying);
        this.cancelDeathSequence();
        this.cancelResetTransition();
        this.cancelIntroPan();
        this.isPaused = false;
        this.resumeAsSimulating = false;
        this.time.paused = false;
        this.codeRunner.stop();
        this.freezeSimulation();
        EventBus.emit('code-stopped');

        if (shouldAnimate) {
            this.playResetSlideTransition(() => this.resetSceneState());
        } else {
            this.resetSceneState();
        }
    }

    private handlePauseCode() {
        this.isPaused = true;
        this.resumeAsSimulating = this.isSimulating;
        this.isSimulating = false;
        this.physics.pause();
        this.time.paused = true;
        this.deathTween?.pause();
        this.resetTween?.pause();
        this.introPanTween?.pause();
        this.cameras.main.stopFollow();
    }

    private handleResumeCode() {
        this.isPaused = false;
        this.time.paused = false;
        if (this.isDying) {
            this.deathTween?.resume();
        } else if (this.isResetting) {
            this.resetTween?.resume();
        } else if (this.introPanTween) {
            this.introPanTween.resume();
        } else if (this.resumeAsSimulating) {
            this.isSimulating = true;
            this.physics.resume();
            this.followPlayerCamera();
        } else {
            this.freezeSimulation();
        }
    }

    private handleLoadLevel(levelId: number) {
        this.cancelDeathSequence();
        this.cancelResetTransition();
        this.cancelIntroPan();
        this.hasRunStarted = false;
        this.isPaused = false;
        this.resumeAsSimulating = false;
        this.time.paused = false;
        this.codeRunner.stop();
        this.hud.reset();
        this.loadLevel(levelId);
        EventBus.emit('code-stopped');
    }
}
