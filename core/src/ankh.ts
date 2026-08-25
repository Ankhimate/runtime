import { inflateSync } from "fflate";
import { expandCompact } from "./compact.js";
import { decodeMessagePack } from "./messagepack.js";
import type { AnkhAsset, AnkhProject, LoadedAnkh } from "./ankh-types.js";

const HEADER_LENGTH = 16;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

export class AnkhFormatError extends Error {
  constructor(message: string) { super(message); this.name = "AnkhFormatError"; }
}

export interface ParseAnkhOptions { maxDecodedBytes?: number; }

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc ^ byte) >>> 0;
    for (let bit = 0; bit < 8; bit++) crc = ((crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function object(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AnkhFormatError(`${label} must be an object`);
}

function validateProject(value: unknown): AnkhProject {
  object(value, "project");
  if (value.version !== 1) throw new AnkhFormatError(`unsupported project version ${JSON.stringify(value.version)}`);
  for (const field of ["assets", "bones", "slots", "skins", "constraints", "constraint_order", "animations"] as const) {
    if (!Array.isArray(value[field])) throw new AnkhFormatError(`project.${field} must be an array`);
  }
  if (!Array.isArray(value.draw_order)) throw new AnkhFormatError("project.draw_order must be an array");
  const assets = value.assets as unknown[];
  const names = new Set<string>();
  assets.forEach((asset, index) => {
    object(asset, `assets[${index}]`);
    if (typeof asset.name !== "string" || names.has(asset.name)) throw new AnkhFormatError(`assets[${index}].name must be unique`);
    if (typeof asset.file !== "string" || !safeAssetPath(asset.file)) throw new AnkhFormatError(`assets[${index}].file is unsafe`);
    if (!Number.isInteger(asset.width) || !Number.isInteger(asset.height) || Number(asset.width) <= 0 || Number(asset.height) <= 0)
      throw new AnkhFormatError(`assets[${index}] dimensions must be positive integers`);
    names.add(asset.name);
  });
  return value as unknown as AnkhProject;
}

export function parseAnkh(source: Uint8Array | ArrayBuffer | string | unknown, options: ParseAnkhOptions = {}): AnkhProject {
  if (typeof source === "string") {
    try { return validateProject(expandCompact(JSON.parse(source))); }
    catch (error) { if (error instanceof AnkhFormatError) throw error; throw new AnkhFormatError(`invalid JSON: ${(error as Error).message}`); }
  }
  if (!(source instanceof Uint8Array) && !(source instanceof ArrayBuffer)) return validateProject(expandCompact(source));
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.length < HEADER_LENGTH || new TextDecoder().decode(bytes.subarray(0, 4)) !== "ANKH") throw new AnkhFormatError("not an Ankh v1 binary file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true), codec = bytes[6]!, flags = bytes[7]!;
  if (version !== 1) throw new AnkhFormatError(`unsupported container version ${version}`);
  if (codec !== 1) throw new AnkhFormatError(`unsupported codec ${codec}`);
  if ((flags & ~1) !== 0) throw new AnkhFormatError(`unsupported flags ${flags}`);
  const rawLength = view.getUint32(8, true), max = options.maxDecodedBytes ?? DEFAULT_MAX_BYTES;
  if (rawLength > max) throw new AnkhFormatError(`decoded payload exceeds ${max} bytes`);
  let payload: Uint8Array;
  try { payload = (flags & 1) ? inflateSync(bytes.subarray(HEADER_LENGTH)) : bytes.slice(HEADER_LENGTH); }
  catch (error) { throw new AnkhFormatError(`could not inflate payload: ${(error as Error).message}`); }
  if (payload.length !== rawLength) throw new AnkhFormatError("decoded payload length mismatch");
  if (crc32(payload) !== view.getUint32(12, true)) throw new AnkhFormatError("payload checksum mismatch");
  return validateProject(expandCompact(decodeMessagePack(payload)));
}

export function safeAssetPath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.startsWith("\\")
    && !/^[A-Za-z]:/.test(path) && !path.split(/[\\/]/).some((part) => part === "" || part === "." || part === "..");
}

export function assetRootFor(projectUrl: string): string {
  return projectUrl.replace(/\.ankh(?:\.min)?\.json$|\.ankh$/i, "") + ".assets/";
}

export interface LoadAnkhOptions extends ParseAnkhOptions {
  loadAsset: (file: string, asset: AnkhAsset) => Promise<Uint8Array>;
}

export async function loadAnkh(source: Uint8Array | ArrayBuffer | string | unknown, options: LoadAnkhOptions): Promise<LoadedAnkh> {
  const project = parseAnkh(source, options);
  const loaded = await Promise.all(project.assets.map(async (asset) => {
    if (!safeAssetPath(asset.file)) throw new AnkhFormatError(`unsafe asset path ${JSON.stringify(asset.file)}`);
    return [asset.name, await options.loadAsset(asset.file, asset)] as const;
  }));
  return { project, assets: new Map(loaded) };
}
