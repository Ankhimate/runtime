export type Curve =
  | "linear"
  | "stepped"
  | { type: "bezier"; handles: readonly [number, number, number, number] };

export interface ScalarKey {
  time: number;
  value: number;
  curve: Curve;
}

export interface VectorKey {
  time: number;
  x: number;
  y: number;
  curve: Curve;
}

export interface BoneTrack {
  name: string;
  offset?: number;
  translate?: VectorKey[];
  rotate?: ScalarKey[];
  scale?: VectorKey[];
  shear?: VectorKey[];
}

export interface SlotTrackKey {
  time: number;
  value?: boolean;
  name?: string | null;
  color?: readonly [number, number, number, number];
}

export interface SlotTrack {
  name: string;
  channel: "visible" | "attachment" | "color";
  keys: SlotTrackKey[];
}

export interface DrawOrderKey {
  time: number;
  offsets: Array<{ slot: string; offset: number }>;
}

export interface RuntimeEvent {
  time: number;
  name: string;
  int?: number;
  float?: number;
  string?: string;
  audio?: string | null;
  volume?: number;
  balance?: number;
}

export interface RuntimeAnimation {
  duration: number;
  looping: boolean;
  bones: BoneTrack[];
  slots: SlotTrack[];
  drawOrder: DrawOrderKey[];
  events: RuntimeEvent[];
  deform?: unknown[];
  ik?: unknown[];
  transform?: unknown[];
}

export interface RuntimeBone {
  name: string;
  parent: number;
  length: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  shearX: number;
  shearY: number;
  inheritRotation: boolean;
  inheritScale: boolean;
  inheritReflect: boolean;
}

export interface RuntimeSlot {
  name: string;
  bone: string;
  attachment: string | null;
  color: string;
  blend: string;
}

export interface RegionAttachment {
  type: "region";
  texture: string;
  x: number;
  y: number;
  rotation: number;
  scale_x: number;
  scale_y: number;
  width: number;
  height: number;
  source_width: number;
  source_height: number;
  pivot_x: number;
  pivot_y: number;
}

export interface SkinAttachment {
  slot: string;
  name: string;
  attachment: RegionAttachment | { type: string; [key: string]: unknown };
}

export interface RuntimeSkin {
  name: string;
  attachments: SkinAttachment[];
}

export interface AtlasPage {
  index: number;
  width: number;
  height: number;
  file: string;
}

export interface AtlasRegion {
  name: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  offset_x: number;
  offset_y: number;
  original_width: number;
  original_height: number;
  rotated: boolean;
}

export interface RuntimeAtlas {
  pages: AtlasPage[];
  regions: AtlasRegion[];
}

export interface RuntimeRigData {
  format: "ankhimate-runtime";
  context_version: 1;
  name: string;
  fps: number;
  bones: RuntimeBone[];
  slots: RuntimeSlot[];
  drawOrder: string[];
  defaultSkin: string | null;
  skins: RuntimeSkin[];
  constraints: unknown[];
  constraintOrder: unknown[];
  animations: Record<string, RuntimeAnimation>;
  atlas: RuntimeAtlas | null;
}

export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export interface BonePose {
  name: string;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  shearX: number;
  shearY: number;
  world: Affine;
}

export interface SlotPose {
  name: string;
  attachment: string | null;
  visible: boolean;
  color: readonly [number, number, number, number];
}

export interface RigPose {
  bones: BonePose[];
  slots: SlotPose[];
  drawOrder: string[];
}

export interface AnimationLayer {
  animation: string;
  time: number;
  alpha: number;
}
