const FIELDS = [
  "version","name","fps","assets","bones","slots","draw_order","skins","default_skin",
  "constraints","constraint_order","animations","groups","psd_layer_paths","export_presets",
  "attachment","audio","balance","bend_direction","blend_mode","bone","bone_offsets","channels",
  "closed","color","constant_speed","dark_color","duration","edges","end_slot","entries","events",
  "file","float_value","forces","frames","handles","height","inherit_deform","inherit_reflect",
  "inherit_rotation","inherit_scale","int_value","interp","kind","keys","length","linked","local",
  "looping","markers","members","mix","mode","offset","offset_x","offset_y","offsets","parent",
  "path","physics","pivot_x","pivot_y","relative","rotate","rotation","scale_x","scale_y","sequence",
  "setup_index","shear_x","shear_y","skin","slot","softness","source_path","stiffness","stretch",
  "stretch_limit","string_value","sx","sy","target","texture","time","timelines","transform_mix",
  "translate_x","translate_y","triangles","tx","ty","type","uv","uvs","value","vertices","volume",
  "weights","width","x","y","axis","constraint","curve",
] as const;

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function tag(index: number): string {
  if (index < ALPHABET.length) return ALPHABET[index]!;
  const value = index - ALPHABET.length;
  return ALPHABET[Math.floor(value / ALPHABET.length)]! + ALPHABET[value % ALPHABET.length]!;
}

const EXPANSIONS = new Map(FIELDS.map((field, index) => [tag(index), field]));

export function expandCompact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expandCompact);
  if (!value || typeof value !== "object" || value instanceof Uint8Array) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[EXPANSIONS.get(key) ?? (key.startsWith("~") ? key.slice(1) : key)] = expandCompact(child);
  }
  return result;
}

export const ANKH_COMPACT_FIELDS: readonly string[] = FIELDS;
