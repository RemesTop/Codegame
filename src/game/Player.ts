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

interface CharacterRig {
    root: Phaser.GameObjects.Container;
    head: Phaser.GameObjects.Image;
    core: Phaser.GameObjects.Image;
    legFront: Phaser.GameObjects.Image;
    legBack: Phaser.GameObjects.Image;
    frontArm: Phaser.GameObjects.Container;
    frontForearm: Phaser.GameObjects.Container;
    backArm: Phaser.GameObjects.Container;
    backForearm: Phaser.GameObjects.Container;
}

const PLAYER_HITBOX_WIDTH = 62;
const PLAYER_HITBOX_HEIGHT = 112;
const PLAYER_RIG_GROUND_OFFSET_Y = 4;

// Relaxed idle arm angles (elbows drop beneath shoulders, forearms hang down)
const IDLE_FRONT_ARM_ROT = -0.32;
const IDLE_FRONT_FOREARM_ROT = 0.62;
const IDLE_BACK_ARM_ROT = -0.28;
const IDLE_BACK_FOREARM_ROT = 0.56;

const PLAYER_PART_TEXTURES: ReadonlyArray<{ key: string; path: string }> = [
    { key: 'player-head', path: 'Player/character_head.png' },
    { key: 'player-core', path: 'Player/character_core.png' },
    { key: 'player-arm1-high', path: 'Player/arm1_high.png' },
    { key: 'player-arm1-low', path: 'Player/arm1_low.png' },
    { key: 'player-arm2-high', path: 'Player/arm2_high.png' },
    { key: 'player-arm2-low', path: 'Player/arm2_low.png' },
    { key: 'player-leg-front', path: 'Player/leg_front.png' },
    { key: 'player-leg-back', path: 'Player/leg_back.png' },
];

/**
 * Player character entity extending Arcade Sprite.
 * Encapsulates movement state, horizontal kinematics (acceleration/deceleration),
 * procedural 2D cutout rig animation, and collision boundaries.
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
    public movementState: MovementState = 'STOP';

    // Spawn / Reset position
    private spawnX: number;
    private spawnY: number;

    // Horizontal Kinematics (isolated on X-axis so Y-axis gravity remains independent)
    private readonly maxSpeedX: number = 480; // Max horizontal speed (pixels/sec, 7.5 tiles/sec)
    private readonly accelerationX: number = 1300; // Horizontal acceleration (pixels/sec^2)
    private readonly decelerationX: number = 1500; // Horizontal braking/friction (pixels/sec^2)
    private readonly jumpVelocityY: number = 800; // Upward jump impulse (pixels/sec)

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

    // Cutout character rig & procedural animation state
    private rig: CharacterRig | null = null;
    private readonly rigScale: number = 0.96; // ~117px tall (bigger, still under 2 tiles / 128px)
    private facing: 1 | -1 = 1;
    private walkPhase: number = 0;

    /**
     * Preloads all individual body-part PNGs for the player cutout rig.
     * Expects `scene.load.setPath('assets')` to already be configured.
     */
    public static preload(scene: Phaser.Scene): void {
        if (!scene?.load?.image) return;
        for (const part of PLAYER_PART_TEXTURES) {
            if (!scene.textures?.exists?.(part.key)) {
                scene.load.image(part.key, part.path);
            }
        }
    }

    constructor(scene: Phaser.Scene, x: number, y: number, texture: string = 'player-hitbox') {
        const useRig =
            Boolean(scene.textures?.exists?.('player-head')) &&
            typeof scene.add?.container === 'function';
        const baseTexture = useRig ? 'player-hitbox' : texture;

        // Generate an invisible 62x112 hitbox texture when the rig is active,
        // or a visible fallback box if body-part textures are not loaded.
        if (!scene.textures.exists(baseTexture)) {
            const gfx = scene.make.graphics({ x: 0, y: 0 });
            if (!useRig) {
                gfx.fillStyle(0x000000, 1);
                gfx.fillRect(0, 0, PLAYER_HITBOX_WIDTH, PLAYER_HITBOX_HEIGHT);
                gfx.lineStyle(4, 0xffffff, 1);
                gfx.strokeRect(0, 0, PLAYER_HITBOX_WIDTH, PLAYER_HITBOX_HEIGHT);
            }
            gfx.generateTexture(baseTexture, PLAYER_HITBOX_WIDTH, PLAYER_HITBOX_HEIGHT);
            gfx.destroy();
        }

        super(scene, x, y, baseTexture);

        this.spawnX = x;
        this.spawnY = y;

        scene.add.existing(this);
        scene.physics.add.existing(this);

        const body = this.body as Phaser.Physics.Arcade.Body | null;
        if (body && typeof body.setSize === 'function') {
            body.setSize(PLAYER_HITBOX_WIDTH, PLAYER_HITBOX_HEIGHT, true);
        }

        // Keep side walls solid but allow falling off the bottom of the screen
        scene.physics.world.setBoundsCollision(true, true, true, false);
        this.setCollideWorldBounds(true);

        // Prevent bouncy landings on platforms
        this.setBounce(0, 0);

        // Terminal velocity cap to prevent tunneling through platforms at extreme speeds
        this.setMaxVelocity(this.maxSpeedX, 1800);

        if (useRig) {
            this.buildCharacterRig();
            this.resetRigPose();
            this.ensurePostUpdateBound();
            this.syncAttachments();
        }
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
        this.updateRig(delta, currentVx);
        this.updateSleepParticles(delta);
        this.syncAttachments();
    }

    /**
     * Assembles the 8 body-part sprites into a layered cutout rig anchored at
     * local (0, 0) = bottom-center of the physics hitbox (ground contact point).
     */
    private buildCharacterRig(): void {
        const add = this.scene.add;

        // 1. Back arm (behind torso and legs)
        const arm2High = add.image(0, 0, 'player-arm2-high').setOrigin(0.75, 0.2);
        const arm2Low = add.image(0, 0, 'player-arm2-low').setOrigin(0.22, 0.2);
        const backForearm = add.container(-7, 14, [arm2Low]);
        const backArm = add.container(18, -58, [arm2High, backForearm]);

        // 2. Legs (behind torso so hip tops stay tucked cleanly beneath the core)
        const legBack = add.image(8, -34, 'player-leg-back').setOrigin(0.45, 0.15);
        const legFront = add.image(-6, -35, 'player-leg-front').setOrigin(0.45, 0.15);

        // 3. Torso core & CRT monitor head
        const core = add.image(0, -54, 'player-core').setOrigin(0.5, 0.5);
        const head = add.image(2, -66, 'player-head').setOrigin(0.5, 0.88);

        // 4. Front arm (forearm behind upper-arm elbow cap so the joint stays seamless)
        const arm1Low = add.image(0, 0, 'player-arm1-low').setOrigin(0.22, 0.2);
        const frontForearm = add.container(-9, 14, [arm1Low]);
        const arm1High = add.image(0, 0, 'player-arm1-high').setOrigin(0.75, 0.2);
        const frontArm = add.container(-10, -54, [frontForearm, arm1High]);

        const root = add.container(
            Math.round(this.x),
            Math.round(this.y + PLAYER_HITBOX_HEIGHT / 2 + PLAYER_RIG_GROUND_OFFSET_Y),
            [backArm, legBack, legFront, core, head, frontArm]
        );
        root.setScale(this.rigScale, this.rigScale);
        root.setDepth(this.depth ?? 10);

        this.rig = {
            root,
            head,
            core,
            legFront,
            legBack,
            frontArm,
            frontForearm,
            backArm,
            backForearm,
        };
    }

    private updateRig(delta: number, currentVx: number): void {
        if (!this.rig) return;

        const dt = delta / 1000;
        const body = this.body as Phaser.Physics.Arcade.Body | null;

        if (this.movementState === 'LEFT' || currentVx < -10) {
            this.facing = -1;
        } else if (this.movementState === 'RIGHT' || currentVx > 10) {
            this.facing = 1;
        }

        const onFloor =
            body && typeof body.onFloor === 'function' ? body.onFloor() : true;
        const vy = body?.velocity?.y ?? 0;
        const isAirborne = !onFloor || vy < -40;
        const speedRatio = Math.min(1, Math.abs(currentVx) / this.maxSpeedX);

        if (!isAirborne && speedRatio > 0.02) {
            this.walkPhase = (this.walkPhase ?? 0) + dt * (4 + speedRatio * 10);
        }

        let targetLegFront = 0;
        let targetLegBack = 0;
        let targetFrontArm = 0;
        let targetFrontForearm = 0;
        let targetBackArm = 0;
        let targetBackForearm = 0;
        let targetCoreRot = 0;
        let targetHeadRot = 0;
        let bodyBobY = 0;
        let blendRate = 14;

        if (isAirborne) {
            // Smoothly transition across the jump arc from upward launch (fallBlend=0)
            // through apex (fallBlend~0.33) to downward fall (fallBlend=1) without
            // ever collapsing back to a flat standing pose at vy=0.
            const fallBlend = Math.max(0, Math.min(1, (vy + 200) / 600));
            const mix = (riseVal: number, fallVal: number) =>
                riseVal + (fallVal - riseVal) * fallBlend;

            targetLegFront = mix(-0.68, -0.42);
            targetLegBack = mix(0.58, 0.52);
            targetFrontArm = mix(-1.25, 0.55);
            targetFrontForearm = mix(-0.85, -0.85);
            targetBackArm = mix(0.55, -1.2);
            targetBackForearm = mix(-0.6, -0.7);
            targetCoreRot = mix(-0.06, 0.05);
            targetHeadRot = mix(-0.14, 0.08);
            bodyBobY = mix(-3, -1);
            blendRate = 22;
        } else if (speedRatio > 0.02) {
            // Contralateral run stride
            const stride = Math.sin(this.walkPhase) * speedRatio;
            targetLegFront = stride * 0.58;
            targetLegBack = -stride * 0.58;
            targetFrontArm = -stride * 0.55;
            targetFrontForearm = Math.max(0, -stride) * -0.28;
            targetBackArm = stride * 0.55;
            targetBackForearm = Math.max(0, stride) * -0.28;
            targetCoreRot = speedRatio * 0.06;
            targetHeadRot = speedRatio * 0.04;
            bodyBobY = -Math.abs(Math.sin(this.walkPhase)) * 3 * speedRatio;
            blendRate = 16;
        } else {
            // Idle: no breathing bob; smoothly relax arms down along the sides
            targetFrontArm = IDLE_FRONT_ARM_ROT;
            targetFrontForearm = IDLE_FRONT_FOREARM_ROT;
            targetBackArm = IDLE_BACK_ARM_ROT;
            targetBackForearm = IDLE_BACK_FOREARM_ROT;
            blendRate = 7;
        }

        const blend = Math.min(1, 1 - Math.exp(-blendRate * dt));
        const lerp = (cur: number, target: number) => cur + (target - cur) * blend;

        this.rig.legFront.rotation = lerp(this.rig.legFront.rotation, targetLegFront);
        this.rig.legBack.rotation = lerp(this.rig.legBack.rotation, targetLegBack);
        this.rig.frontArm.rotation = lerp(this.rig.frontArm.rotation, targetFrontArm);
        this.rig.frontForearm.rotation = lerp(
            this.rig.frontForearm.rotation,
            targetFrontForearm
        );
        this.rig.backArm.rotation = lerp(this.rig.backArm.rotation, targetBackArm);
        this.rig.backForearm.rotation = lerp(
            this.rig.backForearm.rotation,
            targetBackForearm
        );
        this.rig.core.rotation = lerp(this.rig.core.rotation, targetCoreRot);
        this.rig.head.rotation = lerp(this.rig.head.rotation, targetHeadRot);

        this.rig.core.y = -54 + bodyBobY;
        this.rig.head.y = -66 + bodyBobY * 1.15;
        this.rig.frontArm.y = -54 + bodyBobY;
        this.rig.backArm.y = -58 + bodyBobY;
    }

    private resetRigPose(): void {
        if (!this.rig) return;
        this.rig.legFront.rotation = 0;
        this.rig.legBack.rotation = 0;
        this.rig.frontArm.rotation = IDLE_FRONT_ARM_ROT;
        this.rig.frontForearm.rotation = IDLE_FRONT_FOREARM_ROT;
        this.rig.backArm.rotation = IDLE_BACK_ARM_ROT;
        this.rig.backForearm.rotation = IDLE_BACK_FOREARM_ROT;
        this.rig.core.rotation = 0;
        this.rig.head.rotation = 0;
        this.rig.core.y = -54;
        this.rig.head.y = -66;
        this.rig.frontArm.y = -54;
        this.rig.backArm.y = -58;
    }

    private ensurePostUpdateBound(): void {
        if (!this.postUpdateBound && this.scene?.events?.on) {
            const eventName = Phaser.Scenes?.Events?.POST_UPDATE ?? 'postupdate';
            this.scene.events.on(eventName, this.syncAttachments, this);
            this.postUpdateBound = true;
        }
    }

    private syncAttachments(): void {
        if (this.rig) {
            const body = this.body as Phaser.Physics.Arcade.Body | null;
            const bottomY = body
                ? body.position.y + body.height
                : this.y + (this.displayHeight || this.height || PLAYER_HITBOX_HEIGHT) / 2;
            const facing = this.facing ?? 1;
            const scale = this.rigScale ?? 0.96;
            this.rig.root.setPosition(
                Math.round(this.x),
                Math.round(bottomY + PLAYER_RIG_GROUND_OFFSET_Y)
            );
            this.rig.root.setScale(facing * scale, scale);
            this.rig.root.setDepth(this.depth ?? 10);
            this.rig.root.setAlpha(this.alpha ?? 1);
        }
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
            this.ensurePostUpdateBound();
            if (this.heldKeycardSprite) {
                this.heldKeycardSprite.setVisible(true);
                this.updateHeldKeycard();
            }
        } else if (this.heldKeycardSprite) {
            this.heldKeycardSprite.setVisible(false);
        }
    }

    public syncHeldKeycardAlpha(): void {
        if (this.rig) {
            this.rig.root.setAlpha(this.alpha ?? 1);
        }
        if (this.heldKeycardSprite && this.hasKeycard) {
            this.heldKeycardSprite.setAlpha(this.alpha);
        }
    }

    private updateHeldKeycard(): void {
        if (!this.hasKeycard || !this.heldKeycardSprite) return;

        const halfWidth = (this.displayWidth || this.width || 64) / 2;
        const offsetX = halfWidth + 36;
        this.heldKeycardSprite.setPosition(
            Math.round(this.x + offsetX),
            Math.round(this.y - 8)
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
            const swayX = Math.sin((p.ageMs / 1000) * 5 + p.swayPhase) * 10;
            p.text.setPosition(this.x + p.offsetX + swayX, this.y + p.offsetY);
            p.text.setAlpha(1 - progress * progress);
            p.text.setScale(0.75 + progress * 0.35);
        }
    }

    private spawnSleepParticle(): void {
        if (!this.scene?.add?.text) return;

        const halfHeight = (this.displayHeight || this.height || 96) / 2;
        const offsetX = Math.random() * 24 + 16;
        const offsetY = -halfHeight - 8;
        const startX = this.x + offsetX;
        const startY = this.y + offsetY;

        const text = this.scene.add.text(startX, startY, 'z', {
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            fontSize: '26px',
            fontStyle: 'bold',
            color: '#ffffff',
            stroke: '#0f172a',
            strokeThickness: 6,
            resolution: 2,
        });
        text.setOrigin(0.5, 0.5);
        text.setDepth((this.depth ?? 10) + 1);
        text.setScale(0.75);

        this.sleepParticles.push({
            text,
            offsetX,
            offsetY,
            vx: 16 + Math.random() * 16,
            vy: -72 - Math.random() * 20,
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
        this.facing = 1;
        this.walkPhase = 0;
        this.resetRigPose();
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
        this.syncAttachments();
    }

    public override destroy(fromScene?: boolean): void {
        this.clearSleepParticles();
        if (this.postUpdateBound && this.scene?.events?.off) {
            const eventName = Phaser.Scenes?.Events?.POST_UPDATE ?? 'postupdate';
            this.scene.events.off(eventName, this.syncAttachments, this);
            this.postUpdateBound = false;
        }
        this.rig?.root.destroy();
        this.rig = null;
        this.heldKeycardSprite?.destroy();
        this.heldKeycardSprite = null;
        super.destroy(fromScene);
    }
}

