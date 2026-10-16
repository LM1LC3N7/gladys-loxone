// -----------------------------------------------------------------------------
// Loxone values: numbers of the value events, texts of the text events (JSON
// lists, "hsv(…)" colors), units hidden in the C formats of the structure file.
// -----------------------------------------------------------------------------

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** A finite number, or undefined. */
export function toNumber(raw) {
  if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') {
    return undefined;
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  return Number.isFinite(n) ? n : undefined;
}

/** A JSON text, or undefined when it does not parse. */
export function parseJson(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Rounds to `digits` decimals (the Miniserver sends doubles: 21.299999999). */
export const round = (n, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/**
 * The unit of a C format of the structure file: "%.1f°C" -> "°C", "%.0f%%" ->
 * "%", "%.3f kWh" -> "kWh". Loxone Config also writes "<v.1> °C".
 */
export function unitOfFormat(format) {
  return String(format ?? '')
    .replace(/<v(?:\.\d+)?>/g, '')
    .split('%%')
    .map((part) => part.replace(/%[-+ 0#]*\d*(?:\.\d+)?[a-zA-Z]/g, ''))
    .join('%')
    .trim();
}

/** "hsv(120,100,50)" -> { h, s, v }; "temp(80,2700)" -> { brightness, kelvin }. */
export function parseColor(raw) {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase();
  const hsv = /^hsv\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(text);
  if (hsv) {
    return {
      h: clamp(Number(hsv[1]), 0, 360),
      s: clamp(Number(hsv[2]), 0, 100),
      v: clamp(Number(hsv[3]), 0, 100),
    };
  }
  const temp = /^temp\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(text);
  if (temp) {
    return { brightness: clamp(Number(temp[1]), 0, 100), kelvin: Number(temp[2]) };
  }
  return undefined;
}

/** HSV (h 0–360, s and v 0–100) -> the RGB integer of Gladys colors, at full value. */
export function hsvToInt({ h, s }) {
  const sat = s / 100;
  const chroma = sat;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = 1 - chroma;
  const [r, g, b] =
    h < 60
      ? [chroma, x, 0]
      : h < 120
        ? [x, chroma, 0]
        : h < 180
          ? [0, chroma, x]
          : h < 240
            ? [0, x, chroma]
            : h < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const byte = (c) => Math.round((c + m) * 255);
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}

/** The RGB integer of Gladys -> hue (0–360) and saturation (0–100). */
export function intToHueSat(value) {
  const n = clamp(Math.round(Number(value) || 0), 0, 0xffffff);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) {
      h = ((g - b) / d) % 6;
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
  }
  h = Math.round(h * 60);
  return { h: h < 0 ? h + 360 : h, s: max === 0 ? 0 : Math.round((d / max) * 100) };
}
