// app/static/js/components/MobileRoutinesPage.jsx
// Mobile Routines page (design 3a list state). Rendered by RoutinesPage below
// the 640px breakpoint; RoutinesPage stays the owner of all routines state and
// passes the handlers this view needs as props. Tapping a card opens the
// existing RoutineEditor dialog (already mobile-responsive) — the mock's edit
// screen is functionally identical to it, so no separate mobile editor.
//
// Cards use the same action language as the desktop rows (green + to activate,
// blue pencil to edit, red ✕ to delete, drag handle to reorder) so users can
// move between desktop and mobile without relearning anything. There is no
// deactivate action: one routine is always active, and the way to "deactivate"
// one is to activate another.
import { useState } from 'react';
import { GripVertical, Pencil, Plus, Search, X } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const RoutineCard = ({ routine, onEdit, onSetActive, onDelete, dragHandle, dragStyle, dragRef }) => (
  <div
    ref={dragRef}
    onClick={() => onEdit(routine)}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onEdit(routine);
      }
    }}
    className="flex items-center cursor-pointer"
    style={{
      borderRadius: '12px',
      backgroundColor: '#1f2937',
      border: `1px solid ${routine.active ? 'rgba(249,115,22,0.45)' : '#1f2937'}`,
      padding: '8px 8px 8px 14px',
      gap: '8px',
      ...dragStyle,
    }}
    data-ph-capture-attribute-button="mobile-routine-card"
  >
    {dragHandle}
    <div className="flex-1 min-w-0">
      <div className="font-semibold truncate" style={{ fontSize: '15px', color: '#f3f4f6' }}>
        {routine.name}
      </div>
      {routine.active && (
        <span
          className="inline-block font-extrabold uppercase"
          style={{
            fontSize: '9px',
            letterSpacing: '0.06em',
            color: '#f97316',
            backgroundColor: 'rgba(249,115,22,0.14)',
            borderRadius: '99px',
            padding: '2px 7px',
            marginTop: '3px',
          }}
        >
          Active
        </span>
      )}
    </div>

    {/* Actions — same icons as the desktop rows; taps here must not open the
        editor via the card handler */}
    <div
      className="flex items-center shrink-0"
      style={{ gap: '4px' }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {!routine.active && (
        <button
          type="button"
          onClick={() => onSetActive(routine.ID)}
          className="flex items-center justify-center"
          style={{ width: '36px', height: '36px', borderRadius: '8px', color: '#22c55e' }}
          title="Make this the active routine"
          aria-label="Activate routine"
          data-ph-capture-attribute-button="activate-routine"
        >
          <Plus size={17} />
        </button>
      )}
      <button
        type="button"
        onClick={() => onEdit(routine)}
        className="flex items-center justify-center"
        style={{ width: '36px', height: '36px', borderRadius: '8px', color: '#3b82f6' }}
        title="Edit routine"
        aria-label="Edit routine"
        data-ph-capture-attribute-button="edit-routine"
        data-tour={routine.active ? 'edit-routine-icon' : undefined}
      >
        <Pencil size={15} />
      </button>
      {!routine.active && (
        <button
          type="button"
          onClick={() => onDelete(routine.ID)}
          className="flex items-center justify-center"
          style={{ width: '36px', height: '36px', borderRadius: '8px', color: '#ef4444' }}
          title="Delete this routine"
          aria-label="Delete routine"
          data-ph-capture-attribute-button="delete-routine"
        >
          <X size={16} />
        </button>
      )}
    </div>
  </div>
);

// Inactive routines get a drag handle for reordering (desktop parity)
const SortableRoutineCard = ({ routine, onEdit, onSetActive, onDelete }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: routine.ID });

  return (
    <RoutineCard
      routine={routine}
      onEdit={onEdit}
      onSetActive={onSetActive}
      onDelete={onDelete}
      dragRef={setNodeRef}
      dragStyle={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1 : 0,
        position: 'relative',
      }}
      dragHandle={
        <div
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            // Run dnd-kit's KeyboardSensor handler, but don't let Enter/Space
            // bubble to the card's tap-to-edit handler
            e.stopPropagation();
            listeners?.onKeyDown?.(e);
          }}
          className="shrink-0 cursor-move flex items-center justify-center"
          // touch-action: none lets dnd-kit own the touch gesture; without it
          // the browser scrolls instead of dragging on touch screens
          style={{ width: '28px', height: '36px', margin: '0 -4px 0 -8px', touchAction: 'none' }}
          aria-label="Drag to reorder routine"
          data-ph-capture-attribute-drag="routine-drag-handle"
        >
          <GripVertical size={17} color="#6b7280" />
        </div>
      }
    />
  );
};

const MobileRoutinesPage = ({ routines, onNew, onEdit, onSetActive, onDelete, onReorder }) => {
  const [query, setQuery] = useState('');

  // Active routine pinned first, then inactive by their saved order
  const active = routines.find(r => r.active);
  const inactive = routines
    .filter(r => !r.active && r.ID != null)
    .sort((a, b) => Number(a.order) - Number(b.order));
  const q = query.trim().toLowerCase();
  const filteredInactive = inactive.filter(r => r.name.toLowerCase().includes(q));

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 100,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const activeCard = active && (!q || active.name.toLowerCase().includes(q)) && (
    <RoutineCard routine={active} onEdit={onEdit} onSetActive={onSetActive} onDelete={onDelete} />
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
        <div className="font-bold" style={{ fontSize: '17px', color: '#f3f4f6' }}>Routines</div>
        <button
          type="button"
          onClick={onNew}
          className="font-bold shrink-0"
          style={{ height: '36px', padding: '0 14px', borderRadius: '8px', backgroundColor: '#f97316', color: '#111827', fontSize: '13px' }}
          data-ph-capture-attribute-button="add-new-routine"
          data-tour="new-routine-input"
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

      {/* Routine cards. While searching, show a plain list (no drag-and-drop) —
          same behavior as the desktop list. */}
      <div className="flex flex-col" style={{ gap: '8px' }}>
        {activeCard}
        {q ? (
          filteredInactive.map(r => (
            <RoutineCard key={r.ID} routine={r} onEdit={onEdit} onSetActive={onSetActive} onDelete={onDelete} />
          ))
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
            <SortableContext items={inactive.map(r => r.ID)} strategy={verticalListSortingStrategy}>
              {inactive.map(r => (
                <SortableRoutineCard key={r.ID} routine={r} onEdit={onEdit} onSetActive={onSetActive} onDelete={onDelete} />
              ))}
            </SortableContext>
          </DndContext>
        )}

        {!activeCard && (q ? filteredInactive : inactive).length === 0 && (
          <div className="text-center" style={{ color: '#6b7280', fontSize: '13px', padding: '24px 0' }}>
            {q ? 'No routines match your search' : 'No routines yet — tap + New to create one'}
          </div>
        )}
      </div>
    </div>
  );
};

export default MobileRoutinesPage;
