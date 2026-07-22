// app/static/js/components/MobileChordGrid.jsx
// Mobile Practice-page chord density grid (design 2a).
// Renders an item's chord sections as a 3- or 4-across grid of scaled charts,
// with sticky section labels. The tiles + enlarge overlay live in the shared
// MobileChartTiles component (also used, with edit actions, by the chord modal).
// Pass onEdit / onDelete / onInsertAfter (each called with the chart object) to
// surface edit actions in the enlarge overlay; omit them for a view-only grid.
import MobileChartTiles from '@components/MobileChartTiles';

const MobileChordGrid = ({ sections, density, onEdit, onDelete, onInsertAfter }) => {
  if (!sections || sections.length === 0) {
    return <div className="text-xs text-gray-500 py-2">No chord charts for this item yet.</div>;
  }

  return (
    <div>
      {sections.map(section => (
        <div key={section.id} className="mb-2">
          {/* Sticky section label — sits below the 52px top bar */}
          <div
            className="sticky flex items-center justify-between mb-1.5"
            style={{
              top: '52px',
              zIndex: 30,
              backgroundColor: 'rgba(2,8,23,0.92)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              borderRadius: '6px',
              padding: '5px 10px',
            }}
          >
            <span
              className="uppercase font-bold"
              style={{ fontSize: '12px', letterSpacing: '0.06em', color: '#fb923c' }}
            >
              {section.label}
            </span>
            {section.repeatCount && (
              <span
                className="font-bold"
                style={{ fontSize: '11px', color: '#9ca3af', backgroundColor: '#1f2937', borderRadius: '99px', padding: '1px 8px' }}
              >
                {section.repeatCount}
              </span>
            )}
          </div>

          <MobileChartTiles
            chords={section.chords}
            density={density}
            onEdit={onEdit}
            onDelete={onDelete}
            onInsertAfter={onInsertAfter}
          />
        </div>
      ))}
    </div>
  );
};

export default MobileChordGrid;
