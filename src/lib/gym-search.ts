/**
 * Finding real climbing gyms, so nobody has to type an address.
 *
 * The source is OpenStreetMap through its Overpass query API. Google Places
 * would also work and has better coverage of small businesses, but it needs a
 * billing account and a key that a mobile app cannot keep secret. OpenStreetMap
 * needs neither, and a check against Santa Barbara found the gyms that are
 * actually there, so the trade is worth taking until coverage becomes a
 * problem somewhere real.
 *
 * Nothing found here is saved on its own. A search result becomes a gym in our
 * database only when somebody picks it, which keeps the table to places people
 * actually climb rather than a mirror of OpenStreetMap.
 */

/** A place found in OpenStreetMap, not yet a gym in our database. */
export type FoundGym = {
  /** OpenStreetMap's own id, kept so the same place is not added twice. */
  osmId: string;
  name: string;
  city: string | null;
  address: string | null;
  lat: number;
  lng: number;
  /** Indoor gyms and outdoor crags are both tagged as climbing in OSM. */
  indoor: boolean;
  distanceKm: number | null;
};

/**
 * Overpass is free and shared, which means it is sometimes simply overloaded
 * and answers 504 or 429. That is a normal condition rather than a bug, so
 * requests are retried before the caller is told anything went wrong.
 */
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const OVERPASS_ATTEMPTS = 3;
/**
 * Photon rather than Nominatim for typing.
 *
 * Nominatim matches whole words, so "bench" finds nothing and the results only
 * appear once a name is nearly complete, which is not how anybody uses a
 * search box. Photon is built on the same OpenStreetMap data but indexed for
 * type ahead, so partial words work. Both are free and neither needs a key.
 */
const PHOTON = 'https://photon.komoot.io/api/';

/**
 * Whoever runs a free service is entitled to know who is calling it.
 * OpenStreetMap's usage policy asks for this, and requests without it get
 * refused.
 */
const UA = '3B-BoulderingBetaBuddy/0.1';

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

/**
 * Climbing places within `radiusKm` of a point.
 *
 * This is discovery rather than search: it answers "what is around me" without
 * anybody typing. Overpass is the right tool because it queries by tag and
 * area, which a geocoder built for names cannot do.
 *
 * Overpass is free and shared, so being overloaded is a normal condition
 * rather than a bug. Requests are retried before the caller is told anything
 * went wrong.
 */
export async function searchNearby(
  lat: number,
  lng: number,
  radiusKm = 40
): Promise<FoundGym[]> {
  const radius = Math.round(radiusKm * 1000);

  // Two patterns cover how climbing places are tagged in practice: an explicit
  // sport=climbing, and sports centres that list climbing among several sports.
  const query = `
    [out:json][timeout:25];
    (
      nwr["sport"="climbing"](around:${radius},${lat},${lng});
      nwr["sport"~"climbing"]["leisure"="sports_centre"](around:${radius},${lat},${lng});
    );
    out center tags;
  `;

  let lastStatus = 0;

  for (let attempt = 0; attempt < OVERPASS_ATTEMPTS; attempt++) {
    // A little longer each time, because a server that just said it was busy
    // is unlikely to be free a moment later.
    if (attempt > 0) await sleep(1200 * attempt);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    try {
      const res = await fetch(OVERPASS, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      if (res.ok) {
        const json = (await res.json()) as { elements?: OverpassElement[] };
        return toGyms(json.elements ?? [], lat, lng);
      }

      lastStatus = res.status;
      // 429 and 5xx mean the server is busy and worth asking again. Anything
      // else is our request being wrong, which retrying will not fix.
      if (res.status !== 429 && res.status < 500) break;
    } catch {
      // A timeout or a dropped connection is the same kind of problem as a
      // 504, so it goes round again too.
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    lastStatus === 0
      ? 'The map service did not answer. It is free and shared, so it is busy sometimes.'
      : `The map service is busy right now (${lastStatus}).`
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Does this text already say it is about climbing? */
const MENTIONS_CLIMBING = /climb|boulder|crag/i;

/**
 * Find a gym by name as somebody types, anywhere.
 *
 * Separate from searchNearby because they answer a different question. Nearby
 * is for the gym you are standing in; this is for the one you climb at while
 * you are somewhere else, which is the usual case when somebody is setting the
 * app up.
 *
 * The word climbing is added when the text does not already imply it. Without
 * it a search ranks by name alone and "the pad" comes back with houses, a pet
 * groomer and a clothes shop; with it, partial words still find the gym.
 *
 * `near` biases results towards the searcher without restricting them, so the
 * gym down the road outranks one with the same name in another country, and a
 * search for a gym on the other side of the world still finds it.
 */
export async function searchByName(
  query: string,
  near?: { lat: number; lng: number }
): Promise<FoundGym[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const term = MENTIONS_CLIMBING.test(q) ? q : `${q} climbing`;

  const params = new URLSearchParams({ q: term, limit: '20' });
  if (near) {
    params.set('lat', String(near.lat));
    params.set('lon', String(near.lng));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(`${PHOTON}?${params}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Search is unavailable right now (${res.status}).`);

    const json = (await res.json()) as { features?: PhotonFeature[] };
    return (json.features ?? [])
      .filter(isClimbingPlace)
      .map((f) => fromPhoton(f, near))
      .filter(dedupe());
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('Search took too long. Try again in a moment.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    city?: string;
    county?: string;
    state?: string;
    street?: string;
    housenumber?: string;
    osm_id?: number;
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    extent?: number[];
  };
};

/**
 * Keep only places that are actually about climbing.
 *
 * The tag is the reliable signal; the name is a fallback for gyms mapped
 * without one, which is common for newer venues.
 */
function isClimbingPlace(f: PhotonFeature): boolean {
  const p = f.properties ?? {};
  if (p.osm_value === 'climbing' || p.osm_value === 'sports_centre') return true;
  return MENTIONS_CLIMBING.test(p.name ?? '');
}

function fromPhoton(f: PhotonFeature, near?: { lat: number; lng: number }): FoundGym {
  const p = f.properties ?? {};
  const [lng, lat] = f.geometry?.coordinates ?? [0, 0];
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');

  return {
    osmId: `${p.osm_type ?? 'N'}/${p.osm_id ?? `${lat},${lng}`}`,
    name: p.name ?? '',
    city: p.city ?? p.county ?? p.state ?? null,
    address: street || null,
    lat,
    lng,
    // A sports centre is a building; a crag tagged for climbing is not.
    indoor: p.osm_value === 'sports_centre',
    distanceKm: near ? distanceKm(near.lat, near.lng, lat, lng) : null,
  };
}

/**
 * The same gym often appears twice, once as the building and once as a point
 * inside it. Matching on name and a rough coordinate collapses those without
 * merging two real gyms that happen to share a name in different towns.
 */
function dedupe() {
  const seen = new Set<string>();
  return (g: FoundGym) => {
    if (!g.name) return false;
    const key = `${g.name.toLowerCase()}|${Math.round(g.lat * 500)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

function toGyms(elements: OverpassElement[], fromLat: number, fromLng: number): FoundGym[] {
  const seen = new Set<string>();
  const out: FoundGym[] = [];

  for (const el of elements) {
    const t = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;

    // An unnamed point is no use to somebody choosing from a list, and without
    // coordinates it cannot be sorted by distance either.
    if (!t.name || lat == null || lng == null) continue;

    // The same place is sometimes both a node and a way in OpenStreetMap.
    const key = `${t.name.toLowerCase()}|${Math.round(lat * 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');

    out.push({
      osmId: `${el.type}/${el.id}`,
      name: t.name,
      city: t['addr:city'] ?? null,
      address: street || null,
      lat,
      lng,
      // Outdoor crags carry climbing tags too. Anything tagged as a venue is
      // treated as indoor; a bare cliff is not.
      indoor: Boolean(t.leisure === 'sports_centre' || t.building || t['climbing:boulder']),
      distanceKm: distanceKm(fromLat, fromLng, lat, lng),
    });
  }

  // Indoor first, then nearest, since somebody searching from a phone is
  // almost always looking for the gym they are standing outside.
  return out.sort((a, b) => {
    if (a.indoor !== b.indoor) return a.indoor ? -1 : 1;
    return (a.distanceKm ?? 0) - (b.distanceKm ?? 0);
  });
}

/** Straight line distance, which is close enough for ordering a short list. */
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10;
}
