import { useId, useState } from 'react';
import { formatRating } from '../lib/format';

const STAR = 'M12 2.8l2.7 5.9 6.4.7-4.8 4.3 1.4 6.3L12 16.7 6.3 20l1.4-6.3L2.9 9.4l6.4-.7L12 2.8Z';

function Star({ fill, size, id }: { fill: number; size: number; id: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="star">
      <defs>
        <clipPath id={id}><rect x="0" y="0" width={24 * fill} height="24" /></clipPath>
      </defs>
      <path d={STAR} className="star-bg" />
      {fill > 0 && <path d={STAR} className="star-fg" clipPath={`url(#${id})`} />}
    </svg>
  );
}

/** Read-only rating: five stars with half steps. */
export function Stars({ value, size = 16 }: { value: number | null; size?: number }) {
  const v = value ?? 0;
  const uid = useId().replace(/:/g, '');
  return (
    <span className="stars" role="img" aria-label={value == null ? 'Not rated' : `${formatRating(value)} out of 5`}>
      {[0, 1, 2, 3, 4].map((i) => <Star key={i} id={`c${uid}${i}`} size={size} fill={Math.max(0, Math.min(1, v - i))} />)}
    </span>
  );
}

/** The group score as a big condensed number + red meter. */
export function Score({ value, count, big }: { value: number | null; count?: number; big?: boolean }) {
  return (
    <div className={`score${big ? ' score-big' : ''}`}>
      <span className="score-num">{formatRating(value)}</span>
      <span className="score-meter" aria-hidden="true"><i style={{ width: `${((value ?? 0) / 5) * 100}%` }} /></span>
      {count !== undefined && <span className="score-count">{count === 0 ? 'no ratings yet' : `${count} ${count === 1 ? 'voice' : 'voices'}`}</span>}
    </div>
  );
}

/** Tap a star's left half for .5, right half for a whole number. Keyboard: arrow keys. */
export function RatingInput({ value, onChange }: { value: number; onChange(v: number): void }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;
  const pick = (i: number, e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX - r.left < r.width / 2 ? i + 0.5 : i + 1;
  };
  return (
    <div
      className="rating-input"
      role="slider"
      tabIndex={0}
      aria-label="Rating"
      aria-valuemin={0.5}
      aria-valuemax={5}
      aria-valuenow={value || undefined}
      aria-valuetext={value ? `${formatRating(value)} out of 5` : 'Not rated'}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(5, (value || 0) + 0.5)); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(0.5, (value || 1) - 0.5)); }
      }}
      onMouseLeave={() => setHover(null)}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <button
          key={i}
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onMouseMove={(e) => setHover(pick(i, e))}
          onClick={(e) => onChange(pick(i, e))}
        >
          <Star id={`ri${i}`} size={38} fill={Math.max(0, Math.min(1, shown - i))} />
        </button>
      ))}
      <span className="rating-value">{value ? formatRating(shown) : 'Tap to rate'}</span>
    </div>
  );
}
