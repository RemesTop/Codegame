import * as Phaser from 'phaser';
import { EventBus } from '../EventBus';
import { GameHUD } from '../GameHUD';
import { CodeRunner, RobotAPI } from '../CodeRunner';
import { Player } from '../Player';

export class Game extends Phaser.Scene {
    private player!: Player;
    private readonly startX: number = 512;
    private readonly startY: number = 384;

    // --- Sub-components ---
    private hud!: GameHUD;
    private codeRunner!: CodeRunner;

    constructor() {
        super('Game');
    }

    preload() {
        this.load.setPath('assets');
        this.load.image('star', 'star.png');
        this.load.image('background', 'bg.png');
        this.load.image('logo', 'logo.png');
    }

    create() {
        // Draw background
        this.add.image(512, 384, 'background');

        // Create the player character
        this.player = new Player(this, this.startX, this.startY);

        // Create platforms for the character to stand on
        const platform = this.add.rectangle(
            this.startX,
            this.startY + this.player.height + 6,
            160,
            48,
            0xff0023,
        );
        const platform2 = this.add.rectangle(
            this.startX + 150,
            this.startY + this.player.height + 6,
            40,
            70,
            0xff0023,
        );
        const platform3 = this.add.rectangle(
            this.startX + 100,
            this.startY + this.player.height + 120,
            130,
            23,
            0xff0023,
        );
        const platforms = [platform, platform2, platform3];

        // Add platforms as static bodies in the physics world
        this.physics.world.enable(platforms, 1);

        // Add collision between player and platforms
        this.physics.add.collider(this.player, platforms);

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
            this.hud.evaluateTrackedVariables(),
        );

        // --- Phaser <-> React Communication ---
        EventBus.on('run-code', this.handleRunCode, this);
        EventBus.on('stop-code', this.handleStopCode, this);

        // Clean up when this scene is destroyed or restarted
        this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
            EventBus.off('run-code', this.handleRunCode, this);
            EventBus.off('stop-code', this.handleStopCode, this);
            this.handleStopCode();
        });

        EventBus.emit('current-scene-ready', this);
    }

    /**
     * Phaser's internal render & physics loop running at ~60fps.
     * Delegates player kinematics and acceleration to Player.update().
     */
    update(_time: number, delta: number) {
        if (!this.player) return;
        this.player.update(delta);
    }

    private handleRunCode(rawCode: string) {
        this.codeRunner.stop();
        this.player.reset();
        this.hud.reset();
        this.codeRunner.run(rawCode);
    }

    private handleStopCode() {
        this.codeRunner.stop();
        this.player.reset();
        this.hud.reset();
        EventBus.emit('code-stopped');
    }
}
