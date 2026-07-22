// app/static/js/components/MobileItemsList.jsx
// Mobile Items page (design 3b list state). Rendered by PracticeItemsList
// below the 640px breakpoint; PracticeItemsList stays the owner of all items
// state and passes the handlers this view needs as props. Tapping a row opens
// the existing ItemEditor dialog — the mock's edit sheet is functionally
// identical to it, so no separate mobile editor.
import { useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { ChordIcon } from './icons/ChordIcon';

const MobileItemsList = ({ items, onNew, onEdit, onDelete, onOpenChordCharts }) => {
  const [query, setQuery] = useState('');

  // Same apostrophe-normalizing match as the desktop list
  const normalizeApostrophes = (str) => str.replace(/[’'`]/g, "'");
  const q = normalizeApostrophes(query.trim().toLowerCase());
  const list = items.filter(it =>
    !q || normalizeApostrophes((it['C'] || '').toLowerCase()).includes(q)
  );

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
        <div className="font-bold" style={{ fontSize: '17px', color: '#f3f4f6' }}>Items</div>
        <button
          type="button"
          onClick={onNew}
          className="font-bold shrink-0"
          style={{ height: '36px', padding: '0 14px', borderRadius: '8px', backgroundColor: '#f97316', color: '#111827', fontSize: '13px' }}
          data-ph-capture-attribute-button="mobile-new-item"
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
          placeholder="Search items..."
          aria-label="Search items"
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

      {/* Item rows */}
      <div className="flex flex-col" style={{ gap: '8px' }}>
        {list.map(item => (
          <div
            key={item['B']}
            onClick={() => onEdit(item)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onEdit(item);
              }
            }}
            className="flex items-center cursor-pointer"
            style={{
              height: '52px',
              backgroundColor: '#1f2937',
              borderRadius: '10px',
              padding: '0 6px 0 14px',
              gap: '6px',
            }}
            data-ph-capture-attribute-button="mobile-item-row"
          >
            <span className="flex-1 truncate" style={{ fontSize: '15px', color: '#f3f4f6' }}>
              {item['C']}
            </span>
            <span
              className="shrink-0"
              style={{ fontSize: '12px', color: '#9ca3af', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            >
              {parseInt(item['E'], 10) || 5} min
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenChordCharts(item['B'], item['C']);
              }}
              className="flex items-center justify-center shrink-0"
              style={{ width: '36px', height: '36px', borderRadius: '8px', color: '#60a5fa' }}
              aria-label="Chord charts"
              data-ph-capture-attribute-button="mobile-item-chord-charts"
            >
              <ChordIcon className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(item['B']);
              }}
              className="flex items-center justify-center shrink-0"
              style={{ width: '36px', height: '36px', borderRadius: '8px', color: '#6b7280' }}
              aria-label="Delete item"
              data-ph-capture-attribute-button="mobile-delete-item"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}

        {list.length === 0 && (
          <div className="text-center" style={{ color: '#6b7280', fontSize: '13px', padding: '24px 0' }}>
            {q ? 'No items match your search' : 'No items yet — tap + New to create one'}
          </div>
        )}
      </div>
    </div>
  );
};

export default MobileItemsList;
