import { fullness } from '../lib/availability';
import {
  formatClock,
  formatDayClock,
  formatDistance,
  formatDuration,
  formatMoney,
  walkMinutes,
  weekdayName,
} from '../lib/time';
import { LOT_TYPE_LABEL, lotsLabel, type CarparkItem } from '../model';

interface Props {
  item: CarparkItem;
  selected: boolean;
  pending: boolean;
  stayMinutes: number | null;
  arrival: number;
  onToggle(): void;
}

const STATUS_LABEL = { live: 'Live', predicted: 'Predicted', none: 'No data' } as const;

export function CarparkCard({ item, selected, pending, stayMinutes, arrival, onToggle }: Props) {
  const { carpark: cp, availability: a, quote, distance } = item;
  const lots = lotsLabel(a, pending);
  const level = fullness(a);
  const statusLabel = a.status === 'none' && pending ? 'Checking' : STATUS_LABEL[a.status];

  return (
    <li className={`card${selected ? ' is-selected' : ''}`} id={`card-${cp.id}`}>
      <button type="button" className="card-head" aria-expanded={selected} onClick={onToggle}>
        <div className={`lots lots--${level}${a.status === 'predicted' ? ' lots--predicted' : ''}`}>
          <b>{lots.value}</b>
          <span>{lots.caption}</span>
        </div>
        <div className="card-main">
          <div className="card-title">{cp.name}</div>
          <div className="card-meta">
            <span className={`chip chip--${a.status}`}>{statusLabel}</span>
            <span>
              {formatDistance(distance)} · {walkMinutes(distance)} min walk
            </span>
          </div>
          <div className="card-price">
            {quote.total !== null && stayMinutes ? (
              <>
                <b>{formatMoney(quote.total)}</b> for {formatDuration(stayMinutes)}
              </>
            ) : (
              quote.rateLabel
            )}
          </div>
        </div>
        <svg className="chev" viewBox="0 0 20 20" aria-hidden="true">
          <path d="m5 8 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {selected && (
        <div className="detail">
          <section>
            <h3>Availability</h3>
            {a.status === 'live' && (
              <p className="hint">
                Live count{a.updated ? `, updated ${formatClock(a.updated)}` : ''}.
              </p>
            )}
            {a.status === 'predicted' && (
              <p className="hint">
                Predicted for {formatDayClock(arrival)} from the last {a.samples}{' '}
                {weekdayName(arrival)}
                {a.samples === 1 ? '' : 's'} at this time
                {a.range && a.range[0] !== a.range[1] ? ` (ranged ${a.range[0]} to ${a.range[1]})` : ''}.
              </p>
            )}
            {a.status === 'none' && (
              <p className="hint">
                {pending
                  ? 'Checking past data for this car park…'
                  : 'This car park is not reporting live counts and has no recent history to predict from.'}
              </p>
            )}
            {a.lots.length > 0 && (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Lot type</th>
                    <th scope="col">{a.status === 'predicted' ? 'Expected' : 'Available'}</th>
                    <th scope="col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {a.lots.map((l) => (
                    <tr key={l.lotType}>
                      <th scope="row">{LOT_TYPE_LABEL[l.lotType] ?? `Other (${l.lotType})`}</th>
                      <td>{a.status === 'predicted' ? `~${l.available}` : l.available}</td>
                      <td>{l.total ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h3>By level</h3>
            {a.levels?.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Level</th>
                    <th scope="col">Available</th>
                    <th scope="col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {a.levels.map((l) => (
                    <tr key={l.level}>
                      <th scope="row">{l.level}</th>
                      <td>{l.available}</td>
                      <td>{l.total ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="hint">
                {cp.decks && cp.decks > 1
                  ? `${cp.decks} decks. Counts per level are not published for this car park; the figures above cover all levels.`
                  : cp.decks === 1 || cp.decks === 0
                    ? 'Single level, so the figures above cover the whole car park.'
                    : 'Counts per level are not published for this car park.'}
              </p>
            )}
          </section>

          <section>
            <h3>Charges</h3>
            <p className="rate">{quote.rateLabel}</p>
            {quote.lines.length > 0 && (
              <table className="table">
                <tbody>
                  {quote.lines.map((l) => (
                    <tr key={l.label}>
                      <th scope="row">
                        {l.label}
                        <small>{formatDuration(l.minutes)}</small>
                      </th>
                      <td>{formatMoney(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                {quote.total !== null && (
                  <tfoot>
                    <tr>
                      <th scope="row">Total{stayMinutes ? ` for ${formatDuration(stayMinutes)}` : ''}</th>
                      <td>{formatMoney(quote.total)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
            {quote.notes.length > 0 && (
              <ul className="notes">
                {quote.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3>About</h3>
            <dl className="facts">
              <dt>Car park</dt>
              <dd>
                {cp.agency} {cp.code}
              </dd>
              {cp.type && (
                <>
                  <dt>Type</dt>
                  <dd>
                    {cp.type}
                    {cp.basement ? ' (basement)' : ''}
                  </dd>
                </>
              )}
              {cp.parkingSystem && (
                <>
                  <dt>Payment</dt>
                  <dd>{cp.parkingSystem === 'COUPON PARKING' ? 'Parking coupons' : 'Electronic (gantry)'}</dd>
                </>
              )}
              {cp.gantryHeight ? (
                <>
                  <dt>Height limit</dt>
                  <dd>{cp.gantryHeight.toFixed(1)} m</dd>
                </>
              ) : null}
              <dt>Distance</dt>
              <dd>
                {formatDistance(distance)} straight line, about {walkMinutes(distance)} min walk
              </dd>
            </dl>
            <a
              className="btn"
              href={`https://www.google.com/maps/dir/?api=1&destination=${cp.lat},${cp.lng}&travelmode=driving`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Get driving directions
            </a>
          </section>
        </div>
      )}
    </li>
  );
}
