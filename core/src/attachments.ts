import type { Affine, RigPose, RuntimeAttachment, RuntimeRigData } from "./types.js";

export function findAttachment(rig: RuntimeRigData, skinName: string, slot: string, name: string): RuntimeAttachment | undefined {
  const selected = rig.skins.find((skin) => skin.name === skinName);
  const fallback = rig.skins.find((skin) => skin.name === rig.defaultSkin);
  return selected?.attachments.find((entry) => entry.slot === slot && entry.name === name)?.attachment
    ?? fallback?.attachments.find((entry) => entry.slot === slot && entry.name === name)?.attachment;
}

/** World-space polygon for collision, clipping, and path attachments. */
export function attachmentWorldVertices(rig: RuntimeRigData, pose: RigPose, skinName: string, slotName: string, attachmentName: string): number[] {
  const slot = rig.slots.find((candidate) => candidate.name === slotName);
  const attachment = findAttachment(rig, skinName, slotName, attachmentName);
  const host = slot ? pose.bones.find((candidate) => candidate.name === slot.bone)?.world : undefined;
  if (!attachment || !host || !("vertices" in attachment)) return [];
  const vertices = attachment.vertices;
  const weights = "weights" in attachment ? attachment.weights : [];
  const weighted = "weighted" in attachment && attachment.weighted;
  const result: number[] = [];
  for (let index = 0; index < vertices.length / 2; index += 1) {
    const influences = weights[index]?.bones ?? [];
    if (!weighted || influences.length === 0) result.push(...point(host, vertices[index * 2]!, vertices[index * 2 + 1]!));
    else {
      let x = 0; let y = 0; let total = 0;
      for (const influence of influences) {
        const world = pose.bones.find((candidate) => candidate.name === influence.bone)?.world;
        if (!world) continue;
        const placed = point(world, influence.x, influence.y);
        x += placed[0] * influence.weight; y += placed[1] * influence.weight; total += influence.weight;
      }
      result.push(total > 0 ? x / total : 0, total > 0 ? y / total : 0);
    }
  }
  return result;
}

/** World position and rotation for a point attachment. */
export function attachmentWorldPoint(rig: RuntimeRigData, pose: RigPose, skinName: string, slotName: string, attachmentName: string): { x: number; y: number; rotation: number } | undefined {
  const slot = rig.slots.find((candidate) => candidate.name === slotName);
  const attachment = findAttachment(rig, skinName, slotName, attachmentName);
  const world = slot ? pose.bones.find((candidate) => candidate.name === slot.bone)?.world : undefined;
  if (attachment?.type !== "point" || !world) return undefined;
  const position = point(world, attachment.x, attachment.y);
  const radians = attachment.rotation * Math.PI / 180;
  const axisX = world.a * Math.cos(radians) + world.c * Math.sin(radians);
  const axisY = world.b * Math.cos(radians) + world.d * Math.sin(radians);
  return { x: position[0], y: position[1], rotation: Math.atan2(axisY, axisX) };
}

function point(matrix: Affine, x: number, y: number): [number, number] {
  return [matrix.a * x + matrix.c * y + matrix.tx, matrix.b * x + matrix.d * y + matrix.ty];
}
