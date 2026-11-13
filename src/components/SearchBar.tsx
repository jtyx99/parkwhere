import { useEffect, useId, useRef, useState } from 'react';
import { searchPlaces, type Place } from '../lib/onemap';

interface Props {
  place: Place | null;
  onPick(place: Place): void;
}

export function SearchBar({ place, onPick }: Props) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const listId = useId();
  const skipSearch = useRef(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Reflect a place chosen elsewhere (example chips, my location).
  useEffect(() => {
    if (place) {
      skipSearch.current = true;
      setText(place.name);
      setOpen(false);
    }
  }, [place]);

  useEffect(() => {
    if (skipSearch.current) {
      skipSearch.current = false;
      return;
    }
    const q = text.trim();
    setMessage(null);
    if (q.length < 2) {
      setResults([]);
      setBusy(false);
      return;
    }
    const ctrl = new AbortController();
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const found = await searchPlaces(q, ctrl.signal);
        setResults(found);
        setActive(0);
        setOpen(true);
        setMessage(found.length ? null : 'No places found. Try a postal code or building name.');
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setResults([]);
        setMessage('Place search is unavailable right now. Try again shortly.');
      } finally {
        if (!ctrl.signal.aborted) setBusy(false);
      }
    }, 280);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [text]);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const pick = (p: Place) => {
    setOpen(false);
    setMessage(null);
    onPick(p);
  };

  const locate = () => {
    if (!navigator.geolocation) {
      setMessage('This browser cannot share your location.');
      return;
    }
    setLocating(true);
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        pick({
          name: 'My location',
          address: 'Current position',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      () => {
        setLocating(false);
        setMessage('Could not get your location. Check the browser permission, or type a place.');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const showList = open && results.length > 0;

  return (
    <div className="search" ref={wrap}>
      <label className="field-label" htmlFor={`${listId}-input`}>
        Where are you going?
      </label>
      <div className="search-row">
        <div className="search-input">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="m14 14 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            id={`${listId}-input`}
            type="search"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList ? `${listId}-${active}` : undefined}
            autoComplete="off"
            placeholder="Address, building or postal code"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && results.length) {
                e.preventDefault();
                setOpen(true);
                setActive((a) => (a + 1) % results.length);
              } else if (e.key === 'ArrowUp' && results.length) {
                e.preventDefault();
                setActive((a) => (a - 1 + results.length) % results.length);
              } else if (e.key === 'Enter' && results.length) {
                e.preventDefault();
                pick(results[showList ? active : 0]);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          {busy && <span className="spinner" aria-hidden="true" />}
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={locate}
          disabled={locating}
          aria-label="Use my current location"
          title="Use my current location"
        >
          {locating ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="3" fill="currentColor" />
              <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M10 1v3M10 16v3M1 10h3M16 10h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>
      {showList && (
        <ul className="suggestions" id={listId} role="listbox">
          {results.map((r, i) => (
            <li
              key={`${r.name}-${r.lat}-${r.lng}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : undefined}
              onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
            >
              <strong>{r.name}</strong>
              <span>{r.address}</span>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p className="hint hint--warn" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
