import type Phaser from "phaser";
import { multiply } from "./evaluate.js";
import { RigPlayer } from "./player.js";
import { unsupportedFeatures } from "./rig.js";
import type { Affine, RegionAttachment, RigPose, RuntimeRigData, RuntimeSkin } from "./types.js";

export interface PhaserRigOptions {
  /** Texture keys indexed like `rig.atlas.pages`. */
  pageTextureKeys: readonly string[];
  skin?: string;
}

/**
 * A Phaser-owned view plus an Ankhimate player.
 *
 * Add `root` wherever a normal Container can be used, then call `update` with
 * Phaser's millisecond delta from your Scene update method.
 */
export class PhaserRig {
  readonly player: RigPlayer;
  readonly root: Phaser.GameObjects.Container;
  readonly unsupported: readonly string[];
  private readonly scene: Phaser.Scene;
  private readonly images = new Map<string, Phaser.GameObjects.Image>();
  private readonly attachments = new Map<string, RegionAttachment>();
  private readonly regions = new Map<string, { page: number; rotated: boolean }>();
  private readonly pageTextureKeys: readonly string[];

  constructor(scene: Phaser.Scene, rig: RuntimeRigData, options: PhaserRigOptions) {
    this.scene = scene;
    this.player = new RigPlayer(rig);
    this.root = scene.add.container(0, 0);
    this.pageTextureKeys = options.pageTextureKeys;
    this.unsupported = unsupportedFeatures(rig);
    this.installAtlasFrames(rig);
    this.selectSkin(rig, options.skin ?? rig.defaultSkin ?? rig.skins[0]?.name);
    this.apply(this.player.pose());
  }

  play(animation: string, restart = true): this {
    this.player.play(animation, restart);
    this.apply(this.player.pose());
    return this;
  }

  crossFade(animation: string, durationSeconds: number): this {
    this.player.crossFade(animation, durationSeconds);
    return this;
  }

  update(deltaMilliseconds: number): RigPose {
    const pose = this.player.update(deltaMilliseconds / 1000);
    this.apply(pose);
    return pose;
  }

  destroy(): void {
    this.root.destroy(true);
    this.images.clear();
  }

  private installAtlasFrames(rig: RuntimeRigData): void {
    if (!rig.atlas) return;
    for (const region of rig.atlas.regions) {
      const textureKey = this.pageTextureKeys[region.page];
      if (!textureKey) continue;
      const texture = this.scene.textures.get(textureKey);
      if (!texture.has(region.name)) {
        const frame = texture.add(region.name, 0, region.x, region.y, region.width, region.height);
        if (frame && (region.width !== region.original_width || region.height !== region.original_height)) {
          frame.setTrim(
            region.original_width,
            region.original_height,
            region.offset_x,
            region.offset_y,
            region.width,
            region.height,
          );
        }
      }
      this.regions.set(region.name, { page: region.page, rotated: region.rotated });
    }
  }

  private selectSkin(rig: RuntimeRigData, name: string | undefined): void {
    const skin: RuntimeSkin | undefined = rig.skins.find((candidate) => candidate.name === name);
    if (!skin) return;
    for (const entry of skin.attachments) {
      if (entry.attachment.type === "region") {
        this.attachments.set(`${entry.slot}\0${entry.name}`, entry.attachment as RegionAttachment);
      }
    }
  }

  private apply(pose: RigPose): void {
    const bones = new Map(pose.bones.map((bone) => [bone.name, bone.world]));
    const slots = new Map(pose.slots.map((slot) => [slot.name, slot]));
    const setupSlots = new Map(this.player.rig.slots.map((slot) => [slot.name, slot]));

    for (let order = 0; order < pose.drawOrder.length; order += 1) {
      const slotName = pose.drawOrder[order]!;
      const slot = slots.get(slotName);
      const setup = setupSlots.get(slotName);
      if (!slot || !setup) continue;
      const attachment = slot.attachment ? this.attachments.get(`${slotName}\0${slot.attachment}`) : undefined;
      let image = this.images.get(slotName);
      if (!attachment || !slot.visible) {
        image?.setVisible(false);
        continue;
      }
      const region = this.regions.get(attachment.texture);
      const textureKey = region ? this.pageTextureKeys[region.page] : undefined;
      if (!region || !textureKey || region.rotated) {
        image?.setVisible(false);
        continue;
      }
      if (!image) {
        image = this.scene.add.image(0, 0, textureKey, attachment.texture);
        this.root.add(image);
        this.images.set(slotName, image);
      } else {
        image.setTexture(textureKey, attachment.texture);
      }
      const boneWorld = bones.get(setup.bone);
      if (!boneWorld) continue;
      const world = multiply(boneWorld, attachmentAffine(attachment));
      const transformed = decomposeForPhaser(world);
      image
        .setVisible(true)
        .setDepth(order)
        .setOrigin(attachment.pivot_x, 1 - attachment.pivot_y)
        .setPosition(world.tx, -world.ty)
        .setRotation(-transformed.rotation)
        .setScale(transformed.scaleX, transformed.scaleY)
        .setAlpha(slot.color[3])
        .setTint(rgbTint(slot.color));
      image.setDisplaySize(attachment.width * Math.abs(transformed.scaleX), attachment.height * Math.abs(transformed.scaleY));
      image.setFlipX(transformed.scaleX < 0);
      image.setFlipY(transformed.scaleY < 0);
    }
  }
}

function attachmentAffine(attachment: RegionAttachment): Affine {
  const rotation = attachment.rotation * Math.PI / 180;
  return {
    a: Math.cos(rotation) * attachment.scale_x,
    b: Math.sin(rotation) * attachment.scale_x,
    c: -Math.sin(rotation) * attachment.scale_y,
    d: Math.cos(rotation) * attachment.scale_y,
    tx: attachment.x,
    ty: attachment.y,
  };
}

function decomposeForPhaser(matrix: Affine): { rotation: number; scaleX: number; scaleY: number } {
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  return {
    rotation: Math.atan2(matrix.b, matrix.a),
    scaleX,
    scaleY: Math.hypot(matrix.c, matrix.d) * (determinant < 0 ? -1 : 1),
  };
}

function rgbTint(color: readonly [number, number, number, number]): number {
  const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));
  return (byte(color[0]) << 16) | (byte(color[1]) << 8) | byte(color[2]);
}
