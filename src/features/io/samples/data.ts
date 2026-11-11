// Hand-authored reference data shipped with Terrane (no network needed).
import type { Feature, Position } from 'geojson';

// [name, country, population (thousands, urban area, rounded), capital (1/0), lon, lat]
type CityRow = [string, string, number, 0 | 1, number, number];

const CITIES: CityRow[] = [
  // Asia
  ['Tokyo', 'Japan', 37400, 1, 139.69, 35.69],
  ['Delhi', 'India', 31000, 1, 77.21, 28.61],
  ['Shanghai', 'China', 27000, 0, 121.47, 31.23],
  ['Dhaka', 'Bangladesh', 21000, 1, 90.41, 23.81],
  ['Beijing', 'China', 20900, 1, 116.41, 39.9],
  ['Mumbai', 'India', 20400, 0, 72.88, 19.08],
  ['Osaka', 'Japan', 19000, 0, 135.5, 34.69],
  ['Karachi', 'Pakistan', 16000, 0, 67.01, 24.86],
  ['Chongqing', 'China', 15900, 0, 106.55, 29.56],
  ['Istanbul', 'Turkey', 15200, 0, 28.98, 41.01],
  ['Kolkata', 'India', 14900, 0, 88.36, 22.57],
  ['Manila', 'Philippines', 13900, 1, 120.98, 14.6],
  ['Guangzhou', 'China', 13600, 0, 113.26, 23.13],
  ['Tianjin', 'China', 13600, 0, 117.2, 39.13],
  ['Lahore', 'Pakistan', 12600, 0, 74.36, 31.55],
  ['Shenzhen', 'China', 12400, 0, 114.06, 22.54],
  ['Bengaluru', 'India', 12300, 0, 77.59, 12.97],
  ['Chennai', 'India', 11000, 0, 80.27, 13.08],
  ['Hyderabad', 'India', 10500, 0, 78.49, 17.39],
  ['Bangkok', 'Thailand', 10500, 1, 100.5, 13.76],
  ['Jakarta', 'Indonesia', 10800, 1, 106.85, -6.21],
  ['Seoul', 'South Korea', 9960, 1, 126.98, 37.57],
  ['Tehran', 'Iran', 9000, 1, 51.39, 35.69],
  ['Ho Chi Minh City', 'Vietnam', 8600, 0, 106.63, 10.82],
  ['Kuala Lumpur', 'Malaysia', 8000, 1, 101.69, 3.14],
  ['Ahmedabad', 'India', 8000, 0, 72.57, 23.02],
  ['Riyadh', 'Saudi Arabia', 7500, 1, 46.72, 24.71],
  ['Hong Kong', 'China', 7500, 0, 114.17, 22.32],
  ['Baghdad', 'Iraq', 7200, 1, 44.36, 33.31],
  ['Taipei', 'Taiwan', 7000, 1, 121.57, 25.03],
  ['Singapore', 'Singapore', 5900, 1, 103.82, 1.35],
  ['Yangon', 'Myanmar', 5400, 0, 96.2, 16.87],
  ['Ankara', 'Turkey', 5100, 1, 32.85, 39.93],
  ['Hanoi', 'Vietnam', 4900, 1, 105.85, 21.03],
  ['Kabul', 'Afghanistan', 4600, 1, 69.17, 34.53],
  ['Tel Aviv', 'Israel', 3900, 0, 34.78, 32.08],
  ['Dubai', 'United Arab Emirates', 3500, 0, 55.27, 25.2],
  ['Pyongyang', 'North Korea', 3000, 1, 125.75, 39.02],
  ['Kuwait City', 'Kuwait', 3000, 1, 47.98, 29.38],
  ['Tashkent', 'Uzbekistan', 2600, 1, 69.24, 41.3],
  ['Damascus', 'Syria', 2500, 1, 36.29, 33.51],
  ['Beirut', 'Lebanon', 2400, 1, 35.5, 33.89],
  ['Baku', 'Azerbaijan', 2300, 1, 49.87, 40.41],
  ['Amman', 'Jordan', 2200, 1, 35.93, 31.95],
  ['Phnom Penh', 'Cambodia', 2100, 1, 104.92, 11.56],
  ['Almaty', 'Kazakhstan', 2000, 0, 76.93, 43.24],
  ['Ulaanbaatar', 'Mongolia', 1600, 1, 106.92, 47.92],
  ['Abu Dhabi', 'United Arab Emirates', 1500, 1, 54.37, 24.47],
  ['Muscat', 'Oman', 1500, 1, 58.41, 23.59],
  ['Kathmandu', 'Nepal', 1500, 1, 85.32, 27.72],
  ['Astana', 'Kazakhstan', 1300, 1, 71.45, 51.17],
  ['Doha', 'Qatar', 1200, 1, 51.53, 25.29],
  ['Islamabad', 'Pakistan', 1100, 1, 73.05, 33.68],
  ['Bishkek', 'Kyrgyzstan', 1100, 1, 74.59, 42.87],
  ['Tbilisi', 'Georgia', 1100, 1, 44.79, 41.72],
  ['Yerevan', 'Armenia', 1100, 1, 44.51, 40.18],
  ['Vientiane', 'Laos', 700, 1, 102.6, 17.97],
  ['Ashgabat', 'Turkmenistan', 800, 1, 58.38, 37.96],
  // Europe
  ['Moscow', 'Russia', 12500, 1, 37.62, 55.75],
  ['Paris', 'France', 11100, 1, 2.35, 48.86],
  ['London', 'United Kingdom', 9300, 1, -0.13, 51.51],
  ['Madrid', 'Spain', 6700, 1, -3.7, 40.42],
  ['Barcelona', 'Spain', 5600, 0, 2.17, 41.39],
  ['Saint Petersburg', 'Russia', 5400, 0, 30.34, 59.93],
  ['Milan', 'Italy', 5200, 0, 9.19, 45.46],
  ['Rome', 'Italy', 4300, 1, 12.5, 41.9],
  ['Berlin', 'Germany', 3700, 1, 13.4, 52.52],
  ['Kyiv', 'Ukraine', 3000, 1, 30.52, 50.45],
  ['Manchester', 'United Kingdom', 2800, 0, -2.24, 53.48],
  ['Bucharest', 'Romania', 2200, 1, 26.1, 44.43],
  ['Brussels', 'Belgium', 2100, 1, 4.35, 50.85],
  ['Lisbon', 'Portugal', 2900, 1, -9.14, 38.72],
  ['Athens', 'Greece', 3200, 1, 23.73, 37.98],
  ['Vienna', 'Austria', 1950, 1, 16.37, 48.21],
  ['Hamburg', 'Germany', 1900, 0, 9.99, 53.55],
  ['Warsaw', 'Poland', 1800, 1, 21.01, 52.23],
  ['Budapest', 'Hungary', 1750, 1, 19.04, 47.5],
  ['Stockholm', 'Sweden', 1600, 1, 18.07, 59.33],
  ['Munich', 'Germany', 1500, 0, 11.58, 48.14],
  ['Belgrade', 'Serbia', 1400, 1, 20.46, 44.79],
  ['Zurich', 'Switzerland', 1400, 0, 8.54, 47.38],
  ['Copenhagen', 'Denmark', 1350, 1, 12.57, 55.68],
  ['Prague', 'Czechia', 1300, 1, 14.42, 50.08],
  ['Helsinki', 'Finland', 1300, 1, 24.94, 60.17],
  ['Sofia', 'Bulgaria', 1300, 1, 23.32, 42.7],
  ['Dublin', 'Ireland', 1200, 1, -6.26, 53.35],
  ['Amsterdam', 'Netherlands', 1150, 1, 4.9, 52.37],
  ['Oslo', 'Norway', 1050, 1, 10.75, 59.91],
  ['Minsk', 'Belarus', 2000, 1, 27.57, 53.9],
  ['Zagreb', 'Croatia', 800, 1, 15.98, 45.81],
  ['Riga', 'Latvia', 630, 1, 24.11, 56.95],
  ['Vilnius', 'Lithuania', 540, 1, 25.28, 54.69],
  ['Tallinn', 'Estonia', 440, 1, 24.75, 59.44],
  ['Sarajevo', 'Bosnia and Herzegovina', 350, 1, 18.41, 43.86],
  ['Tirana', 'Albania', 500, 1, 19.82, 41.33],
  ['Bern', 'Switzerland', 140, 1, 7.45, 46.95],
  ['Reykjavik', 'Iceland', 140, 1, -21.9, 64.15],
  // Africa
  ['Cairo', 'Egypt', 20900, 1, 31.24, 30.04],
  ['Lagos', 'Nigeria', 14400, 0, 3.38, 6.52],
  ['Kinshasa', 'DR Congo', 14300, 1, 15.27, -4.44],
  ['Luanda', 'Angola', 8300, 1, 13.23, -8.84],
  ['Dar es Salaam', 'Tanzania', 7000, 0, 39.28, -6.79],
  ['Johannesburg', 'South Africa', 5900, 0, 28.05, -26.2],
  ['Khartoum', 'Sudan', 5800, 1, 32.53, 15.5],
  ['Abidjan', "Cote d'Ivoire", 5200, 0, -4.02, 5.36],
  ['Addis Ababa', 'Ethiopia', 4800, 1, 38.74, 9.03],
  ['Nairobi', 'Kenya', 4700, 1, 36.82, -1.29],
  ['Cape Town', 'South Africa', 4600, 1, 18.42, -33.92],
  ['Casablanca', 'Morocco', 3800, 0, -7.59, 33.57],
  ['Yaounde', 'Cameroon', 4100, 1, 11.52, 3.87],
  ['Kampala', 'Uganda', 3300, 1, 32.58, 0.35],
  ['Antananarivo', 'Madagascar', 3300, 1, 47.52, -18.88],
  ['Durban', 'South Africa', 3200, 0, 31.02, -29.86],
  ['Dakar', 'Senegal', 3100, 1, -17.47, 14.69],
  ['Abuja', 'Nigeria', 3000, 1, 7.49, 9.06],
  ['Algiers', 'Algeria', 2900, 1, 3.06, 36.75],
  ['Lusaka', 'Zambia', 2900, 1, 28.29, -15.39],
  ['Bamako', 'Mali', 2800, 1, -8.0, 12.64],
  ['Mogadishu', 'Somalia', 2600, 1, 45.34, 2.04],
  ['Accra', 'Ghana', 2500, 1, -0.19, 5.6],
  ['Tunis', 'Tunisia', 2400, 1, 10.18, 36.81],
  ['Harare', 'Zimbabwe', 1600, 1, 31.05, -17.83],
  ['Rabat', 'Morocco', 1800, 1, -6.84, 34.02],
  ['Maputo', 'Mozambique', 1100, 1, 32.57, -25.97],
  ['Tripoli', 'Libya', 1200, 1, 13.19, 32.89],
  ['Kigali', 'Rwanda', 1200, 1, 30.06, -1.95],
  ['Windhoek', 'Namibia', 430, 1, 17.08, -22.56],
  // North and Central America
  ['Mexico City', 'Mexico', 21800, 1, -99.13, 19.43],
  ['New York', 'United States', 18800, 0, -74.01, 40.71],
  ['Los Angeles', 'United States', 12500, 0, -118.24, 34.05],
  ['Chicago', 'United States', 8900, 0, -87.63, 41.88],
  ['Houston', 'United States', 6400, 0, -95.37, 29.76],
  ['Dallas', 'United States', 6400, 0, -96.8, 32.78],
  ['Toronto', 'Canada', 6300, 0, -79.38, 43.65],
  ['Miami', 'United States', 6100, 0, -80.19, 25.76],
  ['Philadelphia', 'United States', 5700, 0, -75.17, 39.95],
  ['Washington, D.C.', 'United States', 5400, 1, -77.04, 38.91],
  ['Atlanta', 'United States', 5300, 0, -84.39, 33.75],
  ['Guadalajara', 'Mexico', 5300, 0, -103.35, 20.67],
  ['Monterrey', 'Mexico', 5000, 0, -100.31, 25.67],
  ['Boston', 'United States', 4300, 0, -71.06, 42.36],
  ['Phoenix', 'United States', 4200, 0, -112.07, 33.45],
  ['Montreal', 'Canada', 4100, 0, -73.57, 45.5],
  ['Santo Domingo', 'Dominican Republic', 3500, 1, -69.93, 18.49],
  ['San Francisco', 'United States', 3500, 0, -122.42, 37.77],
  ['Seattle', 'United States', 3500, 0, -122.33, 47.61],
  ['Guatemala City', 'Guatemala', 3000, 1, -90.51, 14.63],
  ['Denver', 'United States', 2900, 0, -104.99, 39.74],
  ['Port-au-Prince', 'Haiti', 2800, 1, -72.34, 18.54],
  ['Vancouver', 'Canada', 2600, 0, -123.12, 49.28],
  ['Havana', 'Cuba', 2100, 1, -82.37, 23.14],
  ['Panama City', 'Panama', 1900, 1, -79.52, 8.98],
  ['San Jose', 'Costa Rica', 1400, 1, -84.08, 9.93],
  ['Ottawa', 'Canada', 1400, 1, -75.7, 45.42],
  ['Tegucigalpa', 'Honduras', 1400, 1, -87.21, 14.07],
  ['Managua', 'Nicaragua', 1100, 1, -86.25, 12.13],
  ['Honolulu', 'United States', 1000, 0, -157.86, 21.31],
  ['Kingston', 'Jamaica', 600, 1, -76.79, 18.0],
  ['Anchorage', 'United States', 300, 0, -149.9, 61.22],
  // South America
  ['Sao Paulo', 'Brazil', 22000, 0, -46.63, -23.55],
  ['Buenos Aires', 'Argentina', 15200, 1, -58.38, -34.6],
  ['Rio de Janeiro', 'Brazil', 13500, 0, -43.17, -22.91],
  ['Bogota', 'Colombia', 11000, 1, -74.07, 4.71],
  ['Lima', 'Peru', 10700, 1, -77.04, -12.05],
  ['Santiago', 'Chile', 6800, 1, -70.65, -33.45],
  ['Belo Horizonte', 'Brazil', 6100, 0, -43.94, -19.92],
  ['Brasilia', 'Brazil', 4800, 1, -47.93, -15.78],
  ['Fortaleza', 'Brazil', 4100, 0, -38.54, -3.73],
  ['Porto Alegre', 'Brazil', 4100, 0, -51.23, -30.03],
  ['Medellin', 'Colombia', 4000, 0, -75.57, 6.24],
  ['Recife', 'Brazil', 4000, 0, -34.88, -8.05],
  ['Salvador', 'Brazil', 3900, 0, -38.5, -12.97],
  ['Asuncion', 'Paraguay', 3300, 1, -57.58, -25.26],
  ['Guayaquil', 'Ecuador', 3000, 0, -79.89, -2.17],
  ['Caracas', 'Venezuela', 2900, 1, -66.9, 10.48],
  ['Cali', 'Colombia', 2800, 0, -76.53, 3.45],
  ['Manaus', 'Brazil', 2300, 0, -60.02, -3.12],
  ['Quito', 'Ecuador', 2000, 1, -78.47, -0.18],
  ['La Paz', 'Bolivia', 1900, 1, -68.15, -16.49],
  ['Montevideo', 'Uruguay', 1800, 1, -56.19, -34.9],
  // Oceania
  ['Sydney', 'Australia', 5300, 0, 151.21, -33.87],
  ['Melbourne', 'Australia', 5000, 0, 144.96, -37.81],
  ['Brisbane', 'Australia', 2500, 0, 153.03, -27.47],
  ['Perth', 'Australia', 2100, 0, 115.86, -31.95],
  ['Auckland', 'New Zealand', 1700, 0, 174.76, -36.85],
  ['Adelaide', 'Australia', 1400, 0, 138.6, -34.93],
  ['Canberra', 'Australia', 460, 1, 149.13, -35.28],
  ['Wellington', 'New Zealand', 420, 1, 174.78, -41.29],
  ['Port Moresby', 'Papua New Guinea', 400, 1, 147.18, -9.44],
  ['Suva', 'Fiji', 180, 1, 178.44, -18.14],
];

export const CITY_COUNT = CITIES.length;

export function cityFeatures(): Feature[] {
  return CITIES.map(([NAME, COUNTRY, POP, cap, lon, lat]) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { NAME, COUNTRY, POP_EST: POP * 1000, CAPITAL: cap === 1 },
  }));
}

// ---------- continents for world-atlas countries (ISO 3166-1 numeric codes) ----------

const CONTINENT_IDS: Record<string, string> = {
  Africa:
    '012 024 204 072 854 108 120 132 140 148 174 178 180 384 262 818 226 232 748 231 266 270 288 324 624 404 426 430 434 450 454 466 478 480 504 508 516 562 566 646 678 686 690 694 706 710 728 729 834 768 788 800 732 894 716 654',
  Asia:
    '004 051 031 048 050 064 096 116 156 196 268 356 360 364 368 376 392 400 398 414 417 418 422 458 462 496 104 524 408 512 586 275 608 634 682 702 410 144 760 158 762 764 626 792 795 784 860 704 887 446 344',
  Europe:
    '008 020 040 112 056 070 100 191 203 208 233 246 250 276 300 348 352 372 380 428 438 440 442 470 498 492 499 528 807 578 616 620 642 643 674 688 703 705 724 752 756 804 826 336 832 831 833 248 234',
  'North America':
    '028 044 052 084 124 188 192 212 214 222 308 320 332 340 388 484 558 591 659 662 670 780 840 304 630 850 660 136 060 092 796 500 533 531 534 666 663 652',
  'South America': '032 068 076 152 170 218 328 600 604 740 858 862 238',
  Oceania: '036 242 296 584 583 520 554 585 598 882 090 776 798 548 540 258 580 316 016 570 184 876 612 574',
  Antarctica: '010 334',
  'Seven seas (open ocean)': '239 086 260',
};

const BY_ID = new Map<string, string>();
for (const [continent, ids] of Object.entries(CONTINENT_IDS)) for (const id of ids.split(' ')) BY_ID.set(id, continent);

const BY_NAME: Record<string, string> = {
  Somaliland: 'Africa',
  Kosovo: 'Europe',
  'N. Cyprus': 'Asia',
  'Indian Ocean Ter.': 'Seven seas (open ocean)',
  'Siachen Glacier': 'Asia',
};

export const CONTINENTS = Object.keys(CONTINENT_IDS);

/** Continent of a world-atlas country by its ISO numeric id (zero padded) or, failing that, name. */
export function continentOf(id: string | number | undefined, name?: string): string {
  const key = id === undefined || id === null || id === '' ? '' : String(id).padStart(3, '0');
  return BY_ID.get(key) ?? (name && BY_NAME[name]) ?? 'Seven seas (open ocean)';
}

// ---------- graticule and reference lines ----------

function densify(a: Position, b: Position, step = 1): Position[] {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / step));
  const out: Position[] = [];
  for (let i = 0; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  return out;
}

const dms = (v: number, pos: string, neg: string) => (v === 0 ? '0' : `${Math.abs(v)}°${v > 0 ? pos : neg}`);

/** Lines of constant longitude / latitude every `step` degrees. */
export function graticuleFeatures(step = 10): Feature[] {
  const out: Feature[] = [];
  for (let lon = -180; lon <= 180; lon += step)
    out.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: densify([lon, -90], [lon, 90]) },
      properties: { TYPE: 'Meridian', VALUE: lon, LABEL: dms(lon, 'E', 'W') },
    });
  for (let lat = -90 + step; lat < 90; lat += step)
    out.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: densify([-180, lat], [180, lat]) },
      properties: { TYPE: 'Parallel', VALUE: lat, LABEL: dms(lat, 'N', 'S') },
    });
  return out;
}

export function referenceLineFeatures(): Feature[] {
  const lat = (name: string, v: number): Feature => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: densify([-180, v], [180, v]) },
    properties: { NAME: name, KIND: 'Parallel', VALUE: v },
  });
  return [
    lat('Equator', 0),
    lat('Tropic of Cancer', 23.4366),
    lat('Tropic of Capricorn', -23.4366),
    lat('Arctic Circle', 66.5634),
    lat('Antarctic Circle', -66.5634),
    { type: 'Feature', geometry: { type: 'LineString', coordinates: densify([0, -90], [0, 90]) }, properties: { NAME: 'Prime Meridian', KIND: 'Meridian', VALUE: 0 } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: densify([180, -90], [180, 90]) }, properties: { NAME: 'Antimeridian', KIND: 'Meridian', VALUE: 180 } },
  ];
}
