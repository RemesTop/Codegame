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

    // --- Tracked Variables HUD ---
    private trackVars: Map<string, string> = new Map();
    private trackGetters: Map<string, () => any> = new Map();
    private trackBg!: Phaser.GameObjects.Rectangle;
    private trackText!: Phaser.GameObjects.Text;

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

        // --- Tracked Variables HUD (Top Right Corner) ---
        // Compact semi-transparent dark background card
        this.trackBg = this.add.rectangle(0, 0, 100, 30, 0x1e1e1e, 0.85);
        this.trackBg.setStrokeStyle(1, 0x444444);
        this.trackBg.setDepth(200);
        this.trackBg.setVisible(false);

        // Compact monospace text display aligned to the top-right
        this.trackText = this.add.text(1008 - 8, 16 + 8, '', {
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            fontSize: '13px',
            color: '#00ffcc',
            align: 'right',
            lineSpacing: 4,
        });
        this.trackText.setOrigin(1, 0);
        this.trackText.setDepth(201);

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

    // --- Tracked Variables HUD Management ---

    /**
     * Registers a variable to be tracked.
     * If a getter function is passed (e.g. `() => counter`), it is re-evaluated on every tick.
     */
    private registerTrack(label: string, valueOrGetter?: any) {
        const key = String(label);
        if (typeof valueOrGetter === 'function') {
            this.trackGetters.set(key, valueOrGetter);
        } else {
            this.trackGetters.set(key, () => valueOrGetter);
        }
        this.evaluateTrackedVariables();
    }

    /**
     * Evaluates all registered getters to update HUD with the latest values.
     */
    private evaluateTrackedVariables() {
        if (this.trackGetters.size === 0) return;

        for (const [name, getter] of this.trackGetters.entries()) {
            try {
                const val = getter();
                this.setTrackedValue(name, val);
            } catch {
                this.setTrackedValue(name, 'undefined');
            }
        }
        this.updateTrackDisplay();
    }

    private setTrackedValue(label: string, value: any) {
        let formatted: string;
        if (value === undefined) {
            formatted = 'undefined';
        } else if (value === null) {
            formatted = 'null';
        } else if (typeof value === 'object') {
            try {
                formatted = JSON.stringify(value);
            } catch {
                formatted = '[Object]';
            }
        } else {
            formatted = String(value);
        }

        this.trackVars.set(label, formatted);
    }

    private updateTrackDisplay() {
        if (!this.trackText || !this.trackBg) return;

        if (this.trackVars.size === 0) {
            this.trackText.setText('');
            this.trackBg.setVisible(false);
            return;
        }

        const lines: string[] = [];
        for (const [name, val] of this.trackVars.entries()) {
            lines.push(`${name}: ${val}`);
        }
        this.trackText.setText(lines.join('\n'));
        this.trackBg.setVisible(true);

        // Dynamically resize and position background box with compact 8px padding
        const padding = 8;
        const boxWidth = this.trackText.width + padding * 2;
        const boxHeight = this.trackText.height + padding * 2;
        this.trackBg.setSize(boxWidth, boxHeight);
        this.trackBg.setPosition(1008 - boxWidth / 2, 16 + boxHeight / 2);
    }

    // --- Infinite Loop Protection & Code Transformations ---

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

    /**
     * Automatically transforms single-argument `track('myVar')` or `track(myVar)` calls
     * into `track('myVar', () => myVar)`. This captures the variable in a closure so it
     * dynamically reflects changes during update() ticks without needing repeated track() calls.
     */
    private injectTrackGetters(code: string): string {
        return code.replace(/\btrack\s*\(\s*(['"]?)([a-zA-Z_$][a-zA-Z0-9_$]*)\1\s*\)/g, (_, _quote, varName) => {
            return `track('${varName}', () => ${varName})`;
        });
    }

    // --- Code Sandboxing & Compilation ---

    /**
     * Compiles the player's code once so top-level variables (like `let counter = 0;`)
     * persist across ticks using a JavaScript closure.
     */
    private handleRunCode(rawCode: string) {
        // Reset any existing execution, character position, and tracked list
        this.stopCodeExecution();
        this.resetCharacter();

        try {
            // 1. Inject loop counter protection
            let preparedCode = this.injectLoopProtection(rawCode);

            // 2. Transform track('counter') into track('counter', () => counter)
            preparedCode = this.injectTrackGetters(preparedCode);

            // 3. Sandboxing & Closure Scope:
            // We use `new Function(...)` to construct a function factory.
            // Exposes ONLY: moveRight, moveLeft, stop, track.
            // Shadows: window, document, fetch, eval, Function.
            const createPlayerScope = new Function(
                'moveRight',
                'moveLeft',
                'stop',
                'track',
                'window',
                'document',
                'fetch',
                'eval',
                'Function',
                `
                ${preparedCode}
                return typeof update === 'function' ? update : null;
                `
            );

            // Execute the factory once to initialize top-level variables and retrieve the update function
            const updateFn = createPlayerScope(
                () => this.moveRight(),
                () => this.moveLeft(),
                () => this.stopMoving(),
                (label: string, valueOrGetter?: any) => this.registerTrack(label, valueOrGetter),
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

            // Evaluate initial tracked values immediately before the first tick
            this.evaluateTrackedVariables();

            // 4. Start the fixed tick loop (100ms / 10 times per second)
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
     * Calls the compiled player update() function wrapped in try/catch for safety,
     * then refreshes the tracked variables HUD.
     */
    private executePlayerTick() {
        if (!this.playerUpdateFn) return;

        try {
            this.playerUpdateFn();
            // Automatically re-evaluate tracked variables after update() runs
            this.evaluateTrackedVariables();
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
        this.trackGetters.clear();
        this.trackVars.clear();
        this.updateTrackDisplay();
    }
}
