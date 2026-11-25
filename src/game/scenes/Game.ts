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

export class Game extends Phaser.Scene {
    private player!: Player;
    private currentLevelId: number = 1;
    private currentLevel: LoadedLevel | null = null;
    private tilemapCollider: TilemapCollider | null = null;
    private goalMarker: Phaser.GameObjects.Rectangle | null = null;
    private keycardEntities: KeycardEntity[] = [];
    private doorEntities: DoorEntity[] = [];
    private readonly doorOpenRangeX: number = 80;
    private readonly doorOpenRangeY: number = 64;
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
    private readonly introPanSpeedPxPerSec: number = 180;
    private readonly introPanMinDurationMs: number = 1400;
    private readonly introPanMaxDurationMs: number = 4500;
    private readonly introPanDelayMs: number = 200;
    private readonly fallDeathMarginPx: number = 320;
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
        this.load.image('bg-sky', 'bg_test_SKY.png');
        this.load.image('bg-city', 'bg_test_CITY.png');
        this.load.image('keycard', 'keycard1.png');
        this.load.image('door-closed', 'Locked-door-1.png');
        this.load.image('door-open', 'Locked-door-2.png');
        LevelLoader.preload(this);
    }

    create() {
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
        this.goalMarker?.destroy();
        this.goalMarker = null;
        this.currentLevel?.destroy();

        const loaded = LevelLoader.load(this, levelId);
        this.currentLevel = loaded;

        if (loaded.goal) {
            this.goalMarker = this.add.rectangle(
                loaded.goal.x,
                loaded.goal.y,
                loaded.goal.width,
                loaded.goal.height,
                0x22c55e,
                0.85
            );
            this.goalMarker.setStrokeStyle(2, 0xffffff, 1);
            this.goalMarker.setDepth(5);
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
        const minScrollX = bounds.x;
        const maxScrollX = Math.max(bounds.x, bounds.right - cam.width);
        const minScrollY = bounds.y;
        const maxScrollY = Math.max(bounds.y, bounds.bottom - cam.height);

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
                spawn.y - cam.height / 2,
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
                spawn.x - cam.width / 2,
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
                const bounds = cam.getBounds();
                const canScrollY = bounds.height > cam.height;
                const canScrollX = bounds.width > cam.width;

                const wheelScale = 0.5;
                const scaledX = deltaX * wheelScale;
                const scaledY = deltaY * wheelScale;

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
            const dx = lastPointerX - pointer.x;
            const dy = lastPointerY - pointer.y;
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
            const tileW = this.currentLevel?.map.tileWidth ?? 32;
            const tileH = this.currentLevel?.map.tileHeight ?? 32;
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
        const maxScrollX = Math.max(bounds.x, bounds.right - cam.width);
        const maxScrollY = Math.max(bounds.y, bounds.bottom - cam.height);

        cam.scrollX = Phaser.Math.Clamp(cam.scrollX + dx, bounds.x, maxScrollX);
        cam.scrollY = Phaser.Math.Clamp(cam.scrollY + dy, bounds.y, maxScrollY);
    }

    private followPlayerCamera(): void {
        const cam = this.cameras.main;
        cam.centerOn(this.player.x, this.player.y);
        cam.startFollow(this.player, true, 0.12, 0.06);
        cam.setDeadzone(180, 180);
        this.parallaxBg?.update();
    }

    /**
     * Phaser's internal render & physics loop running at ~60fps.
     * Frozen until Run is pressed; delegates player kinematics to Player.update().
     */
    update(time: number, delta: number) {
        this.parallaxBg?.update();
        this.animateWorldKeycards(time);
        if (!this.isSimulating || !this.player) return;
        this.player.update(delta);
        this.checkKeycardPickups();
        this.updateDoors();
        if (this.checkDangerTouched()) return;
        if (this.checkFallenOffMap()) return;
        this.checkGoalReached();
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
            kc.sprite.setY(kc.baseY + Math.sin(time / 350) * 3);
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

        for (const layer of this.currentLevel.collidingLayers) {
            const tiles = layer.getTilesWithinWorldXY(left, top, width, height, {
                isNotEmpty: true,
            });

            for (const tile of tiles) {
                if (!this.currentLevel.dangerGids.has(tile.index)) {
                    continue;
                }

                const tileLeft = tile.getLeft();
                const tileRight = tile.getRight();
                const tileTop = tile.getTop();
                const tileBottom = tile.getBottom();

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

        const viewWidth = this.scale?.width || 1024;
        const viewHeight = this.scale?.height || 832;
        const feather = Math.round(viewWidth * 0.25);
        const totalWidth = viewWidth + feather * 2;
        const textureKey = this.ensureResetFadeTexture(viewWidth, feather);

        if (!textureKey || !this.add?.image || !this.tweens?.add) {
            onMidpointReset();
            return;
        }

        const startX = -totalWidth;
        const midX = -feather;
        const endX = viewWidth;

        const overlay = this.add
            .image(startX, 0, textureKey)
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
