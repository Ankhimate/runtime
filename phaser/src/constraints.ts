import type {
  Affine,
  BonePose,
  EvaluationState,
  PathAttachment,
  RigPose,
  RuntimeConstraint,
  RuntimeRigData,
  TransformMixValue,
} from "./types.js";

const EPS = 1e-6;
const STEP = 1 / 120;
const MAX_STEPS = 32;
const DAMPING_RATE = 12;

export interface ConstraintOverrides {
  ik: Map<string, { mix?: number; softness?: number; bend?: number }>;
  transform: Map<string, TransformMixValue>;
}

export function applyConstraints(
  rig: RuntimeRigData,
  pose: RigPose,
  overrides: ConstraintOverrides,
  state: EvaluationState | undefined,
  deltaSeconds: number,
  skinName: string | undefined,
): void {
  const byName = new Map(rig.constraints.map((constraint) => [constraint.name, constraint]));
  const skinOwned = new Set(rig.skins.flatMap((skin) => skin.constraints));
  const active = new Set(rig.skins.find((skin) => skin.name === skinName)?.constraints ?? []);
  for (const name of rig.constraintOrder) {
    const constraint = byName.get(name);
    if (!constraint || (skinOwned.has(name) && !active.has(name))) continue;
    switch (constraint.type) {
      case "ik": applyIk(rig, pose, constraint, overrides.ik.get(name)); break;
      case "transform": applyTransform(rig, pose, constraint, overrides.transform.get(name) ?? constraint.mixes); break;
      case "physics": if (state) applyPhysics(rig, pose, constraint, state, deltaSeconds); break;
      case "path": applyPath(rig, pose, constraint, skinName); break;
    }
  }
}

function applyTransform(
  rig: RuntimeRigData,
  pose: RigPose,
  constraint: Extract<RuntimeConstraint, { type: "transform" }>,
  mix: TransformMixValue,
): void {
  const target = bone(pose, constraint.target);
  if (!target) return;
  const source = constraint.local ? target : decompose(target.world);
  const offset = constraint.offsets;
  for (const name of constraint.bones) {
    const driven = bone(pose, name);
    if (!driven || driven === target) continue;
    const current = constraint.local ? driven : decompose(driven.world);
    const goal = constraint.relative ? {
      x: current.x + source.x + offset.x,
      y: current.y + source.y + offset.y,
      rotation: current.rotation + source.rotation + offset.rotation * Math.PI / 180,
      scaleX: current.scaleX * source.scaleX * offset.scale_x,
      scaleY: current.scaleY * source.scaleY * offset.scale_y,
      shearX: current.shearX + source.shearX + offset.shear_x * Math.PI / 180,
      shearY: current.shearY + source.shearY + offset.shear_y * Math.PI / 180,
    } : {
      x: source.x + offset.x,
      y: source.y + offset.y,
      rotation: source.rotation + offset.rotation * Math.PI / 180,
      scaleX: source.scaleX * offset.scale_x,
      scaleY: source.scaleY * offset.scale_y,
      shearX: source.shearX + offset.shear_x * Math.PI / 180,
      shearY: source.shearY + offset.shear_y * Math.PI / 180,
    };
    driven.rotation = wrap(driven.rotation + wrap(goal.rotation - current.rotation) * mix.rotate);
    let dx = goal.x - current.x;
    let dy = goal.y - current.y;
    if (!constraint.local) [dx, dy] = parentInverseDirection(rig, pose, name, dx, dy);
    driven.x += dx * mix.translate_x;
    driven.y += dy * mix.translate_y;
    driven.scaleX += (goal.scaleX - current.scaleX) * mix.scale_x;
    driven.scaleY += (goal.scaleY - current.scaleY) * mix.scale_y;
    driven.shearX += wrap(goal.shearX - current.shearX) * mix.shear_x;
    driven.shearY += wrap(goal.shearY - current.shearY) * mix.shear_y;
    updateSubtree(rig, pose, name);
  }
}

function applyIk(
  rig: RuntimeRigData,
  pose: RigPose,
  constraint: Extract<RuntimeConstraint, { type: "ik" }>,
  override: { mix?: number; softness?: number; bend?: number } | undefined,
): void {
  const chain = constraint.bones.map((name) => bone(pose, name));
  const targetBone = bone(pose, constraint.target);
  const mix = override?.mix ?? constraint.mix;
  if (mix <= 0 || !targetBone || chain.some((item) => !item) || constraint.bones.includes(constraint.target)) return;
  const target = [targetBone.world.tx, targetBone.world.ty] as const;
  const root = [chain[0]!.world.tx, chain[0]!.world.ty] as const;
  const lengths = chain.map((item, index) => {
    if (index + 1 < chain.length) return distance(item!.world.tx, item!.world.ty, chain[index + 1]!.world.tx, chain[index + 1]!.world.ty);
    const source = rig.bones.find((candidate) => candidate.name === item!.name)!;
    const tip = point(item!.world, source.length, 0);
    return distance(item!.world.tx, item!.world.ty, tip[0], tip[1]);
  });
  const reach = lengths.reduce((sum, value) => sum + value, 0);
  const softened = soften(root, target, reach, override?.softness ?? constraint.softness);
  if (constraint.stretch) {
    const factor = stretchFactor(root, softened, reach, constraint.stretch_limit);
    if (factor > 1) {
      const scaled = 1 + (factor - 1) * mix;
      for (let index = 0; index < chain.length; index += 1) {
        const source = rig.bones.find((candidate) => candidate.name === chain[index]!.name)!;
        const parentInChain = source.parent >= 0 && constraint.bones.includes(rig.bones[source.parent]!.name) && source.inheritScale;
        if (!parentInChain) chain[index]!.scaleX *= scaled;
      }
      updateSubtree(rig, pose, chain[0]!.name);
    }
  }
  const bend = override?.bend ?? constraint.bend_direction;
  if (chain.length === 1) {
    rotateToward(rig, pose, chain[0]!.name, angle(root, softened), mix);
  } else if (chain.length === 2) {
    const [first, second] = solveTwo(root, softened, lengths[0]!, lengths[1]!, bend);
    rotateToward(rig, pose, chain[0]!.name, first, mix);
    updateSubtree(rig, pose, chain[0]!.name);
    rotateToward(rig, pose, chain[1]!.name, second, mix);
  } else {
    const joints = chain.map((item) => [item!.world.tx, item!.world.ty] as [number, number]);
    const lastSource = rig.bones.find((candidate) => candidate.name === chain.at(-1)!.name)!;
    joints.push(point(chain.at(-1)!.world, lastSource.length, 0));
    const solved = fabrik(joints, lengths, softened, bend, constraint.stiffness);
    for (let index = 0; index < chain.length; index += 1) {
      updateSubtree(rig, pose, chain[0]!.name);
      rotateToward(rig, pose, chain[index]!.name, angle(solved[index]!, solved[index + 1]!), mix);
    }
  }
  updateSubtree(rig, pose, chain[0]!.name);
}

function applyPhysics(
  rig: RuntimeRigData,
  pose: RigPose,
  constraint: Extract<RuntimeConstraint, { type: "physics" }>,
  state: EvaluationState,
  dt: number,
): void {
  const name = constraint.bones[0];
  if (!name || constraint.mix <= 0) return;
  const driven = bone(pose, name);
  const source = rig.bones.find((candidate) => candidate.name === name);
  if (!driven || !source) return;
  const parentWorld = source.parent >= 0 ? pose.bones[source.parent]!.world : identity();
  const anchor = point(parentWorld, 0, 0);
  const key = `${constraint.name}\0${name}`;
  let sim = state.physics.get(key);
  if (!sim) {
    sim = { rotation: 0, rotationVelocity: 0, x: 0, y: 0, velocityX: 0, velocityY: 0, anchorX: anchor[0], anchorY: anchor[1], remainder: 0 };
    state.physics.set(key, sim);
  }
  const worldDelta: [number, number] = [anchor[0] - (sim.anchorX ?? anchor[0]), anchor[1] - (sim.anchorY ?? anchor[1])];
  sim.anchorX = anchor[0]; sim.anchorY = anchor[1];
  const inv = invert(parentWorld);
  const localDelta = inv ? vector(inv, ...worldDelta) : worldDelta;
  const forceWorld: [number, number] = [constraint.forces.wind_x + constraint.forces.gravity_x, constraint.forces.wind_y + constraint.forces.gravity_y];
  const push = inv ? vector(inv, ...forceWorld) : forceWorld;
  const total = dt + sim.remainder;
  const steps = Math.min(MAX_STEPS, Math.floor(total / STEP));
  sim.remainder = Math.max(0, total - steps * STEP);
  if (steps > 0) {
    const mass = Math.max(0.01, constraint.physics.mass);
    const inertia = clamp(constraint.physics.inertia, 0, 1);
    const spring = constraint.physics.strength / mass;
    const decay = Math.exp(-clamp(constraint.physics.damping, 0, 1) * DAMPING_RATE * STEP);
    const impulseX = -localDelta[0] * inertia / steps;
    const impulseY = -localDelta[1] * inertia / steps;
    for (let i = 0; i < steps; i += 1) {
      sim.velocityX += (push[0] / mass + impulseX * spring - sim.x * spring) * STEP;
      sim.velocityY += (push[1] / mass + impulseY * spring - sim.y * spring) * STEP;
      sim.velocityX *= decay; sim.velocityY *= decay;
      sim.x += sim.velocityX * STEP; sim.y += sim.velocityY * STEP;
      sim.rotationVelocity += (push[0] / mass + impulseX * spring - sim.rotation * spring) * STEP;
      sim.rotationVelocity *= decay; sim.rotation += sim.rotationVelocity * STEP;
    }
  }
  if (constraint.channels.rotate) driven.rotation = wrap(driven.rotation + sim.rotation * clamp(constraint.mix, 0, 1));
  if (constraint.channels.translate) { driven.x += sim.x * constraint.mix; driven.y += sim.y * constraint.mix; }
  updateSubtree(rig, pose, name);
}

function applyPath(
  rig: RuntimeRigData,
  pose: RigPose,
  constraint: Extract<RuntimeConstraint, { type: "path" }>,
  skinName: string | undefined,
): void {
  const slot = rig.slots.find((candidate) => candidate.name === constraint.slot);
  if (!slot?.attachment) return;
  const skin = rig.skins.find((candidate) => candidate.name === skinName) ?? rig.skins.find((candidate) => candidate.name === rig.defaultSkin);
  const attachment = skin?.attachments.find((entry) => entry.slot === slot.name && entry.name === slot.attachment)?.attachment;
  if (attachment?.type !== "path" || attachment.vertices.length < 4) return;
  const host = bone(pose, slot.bone);
  if (!host) return;
  const points = pathPoints(attachment, host.world);
  const placements = spreadPath(points, attachment, constraint.bones.length, constraint.path.position, constraint.path.spacing);
  for (let index = 0; index < placements.length; index += 1) {
    const name = constraint.bones[index]!;
    const driven = bone(pose, name);
    if (!driven) continue;
    const placement = placements[index]!;
    const delta = parentInverseDirection(rig, pose, name, placement[0] - driven.world.tx, placement[1] - driven.world.ty);
    driven.x += delta[0] * constraint.path.mix_translate;
    driven.y += delta[1] * constraint.path.mix_translate;
    rotateToward(rig, pose, name, placement[2], constraint.path.mix_rotate);
    updateSubtree(rig, pose, name);
  }
}

function pathPoints(attachment: PathAttachment, world: Affine): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (let i = 0; i < attachment.vertices.length; i += 2) result.push(point(world, attachment.vertices[i]!, attachment.vertices[i + 1]!));
  return result;
}

function spreadPath(points: Array<[number, number]>, path: PathAttachment, count: number, position: number, spacing: number): Array<[number, number, number]> {
  const segments = path.closed ? points.length : points.length - 1;
  const lengths = [0];
  for (let i = 0; i < segments; i += 1) lengths.push(lengths.at(-1)! + distance(...points[i]!, ...points[(i + 1) % points.length]!));
  const total = lengths.at(-1)!;
  const at = (value: number): [number, number, number] => {
    let d = path.closed ? modulo(value, total) : clamp(value, 0, total);
    let index = lengths.findIndex((length) => length >= d) - 1;
    index = clamp(index, 0, segments - 1);
    const from = points[index]!; const to = points[(index + 1) % points.length]!;
    const t = (d - lengths[index]!) / Math.max(EPS, lengths[index + 1]! - lengths[index]!);
    return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, angle(from, to)];
  };
  if (count === 0 || total <= EPS) return [];
  if (!path.constant_speed) {
    const span = segments;
    return Array.from({ length: count }, (_, i) => {
      const raw = position * span + (count > 1 ? span / (count - 1) * spacing * i : 0);
      const param = path.closed ? modulo(raw, span) : clamp(raw, 0, span);
      const index = Math.min(points.length - 1, Math.floor(param));
      const from = points[index]!; const to = points[(index + 1) % points.length]!; const t = param - Math.floor(param);
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, angle(from, to)];
    });
  }
  return Array.from({ length: count }, (_, i) => at(position * total + (count > 1 ? total / (count - 1) * spacing * i : 0)));
}

function fabrik(joints: Array<[number, number]>, lengths: number[], target: readonly [number, number], bend: number, stiffness: number): Array<[number, number]> {
  const result = joints.map((item) => [...item] as [number, number]);
  const root = [...result[0]!] as [number, number];
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (distance(...root, ...target) >= total) {
    const direction = unit(target[0] - root[0], target[1] - root[1]);
    for (let i = 1; i < result.length; i += 1) result[i] = [result[i - 1]![0] + direction[0] * lengths[i - 1]!, result[i - 1]![1] + direction[1] * lengths[i - 1]!];
    return result;
  }
  const stiff = clamp(stiffness, 0, 1);
  for (let iteration = 0; iteration < 20; iteration += 1) {
    result[result.length - 1] = [target[0], target[1]];
    for (let i = result.length - 2; i >= 0; i -= 1) placeAtDistance(result, i, i + 1, lengths[i]!);
    result[0] = root;
    for (let i = 1; i < result.length; i += 1) placeAtDistance(result, i, i - 1, lengths[i - 1]!);
    if (stiff > 0) for (let i = 1; i < result.length - 1; i += 1) { result[i]![0] += (joints[i]![0] - result[i]![0]) * stiff; result[i]![1] += (joints[i]![1] - result[i]![1]) * stiff; }
    if (distance(...result.at(-1)!, ...target) < 0.001) break;
  }
  enforceBend(result, bend);
  return result;
}

function placeAtDistance(points: Array<[number, number]>, moving: number, fixed: number, length: number): void {
  const direction = unit(points[moving]![0] - points[fixed]![0], points[moving]![1] - points[fixed]![1]);
  points[moving] = [points[fixed]![0] + direction[0] * length, points[fixed]![1] + direction[1] * length];
}

function enforceBend(points: Array<[number, number]>, bend: number): void {
  if (!bend || points.length < 3) return;
  const root = points[0]!; const tip = points.at(-1)!; const ax = tip[0] - root[0]; const ay = tip[1] - root[1];
  const side = ax * (points[1]![1] - root[1]) - ay * (points[1]![0] - root[0]);
  if (!side || Math.sign(side) === Math.sign(bend)) return;
  const len = Math.hypot(ax, ay); const ux = ax / len; const uy = ay / len;
  for (let i = 1; i < points.length - 1; i += 1) { const ox = points[i]![0] - root[0]; const oy = points[i]![1] - root[1]; const along = ox * ux + oy * uy; points[i] = [root[0] + 2 * ux * along - ox, root[1] + 2 * uy * along - oy]; }
}

function solveTwo(root: readonly [number, number], target: readonly [number, number], l1: number, l2: number, bend: number): [number, number] {
  const dx = target[0] - root[0]; const dy = target[1] - root[1]; const squared = dx * dx + dy * dy; const gamma = Math.atan2(dy, dx);
  if (squared >= (l1 + l2) ** 2 - 1e-5) return [gamma, gamma];
  if (squared <= (l1 - l2) ** 2 + 1e-5) return [gamma, gamma + Math.PI];
  const d = Math.sqrt(squared);
  const alpha = Math.acos(clamp((l1 * l1 + squared - l2 * l2) / (2 * l1 * d), -1, 1));
  const beta = Math.acos(clamp((squared - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1, 1));
  const first = gamma - bend * alpha;
  return [first, first + bend * beta];
}

function soften(root: readonly [number, number], target: readonly [number, number], reach: number, softness: number): [number, number] {
  if (softness <= 0) return [target[0], target[1]];
  const dx = target[0] - root[0]; const dy = target[1] - root[1]; const d = Math.hypot(dx, dy); const start = Math.max(0, reach - softness);
  if (d <= start || d <= EPS) return [target[0], target[1]];
  const remaining = Math.max(EPS, reach - start); const eased = remaining * (1 - Math.exp(-(d - start) / remaining));
  return [root[0] + dx / d * (start + eased), root[1] + dy / d * (start + eased)];
}

function stretchFactor(root: readonly [number, number], target: readonly [number, number], reach: number, limit: number): number {
  return reach <= EPS ? 1 : Math.min(Math.max(1, limit), Math.max(1, distance(...root, ...target) / reach));
}

function rotateToward(rig: RuntimeRigData, pose: RigPose, name: string, target: number, mix: number): void {
  const driven = bone(pose, name); if (!driven) return;
  driven.rotation = wrap(driven.rotation + wrap(target - decompose(driven.world).rotation) * mix);
  updateWorld(rig, pose, name);
}

function updateSubtree(rig: RuntimeRigData, pose: RigPose, root: string): void {
  const rootIndex = rig.bones.findIndex((item) => item.name === root);
  for (let i = rootIndex; i < rig.bones.length; i += 1) if (i === rootIndex || isDescendant(rig, i, rootIndex)) updateWorldAt(rig, pose, i);
}

function isDescendant(rig: RuntimeRigData, index: number, ancestor: number): boolean {
  let parent = rig.bones[index]!.parent;
  while (parent >= 0) { if (parent === ancestor) return true; parent = rig.bones[parent]!.parent; }
  return false;
}

function updateWorld(rig: RuntimeRigData, pose: RigPose, name: string): void { const index = rig.bones.findIndex((item) => item.name === name); if (index >= 0) updateWorldAt(rig, pose, index); }

function updateWorldAt(rig: RuntimeRigData, pose: RigPose, index: number): void {
  const local = pose.bones[index]!; const source = rig.bones[index]!; const own = compose(local);
  local.world = source.parent < 0 ? own : composeChild(pose.bones[source.parent]!.world, local, source);
}

function compose(local: BonePose): Affine {
  const x = local.rotation + local.shearX; const y = local.rotation + Math.PI / 2 + local.shearY;
  return { a: Math.cos(x) * local.scaleX, b: Math.sin(x) * local.scaleX, c: Math.cos(y) * local.scaleY, d: Math.sin(y) * local.scaleY, tx: local.x, ty: local.y };
}

function composeChild(parent: Affine, local: BonePose, source: RuntimeRigData["bones"][number]): Affine {
  const own = compose(local);
  if (source.inheritRotation && source.inheritScale && source.inheritReflect) return mul(parent, own);
  const origin = point(parent, local.x, local.y); const p = decompose(parent);
  let sy = source.inheritScale ? p.scaleY : 1; if (!source.inheritReflect && sy < 0) sy *= -1;
  const effective = compose({ ...local, x: 0, y: 0, rotation: source.inheritRotation ? p.rotation : 0, scaleX: source.inheritScale ? p.scaleX : 1, scaleY: sy, shearX: 0, shearY: source.inheritScale ? p.shearY : 0 });
  const world = mul(effective, own); world.tx = origin[0]; world.ty = origin[1]; return world;
}

function decompose(matrix: Affine): Omit<BonePose, "name" | "world"> {
  const rotation = Math.atan2(matrix.b, matrix.a); const scaleX = Math.hypot(matrix.a, matrix.b); const det = matrix.a * matrix.d - matrix.b * matrix.c; const scaleY = Math.hypot(matrix.c, matrix.d) * (det < 0 ? -1 : 1);
  const yAngle = scaleY < 0 ? Math.atan2(-matrix.d, -matrix.c) : Math.atan2(matrix.d, matrix.c);
  return { x: matrix.tx, y: matrix.ty, rotation, scaleX, scaleY, shearX: 0, shearY: wrap(yAngle - rotation - Math.PI / 2) };
}

function parentInverseDirection(rig: RuntimeRigData, pose: RigPose, name: string, x: number, y: number): [number, number] {
  const source = rig.bones.find((candidate) => candidate.name === name); if (!source || source.parent < 0) return [x, y];
  const inv = invert(pose.bones[source.parent]!.world); return inv ? vector(inv, x, y) : [x, y];
}

function identity(): Affine { return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }; }
function mul(l: Affine, r: Affine): Affine { return { a: l.a*r.a+l.c*r.b, b:l.b*r.a+l.d*r.b, c:l.a*r.c+l.c*r.d, d:l.b*r.c+l.d*r.d, tx:l.a*r.tx+l.c*r.ty+l.tx, ty:l.b*r.tx+l.d*r.ty+l.ty }; }
function invert(m: Affine): Affine | undefined { const det=m.a*m.d-m.b*m.c;if(Math.abs(det)<1e-12)return undefined;const inv=1/det;const a=m.d*inv,b=-m.b*inv,c=-m.c*inv,d=m.a*inv;return{a,b,c,d,tx:-(a*m.tx+c*m.ty),ty:-(b*m.tx+d*m.ty)}; }
function point(m: Affine, x: number, y: number): [number, number] { return [m.a*x+m.c*y+m.tx,m.b*x+m.d*y+m.ty]; }
function vector(m: Affine, x: number, y: number): [number, number] { return [m.a*x+m.c*y,m.b*x+m.d*y]; }
function bone(pose: RigPose, name: string): BonePose | undefined { return pose.bones.find((item) => item.name === name); }
function angle(a: readonly [number, number], b: readonly [number, number]): number { return Math.atan2(b[1]-a[1],b[0]-a[0]); }
function distance(ax:number,ay:number,bx:number,by:number):number{return Math.hypot(bx-ax,by-ay);}
function unit(x:number,y:number):[number,number]{const len=Math.hypot(x,y);return len>EPS?[x/len,y/len]:[1,0];}
function wrap(value:number):number{value=modulo(value+Math.PI,Math.PI*2)-Math.PI;return value<=-Math.PI?value+Math.PI*2:value;}
function modulo(value:number,divisor:number):number{return divisor===0?0:((value%divisor)+divisor)%divisor;}
function clamp(value:number,min:number,max:number):number{return Math.max(min,Math.min(max,value));}
