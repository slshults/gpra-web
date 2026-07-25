// app/static/js/components/MobileRoutinesPage.jsx
// Mobile Routines page (design 3a list state). Rendered by RoutinesPage below
// the 640px breakpoint; RoutinesPage stays the owner of all routines state and
// passes the handlers this view needs as props. Tapping a card opens the
// existing RoutineEditor dialog (already mobile-responsive) — the mock's edit
// screen is functionally identical to it, so no separate mobile editor.
import { useState } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';

const MobileRoutinesPage = ({ routines, onNew, onEdit, onSetActive, onDeactivate, onDelete }) => {
  const [query, setQuery] = useState('');

  // Active routine pinned first, then inactive by their saved order
  const active = routines.find(r => r.active);
  const inactive = routines
    .filter(r => !r.active && r.ID != null)
    .sort((a, b) => Number(a.order) - Number(b.order));
  const q = query.trim().toLowerCase();
  const list = [...(active ? [active] : []), ...inactive]
    .filter(r => !q || r.name.toLowerCase().includes(q));

  return (
    <div style={{ padding: '0 12px 64px', boxSizing: 'border-box' }}>
      {/* Sticky top bar */}
      <div
        className="sticky flex items-center justify-between"
        style={{
          top: 0,
          zIndex: 40,
          height: '52px',
          margin: '0 -12px 10px',
          padding: '0 14px',
          backgroundColor: 'rgba(17,24,39,0.96)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderBottom: '1px solid #1f2937',
        }}
      >
        <div className="font-bold" style={{ fontSize: '17px', color: '#f3f4f6' }}>Routines</div>
        <button
          type="button"
          onClick={onNew}
          className="font-bold shrink-0"
          style={{ height: '36px', padding: '0 14px', borderRadius: '8px', backgroundColor: '#f97316', color: '#111827', fontSize: '13px' }}
          data-ph-capture-attribute-button="mobile-new-routine"
        >
          + New
        </button>
      </div>

      {/* Search */}
      <div className="relative" style={{ marginBottom: '10px' }}>
        <Search size={14} color="#6b7280" className="absolute" style={{ left: '12px', top: '13px' }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search routines..."
          aria-label="Search routines"
          autoComplete="off"
          className="w-full"
          style={{
            height: '40px',
            backgroundColor: '#0b1120',
            border: '1px solid #374151',
            borderRadius: '10px',
            padding: '0 12px 0 34px',
            fontSize: '14px',
            color: '#f3f4f6',
          }}
        />
      </div>

      {/* Routine cards */}
      <div className="flex flex-col" style={{ gap: '8px' }}>
        {list.map(r => (
          <div
            key={r.ID}
            onClick={() => onEdit(r)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onEdit(r);
              }
            }}
            className="cursor-pointer"
            style={{
              borderRadius: '12px',
              backgroundColor: '#1f2937',
              border: `1px solid ${r.active ? 'rgba(249,115,22,0.45)' : '#1f2937'}`,
              padding: '12px 14px',
            }}
            data-ph-capture-attribute-button="mobile-routine-card"
          >
            <div className="flex items-center justify-between" style={{ gap: '8px' }}>
              <div className="flex items-center min-w-0" style={{ gap: '8px' }}>
                <span className="font-semibold truncate" style={{ fontSize: '15px', color: '#f3f4f6' }}>
                  {r.name}
                </span>
                {r.active && (
                  <span
                    className="font-extrabold uppercase shrink-0"
                    style={{
                      fontSize: '9px',
                      letterSpacing: '0.06em',
                      color: '#f97316',
                      backgroundColor: 'rgba(249,115,22,0.14)',
                      borderRadius: '99px',
                      padding: '2px 7px',
                    }}
                  >
                    Active
                  </span>
                )}
              </div>
              <ChevronRight size={16} color="#6b7280" className="shrink-0" />
            </div>

            {/* Action row — taps here must not open the editor */}
            <div
              className="flex items-center justify-between"
              style={{ marginTop: '6px' }}
              onClick={(e) => e.stopPropagation()}
            >
              {r.active ? (
                <button
                  type="button"
                  onClick={() => onDeactivate(r.ID)}
                  className="font-semibold"
                  style={{ fontSize: '12px', color: '#9ca3af', padding: '4px 0' }}
                  data-ph-capture-attribute-button="mobile-deactivate-routine"
                >
                  Deactivate
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onSetActive(r.ID)}
                  className="font-semibold"
                  style={{ fontSize: '12px', color: '#fb923c', padding: '4px 0' }}
                  data-ph-capture-attribute-button="mobile-set-active-routine"
                >
                  Set active
                </button>
              )}
              <button
                type="button"
                onClick={() => onDelete(r.ID)}
                className="flex items-center justify-center"
                style={{ width: '28px', height: '28px', borderRadius: '6px', color: '#6b7280' }}
                aria-label="Delete routine"
                data-ph-capture-attribute-button="mobile-delete-routine"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        ))}

        {list.length === 0 && (
          <div className="text-center" style={{ color: '#6b7280', fontSize: '13px', padding: '24px 0' }}>
            {q ? 'No routines match your search' : 'No routines yet — tap + New to create one'}
          </div>
        )}
      </div>
    </div>
  );
};

export default MobileRoutinesPage;
