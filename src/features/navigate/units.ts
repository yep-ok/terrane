// Measurement units: formatting and conversion (pure; no OL / React).

export type UnitSystem = 'metric' | 'imperial' | 'nautical';
export const UNIT_SYSTEMS: Array<{ value: UnitSystem; label: string }> = [
  { value: 'metric', label: 'Metric' },
  { value: 'imperial', label: 'Imperial' },
  { value: 'nautical', label: 'Nautical' },
];

export type DistanceUnit = 'm' | 'km' | 'ft' | 'mi' | 'nmi';
export const DISTANCE_UNITS: Array<{ value: DistanceUnit; label: string; metres: number }> = [
  { value: 'm', label: 'Meters', metres: 1 },
  { value: 'km', label: 'Kilometers', metres: 1000 },
  { value: 'ft', label: 'Feet', metres: 0.3048 },
  { value: 'mi', label: 'Miles', metres: 1609.344 },
  { value: 'nmi', label: 'Nautical miles', metres: 1852 },
];
export const toMetres = (value: number, unit: DistanceUnit) => value * (DISTANCE_UNITS.find((u) => u.value === unit)?.metres ?? 1);

const FT_PER_M = 3.280839895;
const M_PER_MI = 1609.344;
const M_PER_NMI = 1852;

function num(n: number, maxDigits: number, locale?: string): string {
  return n.toLocaleString(locale, { maximumFractionDigits: maxDigits, minimumFractionDigits: 0 });
}

/** Length in metres to a readable string in the chosen unit system. */
export function formatLength(metres: number, system: UnitSystem, locale?: string): string {
  if (!Number.isFinite(metres)) return '';
  switch (system) {
    case 'imperial': {
      const mi = metres / M_PER_MI;
      if (mi < 0.25) return `${num(metres * FT_PER_M, metres * FT_PER_M < 100 ? 2 : 1, locale)} ft`;
      return `${num(mi, 3, locale)} mi`;
    }
    case 'nautical':
      return `${num(metres / M_PER_NMI, 3, locale)} nmi`;
    default:
      if (metres < 1000) return `${num(metres, metres < 100 ? 2 : 1, locale)} m`;
      return `${num(metres / 1000, 3, locale)} km`;
  }
}

/** Area in square metres to a readable string in the chosen unit system. */
export function formatArea(sqm: number, system: UnitSystem, locale?: string): string {
  if (!Number.isFinite(sqm)) return '';
  switch (system) {
    case 'imperial': {
      const sqft = sqm * FT_PER_M * FT_PER_M;
      if (sqft < 4356) return `${num(sqft, 1, locale)} ft²`;
      const acres = sqft / 43560;
      if (acres < 640) return `${num(acres, 3, locale)} ac`;
      return `${num(acres / 640, 3, locale)} mi²`;
    }
    case 'nautical': {
      const n = sqm / (M_PER_NMI * M_PER_NMI);
      if (n < 0.01) return `${num(sqm, 1, locale)} m²`;
      return `${num(n, 4, locale)} nmi²`;
    }
    default:
      if (sqm < 10000) return `${num(sqm, 1, locale)} m²`;
      if (sqm < 1e6) return `${num(sqm / 10000, 3, locale)} ha`;
      return `${num(sqm / 1e6, 3, locale)} km²`;
  }
}

const KEY = 'terrane.measureUnits';
export function loadUnitSystem(): UnitSystem {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (v === 'metric' || v === 'imperial' || v === 'nautical') return v;
  } catch {}
  return 'metric';
}
export function saveUnitSystem(u: UnitSystem) {
  try {
    localStorage.setItem(KEY, u);
  } catch {}
}
