import type { RuntimeAnimation, RuntimeRigData } from "./types.js";

export class RigFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RigFormatError";
  }
}

function object(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RigFormatError(`${label} must be an object`);
  }
}

export function parseRig(source: string | unknown): RuntimeRigData {
  let value: unknown;
  try {
    value = typeof source === "string" ? JSON.parse(source) : source;
  } catch (error) {
    throw new RigFormatError(`invalid JSON: ${(error as Error).message}`);
  }
  object(value, "rig");
  if (value.format !== "ankhimate-runtime") {
    throw new RigFormatError(`unsupported format ${JSON.stringify(value.format)}`);
  }
  if (value.context_version !== 1) {
    throw new RigFormatError(`unsupported context_version ${JSON.stringify(value.context_version)}`);
  }
  if (!Array.isArray(value.bones) || !Array.isArray(value.slots) || !Array.isArray(value.skins)) {
    throw new RigFormatError("bones, slots, and skins must be arrays");
  }
  object(value.animations, "animations");

  const boneNames = new Set<string>();
  value.bones.forEach((raw, index) => {
    object(raw, `bones[${index}]`);
    if (typeof raw.name !== "string" || boneNames.has(raw.name)) {
      throw new RigFormatError(`bones[${index}].name must be unique`);
    }
    if (!Number.isInteger(raw.parent) || (raw.parent as number) < -1 || (raw.parent as number) >= index) {
      throw new RigFormatError(`bones[${index}].parent must refer to an earlier bone or be -1`);
    }
    boneNames.add(raw.name);
  });

  const slotNames = new Set<string>();
  value.slots.forEach((raw, index) => {
    object(raw, `slots[${index}]`);
    if (typeof raw.name !== "string" || slotNames.has(raw.name)) {
      throw new RigFormatError(`slots[${index}].name must be unique`);
    }
    if (typeof raw.bone !== "string" || !boneNames.has(raw.bone)) {
      throw new RigFormatError(`slots[${index}].bone does not name a bone`);
    }
    slotNames.add(raw.name);
  });

  for (const [name, raw] of Object.entries(value.animations)) {
    object(raw, `animations.${name}`);
    if (typeof raw.duration !== "number" || raw.duration < 0 || !Number.isFinite(raw.duration)) {
      throw new RigFormatError(`animations.${name}.duration must be a finite non-negative number`);
    }
    for (const track of (raw.bones ?? []) as Array<{ name?: unknown }>) {
      if (typeof track.name !== "string" || !boneNames.has(track.name)) {
        throw new RigFormatError(`animations.${name} targets missing bone ${JSON.stringify(track.name)}`);
      }
    }
  }

  return value as unknown as RuntimeRigData;
}

export function animationOf(rig: RuntimeRigData, name: string): RuntimeAnimation {
  const animation = rig.animations[name];
  if (!animation) throw new Error(`unknown animation ${JSON.stringify(name)}`);
  return animation;
}

export function unsupportedFeatures(rig: RuntimeRigData): string[] {
  const features = new Set<string>();
  if (rig.constraints.length > 0) features.add("constraints");
  for (const skin of rig.skins) {
    for (const entry of skin.attachments) {
      if (entry.attachment.type !== "region") features.add(`${entry.attachment.type} attachments`);
    }
  }
  for (const animation of Object.values(rig.animations)) {
    if ((animation.deform?.length ?? 0) > 0) features.add("deform timelines");
    if ((animation.ik?.length ?? 0) > 0) features.add("IK timelines");
    if ((animation.transform?.length ?? 0) > 0) features.add("transform-constraint timelines");
  }
  return [...features];
}
