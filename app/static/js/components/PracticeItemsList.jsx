import React, { useState } from 'react';
import { Plus, Pencil, Trash2, GripVertical } from 'lucide-react';
import { trackItemOperation } from '../utils/analytics';
import { Card, CardHeader, CardTitle, CardContent } from '@ui/card';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
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
const SortableItem = React.memo(({ item, onEdit, onDelete, onOpenChordCharts }) => {
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
        <div {...attributes} {...listeners} className="flex-shrink-0">
          <GripVertical className="h-6 w-6 text-gray-500 mr-2 sm:mr-4 cursor-move" />
        </div>
        <span className="text-base sm:text-xl">{item['C']}</span>
      </div>
      <div className="flex space-x-3 justify-end sm:justify-start flex-shrink-0">
        <Button
          variant="ghost"
          size="lg"
          onClick={() => onEdit(item)}
          className="hover:bg-gray-700"
        >
          <Pencil className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Edit item</span>
        </Button>
        <Button
          variant="ghost"
          size="lg"
          onClick={() => onOpenChordCharts(item['B'], item['C'])}
          className="text-blue-400 hover:text-blue-300 hover:bg-gray-700"
        >
          <ChordIcon className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Chord charts</span>
        </Button>
        <Button
          variant="ghost"
          size="lg"
          onClick={handleDelete}
          className="text-red-500 hover:text-red-400 hover:bg-gray-700"
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

  // Chord charts modal state
  const [chordChartsModalOpen, setChordChartsModalOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [selectedItemTitle, setSelectedItemTitle] = useState('');

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
    onItemsChange();
    setEditingItem(null);
    setIsEditOpen(false);
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
    </>
  );
}