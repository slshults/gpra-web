import { useState, useEffect } from 'react';
import { trackItemOperation, trackContentUpdate } from '../utils/analytics';
import { supportsFolderOpening } from '../utils/platform';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ui/dialog';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { Textarea } from '@ui/textarea';
import { Label } from '@ui/label';
import { Loader2 } from 'lucide-react';
import TierLimitModal from './TierLimitModal';
import { renderMarkdown } from './NoteEditor';

export const ItemEditor = ({ open, onOpenChange, item = null, onItemChange }) => {
  const [formData, setFormData] = useState({
    'C': '',
    'D': '',
    'E': 5,
    'F': '',
    'G': '',
    'H': '',
    'I': '',
  });
  const [error, setError] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showNotesPreview, setShowNotesPreview] = useState(false);
  const [tierLimitModalOpen, setTierLimitModalOpen] = useState(false);
  const [tierLimitData, setTierLimitData] = useState({
    limitType: 'items',
    currentTier: 'free',
    currentCount: 0,
    limitAmount: 15,
  });

  // Clear error and load item data when modal opens
  useEffect(() => {
    if (open) {
      if (item) {
        // Editing existing item
        // If we have a complete item (with all fields), use it directly
        if (item['D'] !== undefined || item['H'] !== undefined) {
          setFormData({
            'C': item['C'] || '',
            'D': item['D'] || '',
            'E': item['E'] || 5,
            'F': item['F'] || '',
            'G': item['G'] || '',
            'H': item['H'] || '',
            'I': item['I'] || '',
          });
          setError(null);
          setIsDirty(false);
          setShowNotesPreview(false);
        } else {
          // We have a lightweight item (only ID and Title), need to fetch full data
          fetchFullItemData(item['A']);
        }
      } else {
        // Creating new item - reset to defaults
        setFormData({
          'C': '',
          'D': '',
          'E': 5,
          'F': '',
          'G': '',
          'H': '',
          'I': '',
        });
        setError(null);
        setIsDirty(false);
        setShowNotesPreview(false);
      }
    }
  }, [open, item]);

  const fetchFullItemData = async (itemId) => {
    try {
      const response = await fetch(`/api/items/${itemId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch item details');
      }
      const fullItem = await response.json();
      
      setFormData({
        'C': fullItem['C'] || '',
        'D': fullItem['D'] || '',
        'E': fullItem['E'] || 5,
        'F': fullItem['F'] || '',
        'G': fullItem['G'] || '',
        'H': fullItem['H'] || '',
        'I': fullItem['I'] || '',
      });
      setError(null);
      setIsDirty(false);
    } catch (err) {
      setError(`Failed to load item: ${err.message}`);
      console.error('Fetch item error:', err);
    }
  };

  const handleFormChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setIsDirty(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const { G: _G, ...dataToSend } = formData;
      
      // Ensure no trailing slash and handle empty item ID case
      const baseUrl = '/api/items';
      const url = item?.['A'] ? `${baseUrl}/${item['A']}` : baseUrl;
      
      const response = await fetch(url, {
        method: item ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dataToSend),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);

        // Check if this is a tier limit error
        if (response.status === 403) {
          if (errorData?.error === 'Item limit reached') {
            setTierLimitData({
              limitType: 'items',
              currentTier: errorData.tier || 'free',
              currentCount: errorData.current || 0,
              limitAmount: errorData.limit || 15,
            });
            setTierLimitModalOpen(true);
            return;
          }
        }

        throw new Error(errorData?.error || 'Failed to save item');
      }

      const savedItem = await response.json();
      
      // Track item creation or update
      const isCreating = !item?.['A'];
      const itemName = formData['C'] || 'Unnamed Item';
      
      if (isCreating) {
        trackItemOperation('created', 'item', itemName);
      } else {
        trackItemOperation('updated', 'item', itemName);
        
        // Track specific content updates if this is an edit
        const originalNotes = item?.['D'] || '';
        const originalTuning = item?.['H'] || '';
        const originalSongbook = item?.['I'] || '';

        if (formData['D'] && formData['D'] !== originalNotes) {
          trackContentUpdate('notes', itemName);
        }
        if (formData['H'] && formData['H'] !== originalTuning) {
          trackContentUpdate('tuning', itemName);
        }
        if (formData['I'] && formData['I'] !== originalSongbook) {
          trackContentUpdate('folder_path', itemName);
        }
      }
      
      onItemChange?.(savedItem);
      onOpenChange(false);
    } catch (err) {
      setError(err.message);
      console.error('Save error:', err);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-gray-800">
        <DialogHeader>
          <DialogTitle>
            {item ? `Edit item: ${item['C']}` : 'Create new item'}
          </DialogTitle>
          {error && (
            <div className="mt-2 text-sm text-red-500" role="alert">
              {error}
            </div>
          )}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={formData['C']}
              onChange={(e) => handleFormChange('C', e.target.value)}
              placeholder="Enter item title"
              required
              className="bg-gray-900 text-white"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="duration">Duration</Label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Input
                  id="duration-minutes"
                  type="number"
                  min="0"
                  max="999"
                  value={Math.floor(formData['E'])}
                  onChange={(e) => {
                    const mins = parseInt(e.target.value) || 0;
                    const secs = (formData['E'] % 1) * 60;
                    handleFormChange('E', mins + (secs / 60));
                  }}
                  onInput={(e) => {
                    const mins = parseInt(e.target.value) || 0;
                    const secs = (formData['E'] % 1) * 60;
                    handleFormChange('E', mins + (secs / 60));
                  }}
                  className="bg-gray-900 text-white text-center"
                  autoComplete="off"
                  placeholder="0"
                />
                <div className="text-xs text-gray-400 text-center mt-1">minutes</div>
              </div>
              <span className="text-xl text-gray-400">:</span>
              <div className="flex-1">
                <div className="relative">
                  <Input
                    id="duration-seconds"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={Math.round((formData['E'] % 1) * 60)}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^0-9]/g, '');
                      const secs = Math.min(59, parseInt(value) || 0);
                      const mins = Math.floor(formData['E']);
                      handleFormChange('E', mins + (secs / 60));
                    }}
                    className="bg-gray-900 text-white text-center pr-6"
                    autoComplete="off"
                    placeholder="00"
                  />
                  <div className="absolute right-0 top-0 flex flex-col h-full border-l border-gray-700">
                    <button
                      type="button"
                      onClick={() => {
                        const currentSecs = Math.round((formData['E'] % 1) * 60);
                        const newSecs = Math.min(59, currentSecs + 15);
                        const mins = Math.floor(formData['E']);
                        handleFormChange('E', mins + (newSecs / 60));
                      }}
                      className="flex-1 px-1 text-gray-400 hover:text-white hover:bg-gray-700 text-xs leading-none"
                      aria-label="Increase seconds by 15"
                      data-ph-capture-attribute-button="duration-seconds-up"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const currentSecs = Math.round((formData['E'] % 1) * 60);
                        const newSecs = Math.max(0, currentSecs - 15);
                        const mins = Math.floor(formData['E']);
                        handleFormChange('E', mins + (newSecs / 60));
                      }}
                      className="flex-1 px-1 text-gray-400 hover:text-white hover:bg-gray-700 text-xs leading-none border-t border-gray-700"
                      aria-label="Decrease seconds by 15"
                      data-ph-capture-attribute-button="duration-seconds-down"
                    >
                      ▼
                    </button>
                  </div>
                </div>
                <div className="text-xs text-gray-400 text-center mt-1">seconds</div>
              </div>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Total: {Math.floor(formData['E'])} min {Math.round((formData['E'] % 1) * 60)} sec
            </div>
          </div>

          {/* Songbook folder/link field - only show on desktop platforms */}
          {supportsFolderOpening() && (
            <div className="space-y-2">
              <Label htmlFor="songbook">Songbook folder or link</Label>
              <Input
                id="songbook"
                value={formData['I']}
                onChange={(e) => handleFormChange('I', e.target.value)}
                placeholder='e.g.: "C:\Users\...\SongName" or "https://tabs.ultimate-guitar.com/..."'
                className="bg-gray-900 font-mono"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="tuning">Tuning</Label>
            <Input
              id="tuning"
              value={formData['H']}
              onChange={(e) => handleFormChange('H', e.target.value)}
              placeholder="e.g. EADGBE"
              className="bg-gray-900 text-white"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="notes">Notes <span className="text-gray-500 font-normal">(markdown supported)</span></Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={!showNotesPreview ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowNotesPreview(false)}
                  data-ph-capture-attribute-button="notes-edit-mode"
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant={showNotesPreview ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowNotesPreview(true)}
                  data-ph-capture-attribute-button="notes-preview-mode"
                >
                  Preview
                </Button>
              </div>
            </div>
            {showNotesPreview ? (
              <div
                className="h-24 bg-gray-900 text-white p-3 rounded-md overflow-auto"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(formData['D']) }}
              />
            ) : (
              <Textarea
                id="notes"
                value={formData['D']}
                onChange={(e) => handleFormChange('D', e.target.value)}
                placeholder="Enter any notes... (markdown supported)"
                className="h-24 bg-gray-900 text-white"
                autoComplete="off"
              />
            )}
          </div>

          <div className="flex justify-end space-x-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="text-gray-300 hover:text-white"
              data-ph-capture-attribute-button="item-editor-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700"
              disabled={!isDirty}
              data-ph-capture-attribute-button="item-editor-save"
            >
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    {open && <TierLimitModal
      isOpen={tierLimitModalOpen}
      onClose={() => setTierLimitModalOpen(false)}
      limitType={tierLimitData.limitType}
      currentTier={tierLimitData.currentTier}
      currentCount={tierLimitData.currentCount}
      limitAmount={tierLimitData.limitAmount}
    />}
    </>
  );
};


export default ItemEditor; 