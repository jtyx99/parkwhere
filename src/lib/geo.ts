const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Straight-line distance in metres. */
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// SVY21 projection constants (WGS84 ellipsoid, origin at Base 7 Pierce Reservoir).
const A = 6378137;
const F = 1 / 298.257223563;
const O_LAT = 1 + 22 / 60;
const O_LNG = 103 + 50 / 60;
const O_N = 38744.572;
const O_E = 28001.642;
const K = 1;

const B = A * (1 - F);
const E2 = 2 * F - F * F;
const E4 = E2 * E2;
const E6 = E4 * E2;
const A0 = 1 - E2 / 4 - (3 * E4) / 64 - (5 * E6) / 256;
const A2 = (3 / 8) * (E2 + E4 / 4 + (15 * E6) / 128);
const A4 = (15 / 256) * (E4 + (3 * E6) / 4);
const A6 = (35 * E6) / 3072;

const calcM = (lat: number) => {
  const r = rad(lat);
  return A * (A0 * r - A2 * Math.sin(2 * r) + A4 * Math.sin(4 * r) - A6 * Math.sin(6 * r));
};

/** Convert SVY21 easting/northing (metres) to WGS84 latitude/longitude. */
export function svy21ToWgs84(easting: number, northing: number): { lat: number; lng: number } {
  const Mprime = calcM(O_LAT) + (northing - O_N) / K;
  const n = (A - B) / (A + B);
  const n2 = n * n;
  const n3 = n2 * n;
  const n4 = n2 * n2;
  const G = A * (1 - n) * (1 - n2) * (1 + (9 * n2) / 4 + (225 * n4) / 64) * (Math.PI / 180);
  const sigma = ((Mprime / G) * Math.PI) / 180;

  const latP =
    sigma +
    ((3 * n) / 2 - (27 * n3) / 32) * Math.sin(2 * sigma) +
    ((21 * n2) / 16 - (55 * n4) / 32) * Math.sin(4 * sigma) +
    ((151 * n3) / 96) * Math.sin(6 * sigma) +
    ((1097 * n4) / 512) * Math.sin(8 * sigma);

  const sinP = Math.sin(latP);
  const sin2 = sinP * sinP;
  const rho = (A * (1 - E2)) / Math.pow(1 - E2 * sin2, 1.5);
  const v = A / Math.sqrt(1 - E2 * sin2);
  const psi = v / rho;
  const psi2 = psi * psi;
  const psi3 = psi2 * psi;
  const psi4 = psi3 * psi;
  const t = Math.tan(latP);
  const t2 = t * t;
  const t4 = t2 * t2;
  const t6 = t4 * t2;

  const Ep = easting - O_E;
  const x = Ep / (K * v);
  const x2 = x * x;
  const x3 = x2 * x;
  const x5 = x3 * x2;
  const x7 = x5 * x2;

  const latFactor = t / (K * rho);
  const lat =
    latP -
    latFactor * ((Ep * x) / 2) +
    latFactor * ((Ep * x3) / 24) * (-4 * psi2 + 9 * psi * (1 - t2) + 12 * t2) -
    latFactor *
      ((Ep * x5) / 720) *
      (8 * psi4 * (11 - 24 * t2) -
        12 * psi3 * (21 - 71 * t2) +
        15 * psi2 * (15 - 98 * t2 + 15 * t4) +
        180 * psi * (5 * t2 - 3 * t4) +
        360 * t4) +
    latFactor * ((Ep * x7) / 40320) * (1385 - 3633 * t2 + 4095 * t4 + 1575 * t6);

  const secP = 1 / Math.cos(latP);
  const lng =
    rad(O_LNG) +
    x * secP -
    ((x3 * secP) / 6) * (psi + 2 * t2) +
    ((x5 * secP) / 120) * (-4 * psi3 * (1 - 6 * t2) + psi2 * (9 - 68 * t2) + 72 * psi * t2 + 24 * t4) -
    ((x7 * secP) / 5040) * (61 + 662 * t2 + 1320 * t4 + 720 * t6);

  return { lat: (lat * 180) / Math.PI, lng: (lng * 180) / Math.PI };
}
