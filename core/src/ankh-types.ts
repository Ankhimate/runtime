export interface AnkhAsset {
  name: string;
  file: string;
  width: number;
  height: number;
  [key: string]: unknown;
}

export interface AnkhBone {
  name: string;
  parent?: string;
  local?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AnkhSlot {
  name: string;
  bone: string;
  attachment?: string | null;
  [key: string]: unknown;
}

export interface AnkhAttachment {
  type: string;
  texture?: string;
  pivot_x?: number;
  pivot_y?: number;
  uv?: [number, number, number, number];
  [key: string]: unknown;
}

export interface AnkhSkinEntry {
  slot: string;
  name: string;
  attachment: AnkhAttachment;
  [key: string]: unknown;
}

export interface AnkhSkin {
  name: string;
  entries: AnkhSkinEntry[];
  [key: string]: unknown;
}

export interface AnkhTimeline {
  kind: string;
  keys: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface AnkhAnimation {
  name: string;
  duration: number;
  looping: boolean;
  timelines: AnkhTimeline[];
  events: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface AnkhProject {
  version: 1;
  name: string;
  fps: number;
  assets: AnkhAsset[];
  bones: AnkhBone[];
  slots: AnkhSlot[];
  draw_order: string[];
  skins: AnkhSkin[];
  default_skin?: string;
  constraints: Array<Record<string, unknown>>;
  constraint_order: string[];
  animations: AnkhAnimation[];
  [key: string]: unknown;
}

export interface LoadedAnkh {
  project: AnkhProject;
  assets: ReadonlyMap<string, Uint8Array>;
}
