export interface Place {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

const SEARCH_URL = 'https://www.onemap.gov.sg/api/common/elastic/search';
// Optional: OneMap may require a token for search in future.
const TOKEN: string | undefined = import.meta.env.VITE_ONEMAP_TOKEN || undefined;

interface OneMapResult {
  SEARCHVAL: string;
  ADDRESS: string;
  LATITUDE: string;
  LONGITUDE: string;
}

const tidy = (s: string) =>
  s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bSingapore (\d{6})$/, 'S($1)');

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `${SEARCH_URL}?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
  const res = await fetch(url, { signal, headers: TOKEN ? { Authorization: TOKEN } : undefined });
  if (!res.ok) throw new Error(`Place search responded ${res.status}`);
  const data = (await res.json()) as { results?: OneMapResult[] };
  const seen = new Set<string>();
  const places: Place[] = [];
  for (const r of data.results ?? []) {
    const lat = Number(r.LATITUDE);
    const lng = Number(r.LONGITUDE);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = `${r.SEARCHVAL}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({ name: tidy(r.SEARCHVAL), address: tidy(r.ADDRESS), lat, lng });
    if (places.length >= 7) break;
  }
  return places;
}
