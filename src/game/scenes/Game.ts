import * as Phaser from 'phaser';
import { EventBus } from '../EventBus';
import { GameHUD } from '../GameHUD';
import { CodeRunner, RobotAPI } from '../CodeRunner';

// The three possible horizontal movement states for our character
export type MovementState = 'LEFT' | 'RIGHT' | 'STOP';

export class Game extends Phaser.Scene {
    // --- Test Character Properties ---
    private player!: Phaser.GameObjects.Rectangle;
    private movementState: MovementState = 'STOP';
    private readonly startX: number = 512;
    private readonly startY: number = 384;
    private readonly moveSpeed: number = 220; // Movement speed in pixels per second

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

        // Create the test character: a 48x48 red square with a white border
        this.player = this.add.rectangle(this.startX, this.startY, 48, 48, 0xff0000);
        this.player.setStrokeStyle(2, 0xffffff);

        // Initialize HUD for tracked variables in top-right corner
        this.hud = new GameHUD(this);

        // Define the whitelisted API exposed to player code
        const api: RobotAPI = {
            moveRight: () => this.moveRight(),
            moveLeft: () => this.moveLeft(),
            stop: () => this.stopMoving(),
            track: (label: string, valueOrGetter?: any) => this.hud.registerTrack(label, valueOrGetter),
        };

        // Initialize CodeRunner with scene, API, and post-tick HUD refresh callback
        this.codeRunner = new CodeRunner(this, api, () => this.hud.evaluateTrackedVariables());

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
     * Moves the red square smoothly according to its current movementState.
     */
    update(_time: number, delta: number) {
        if (!this.player) return;

        // delta is in milliseconds; divide by 1000 to get frame-rate independent seconds
        const dt = delta / 1000;

        if (this.movementState === 'RIGHT') {
            this.player.x += this.moveSpeed * dt;
        } else if (this.movementState === 'LEFT') {
            this.player.x -= this.moveSpeed * dt;
        }

        // Clamp the square within the game canvas (width 1024)
        const halfWidth = this.player.width / 2;
        this.player.x = Phaser.Math.Clamp(this.player.x, halfWidth, 1024 - halfWidth);
    }

    // --- Exposed Movement API for Player Code ---

    private moveRight() {
        this.movementState = 'RIGHT';
    }

    private moveLeft() {
        this.movementState = 'LEFT';
    }

    private stopMoving() {
        this.movementState = 'STOP';
    }

    private resetCharacter() {
        this.movementState = 'STOP';
        if (this.player) {
            this.player.setPosition(this.startX, this.startY);
        }
    }

    private handleRunCode(rawCode: string) {
        this.codeRunner.stop();
        this.resetCharacter();
        this.hud.reset();
        this.codeRunner.run(rawCode);
    }

    private handleStopCode() {
        this.codeRunner.stop();
        this.resetCharacter();
        this.hud.reset();
        EventBus.emit('code-stopped');
    }
}
