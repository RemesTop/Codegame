import * as Phaser from 'phaser';
import { EventBus } from '../EventBus';
import { GameHUD } from '../GameHUD';
import { CodeRunner, RobotAPI } from '../CodeRunner';
import { Player } from '../Player';
import { LevelLoader, LoadedLevel } from '../LevelLoader';
import { TilemapCollider } from '../TilemapCollider';

export class Game extends Phaser.Scene {
    private player!: Player;
    private currentLevelId: number = 1;
    private currentLevel: LoadedLevel | null = null;
    private tilemapCollider: TilemapCollider | null = null;
    private isSimulating: boolean = false;

    // --- Sub-components ---
    private hud!: GameHUD;
    private codeRunner!: CodeRunner;

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

        // Load initial level (level select menu will be wired later)
        this.loadLevel(this.currentLevelId);

        // Initialize HUD for tracked variables in top-right corner
        this.hud = new GameHUD(this);

        // Define the whitelisted API exposed to player code
        const api: RobotAPI = {
            moveRight: () => this.player.moveRight(),
            moveLeft: () => this.player.moveLeft(),
            stop: () => this.player.stopMoving(),
            track: (label: string, valueOrGetter?: any) =>
                this.hud.registerTrack(label, valueOrGetter),
        };

        // Initialize CodeRunner with scene, API, and post-tick HUD refresh callback
        this.codeRunner = new CodeRunner(this, api, () =>
            this.hud.evaluateTrackedVariables()
        );

        // --- Phaser <-> React Communication ---
        EventBus.on('run-code', this.handleRunCode, this);
        EventBus.on('stop-code', this.handleStopCode, this);
        EventBus.on('code-error', this.freezeSimulation, this);

        // Clean up when this scene is destroyed or restarted
        this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
            EventBus.off('run-code', this.handleRunCode, this);
            EventBus.off('stop-code', this.handleStopCode, this);
            EventBus.off('code-error', this.freezeSimulation, this);
            this.handleStopCode();
            this.tilemapCollider?.destroy();
            this.tilemapCollider = null;
            this.currentLevel?.destroy();
            this.currentLevel = null;
        });

        EventBus.emit('current-scene-ready', this);
    }

    /**
     * Loads a level by ID, spawns or repositions the player, and attaches tile/ramp collisions.
     */
    public loadLevel(levelId: number): void {
        this.currentLevelId = levelId;
        this.tilemapCollider?.destroy();
        this.tilemapCollider = null;
        this.currentLevel?.destroy();

        const loaded = LevelLoader.load(this, levelId);
        this.currentLevel = loaded;

        if (!this.player) {
            this.player = new Player(this, loaded.spawn.x, loaded.spawn.y);
            this.player.setDepth(10);
        } else {
            this.player.setSpawnPosition(loaded.spawn.x, loaded.spawn.y);
            this.player.reset();
        }

        this.tilemapCollider = new TilemapCollider(this, this.player, loaded);
        this.cameras.main.centerOn(loaded.spawn.x, loaded.spawn.y);
        this.cameras.main.startFollow(this.player, true, 0.15, 0.15);

        // Keep player and game logic frozen until Run is pressed
        this.freezeSimulation();
    }

    /**
     * Phaser's internal render & physics loop running at ~60fps.
     * Frozen until Run is pressed; delegates player kinematics to Player.update().
     */
    update(_time: number, delta: number) {
        if (!this.isSimulating || !this.player) return;
        this.player.update(delta);
    }

    private freezeSimulation() {
        this.isSimulating = false;
        this.physics.pause();
    }

    private resumeSimulation() {
        this.isSimulating = true;
        this.physics.resume();
    }

    private handleRunCode(rawCode: string) {
        this.codeRunner.stop();
        this.tilemapCollider?.reset();
        this.player.reset();
        this.hud.reset();
        this.resumeSimulation();
        this.codeRunner.run(rawCode);
    }

    private handleStopCode() {
        this.codeRunner.stop();
        this.freezeSimulation();
        this.tilemapCollider?.reset();
        this.player.reset();
        this.hud.reset();
        EventBus.emit('code-stopped');
    }
}
