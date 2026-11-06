import * as Phaser from 'phaser';
import { EventBus } from '../EventBus';

// The three possible horizontal movement states for our character
export type MovementState = 'LEFT' | 'RIGHT' | 'STOP';

export class Game extends Phaser.Scene {
    // --- Test Character Properties ---
    private player!: Phaser.GameObjects.Rectangle;
    private movementState: MovementState = 'STOP';
    private readonly startX: number = 512;
    private readonly startY: number = 384;
    private readonly moveSpeed: number = 220; // Movement speed in pixels per second

    // --- Safe Code Execution & Tick State ---
    // The player's compiled update() function holding its closure scope
    private playerUpdateFn: (() => void) | null = null;
    // Phaser timer event that triggers the player's update() every 100ms
    private codeTimer: Phaser.Time.TimerEvent | null = null;
    private readonly tickIntervalMs: number = 100; // 100ms per tick (10 ticks / sec)

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

        // --- Phaser <-> React Communication ---
        // Listen for events emitted by React (App.tsx) via the shared EventBus
        EventBus.on('run-code', this.handleRunCode, this);
        EventBus.on('stop-code', this.handleStopCode, this);

        // Clean up EventBus listeners when this scene is destroyed or restarted
        this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
            EventBus.off('run-code', this.handleRunCode, this);
            EventBus.off('stop-code', this.handleStopCode, this);
            this.stopCodeExecution();
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

    // --- Infinite Loop Protection ---

    /**
     * Injects an iteration counter before while/for loops.
     * If a single tick loops more than 10,000 times, it throws an error to prevent freezing the browser.
     */
    private injectLoopProtection(code: string): string {
        let loopCounterId = 0;
        return code.replace(/\b(for|while)\s*(\((?:[^()]+|\([^()]*\))*\))\s*\{/g, (_, type, condition) => {
            const id = loopCounterId++;
            return `let __loopCount_${id} = 0; ${type} ${condition} { if (++__loopCount_${id} > 10000) throw new Error("Infinite loop detected: exceeded 10,000 iterations in a single tick"); `;
        });
    }

    // --- Code Sandboxing & Compilation ---

    /**
     * Compiles the player's code once so top-level variables (like `let counter = 0;`)
     * persist across ticks using a JavaScript closure.
     */
    private handleRunCode(rawCode: string) {
        // Reset any existing execution and reset character position
        this.stopCodeExecution();
        this.resetCharacter();

        try {
            // 1. Inject loop counter protection
            const protectedCode = this.injectLoopProtection(rawCode);

            // 2. Sandboxing & Closure Scope:
            // We use `new Function(...)` to construct a function factory.
            //
            // HOW SANDBOXING WORKS:
            // By declaring sensitive browser globals (window, document, fetch, eval, Function)
            // as formal parameter names, and passing `undefined` as their arguments, any reference
            // to these names inside the player's code resolves to `undefined` instead of the real global.
            //
            // HOW CLOSURE PERSISTENCE WORKS:
            // The factory function evaluates the player's code once. Top-level variables (like `let counter = 0`)
            // are initialized in this outer function's scope. The factory then returns the `update` function.
            // That `update` function retains a reference to this outer scope (a closure), so subsequent calls
            // will read and modify the SAME `counter` variable across multiple timer ticks.
            const createPlayerScope = new Function(
                'moveRight',
                'moveLeft',
                'stop',
                'window',
                'document',
                'fetch',
                'eval',
                'Function',
                `
                ${protectedCode}
                return typeof update === 'function' ? update : null;
                `
            );

            // Execute the factory once to initialize top-level variables and retrieve the update function
            const updateFn = createPlayerScope(
                () => this.moveRight(),
                () => this.moveLeft(),
                () => this.stopMoving(),
                undefined, // shadows window
                undefined, // shadows document
                undefined, // shadows fetch
                undefined, // shadows eval
                undefined  // shadows Function
            );

            if (!updateFn) {
                throw new Error("No update() function found. Please define 'function update() { ... }'.");
            }

            this.playerUpdateFn = updateFn;

            // 3. Start the fixed tick loop (100ms / 10 times per second)
            this.codeTimer = this.time.addEvent({
                delay: this.tickIntervalMs,
                callback: this.executePlayerTick,
                callbackScope: this,
                loop: true,
            });

            EventBus.emit('code-started');
        } catch (err: any) {
            this.stopCodeExecution();
            EventBus.emit('code-error', err.message || String(err));
        }
    }

    /**
     * Executes on every timer tick (every 100ms).
     * Calls the compiled player update() function wrapped in try/catch for safety.
     */
    private executePlayerTick() {
        if (!this.playerUpdateFn) return;

        try {
            this.playerUpdateFn();
        } catch (err: any) {
            // Catch runtime errors or infinite loop exceptions safely
            this.stopCodeExecution();
            EventBus.emit('code-error', `Runtime error in update(): ${err.message || String(err)}`);
        }
    }

    private handleStopCode() {
        this.stopCodeExecution();
        this.resetCharacter();
        EventBus.emit('code-stopped');
    }

    private stopCodeExecution() {
        if (this.codeTimer) {
            this.codeTimer.remove();
            this.codeTimer = null;
        }
        this.playerUpdateFn = null;
        this.movementState = 'STOP';
    }
}
