import * as Phaser from 'phaser';
import { EventBus } from '../EventBus';
import { GameHUD } from '../GameHUD';
import { CodeRunner, RobotAPI } from '../CodeRunner';
import { Player } from '../Player';
import { LevelLoader, LoadedLevel } from '../LevelLoader';
import { getLevelIdFromUrl } from '../Levels/levels';
import { TilemapCollider } from '../TilemapCollider';
import { DetectObjectTarget, pixelsToUnits, Raycaster } from '../Raycaster';

export class Game extends Phaser.Scene {
    private player!: Player;
    private currentLevelId: number = 1;
    private currentLevel: LoadedLevel | null = null;
    private tilemapCollider: TilemapCollider | null = null;
    private goalMarker: Phaser.GameObjects.Rectangle | null = null;
    private isSimulating: boolean = false;
    private isDying: boolean = false;
    private deathTween: Phaser.Tweens.Tween | null = null;
    private readonly deathFadeDurationMs: number = 1500;
    private isPaused: boolean = false;
    private resumeAsSimulating: boolean = false;

    // --- Sub-components ---
    private hud!: GameHUD;
    private codeRunner!: CodeRunner;
    private raycaster!: Raycaster;

    constructor() {
        super('Game');
    }

    preload() {
        this.load.setPath('assets');
        this.load.image('background', 'bg.png');
        LevelLoader.preload(this);
    }

    create() {
        // Keep the background pinned to the viewport when the camera follows the player
        this.add.image(512, 384, 'background').setScrollFactor(0);

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

        // Initialize CodeRunner with scene, API, and post-tick HUD refresh callback
        this.codeRunner = new CodeRunner(this, api, () =>
            this.hud.evaluateTrackedVariables()
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
            this.handleStopCode();
            this.raycaster?.destroy();
            this.tilemapCollider?.destroy();
            this.tilemapCollider = null;
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
        this.currentLevelId = levelId;
        this.raycaster?.clearVisuals();
        this.tilemapCollider?.destroy();
        this.tilemapCollider = null;
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
        this.cameras.main.centerOn(loaded.spawn.x, loaded.spawn.y);

        // Keep player and game logic frozen until Run is pressed
        this.freezeSimulation();
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
                if (this.isSimulating || this.isDying) return;

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
            if (this.isSimulating || this.isDying) return;
            isDragging = true;
            lastPointerX = pointer.x;
            lastPointerY = pointer.y;
        });

        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
                if (!isDragging || this.isSimulating || this.isDying || !pointer.isDown) {
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
    }

    /**
     * Phaser's internal render & physics loop running at ~60fps.
     * Frozen until Run is pressed; delegates player kinematics to Player.update().
     */
    update(_time: number, delta: number) {
        if (!this.isSimulating || !this.player) return;
        this.player.update(delta);
        if (this.checkDangerTouched()) return;
        this.checkGoalReached();
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
     * Kills the player on touching a danger tile, slowly fades the sprite out,
     * and resets the game once the fade-out finishes.
     */
    private triggerPlayerDeath(): void {
        this.isDying = true;
        this.codeRunner.stop();
        this.player.stopMoving();
        this.player.setVelocity(0, 0);
        this.freezeSimulation();
        EventBus.emit('code-stopped');

        if (this.tweens?.add) {
            this.deathTween = this.tweens.add({
                targets: this.player,
                alpha: 0,
                duration: this.deathFadeDurationMs,
                ease: 'Linear',
                onComplete: () => {
                    if (!this.isDying) return;
                    this.deathTween = null;
                    this.isDying = false;
                    this.handleStopCode();
                },
            });
        } else {
            this.isDying = false;
            this.handleStopCode();
        }
    }

    private cancelDeathSequence(): void {
        if (this.deathTween) {
            this.deathTween.stop();
            this.deathTween = null;
        }
        this.isDying = false;
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
        this.codeRunner.stop();
        this.raycaster?.clearVisuals();
        this.tilemapCollider?.reset();
        this.player.reset();
        this.hud.reset();
        this.resumeSimulation();
        this.codeRunner.run(rawCode);
    }

    private handleStopCode() {
        this.cancelDeathSequence();
        this.isPaused = false;
        this.resumeAsSimulating = false;
        this.time.paused = false;
        this.codeRunner.stop();
        this.freezeSimulation();
        this.raycaster?.clearVisuals();
        this.tilemapCollider?.reset();
        this.player.reset();
        this.hud.reset();
        this.cameras.main.centerOn(this.player.x, this.player.y);
        EventBus.emit('code-stopped');
    }

    private handlePauseCode() {
        this.isPaused = true;
        this.resumeAsSimulating = this.isSimulating;
        this.isSimulating = false;
        this.physics.pause();
        this.time.paused = true;
        this.deathTween?.pause();
        this.cameras.main.stopFollow();
    }

    private handleResumeCode() {
        this.isPaused = false;
        this.time.paused = false;
            if (this.isDying) {
                this.deathTween?.resume();
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
        this.isPaused = false;
        this.resumeAsSimulating = false;
        this.time.paused = false;
        this.codeRunner.stop();
        this.hud.reset();
        this.loadLevel(levelId);
        EventBus.emit('code-stopped');
    }
}
