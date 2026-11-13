import { useCallback, useEffect, useMemo, useState } from 'react';
import { CarparkCard } from './components/CarparkCard';
import { MapView } from './components/MapView';
import { SearchBar } from './components/SearchBar';
import { isFresh, resolveAvailability, wantsLive } from './lib/availability';
import { haversine } from './lib/geo';
import { searchPlaces, type Place } from './lib/onemap';
import { MINUTE, formatClock, formatDate, formatDistance, parseSgt, toSgtInput } from './lib/time';
import { RADIUS_OPTIONS, type CarparkItem, type SortMode } from './model';
import { sourceById, sources } from './sources';
import { hdbListDate } from './sources/hdb';
import type { Carpark, Snapshot, SourceId } from './sources/types';

const EXAMPLES = ['Tampines Hub', 'Toa Payoh Central', 'Chinatown Complex', 'Bedok Interchange'];
const REFRESH_MS = 60_000;
const BUCKET = 15 * MINUTE;

type SnapshotMap = Partial<Record<SourceId, Snapshot>>;
type HistoryMap = Partial<Record<SourceId, Snapshot[]>>;

const roundUp5 = (t: number) => Math.ceil(t / (5 * MINUTE)) * 5 * MINUTE;

export function App() {
  const [carparks, setCarparks] = useState<Carpark[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [radius, setRadius] = useState(RADIUS_OPTIONS[0]);
  const [arriveStr, setArriveStr] = useState(() => toSgtInput(roundUp5(Date.now())));
  const [departStr, setDepartStr] = useState(() => toSgtInput(roundUp5(Date.now()) + 120 * MINUTE));
  const [live, setLive] = useState<SnapshotMap>({});
  const [liveError, setLiveError] = useState(false);
  const [liveAt, setLiveAt] = useState<number | null>(null);
  const [history, setHistory] = useState<{ key: string; data: HistoryMap } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('distance');
  const [now, setNow] = useState(() => Date.now());
  const [listDate, setListDate] = useState<number | null>(null);

  // Car park lists.
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled(sources.map((s) => s.loadCarparks())).then((results) => {
      if (cancelled) return;
      const all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      setCarparks(all);
      setListDate(hdbListDate());
      if (all.length === 0) setLoadError('Could not load the car park list. Reload to try again.');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live availability, refreshed every minute while the tab is visible.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      const results = await Promise.allSettled(sources.map((s) => s.getLive()));
      if (cancelled) return;
      const next: SnapshotMap = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') next[sources[i].id] = r.value;
      });
      const ok = Object.keys(next).length > 0;
      setLiveError(!ok);
      if (ok) {
        setLive((prev) => ({ ...prev, ...next }));
        setLiveAt(Date.now());
      }
      setNow(Date.now());
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const arrive = parseSgt(arriveStr);
  const depart = parseSgt(departStr);
  const timeError = !arrive
    ? 'Enter your arrival time.'
    : !depart
      ? 'Enter your departure time.'
      : +depart <= +arrive
        ? 'Departure must be after arrival.'
        : null;
  const stayMinutes = !timeError && arrive && depart ? Math.round((+depart - +arrive) / MINUTE) : null;
  // Availability is always looked up for now or later, never the past.
  const arrival = Math.max(arrive ? +arrive : now, now);
  const arrivalBucket = Math.round(arrival / BUCKET) * BUCKET;

  const nearby = useMemo(() => {
    if (!place) return { inRange: [], nearest: null as { carpark: Carpark; distance: number } | null };
    let nearest: { carpark: Carpark; distance: number } | null = null;
    const inRange: { carpark: Carpark; distance: number }[] = [];
    for (const carpark of carparks) {
      const distance = haversine(place.lat, place.lng, carpark.lat, carpark.lng);
      if (!nearest || distance < nearest.distance) nearest = { carpark, distance };
      if (distance <= radius) inRange.push({ carpark, distance });
    }
    return { inRange, nearest };
  }, [carparks, place, radius]);

  // History is needed when arriving later, or when a nearby car park has no fresh live reading.
  const liveMode = wantsLive(arrival, now);
  const needHistory =
    nearby.inRange.length > 0 &&
    (!liveMode ||
      nearby.inRange.some(
        ({ carpark }) => !isFresh(live[carpark.sourceId]?.byCode.get(carpark.code), now),
      ));
  const historySources = useMemo(
    () => [...new Set(nearby.inRange.map((n) => n.carpark.sourceId))].sort().join(','),
    [nearby],
  );
  const historyKey = `${arrivalBucket}|${historySources}`;

  useEffect(() => {
    if (!needHistory || !historySources) return;
    let cancelled = false;
    const ids = historySources.split(',') as SourceId[];
    Promise.all(
      ids.map((id) =>
        sourceById(id)
          .getHistory(new Date(arrivalBucket), new Date())
          .catch(() => [] as Snapshot[]),
      ),
    ).then((lists) => {
      if (cancelled) return;
      const data: HistoryMap = {};
      ids.forEach((id, i) => (data[id] = lists[i]));
      setHistory({ key: historyKey, data });
    });
    return () => {
      cancelled = true;
    };
  }, [needHistory, historySources, arrivalBucket, historyKey]);

  const historyReady = history?.key === historyKey;
  const pending = (needHistory && !historyReady) || (liveMode && liveAt === null && !liveError);

  const items = useMemo(() => {
    const list: CarparkItem[] = nearby.inRange.map(({ carpark, distance }) => ({
      carpark,
      distance,
      availability: resolveAvailability(
        carpark.code,
        live[carpark.sourceId] ?? null,
        (historyReady && history?.data[carpark.sourceId]) || [],
        arrival,
        now,
      ),
      quote:
        arrive && depart
          ? sourceById(carpark.sourceId).quote(carpark, arrive, depart)
          : sourceById(carpark.sourceId).quote(carpark, new Date(0), new Date(0)),
    }));
    const byDistance = (x: CarparkItem, y: CarparkItem) => x.distance - y.distance;
    if (sort === 'price') {
      list.sort((x, y) => (x.quote.total ?? Infinity) - (y.quote.total ?? Infinity) || byDistance(x, y));
    } else if (sort === 'lots') {
      list.sort(
        (x, y) => (y.availability.available ?? -1) - (x.availability.available ?? -1) || byDistance(x, y),
      );
    } else {
      list.sort(byDistance);
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearby, live, history, historyReady, arrival, now, arriveStr, departStr, sort]);

  useEffect(() => {
    if (selectedId && !items.some((i) => i.carpark.id === selectedId)) setSelectedId(null);
  }, [items, selectedId]);

  const scrollToCard = useCallback((id: string) => {
    requestAnimationFrame(() =>
      document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
    );
  }, []);

  const selectFromMap = useCallback(
    (id: string) => {
      setSelectedId(id);
      // On wide screens the list sits beside the map, so bring the card into view.
      if (window.matchMedia('(min-width: 860px)').matches) scrollToCard(id);
    },
    [scrollToCard],
  );
  const showDetails = useCallback(
    (id: string) => {
      setSelectedId(id);
      scrollToCard(id);
    },
    [scrollToCard],
  );

  const pickPlace = useCallback((p: Place) => {
    setPlace(p);
    setSelectedId(null);
  }, []);

  const tryExample = async (name: string) => {
    try {
      const [first] = await searchPlaces(name);
      if (first) pickPlace(first);
    } catch {
      /* the search box reports its own errors */
    }
  };

  const widerRadius = nearby.nearest && RADIUS_OPTIONS.find((r) => r >= nearby.nearest!.distance);
  const predicting = !liveMode;
  const hasLta = useMemo(() => carparks.some((c) => c.sourceId === 'lta'), [carparks]);

  return (
    <div className="app">
      <header className="controls">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            P
          </span>
          <div>
            <h1>ParkWhere</h1>
            <p>Find parking near your destination in Singapore</p>
          </div>
        </div>

        <SearchBar place={place} onPick={pickPlace} />

        <div className="times">
          <label>
            <span className="field-label">Arrive</span>
            <input
              type="datetime-local"
              value={arriveStr}
              onChange={(e) => {
                const v = e.target.value;
                // Keep the same length of stay when arrival moves.
                const a0 = parseSgt(arriveStr);
                const d0 = parseSgt(departStr);
                const a1 = parseSgt(v);
                if (a0 && d0 && a1 && +d0 > +a0) setDepartStr(toSgtInput(+a1 + (+d0 - +a0)));
                setArriveStr(v);
              }}
            />
          </label>
          <label>
            <span className="field-label">Leave</span>
            <input
              type="datetime-local"
              value={departStr}
              min={arriveStr}
              aria-invalid={timeError ? true : undefined}
              onChange={(e) => setDepartStr(e.target.value)}
            />
          </label>
        </div>
        {timeError ? (
          <p className="hint hint--warn" role="alert">
            {timeError}
          </p>
        ) : (
          <p className="hint">Singapore time. Charges are worked out for this stay.</p>
        )}

        <div className="radius" role="group" aria-label="Search radius">
          <span className="field-label">Within</span>
          <div className="segmented">
            {RADIUS_OPTIONS.map((r) => (
              <button key={r} type="button" aria-pressed={r === radius} onClick={() => setRadius(r)}>
                {formatDistance(r)}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="map-area">
        <MapView
          place={place}
          radius={radius}
          items={items}
          selectedId={selectedId}
          pending={pending}
          stayMinutes={stayMinutes}
          now={now}
          onSelect={selectFromMap}
          onDetails={showDetails}
        />
        <div className="legend" aria-hidden="true">
          <span><i className="dot dot--good" />Plenty</span>
          <span><i className="dot dot--low" />Filling up</span>
          <span><i className="dot dot--full" />Nearly full</span>
          <span><i className="dot dot--unknown" />No data</span>
        </div>
      </main>

      <section className="results" aria-live="polite">
        {loadError && <p className="banner banner--error">{loadError}</p>}
        {liveError && (
          <p className="banner banner--error">
            Live availability could not be loaded. Showing predictions where possible; retrying every minute.
          </p>
        )}

        {!place ? (
          <div className="empty">
            <h2>Search for a place to see parking around it</h2>
            <p>
              Enter where you are going and when. You will see nearby car parks with lots left, the
              charge for your stay and the distance to walk.
            </p>
            <div className="examples">
              {EXAMPLES.map((name) => (
                <button key={name} type="button" onClick={() => tryExample(name)}>
                  {name}
                </button>
              ))}
            </div>
          </div>
        ) : carparks.length === 0 && !loadError ? (
          <p className="hint pad">Loading car parks…</p>
        ) : items.length === 0 ? (
          <div className="empty">
            <h2>No car parks within {formatDistance(radius)}</h2>
            {nearby.nearest && (
              <p>
                The nearest is {nearby.nearest.carpark.name}, {formatDistance(nearby.nearest.distance)} from{' '}
                {place.name}.
              </p>
            )}
            {widerRadius ? (
              <button type="button" className="btn" onClick={() => setRadius(widerRadius)}>
                Widen search to {formatDistance(widerRadius)}
              </button>
            ) : (
              <p>
                Nothing within 1 km either.
                {hasLta ? '' : ' Only public (HDB) car parks are covered so far.'}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="results-head">
              <div>
                <h2>
                  {items.length} car park{items.length === 1 ? '' : 's'} within {formatDistance(radius)}
                </h2>
                <p className="hint">
                  {predicting
                    ? 'Predicted for your arrival time from past weeks.'
                    : liveAt
                      ? `Live counts, updated ${formatClock(liveAt)}.`
                      : 'Loading live counts…'}
                </p>
              </div>
              <label className="sort">
                <span className="visually-hidden">Sort by</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
                  <option value="distance">Nearest</option>
                  <option value="price">Cheapest</option>
                  <option value="lots">Most lots</option>
                </select>
              </label>
            </div>
            <ul className="cards">
              {items.map((item) => (
                <CarparkCard
                  key={item.carpark.id}
                  item={item}
                  selected={item.carpark.id === selectedId}
                  pending={pending}
                  stayMinutes={stayMinutes}
                  arrival={arrival}
                  now={now}
                  onToggle={() => setSelectedId((cur) => (cur === item.carpark.id ? null : item.carpark.id))}
                />
              ))}
            </ul>
          </>
        )}

        <footer className="foot">
          Availability from data.gov.sg (HDB){hasLta ? ' and LTA DataMall' : ''}. Place search and
          map by OneMap. Charges are estimates; signs at the car park prevail.
          {listDate ? ` Car park list updated ${formatDate(listDate)}.` : ''}
        </footer>
      </section>
    </div>
  );
}
