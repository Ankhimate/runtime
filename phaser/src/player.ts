import { evaluate } from "./evaluate.js";
import { animationOf } from "./rig.js";
import type { AnimationLayer, RigPose, RuntimeEvent, RuntimeRigData } from "./types.js";

interface TrackState {
  animation: string;
  time: number;
}

export class RigPlayer {
  readonly rig: RuntimeRigData;
  readonly events: RuntimeEvent[] = [];
  private current: TrackState | undefined;
  private outgoing: TrackState | undefined;
  private fadeDuration = 0;
  private fadeTime = 0;

  constructor(rig: RuntimeRigData) {
    this.rig = rig;
  }

  get animation(): string | undefined {
    return this.current?.animation;
  }

  get time(): number {
    return this.current?.time ?? 0;
  }

  play(animation: string, restart = true): this {
    animationOf(this.rig, animation);
    if (!restart && this.current?.animation === animation) return this;
    this.current = { animation, time: 0 };
    this.outgoing = undefined;
    this.fadeDuration = 0;
    this.fadeTime = 0;
    return this;
  }

  crossFade(animation: string, duration: number): this {
    animationOf(this.rig, animation);
    if (this.current?.animation === animation) return this;
    if (!this.current || duration <= 0) return this.play(animation);
    this.outgoing = { ...this.current };
    this.current = { animation, time: 0 };
    this.fadeDuration = duration;
    this.fadeTime = 0;
    return this;
  }

  seek(time: number): this {
    if (this.current) this.current.time = normalizeTime(animationOf(this.rig, this.current.animation), time);
    return this;
  }

  update(deltaSeconds: number): RigPose {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("deltaSeconds must be a finite non-negative number");
    }
    this.events.length = 0;
    if (this.current) {
      const animation = animationOf(this.rig, this.current.animation);
      this.events.push(...eventsBetween(animation, this.current.time, deltaSeconds));
      this.current.time = normalizeTime(animation, this.current.time + deltaSeconds);
    }
    if (this.outgoing) {
      const animation = animationOf(this.rig, this.outgoing.animation);
      this.outgoing.time = normalizeTime(animation, this.outgoing.time + deltaSeconds);
      this.fadeTime += deltaSeconds;
      if (this.fadeTime >= this.fadeDuration) this.outgoing = undefined;
    }
    return this.pose();
  }

  pose(): RigPose {
    const layers: AnimationLayer[] = [];
    if (this.outgoing && this.current) {
      const incomingAlpha = Math.min(1, this.fadeTime / this.fadeDuration);
      layers.push({ animation: this.outgoing.animation, time: this.outgoing.time, alpha: 1 - incomingAlpha });
      layers.push({ animation: this.current.animation, time: this.current.time, alpha: incomingAlpha });
    } else if (this.current) {
      layers.push({ animation: this.current.animation, time: this.current.time, alpha: 1 });
    }
    return evaluate(this.rig, layers);
  }
}

function normalizeTime(animation: { duration: number; looping: boolean }, time: number): number {
  if (animation.duration <= 0) return 0;
  if (!animation.looping) return Math.max(0, Math.min(animation.duration, time));
  return ((time % animation.duration) + animation.duration) % animation.duration;
}

function eventsBetween(animation: { duration: number; looping: boolean; events: RuntimeEvent[] }, from: number, delta: number): RuntimeEvent[] {
  if (delta <= 0 || animation.events.length === 0 || animation.duration <= 0) return [];
  const result: RuntimeEvent[] = [];
  if (!animation.looping) {
    const to = Math.min(animation.duration, from + delta);
    return animation.events.filter((event) => event.time > from && event.time <= to);
  }
  let cursor = from;
  let remaining = delta;
  while (remaining > 0) {
    const toEnd = animation.duration - cursor;
    const step = Math.min(remaining, toEnd);
    const end = cursor + step;
    result.push(...animation.events.filter((event) => event.time > cursor && event.time <= end));
    remaining -= step;
    if (remaining > 0 || end >= animation.duration) {
      cursor = 0;
      if (remaining > 0) result.push(...animation.events.filter((event) => event.time === 0));
    } else {
      cursor = end;
    }
    if (step === 0 && remaining > 0) cursor = 0;
  }
  return result;
}
