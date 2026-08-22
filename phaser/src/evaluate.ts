import type {
  Affine,
  AnimationLayer,
  BonePose,
  Curve,
  RigPose,
  RuntimeRigData,
  ScalarKey,
  SlotPose,
  VectorKey,
} from "./types.js";
import { animationOf } from "./rig.js";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

function wrap(angle: number): number {
  angle = ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return angle <= -Math.PI ? angle + TAU : angle;
}

function bezierAxis(t: number, p1: number, p2: number): number {
  const inv = 1 - t;
  return 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t;
}

function bezierEase(target: number, handles: readonly [number, number, number, number]): number {
  const [x1, y1, x2, y2] = handles;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 20; i += 1) {
    const mid = (low + high) / 2;
    if (bezierAxis(mid, x1, x2) < target) low = mid;
    else high = mid;
  }
  return bezierAxis((low + high) / 2, y1, y2);
}

function ease(fraction: number, curve: Curve): number {
  if (curve === "linear") return fraction;
  if (curve === "stepped") return 0;
  return bezierEase(fraction, curve.handles);
}

function span<T extends { time: number; curve?: Curve }>(keys: readonly T[], time: number): [T, T, number] | undefined {
  const first = keys[0];
  if (!first) return undefined;
  if (keys.length === 1 || time <= first.time) return [first, first, 0];
  const last = keys[keys.length - 1]!;
  if (time >= last.time) return [last, last, 0];
  let low = 0;
  let high = keys.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (keys[mid]!.time <= time) low = mid;
    else high = mid;
  }
  const from = keys[low]!;
  const to = keys[high]!;
  const raw = to.time > from.time ? (time - from.time) / (to.time - from.time) : 1;
  return [from, to, ease(raw, to.curve ?? "linear")];
}

function scalar(keys: readonly ScalarKey[], time: number, angle = false): number | undefined {
  const located = span(keys, time);
  if (!located) return undefined;
  const [from, to, t] = located;
  if (from === to) return from.value;
  let delta = to.value - from.value;
  if (angle) delta = wrap(delta * DEG) / DEG;
  return from.value + delta * t;
}

function vector(keys: readonly VectorKey[], time: number): readonly [number, number] | undefined {
  const located = span(keys, time);
  if (!located) return undefined;
  const [from, to, t] = located;
  return [from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t];
}

function compose(pose: Omit<BonePose, "name" | "world">): Affine {
  const xAngle = pose.rotation + pose.shearX;
  const yAngle = pose.rotation + Math.PI / 2 + pose.shearY;
  return {
    a: Math.cos(xAngle) * pose.scaleX,
    b: Math.sin(xAngle) * pose.scaleX,
    c: Math.cos(yAngle) * pose.scaleY,
    d: Math.sin(yAngle) * pose.scaleY,
    tx: pose.x,
    ty: pose.y,
  };
}

export function multiply(left: Affine, right: Affine): Affine {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    tx: left.a * right.tx + left.c * right.ty + left.tx,
    ty: left.b * right.tx + left.d * right.ty + left.ty,
  };
}

function decompose(matrix: Affine): { rotation: number; scaleX: number; scaleY: number; shearY: number } {
  const rotation = Math.atan2(matrix.b, matrix.a);
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const det = matrix.a * matrix.d - matrix.b * matrix.c;
  const scaleY = Math.hypot(matrix.c, matrix.d) * (det < 0 ? -1 : 1);
  const yAngle = scaleY < 0 ? Math.atan2(-matrix.d, -matrix.c) : Math.atan2(matrix.d, matrix.c);
  return { rotation, scaleX, scaleY, shearY: wrap(yAngle - rotation - Math.PI / 2) };
}

function childWorld(parent: Affine, local: Omit<BonePose, "name" | "world">, bone: RuntimeRigData["bones"][number]): Affine {
  const localMatrix = compose(local);
  if (bone.inheritRotation && bone.inheritScale && bone.inheritReflect) {
    return multiply(parent, localMatrix);
  }
  const originX = parent.a * local.x + parent.c * local.y + parent.tx;
  const originY = parent.b * local.x + parent.d * local.y + parent.ty;
  const inherited = decompose(parent);
  let inheritedScaleY = bone.inheritScale ? inherited.scaleY : 1;
  if (!bone.inheritReflect && inheritedScaleY < 0) inheritedScaleY *= -1;
  const effective = compose({
    x: 0,
    y: 0,
    rotation: bone.inheritRotation ? inherited.rotation : 0,
    scaleX: bone.inheritScale ? inherited.scaleX : 1,
    scaleY: inheritedScaleY,
    shearX: 0,
    shearY: bone.inheritScale ? inherited.shearY : 0,
  });
  const world = multiply(effective, localMatrix);
  world.tx = originX;
  world.ty = originY;
  return world;
}

function color(hex: string): [number, number, number, number] {
  const normalized = hex.length === 6 ? `${hex}ff` : hex;
  if (!/^[0-9a-fA-F]{8}$/.test(normalized)) return [1, 1, 1, 1];
  return [0, 2, 4, 6].map((at) => Number.parseInt(normalized.slice(at, at + 2), 16) / 255) as [number, number, number, number];
}

function stepped<T extends { time: number }>(keys: readonly T[], time: number): T | undefined {
  let answer = keys[0];
  for (const key of keys) {
    if (key.time > time) break;
    answer = key;
  }
  return answer;
}

export function evaluate(rig: RuntimeRigData, layers: readonly AnimationLayer[] = []): RigPose {
  const bones: BonePose[] = rig.bones.map((bone) => ({
    name: bone.name,
    x: bone.x,
    y: bone.y,
    rotation: bone.rotation * DEG,
    scaleX: bone.scaleX,
    scaleY: bone.scaleY,
    shearX: bone.shearX * DEG,
    shearY: bone.shearY * DEG,
    world: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
  }));
  const slots: SlotPose[] = rig.slots.map((slot) => ({
    name: slot.name,
    attachment: slot.attachment,
    visible: true,
    color: color(slot.color),
  }));
  let drawOrder = [...rig.drawOrder];
  const boneIndex = new Map(bones.map((bone, index) => [bone.name, index]));
  const slotIndex = new Map(slots.map((slot, index) => [slot.name, index]));
  const attachmentWinners = new Map<number, number>();
  const visibleWinners = new Map<number, number>();
  let drawOrderWeight = -1;

  for (const layer of layers) {
    if (layer.alpha <= 0) continue;
    const animation = animationOf(rig, layer.animation);
    for (const track of animation.bones) {
      const index = boneIndex.get(track.name);
      if (index === undefined) continue;
      const bone = bones[index]!;
      const time = layer.time - (track.offset ?? 0);
      const translate = track.translate ? vector(track.translate, time) : undefined;
      const rotate = track.rotate ? scalar(track.rotate, time, true) : undefined;
      const scale = track.scale ? vector(track.scale, time) : undefined;
      const shear = track.shear ? vector(track.shear, time) : undefined;
      if (translate) {
        bone.x += translate[0] * layer.alpha;
        bone.y += translate[1] * layer.alpha;
      }
      if (rotate !== undefined) bone.rotation = wrap(bone.rotation + rotate * DEG * layer.alpha);
      if (scale) {
        bone.scaleX *= 1 + (scale[0] - 1) * layer.alpha;
        bone.scaleY *= 1 + (scale[1] - 1) * layer.alpha;
      }
      if (shear) {
        bone.shearX += shear[0] * DEG * layer.alpha;
        bone.shearY += shear[1] * DEG * layer.alpha;
      }
    }
    for (const track of animation.slots) {
      const index = slotIndex.get(track.name);
      if (index === undefined) continue;
      const key = stepped(track.keys, layer.time);
      if (!key) continue;
      const slot = slots[index]!;
      if (track.channel === "attachment" && layer.alpha >= (attachmentWinners.get(index) ?? -1)) {
        slot.attachment = key.name ?? null;
        attachmentWinners.set(index, layer.alpha);
      } else if (track.channel === "visible" && layer.alpha >= (visibleWinners.get(index) ?? -1)) {
        slot.visible = key.value ?? true;
        visibleWinners.set(index, layer.alpha);
      } else if (track.channel === "color" && key.color) {
        slot.color = slot.color.map((component, i) => component + (key.color![i]! - component) * layer.alpha) as [number, number, number, number];
      }
    }
    const drawKey = stepped(animation.drawOrder, layer.time);
    if (drawKey && layer.alpha >= drawOrderWeight) {
      drawOrder = applyDrawOrder(rig.drawOrder, drawKey.offsets);
      drawOrderWeight = layer.alpha;
    }
  }

  for (let index = 0; index < bones.length; index += 1) {
    const pose = bones[index]!;
    const local = compose(pose);
    const source = rig.bones[index]!;
    pose.world = source.parent === -1 ? local : childWorld(bones[source.parent]!.world, pose, source);
  }
  return { bones, slots, drawOrder };
}

function applyDrawOrder(setup: readonly string[], offsets: readonly { slot: string; offset: number }[]): string[] {
  const result = [...setup];
  for (const { slot, offset } of offsets) {
    const from = result.indexOf(slot);
    if (from < 0) continue;
    result.splice(from, 1);
    const to = Math.max(0, Math.min(result.length, from + offset));
    result.splice(to, 0, slot);
  }
  return result;
}
