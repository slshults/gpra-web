// app/static/js/components/MobileItemsList.jsx
// Mobile Items page (design 3b list state). Rendered by PracticeItemsList
// below the 640px breakpoint; PracticeItemsList stays the owner of all items
// state and passes the handlers this view needs as props. Tapping a row opens
// the existing ItemEditor dialog — the mock's edit sheet is functionally
// identical to it, so no separate mobile editor.
//
// Rows use the same action language as the desktop list (drag handle, pencil,
// chord charts, trash) so users can move between desktop and mobile without
// relearning anything.
import { useState } from 'react';
import { GripVertical, Pencil, Search, Trash2 } from 'lucide-react';
import { ChordIcon } from './icons/ChordIcon';
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

const ItemRow = ({ item, onEdit, onDelete, onOpenChordCharts, dragHandle, dragStyle, dragRef }) => (
  <div
    ref={dragRef}
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
      padding: '0 4px 0 8px',
      gap: '4px',
      ...dragStyle,
    }}
    data-ph-capture-attribute-button="mobile-item-row"
  >
    {dragHandle}
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
        onEdit(item);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className="flex items-center justify-center shrink-0"
      style={{ width: '36px', height: '36px', borderRadius: '8px', color: '#d1d5db' }}
      title="Edit item"
      aria-label="Edit item"
      data-ph-capture-attribute-button="edit-item"
    >
      <Pencil size={15} />
    </button>
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenChordCharts(item['B'], item['C']);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className="flex items-center justify-center shrink-0"
      style={{ width: '36px', height: '36px', borderRadius: '8px', color: '#60a5fa' }}
      title="Add or edit chord charts"
      aria-label="Chord charts"
      data-ph-capture-attribute-button="open-chord-charts-modal"
    >
      <ChordIcon className="h-5 w-5" aria-hidden="true" />
    </button>
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onDelete(item['B']);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className="flex items-center justify-center shrink-0"
      style={{ width: '36px', height: '36px', borderRadius: '8px', color: '#ef4444' }}
      title="Delete this item and remove it from all routines"
      aria-label="Delete item"
      data-ph-capture-attribute-button="delete-item"
    >
      <Trash2 size={16} />
    </button>
  </div>
);

const SortableItemRow = ({ item, onEdit, onDelete, onOpenChordCharts }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item['B'] });

  return (
    <ItemRow
      item={item}
      onEdit={onEdit}
      onDelete={onDelete}
      onOpenChordCharts={onOpenChordCharts}
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
            // bubble to the row's tap-to-edit handler
            e.stopPropagation();
            listeners?.onKeyDown?.(e);
          }}
          className="shrink-0 cursor-move flex items-center justify-center"
          // touch-action: none lets dnd-kit own the touch gesture; without it
          // the browser scrolls instead of dragging on touch screens
          style={{ width: '28px', height: '52px', touchAction: 'none' }}
          aria-label="Drag to reorder item"
          data-ph-capture-attribute-drag="item-drag-handle"
        >
          <GripVertical size={17} color="#6b7280" />
        </div>
      }
    />
  );
};

const MobileItemsList = ({ items, onNew, onEdit, onDelete, onOpenChordCharts, onReorder, onDragStart }) => {
  const [query, setQuery] = useState('');

  // Same apostrophe-normalizing match as the desktop list
  const normalizeApostrophes = (str) => str.replace(/[’'`]/g, "'");
  const q = normalizeApostrophes(query.trim().toLowerCase());
  const filtered = items.filter(it =>
    !q || normalizeApostrophes((it['C'] || '').toLowerCase()).includes(q)
  );

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

      {/* Item rows. While searching, show a plain list (no drag-and-drop) so a
          reorder can't act on filtered indexes. */}
      <div className="flex flex-col" style={{ gap: '8px' }}>
        {q ? (
          filtered.map(item => (
            <ItemRow
              key={item['B']}
              item={item}
              onEdit={onEdit}
              onDelete={onDelete}
              onOpenChordCharts={onOpenChordCharts}
            />
          ))
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onReorder}>
            <SortableContext items={filtered.map(item => item['B'])} strategy={verticalListSortingStrategy}>
              {filtered.map(item => (
                <SortableItemRow
                  key={item['B']}
                  item={item}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onOpenChordCharts={onOpenChordCharts}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}

        {filtered.length === 0 && (
          <div className="text-center" style={{ color: '#6b7280', fontSize: '13px', padding: '24px 0' }}>
            {q ? 'No items match your search' : 'No items yet — tap + New to create one'}
          </div>
        )}
      </div>
    </div>
  );
};

export default MobileItemsList;
