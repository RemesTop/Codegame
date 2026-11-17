import * as Phaser from 'phaser';

export type MovementState = 'LEFT' | 'RIGHT' | 'STOP';

/**
 * Player character entity extending Arcade Sprite.
 * Encapsulates movement state, horizontal kinematics (acceleration/deceleration),
 * and collision boundaries.
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
    public movementState: MovementState = 'STOP';

    // Spawn / Reset position
    private readonly spawnX: number;
    private readonly spawnY: number;

    // Horizontal Kinematics (isolated on X-axis so Y-axis gravity remains independent)
    private readonly maxSpeedX: number = 240; // Max horizontal speed (pixels/sec)
    private readonly accelerationX: number = 650; // Horizontal acceleration (pixels/sec^2)
    private readonly decelerationX: number = 750; // Horizontal braking/friction (pixels/sec^2)

    constructor(scene: Phaser.Scene, x: number, y: number, texture: string = 'dude') {
        // If the requested texture is not in cache, create a clean default sprite texture
        if (!scene.textures.exists(texture)) {
            const gfx = scene.make.graphics({ x: 0, y: 0 });
            gfx.fillStyle(0x000000, 1);
            gfx.fillRect(0, 0, 32, 48);
            gfx.lineStyle(2, 0xffffff, 1);
            gfx.strokeRect(0, 0, 32, 48);
            gfx.generateTexture(texture, 32, 48);
            gfx.destroy();
        }

        super(scene, x, y, texture);

        this.spawnX = x;
        this.spawnY = y;

        scene.add.existing(this);
        scene.physics.add.existing(this);

        // Keep side walls solid but allow falling off the bottom of the screen
        scene.physics.world.setBoundsCollision(true, true, true, false);
        this.setCollideWorldBounds(true);

        // Prevent bouncy landings on platforms
        this.setBounce(0, 0);

        // Terminal velocity cap to prevent tunneling through platforms at extreme speeds
        this.setMaxVelocity(this.maxSpeedX, 900);
    }

    /**
     * Called every frame from Scene.update() (~60 FPS).
     * Smoothly accelerates and decelerates horizontal velocity using Arcade Physics.
     */
    public update(delta: number): void {
        const dt = delta / 1000;

        // 1. Determine target horizontal velocity
        let targetVx = 0;
        if (this.movementState === 'RIGHT') {
            targetVx = this.maxSpeedX;
        } else if (this.movementState === 'LEFT') {
            targetVx = -this.maxSpeedX;
        }

        // 2. Smoothly approach target velocity using acceleration or deceleration
        const body = this.body as Phaser.Physics.Arcade.Body;
        if (!body) return;

        let currentVx = body.velocity.x;
        if (currentVx < targetVx) {
            const rate = targetVx === 0 ? this.decelerationX : this.accelerationX;
            currentVx = Math.min(currentVx + rate * dt, targetVx);
        } else if (currentVx > targetVx) {
            const rate = targetVx === 0 ? this.decelerationX : this.accelerationX;
            currentVx = Math.max(currentVx - rate * dt, targetVx);
        }

        this.setVelocityX(currentVx);

        // Once the player falls completely below the screen, halt vertical velocity so coordinates stay reasonable
        const screenBottom = this.scene.scale.height;
        if (this.y > screenBottom + 200) {
            this.setVelocityY(0);
        }
    }

    /**
     * Returns true if the player has fallen below the bottom of the screen.
     */
    public isOffScreen(): boolean {
        return this.y > this.scene.scale.height;
    }

    // --- Exposed Movement API for Player Code ---

    public moveRight(): void {
        this.movementState = 'RIGHT';
    }

    public moveLeft(): void {
        this.movementState = 'LEFT';
    }

    public stopMoving(): void {
        this.movementState = 'STOP';
    }

    /**
     * Resets character state, velocity, and position back to starting spawn coordinates.
     */
    public reset(): void {
        this.movementState = 'STOP';
        this.setVelocity(0, 0);
        this.setPosition(this.spawnX, this.spawnY);
    }
}

