import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { fullness } from '../lib/availability';
import type { Place } from '../lib/onemap';
import { formatDistance, formatDuration, formatMoney, walkMinutes } from '../lib/time';
import { lotsLabel, statusText, type CarparkItem } from '../model';

interface Props {
  place: Place | null;
  radius: number;
  items: CarparkItem[];
  selectedId: string | null;
  pending: boolean;
  stayMinutes: number | null;
  now: number;
  onSelect(id: string): void;
  onDetails(id: string): void;
}

const SG_CENTER: L.LatLngExpression = [1.3521, 103.8198];
const SG_BOUNDS = L.latLngBounds([1.13, 103.55], [1.5, 104.15]);

const ATTRIBUTION =
  '<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" alt="" style="height:16px;width:16px;vertical-align:-3px"/>&nbsp;' +
  '<a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a>&nbsp;&copy;&nbsp;contributors&nbsp;|&nbsp;' +
  '<a href="https://www.sla.gov.sg/" target="_blank" rel="noopener noreferrer">Singapore Land Authority</a>';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function pinIcon(item: CarparkItem, selected: boolean, pending: boolean): L.DivIcon {
  const { value } = lotsLabel(item.availability, pending);
  const cls = [
    'pin',
    `pin--${fullness(item.availability)}`,
    item.availability.status === 'predicted' && 'pin--predicted',
    selected && 'is-selected',
  ]
    .filter(Boolean)
    .join(' ');
  return L.divIcon({
    className: 'pin-wrap',
    html: `<div class="${cls}"><span class="pin-p">P</span><b>${esc(value)}</b></div>`,
    iconSize: [0, 0],
  });
}

function popupHtml(item: CarparkItem, pending: boolean, stayMinutes: number | null, now: number): string {
  const { carpark, availability: a, quote, distance } = item;
  const { value, caption } = lotsLabel(a, pending);
  const status = statusText(a, pending, now);
  const charge =
    quote.total !== null && stayMinutes
      ? `<b>${formatMoney(quote.total)}</b> for ${formatDuration(stayMinutes)}`
      : esc(quote.rateLabel);
  return `
    <div class="popup">
      <div class="popup-name">${esc(carpark.name)}</div>
      <div class="popup-lots popup-lots--${fullness(a)}">
        <b>${esc(value)}</b> <span>${caption}${a.total ? ` of ${a.total}` : ''}</span>
        ${a.available === null ? '' : `<em class="chip chip--${a.status}">${status}</em>`}
      </div>
      <div class="popup-meta">${formatDistance(distance)} away · ${walkMinutes(distance)} min walk</div>
      <div class="popup-meta">${charge}</div>
      <button type="button" class="popup-btn" data-details="${esc(carpark.id)}">More details</button>
    </div>`;
}

export function MapView({ place, radius, items, selectedId, pending, stayMinutes, now, onSelect, onDetails }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const overlay = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const handlers = useRef({ onSelect, onDetails });
  handlers.current = { onSelect, onDetails };

  useEffect(() => {
    const node = el.current!;
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const m = L.map(node, {
      center: SG_CENTER,
      zoom: 12,
      minZoom: 11,
      maxZoom: 19,
      maxBounds: SG_BOUNDS,
      maxBoundsViscosity: 0.8,
      zoomControl: false,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.attributionControl.setPrefix(false);
    L.tileLayer(`https://www.onemap.gov.sg/maps/tiles/${dark ? 'Night' : 'Default'}/{z}/{x}/{y}.png`, {
      detectRetina: true,
      maxZoom: 19,
      minZoom: 11,
      attribution: ATTRIBUTION,
    }).addTo(m);
    overlay.current = L.layerGroup().addTo(m);
    map.current = m;

    const onClick = (e: MouseEvent) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-details]')?.dataset.details;
      if (id) handlers.current.onDetails(id);
    };
    node.addEventListener('click', onClick);
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(node);
    return () => {
      resize.disconnect();
      node.removeEventListener('click', onClick);
      m.remove();
      map.current = null;
      markers.current.clear();
    };
  }, []);

  // Destination pin and search radius.
  useEffect(() => {
    const m = map.current;
    const layer = overlay.current;
    if (!m || !layer) return;
    layer.clearLayers();
    if (!place) return;
    const at = L.latLng(place.lat, place.lng);
    L.circle(at, { radius, className: 'radius-ring', interactive: false }).addTo(layer);
    L.marker(at, {
      icon: L.divIcon({ className: 'dest-wrap', html: '<div class="dest"></div>', iconSize: [0, 0] }),
      interactive: false,
      keyboard: false,
      zIndexOffset: -100,
    }).addTo(layer);
    m.fitBounds(at.toBounds(radius * 2.3), { maxZoom: 18, animate: true });
  }, [place, radius]);

  // Keep one marker per car park in sync with the latest data.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    for (const item of items) {
      const id = item.carpark.id;
      seen.add(id);
      const selected = id === selectedId;
      const icon = pinIcon(item, selected, pending);
      const html = popupHtml(item, pending, stayMinutes, now);
      let marker = markers.current.get(id);
      if (!marker) {
        marker = L.marker([item.carpark.lat, item.carpark.lng], { icon, title: item.carpark.name })
          .bindPopup(html, { offset: [0, -30], closeButton: false, autoPanPadding: [24, 24] })
          .on('click', () => handlers.current.onSelect(id))
          .addTo(m);
        markers.current.set(id, marker);
      } else {
        marker.setIcon(icon);
        marker.setPopupContent(html);
      }
      marker.setZIndexOffset(selected ? 1000 : 0);
    }
    for (const [id, marker] of markers.current) {
      if (!seen.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }
  }, [items, selectedId, pending, stayMinutes, now]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const marker = selectedId ? markers.current.get(selectedId) : undefined;
    if (marker) {
      if (!marker.isPopupOpen()) marker.openPopup();
    } else {
      m.closePopup();
    }
  }, [selectedId]);

  return <div className="map" ref={el} role="application" aria-label="Map of nearby car parks" />;
}
