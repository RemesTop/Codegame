import * as Phaser from 'phaser';

export type MovementState = 'LEFT' | 'RIGHT' | 'STOP';

interface SleepParticle {
    text: Phaser.GameObjects.Text;
    offsetX: number;
    offsetY: number;
    vx: number;
    vy: number;
    ageMs: number;
    lifetimeMs: number;
    swayPhase: number;
}

/**
 * Player character entity extending Arcade Sprite.
 * Encapsulates movement state, horizontal kinematics (acceleration/deceleration),
 * and collision boundaries.
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
    public movementState: MovementState = 'STOP';

    // Spawn / Reset position
    private spawnX: number;
    private spawnY: number;

    // Horizontal Kinematics (isolated on X-axis so Y-axis gravity remains independent)
    private readonly maxSpeedX: number = 240; // Max horizontal speed (pixels/sec)
    private readonly accelerationX: number = 650; // Horizontal acceleration (pixels/sec^2)
    private readonly decelerationX: number = 750; // Horizontal braking/friction (pixels/sec^2)
    private readonly jumpVelocityY: number = 400; // Upward jump impulse (pixels/sec)

    // Sleep indicator ("z" particle) state
    private isSleeping: boolean = false;
    private sleepParticleCooldownMs: number = 0;
    private readonly sleepParticleIntervalMs: number = 450;
    private readonly sleepParticleLifetimeMs: number = 900;
    private sleepParticles: SleepParticle[] = [];

    // Held keycard state (shown to the right of the player)
    public hasKeycard: boolean = false;
    private heldKeycardSprite: Phaser.GameObjects.Image | null = null;
    private postUpdateBound: boolean = false;

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
        this.updateSleepParticles(delta);
        this.updateHeldKeycard();
    }

    public setHasKeycard(hasKeycard: boolean): void {
        this.hasKeycard = hasKeycard;
        if (hasKeycard) {
            if (!this.heldKeycardSprite && this.scene?.add?.image) {
                this.heldKeycardSprite = this.scene.add
                    .image(Math.round(this.x), Math.round(this.y), 'keycard')
                    .setOrigin(0.5, 0.5)
                    .setDepth((this.depth ?? 10) + 1);
            }
            if (!this.postUpdateBound && this.scene?.events?.on) {
                this.scene.events.on(
                    Phaser.Scenes.Events.POST_UPDATE,
                    this.updateHeldKeycard,
                    this
                );
                this.postUpdateBound = true;
            }
            if (this.heldKeycardSprite) {
                this.heldKeycardSprite.setVisible(true);
                this.updateHeldKeycard();
            }
        } else if (this.heldKeycardSprite) {
            this.heldKeycardSprite.setVisible(false);
        }
    }

    public syncHeldKeycardAlpha(): void {
        if (this.heldKeycardSprite && this.hasKeycard) {
            this.heldKeycardSprite.setAlpha(this.alpha);
        }
    }

    private updateHeldKeycard(): void {
        if (!this.hasKeycard || !this.heldKeycardSprite) return;

        const halfWidth = (this.displayWidth || this.width || 32) / 2;
        const offsetX = halfWidth + 18;
        this.heldKeycardSprite.setPosition(
            Math.round(this.x + offsetX),
            Math.round(this.y - 4)
        );
        this.heldKeycardSprite.setAlpha(this.alpha);
    }

    public setSleeping(sleeping: boolean): void {
        this.isSleeping = sleeping;
    }

    private updateSleepParticles(delta: number): void {
        if (this.sleepParticleCooldownMs > 0) {
            this.sleepParticleCooldownMs = Math.max(0, this.sleepParticleCooldownMs - delta);
        }

        if (this.isSleeping && this.sleepParticleCooldownMs <= 0) {
            this.spawnSleepParticle();
            this.sleepParticleCooldownMs = this.sleepParticleIntervalMs;
        }

        const dt = delta / 1000;
        for (let i = this.sleepParticles.length - 1; i >= 0; i--) {
            const p = this.sleepParticles[i];
            p.ageMs += delta;
            if (p.ageMs >= p.lifetimeMs) {
                p.text.destroy();
                this.sleepParticles.splice(i, 1);
                continue;
            }

            const progress = p.ageMs / p.lifetimeMs;
            p.offsetX += p.vx * dt;
            p.offsetY += p.vy * dt;
            const swayX = Math.sin((p.ageMs / 1000) * 5 + p.swayPhase) * 5;
            p.text.setPosition(this.x + p.offsetX + swayX, this.y + p.offsetY);
            p.text.setAlpha(1 - progress * progress);
            p.text.setScale(0.75 + progress * 0.35);
        }
    }

    private spawnSleepParticle(): void {
        if (!this.scene?.add?.text) return;

        const halfHeight = (this.displayHeight || this.height || 48) / 2;
        const offsetX = Math.random() * 12 + 8;
        const offsetY = -halfHeight - 4;
        const startX = this.x + offsetX;
        const startY = this.y + offsetY;

        const text = this.scene.add.text(startX, startY, 'z', {
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            fontSize: '13px',
            fontStyle: 'bold',
            color: '#ffffff',
            stroke: '#0f172a',
            strokeThickness: 3,
            resolution: 2,
        });
        text.setOrigin(0.5, 0.5);
        text.setDepth((this.depth ?? 10) + 1);
        text.setScale(0.75);

        this.sleepParticles.push({
            text,
            offsetX,
            offsetY,
            vx: 8 + Math.random() * 8,
            vy: -36 - Math.random() * 10,
            ageMs: 0,
            lifetimeMs: this.sleepParticleLifetimeMs,
            swayPhase: Math.random() * Math.PI * 2,
        });
    }

    private clearSleepParticles(): void {
        for (const p of this.sleepParticles) {
            p.text.destroy();
        }
        this.sleepParticles = [];
    }

    /**
     * Returns true if the player has fallen below the bottom of the level.
     */
    public isOffScreen(): boolean {
        const worldBottom = Math.max(
            this.scene.scale.height,
            this.scene.physics.world.bounds.bottom
        );
        return this.y > worldBottom;
    }

    public setSpawnPosition(x: number, y: number): void {
        this.spawnX = x;
        this.spawnY = y;
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

    public jump(): void {
        const body = this.body as Phaser.Physics.Arcade.Body | null;
        if (body && body.onFloor()) {
            this.setVelocityY(-this.jumpVelocityY);
        }
    }

    /**
     * Resets character state, velocity, and position back to starting spawn coordinates.
     */
    public reset(): void {
        this.movementState = 'STOP';
        this.isSleeping = false;
        this.sleepParticleCooldownMs = 0;
        this.clearSleepParticles();
        this.setHasKeycard(false);
        if (typeof this.setAlpha === 'function') {
            this.setAlpha(1);
        } else {
            this.alpha = 1;
        }
        const body = this.body as Phaser.Physics.Arcade.Body | null;
        if (body) {
            body.reset(this.spawnX, this.spawnY);
        } else {
            this.setVelocity(0, 0);
            this.setPosition(this.spawnX, this.spawnY);
        }
    }

    public override destroy(fromScene?: boolean): void {
        this.clearSleepParticles();
        if (this.postUpdateBound && this.scene?.events?.off) {
            this.scene.events.off(
                Phaser.Scenes.Events.POST_UPDATE,
                this.updateHeldKeycard,
                this
            );
            this.postUpdateBound = false;
        }
        this.heldKeycardSprite?.destroy();
        this.heldKeycardSprite = null;
        super.destroy(fromScene);
    }
}

