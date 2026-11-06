import * as Phaser from 'phaser';

/**
 * GameHUD handles rendering the top-right tracked variables display.
 * Dynamically resizes a semi-transparent card background to fit tracked lines.
 */
export class GameHUD {
    private scene: Phaser.Scene;
    private trackVars: Map<string, string> = new Map();
    private trackGetters: Map<string, () => any> = new Map();
    private trackBg: Phaser.GameObjects.Rectangle;
    private trackText: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;

        // Compact semi-transparent dark background card in top-right corner
        this.trackBg = this.scene.add.rectangle(0, 0, 100, 30, 0x1e1e1e, 0.85);
        this.trackBg.setStrokeStyle(1, 0x444444);
        this.trackBg.setDepth(200);
        this.trackBg.setVisible(false);

        // Compact monospace text display aligned to the top-right
        this.trackText = this.scene.add.text(1008 - 8, 16 + 8, '', {
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            fontSize: '14px',
            color: '#00ffcc',
            align: 'right',
            lineSpacing: 4,
            resolution: 2, // High-resolution rendering to prevent blurriness
        });
        this.trackText.setOrigin(1, 0);
        this.trackText.setDepth(201);
    }

    /**
     * Registers a variable or getter function to display on the HUD.
     */
    registerTrack(label: string, valueOrGetter?: any): void {
        const key = String(label);
        if (typeof valueOrGetter === 'function') {
            this.trackGetters.set(key, valueOrGetter);
        } else {
            this.trackGetters.set(key, () => valueOrGetter);
        }
        this.evaluateTrackedVariables();
    }

    /**
     * Re-evaluates all registered getters and updates the HUD display.
     */
    evaluateTrackedVariables(): void {
        if (this.trackGetters.size === 0) return;

        for (const [name, getter] of this.trackGetters.entries()) {
            try {
                const val = getter();
                this.setTrackedValue(name, val);
            } catch {
                this.setTrackedValue(name, 'undefined');
            }
        }
        this.updateDisplay();
    }

    private setTrackedValue(label: string, value: any): void {
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

    updateDisplay(): void {
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

        // Dynamically resize and position background box with 8px padding
        const padding = 8;
        const boxWidth = Math.round(this.trackText.width + padding * 2);
        const boxHeight = Math.round(this.trackText.height + padding * 2);
        this.trackBg.setSize(boxWidth, boxHeight);
        this.trackBg.setPosition(
            Math.round(1008 - boxWidth / 2),
            Math.round(16 + boxHeight / 2)
        );
    }

    reset(): void {
        this.trackGetters.clear();
        this.trackVars.clear();
        this.updateDisplay();
    }

    destroy(): void {
        this.trackBg.destroy();
        this.trackText.destroy();
    }
}

