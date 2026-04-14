import React, { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, GripVertical, Copy, Check, ExternalLink } from 'lucide-react';
import RowActionTipModal from './RowActionTipModal';
import { trackItemOperation } from '../utils/analytics';
import { Card, CardHeader, CardTitle, CardContent } from '@ui/card';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@ui/dialog';
import { ItemEditor } from './ItemEditor';
import ChordChartsModal from './ChordChartsModal';
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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@ui/alert-dialog";

// Split out item component for better state isolation
const SortableItem = React.memo(({ item, onEdit, onDelete, onOpenChordCharts, onRowTipClick }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item['B'] });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
  };

  const handleDelete = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await onDelete(item['B']);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 sm:p-5 rounded-lg gap-3 ${
        isDragging ? 'bg-gray-700' : 'bg-gray-800'
      }`}
    >
      <div className="flex items-center min-w-0 flex-1">
        <div {...attributes} {...listeners} className="flex-shrink-0" aria-label="Drag to reorder item" data-ph-capture-attribute-drag="item-drag-handle">
          <GripVertical className="h-6 w-6 text-gray-500 mr-2 sm:mr-4 cursor-move" aria-hidden="true" />
        </div>
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={onRowTipClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowTipClick?.(); } }}
        >
          <span className="text-base sm:text-xl">{item['C']}</span>
        </div>
      </div>
      <div className="flex space-x-3 justify-end sm:justify-start flex-shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onEdit(item)}
          className="hover:bg-gray-700"
          title="Edit item"
          data-ph-capture-attribute-button="edit-item"
        >
          <Pencil className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Edit item</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onOpenChordCharts(item['B'], item['C'])}
          className="text-blue-400 hover:text-blue-300 hover:bg-gray-700"
          title="Add or edit chord charts"
          data-ph-capture-attribute-button="open-chord-charts-modal"
        >
          <ChordIcon className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Chord charts</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDelete}
          className="text-red-500 hover:text-red-400 hover:bg-gray-700"
          title="Delete this item and remove it from all routines"
          data-ph-capture-attribute-button="delete-item"
        >
          <Trash2 className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Delete item</span>
        </Button>
      </div>
    </div>
  );
});

export const PracticeItemsList = ({ items = [], onItemsChange }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);

  // First item guidance state
  const [firstItemGuidanceShown, setFirstItemGuidanceShown] = useState(true);
  const [showFirstItemGuide, setShowFirstItemGuide] = useState(false);
  const [copiedGuidance, setCopiedGuidance] = useState(false);

  useEffect(() => {
    fetch('/api/user/preferences/first-item-guidance-status')
      .then(r => r.json())
      .then(data => setFirstItemGuidanceShown(data.shown))
      .catch(() => {});
  }, []);

  // Chord charts modal state
  const [chordChartsModalOpen, setChordChartsModalOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [selectedItemTitle, setSelectedItemTitle] = useState('');

  // Row action tip modal state
  const [showItemRowTip, setShowItemRowTip] = useState(false);
  const handleItemRowTipClick = () => {
    setShowItemRowTip(true);
    window.posthog?.capture('row_action_tip_shown', { row_type: 'item' });
  };

  // Auto-open chord charts modal from AutocreateWatcher navigation
  useEffect(() => {
    const raw = sessionStorage.getItem('autocreateOpenChordCharts');
    if (!raw || !items?.length) return;

    sessionStorage.removeItem('autocreateOpenChordCharts');

    try {
      const { itemId, itemTitle } = JSON.parse(raw);
      setSelectedItemId(itemId);
      setSelectedItemTitle(itemTitle);
      setChordChartsModalOpen(true);
    } catch (e) {
      // Ignore parse errors
    }
  }, [items]);

  const handleDelete = async (itemId) => {
    if (isDragging) return; // Prevent delete during drag
    setItemToDelete(itemId);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/items/${itemToDelete}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete item');
      }
      
      // Track item deletion
      const itemToDeleteData = items.find(item => item['B'] === itemToDelete);
      if (itemToDeleteData) {
        const itemName = itemToDeleteData['C'] || `Item ${itemToDelete}`; // Column C is Title
        trackItemOperation('deleted', 'item', itemName);
      }
      
      onItemsChange();
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setIsDeleting(false);
      setItemToDelete(null);
    }
  };

  const handleEditClick = (item) => {
    setEditingItem(item);
    setIsEditOpen(true);
  };

  const handleOpenChordCharts = (itemId, itemTitle) => {
    setSelectedItemId(itemId);
    setSelectedItemTitle(itemTitle);
    setChordChartsModalOpen(true);
  };

  const handleSave = async () => {
    const wasCreate = !editingItem;
    onItemsChange();
    setEditingItem(null);
    setIsEditOpen(false);

    if (wasCreate && !firstItemGuidanceShown) {
      setShowFirstItemGuide(true);
      setFirstItemGuidanceShown(true);
      window.posthog?.capture('first_item_guidance_shown');
      fetch('/api/user/preferences/first-item-guidance-complete', {
        method: 'POST'
      }).catch(() => {});
    }
  };

  const handleDragStart = () => {
    setIsDragging(true);
  };

  const handleDragEnd = async ({ active, over }) => {
    setIsDragging(false);
    if (isDeleting || !active || !over || active.id === over.id) return;
  
    const oldIndex = items.findIndex(item => item['B'] === active.id);
    const newIndex = items.findIndex(item => item['B'] === over.id);
    
    try {
      // Create new array with moved item
      const reordered = arrayMove(items, oldIndex, newIndex);
      
      // Update all orders to match new positions (using Column B as identifier)
      const withNewOrder = reordered.map((item, index) => ({
        'A': item['B'],  // Use Column B (ItemID) as the identifier for backend
        'G': index       // Column G is the order
      }));
      
      // Send complete new state
      const response = await fetch('/api/items/order', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(withNewOrder),
      });
      
      if (!response.ok) {
        throw new Error('Failed to update items');
      }
      
      // Force refresh
      onItemsChange();
    } catch (error) {
      console.error('Reorder failed:', error);
    }
  };

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

  const filteredItems = items.filter((item) => {
    if (!searchQuery) return true;
    const title = item?.['C'] || '';
    // Normalize apostrophes in both search term and title for consistent matching
    const normalizeApostrophes = (str) => str.replace(/[''`]/g, "'");
    const normalizedTitle = normalizeApostrophes(title.toLowerCase());
    const normalizedSearch = normalizeApostrophes(searchQuery.toLowerCase());
    return normalizedTitle.includes(normalizedSearch);
  });

  return (
    <>
      <Card className="w-full max-w-4xl mx-auto bg-gray-900 text-gray-100">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-2xl">Practice items</CardTitle>
          <div className="flex items-center space-x-2">
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-lg px-4 py-6"
              onClick={() => {
                setEditingItem(null);
                setIsEditOpen(true);
              }}
              data-ph-capture-attribute-button="add-new-item"
            >
              <Plus className="mr-2 h-5 w-5" aria-hidden="true" />
              Add item
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-6">
            <label htmlFor="search-items-input" className="sr-only">
              Search practice items
            </label>
            <Input
              id="search-items-input"
              type="text"
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-lg py-6 px-4"
              autoComplete="off"
            />
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredItems.map(item => item['B'])}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-4">
                {filteredItems.map((item) => (
                  <SortableItem
                    key={item['B']}
                    item={item}
                    onEdit={handleEditClick}
                    onDelete={handleDelete}
                    onOpenChordCharts={handleOpenChordCharts}
                    onRowTipClick={handleItemRowTipClick}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </CardContent>
      </Card>

      {isEditOpen && (
        <ItemEditor
          open={isEditOpen}
          onOpenChange={(open) => {
            if (!open) {
              setEditingItem(null);
              setIsEditOpen(false);
            }
          }}
          item={editingItem}
          onItemChange={handleSave}
        />
      )}

      <AlertDialog open={!!itemToDelete} onOpenChange={() => setItemToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the practice item
              and remove it from all routines.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ChordChartsModal
        isOpen={chordChartsModalOpen}
        onClose={() => setChordChartsModalOpen(false)}
        itemId={selectedItemId}
        itemTitle={selectedItemTitle}
      />

      <RowActionTipModal
        open={showItemRowTip}
        onOpenChange={setShowItemRowTip}
        modalName="Item row tips"
        title="Working with items"
        description="How to:"
        tips={[
          { icon: <GripVertical className="h-4 w-4 text-gray-400" />, label: 'Drag handle on the left to reorder' },
          { icon: <Pencil className="h-4 w-4" />, label: 'Pencil icon to edit' },
          { icon: <ChordIcon className="h-4 w-4 text-blue-400" />, label: 'Chord chart icon to create or edit chord charts' },
          { icon: <Trash2 className="h-4 w-4 text-red-500" />, label: 'Trash can to delete' },
        ]}
      />

      <Dialog open={showFirstItemGuide} onOpenChange={setShowFirstItemGuide}>
        <DialogContent modalName="First item guidance">
          <DialogHeader>
            <DialogTitle>Please read, you won't see this again:</DialogTitle>
            <DialogDescription className="sr-only">Guidance for new users after creating their first practice item</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>You've created your first practice item. 🙌</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Next: Click "Routines" above to make or edit a routine</li>
              <li>Edit a routine to add items to it.</li>
              <li>If you have more than one routine, click <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">+</code> on a routine to make it active</li>
              <li>Then click "Practice" to use your routine and the items in it</li>
              <li>Click an item on the practice page to expand it, use the timer, add chord charts, etc.</li>
              <li>Enjoy</li>
            </ul>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => {
                const text = `Next steps after creating your first item:\n\n• Click "Routines" above to make or edit a routine\n• Edit a routine to add items to it\n• If you have more than one routine, click + on a routine to make it active\n• Then click "Practice" to use your routine and the items in it\n• Click an item on the practice page to expand it, use the timer, add chord charts, etc.\n• Enjoy`;
                navigator.clipboard.writeText(text).then(() => {
                  setCopiedGuidance(true);
                  setTimeout(() => setCopiedGuidance(false), 2000);
                });
                window.posthog?.capture('first_item_guidance_copied');
              }}>
                {copiedGuidance ? <><Check className="h-4 w-4 mr-1" /> Copied</> : <><Copy className="h-4 w-4 mr-1" /> Copy this info</>}
              </Button>
              <Button variant="outline" size="sm" onClick={() => {
                const html = `<!DOCTYPE html><html><head><title>Next steps — Guitar Practice Routine App</title><style>body{font-family:system-ui,sans-serif;max-width:600px;margin:40px auto;padding:0 20px;background:#1a1a2e;color:#e0e0e0}h1{font-size:1.4rem;color:#fff}ul{line-height:1.8}code{background:#333;padding:2px 6px;border-radius:4px;font-size:0.9em}</style></head><body><h1>Next steps after creating your first item</h1><ul><li>Click "Routines" above to make or edit a routine</li><li>Edit a routine to add items to it</li><li>If you have more than one routine, click <code>+</code> on a routine to make it active</li><li>Then click "Practice" to use your routine and the items in it</li><li>Click an item on the practice page to expand it, use the timer, add chord charts, etc.</li><li>Enjoy</li></ul></body></html>`;
                const blob = new Blob([html], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');
                window.posthog?.capture('first_item_guidance_opened_in_tab');
              }}>
                <ExternalLink className="h-4 w-4 mr-1" /> Open in new tab
              </Button>
            </div>
            <Button onClick={() => {
              setShowFirstItemGuide(false);
              window.posthog?.capture('first_item_guidance_dismissed', { method: 'got_it' });
            }}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
