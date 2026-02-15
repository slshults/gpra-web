import React, { useEffect, useCallback, useState, useRef, useMemo, memo } from 'react';
import { trackChordChartEvent } from '../utils/analytics';
import { usePracticeItems } from '../hooks/usePracticeItems';

// Simple debounce function
const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

// Helper functions for copy modal fuzzy matching (copied from PracticePage)
const normalizeText = (str) => {
  return str
    // Normalize apostrophes and quotes
    .replace(/[''`"]/g, "'")
    // Normalize dashes and hyphens
    .replace(/[–—−]/g, "-")
    // Remove extra whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

const extractBaseSongName = (title) => {
  // Remove all parentheses and their contents: (acoustic), (electric), (relearning), etc.
  return title.replace(/\s*\([^)]*\)\s*/g, '').trim();
};

const findSimilarSongs = (sourceTitle, allItems, sourceItemId) => {
  const baseName = extractBaseSongName(sourceTitle);
  const normalizedBaseName = normalizeText(baseName);
  debugLog('CopyCharts', 'findSimilarSongs - sourceTitle:', sourceTitle, '-> baseName:', baseName, '-> normalized:', normalizedBaseName);

  return allItems.filter(item => {
    // Skip the source item itself
    if (item['B'] === sourceItemId) return false;

    const itemTitle = item['C'] || '';
    const itemBaseName = extractBaseSongName(itemTitle);
    const normalizedItemBaseName = normalizeText(itemBaseName);

    // More precise similarity matching - require significant overlap
    const matches = normalizedBaseName === normalizedItemBaseName ||
                   (normalizedBaseName.length > 3 && normalizedItemBaseName.includes(normalizedBaseName)) ||
                   (normalizedItemBaseName.length > 3 && normalizedBaseName.includes(normalizedItemBaseName));

    return matches;
  });
};

import { Button } from '@ui/button';
import { Check, Music, Upload, AlertTriangle, X, Wand, Sparkles, Loader2, Printer } from 'lucide-react';
import { ChordChartEditor } from './ChordChartEditor';
import ApiErrorModal, { resetRateLimitBackoff } from './ApiErrorModal';
import AutocreateSuccessModal from './AutocreateSuccessModal';
import { serverDebug, debugLog } from '../utils/logging';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Import at top to activate console overrides
import '../utils/logging';

// MemoizedChordChart component to prevent unnecessary re-renders
const MemoizedChordChart = memo(({ chart, onEdit, onDelete, onInsertAfter }) => {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);
  const chartRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMenu]);

  // SVGuitar rendering effect (copied from PracticePage)
  useEffect(() => {
    if (!chartRef.current) return;

    const renderChart = () => {
      if (!window.svguitar || !chartRef.current) return;

      try {
        // Handle nested chordData structure if present
        const actualChartData = chart.chordData || chart;

        // Clear any existing content
        chartRef.current.innerHTML = '';

        // Create SVGuitar instance
        const chartInstance = new window.svguitar.SVGuitarChord(chartRef.current);

        // Configure the chart with same dimensions as editor for consistency
        const config = {
          strings: actualChartData.numStrings || 6,
          frets: actualChartData.numFrets || 5,
          position: actualChartData.startingFret || 1,
          tuning: [], // Hide tuning labels in the small display
          width: 128,             // Reduced ~20% (was 160)
          height: 176,            // Reduced ~20% (was 220)
          fretSize: 1.2,          // Match editor settings
          fingerSize: 0.75,       // Larger finger size for text visibility (match editor)
          sidePadding: 0.2,       // Match editor settings
          fontFamily: 'Arial',
          // Dark theme colors
          color: '#ffffff',           // White finger dots
          backgroundColor: 'transparent',
          strokeColor: '#ffffff',     // White grid lines
          textColor: '#ffffff',       // White text
          fretLabelColor: '#ffffff',  // White fret labels
          // Finger text settings (match editor)
          fingerTextColor: '#000000', // Black text on white dots for contrast
          fingerTextSize: 28         // Larger text size for visibility (match editor)
        };

        // Combine regular fingers with open and muted strings (same as in editor)
        // Process fingers to ensure proper finger number format for SVGuitar
        const processedFingers = (actualChartData.fingers || []).map(finger => {
          const [string, fret, fingerNumber] = finger;
          // Only include finger number if it's defined and not empty
          if (fingerNumber && fingerNumber !== 'undefined') {
            return [string, fret, fingerNumber];
          }
          return [string, fret]; // No finger number
        });

        const allFingers = [
          ...processedFingers,
          // Add open strings as [string, 0]
          ...(actualChartData.openStrings || []).map(string => [string, 0]),
          // Add muted strings as [string, 'x']
          ...(actualChartData.mutedStrings || []).map(string => [string, 'x'])
        ];

        // Prepare chord data
        const chordData = {
          fingers: allFingers,
          barres: actualChartData.barres || []
        };

        // Render the chart
        chartInstance.configure(config).chord(chordData).draw();

        // Style the SVG to fit the container
        setTimeout(() => {
          const svg = chartRef.current?.querySelector('svg');
          if (svg) {
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.style.maxWidth = '128px';  // Reduced ~20% (was 160)
            svg.style.maxHeight = '180px'; // Reduced ~20% (was 224)
            svg.style.position = 'relative';
            svg.style.zIndex = '1';
          }
        }, 50);
      } catch (error) {
        console.error('Error rendering memoized chord chart:', error);
      }
    };

    renderChart();
  }, [chart]); // Only re-render when chart data changes

  const handleEditClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMenu(false);
    // Note: chart data is flattened at top level (not nested in chord_data)
    onEdit(chart.id, {
      title: chart.title,
      // Pass the full chart object since data is flattened at top level
      ...chart,
      sectionId: chart.sectionId,
      sectionLabel: chart.sectionLabel,
      sectionRepeatCount: chart.sectionRepeatCount
    });
  };

  const handleDeleteClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMenu(false);
    onDelete(chart.id);
  };

  const handleInsertAfterClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMenu(false);
    onInsertAfter(chart.id, {
      sectionId: chart.sectionId,
      sectionLabel: chart.sectionLabel,
      sectionRepeatCount: chart.sectionRepeatCount
    });
  };

  const handleLineBreakClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMenu(false);

    // Toggle line break after this chord
    // Note: chart data is flattened at top level (not nested in chord_data), so we reconstruct it
    const updatedChartData = {
      fingers: chart.fingers || [],
      barres: chart.barres || [],
      tuning: chart.tuning || 'EADGBE',
      capo: chart.capo || 0,
      startingFret: chart.startingFret || 1,
      numFrets: chart.numFrets || 5,
      numStrings: chart.numStrings || 6,
      openStrings: chart.openStrings || [],
      mutedStrings: chart.mutedStrings || [],
      sectionId: chart.sectionId || '',
      sectionLabel: chart.sectionLabel || '',
      sectionRepeatCount: chart.sectionRepeatCount || '',
      hasLineBreakAfter: !chart.hasLineBreakAfter  // Toggle the value
    };

    onEdit(chart.id, {
      title: chart.title,
      chord_data: updatedChartData,
      sectionId: chart.sectionId,
      sectionLabel: chart.sectionLabel,
      sectionRepeatCount: chart.sectionRepeatCount
    });
  };

  const handleMenuClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMenu(!showMenu);
  };

  return (
    <div className="relative mx-auto" style={{ maxWidth: '144px' }}>
      {/* Chord chart display */}
      <div
        className="bg-gray-800 p-1 rounded-lg cursor-pointer relative group"
        onClick={handleMenuClick}
        style={{
          minWidth: '0',
          maxWidth: '100%',
          width: '100%',
          position: 'relative'
        }}
      >
        {/* Three-dot menu button */}
        <button
          className="absolute top-1 right-1 bg-gray-700 text-gray-300 rounded-full w-6 h-6 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity z-10"
          onClick={handleMenuClick}
          aria-label="Chord chart menu"
          data-ph-capture-attribute-button="chord-chart-menu"
        >
          ⋮
        </button>

        {/* Chord diagram container using SVGuitar (copied sizing from PracticePage) */}
        <div className="relative w-32 mx-auto flex items-center justify-center overflow-hidden" style={{height: '184px'}}>
          <div
            ref={chartRef}
            className="w-full h-full"
          >
            {/* SVGuitar chart will be rendered here */}
          </div>
        </div>

        {/* Chord title */}
        <div className="text-center text-white text-sm font-semibold mt-2">
          {chart.title}
        </div>

        {/* Line break indicator */}
        {chart.hasLineBreakAfter && (
          <div className="absolute -bottom-1 -right-1 bg-blue-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs">
            ↵
          </div>
        )}
      </div>

      {/* Menu dropdown */}
      {showMenu && (
        <div
          ref={menuRef}
          className="absolute top-8 right-0 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-20 min-w-48"
        >
          <button
            onClick={handleEditClick}
            className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 rounded-t-lg flex items-center"
            data-ph-capture-attribute-button="modal-edit-chord"
          >
            ✏️ Edit chord
          </button>
          <button
            onClick={handleInsertAfterClick}
            className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 flex items-center"
            data-ph-capture-attribute-button="modal-insert-chord-after"
          >
            ➕ Insert chord after
          </button>
          <button
            onClick={handleLineBreakClick}
            className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 flex items-center"
            data-ph-capture-attribute-button="modal-toggle-line-break"
          >
            {chart.hasLineBreakAfter ? '↩️ Remove line break' : '↵ Add line break after'}
          </button>
          <button
            onClick={handleDeleteClick}
            className="w-full text-left px-4 py-2 text-red-400 hover:bg-gray-600 rounded-b-lg flex items-center"
            data-ph-capture-attribute-button="modal-delete-chord"
          >
            🗑️ Delete chord
          </button>
        </div>
      )}
    </div>
  );
});

export default function ChordChartsModal({ isOpen, onClose, itemId, itemTitle }) {
  // Get all items for copy modal
  const { items: allItems } = usePracticeItems();

  // State management - copy all the state from PracticePage that chord charts depend on
  const [chordCharts, setChordCharts] = useState({});
  const [chordSections, setChordSections] = useState({});
  const [showChordEditor, setShowChordEditor] = useState({});
  const [editingChordId, setEditingChordId] = useState(null);
  const [insertionContext, setInsertionContext] = useState(null);
  const [scrollBackContext, setScrollBackContext] = useState({});
  const [deletingSection, setDeletingSection] = useState(new Set());


  // Copy modal state (copied from PracticePage)
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copySourceItemId, setCopySourceItemId] = useState(null);
  const [copySearchTerm, setCopySearchTerm] = useState('');
  const [selectedTargetItems, setSelectedTargetItems] = useState(new Set());
  const [itemsWithExistingCharts, setItemsWithExistingCharts] = useState(new Set());
  const [showOverwriteConfirmation, setShowOverwriteConfirmation] = useState(false);
  const [copyProgress, setCopyProgress] = useState(null);

  // Copy FROM modal state
  const [showCopyFromModal, setShowCopyFromModal] = useState(false);
  const [copyFromSearchTerm, setCopyFromSearchTerm] = useState('');
  const [selectedSourceItem, setSelectedSourceItem] = useState(null); // primary key (column A) of selected source
  const [copyFromProgress, setCopyFromProgress] = useState(null);
  const [copyFromShowOverwriteConfirmation, setCopyFromShowOverwriteConfirmation] = useState(false);

  // Autocreate states
  const [showAutocreateZone, setShowAutocreateZone] = useState({});
  const [autocreateProgress, setAutocreateProgress] = useState({});
  const [uploadedFiles, setUploadedFiles] = useState({});
  const [youtubeUrls, setYoutubeUrls] = useState({});
  const [manualChordInput, setManualChordInput] = useState({});
  const [manualInputErrors, setManualInputErrors] = useState({});
  const [isDragActive, setIsDragActive] = useState({});

  // Abort controller for cancelling requests (copied from PracticePage)
  const [autocreateAbortController, setAutocreateAbortController] = useState({});
  // Rotating processing messages for entertainment (copied from PracticePage)
  const processingMessages = [
    "✨ Claude is making magic happen",
    "✨ Claude is *still* making magic happen",
    "Yeah, we all love instant gratification, but it'll still be quicker than you could do it from scratch",
    "Are you familiar with the phrase 'A watched pot never boils'? It's kinda like that",
    "Chill, I'm working on it.",
    "You could be stretching or something while you wait, couldn't you?",
    "The pyramids weren't built in a day... ",
    "but hey, at least I'm not going to ask you for an email address to send the chord charts to.",
    "Perfect chord charts take time to craft. These will take less time and they won't be perfect.",
    "Yeah, I could show you a progress bar, but we both know it would just lie to you"
  ];
  const [processingMessageIndex, setProcessingMessageIndex] = useState(0);
  const [_messageQueue, setMessageQueue] = useState([]);

  // Modal and copy states
  const [showApiErrorModal, setShowApiErrorModal] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [showAutocreateSuccessModal, setShowAutocreateSuccessModal] = useState(false);
  const [autocreateSuccessData, setAutocreateSuccessData] = useState(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancellingItemId, setCancellingItemId] = useState(null);

  // Delete confirmation modal state (copied from PracticePage)
  const [showDeleteChordsModal, setShowDeleteChordsModal] = useState(false);
  const [deleteModalItemId, setDeleteModalItemId] = useState(null);

  // Mock getItemDetails function since we don't have useItemDetails hook in modal
  const getItemDetails = useCallback((itemIdToGet) => {
    if (itemIdToGet === itemId) {
      return {
        C: itemTitle, // Column C is Title
        B: itemId,    // Column B is ItemID
        E: 5          // Default duration
      };
    }
    return null;
  }, [itemId, itemTitle]);

  // Effect to load SVGuitar library for MemoizedChordChart components
  useEffect(() => {
    // Load SVGuitar UMD script if not already loaded
    if (!window.svguitar) {
      const script = document.createElement('script');
      script.src = 'https://omnibrain.github.io/svguitar/js/svguitar.umd.js';
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  // Load chord charts for this item when modal opens
  useEffect(() => {
    if (isOpen && itemId) {
      loadChordChartsForItem(itemId);
    }
  }, [isOpen, itemId]);

  // Rotate processing messages every 10 seconds
  useEffect(() => {
    const processingItems = Object.values(autocreateProgress).filter(progress => progress === 'processing');

    if (processingItems.length === 0) {
      // Reset message state when no processing
      setProcessingMessageIndex(0);
      setMessageQueue([]);
      return;
    }

    // Always start with the first message
    setProcessingMessageIndex(0);
    // Create initial shuffled queue excluding the first message
    const remainingMessages = Array.from({length: processingMessages.length - 1}, (_, i) => i + 1);
    const shuffled = remainingMessages.sort(() => Math.random() - 0.5);
    setMessageQueue(shuffled);

    const interval = setInterval(() => {
      setMessageQueue(prevQueue => {
        if (prevQueue.length === 0) {
          // Queue is empty, create new shuffled queue of all messages
          const allMessages = Array.from({length: processingMessages.length}, (_, i) => i);
          const newShuffled = allMessages.sort(() => Math.random() - 0.5);
          const nextIndex = newShuffled[0];
          const newQueue = newShuffled.slice(1);

          setProcessingMessageIndex(nextIndex);
          return newQueue;
        } else {
          // Take next message from queue
          const nextIndex = prevQueue[0];
          const newQueue = prevQueue.slice(1);

          setProcessingMessageIndex(nextIndex);
          return newQueue;
        }
      });
    }, 10000); // 10 seconds

    return () => clearInterval(interval);
  }, [autocreateProgress, processingMessages]);


  // Copy modal: Detect items with existing charts when selection changes (copied from PracticePage)
  useEffect(() => {
    if (!showCopyModal || selectedTargetItems.size === 0) return;

    const newItemsWithCharts = new Set();
    selectedTargetItems.forEach(primaryKey => {
      const targetItem = allItems?.find(item => item['A'] === primaryKey);
      const itemReferenceId = targetItem?.['B'];
      if (itemReferenceId && chordCharts[itemReferenceId]?.length > 0) {
        newItemsWithCharts.add(primaryKey);
      }
    });

    setItemsWithExistingCharts(newItemsWithCharts);
  }, [showCopyModal, selectedTargetItems, chordCharts, allItems]);

  // Copy all the chord chart functions from PracticePage...
  const loadChordChartsForItem = async (itemId) => {
    // Always fetch fresh data to ensure UI is up-to-date after autocreate
    try {
      const response = await fetch(`/api/items/${itemId}/chord-charts`);
      if (response.ok) {
        const charts = await response.json();
        setChordCharts(prev => ({
          ...prev,
          [itemId]: charts
        }));

        // Build sections from charts
        const sections = buildSectionsFromCharts(charts);
        setChordSections(prev => ({
          ...prev,
          [itemId]: sections
        }));
      }
    } catch (error) {
      console.error('Error loading chord charts:', error);
    }
  };

  const buildSectionsFromCharts = (charts) => {
    const sectionsMap = new Map();

    charts.forEach(chart => {
      const sectionId = chart.sectionId || 'default-section';
      const sectionLabel = chart.sectionLabel || 'Section';
      const sectionRepeatCount = chart.sectionRepeatCount || '';

      if (!sectionsMap.has(sectionId)) {
        sectionsMap.set(sectionId, {
          id: sectionId,
          label: sectionLabel,
          repeatCount: sectionRepeatCount,
          chords: []
        });
      }

      sectionsMap.get(sectionId).chords.push(chart);
    });

    return Array.from(sectionsMap.values());
  };

  const getChordSections = (itemId) => {
    const charts = chordCharts[itemId] || [];
    return buildSectionsFromCharts(charts);
  };

  // Copy modal: Memoized similar items calculation (copied from PracticePage)
  const similarItemIds = useMemo(() => {
    if (!copySourceItemId || !allItems) return new Set();

    const sourceItem = allItems.find(item => item['B'] === copySourceItemId);
    const sourceTitle = sourceItem?.['C'] || '';
    const allFilteredItems = allItems.filter(item => item['B'] !== copySourceItemId);

    return new Set(
      findSimilarSongs(sourceTitle, allFilteredItems, copySourceItemId).map(item => item['A'])
    );
  }, [copySourceItemId, allItems]);

  // Copy modal: Memoized filtered and sorted items (copied from PracticePage)
  const sortedAndFilteredItems = useMemo(() => {
    if (!allItems) return [];

    return allItems
      .filter(item => {
        // Filter out the source item
        if (item['B'] === copySourceItemId) return false;

        // Filter by search term
        if (copySearchTerm.trim()) {
          const title = item['C'] || '';
          const normalizedTitle = normalizeText(title);
          const normalizedSearch = normalizeText(copySearchTerm);

          if (!normalizedSearch) return true;
          return normalizedTitle.includes(normalizedSearch);
        }

        return true;
      })
      .sort((a, b) => {
        // If there's an active search term, only sort alphabetically
        if (copySearchTerm.trim()) {
          const aTitle = a['C'] || '';
          const bTitle = b['C'] || '';
          return aTitle.localeCompare(bTitle);
        }

        // Check if items are similar to source
        const aIsSimilar = similarItemIds.has(a['A']);
        const bIsSimilar = similarItemIds.has(b['A']);

        // Sort similar songs to the top
        if (aIsSimilar && !bIsSimilar) return -1;
        if (!aIsSimilar && bIsSimilar) return 1;

        // Within each group, sort alphabetically
        const aTitle = a['C'] || '';
        const bTitle = b['C'] || '';
        return aTitle.localeCompare(bTitle);
      });
  }, [allItems, copySourceItemId, copySearchTerm, similarItemIds]);

  // Copy FROM modal: Memoized filtered and sorted items (only items WITH chord charts)
  const sortedAndFilteredCopyFromItems = useMemo(() => {
    if (!allItems) return [];

    return allItems
      .filter(item => {
        // Filter out the current item (the one we're copying TO)
        if (item['B'] === itemId) return false;

        // Only show items that have chord charts loaded
        const charts = chordCharts[item['B']];
        if (!charts || charts.length === 0) return false;

        // Filter by search term
        if (copyFromSearchTerm.trim()) {
          const title = item['C'] || '';
          const normalizedTitle = normalizeText(title);
          const normalizedSearch = normalizeText(copyFromSearchTerm);

          if (!normalizedSearch) return true;
          return normalizedTitle.includes(normalizedSearch);
        }

        return true;
      })
      .sort((a, b) => {
        const aTitle = a['C'] || '';
        const bTitle = b['C'] || '';
        return aTitle.localeCompare(bTitle);
      });
  }, [allItems, itemId, copyFromSearchTerm, chordCharts]);

  // Debounced update function for section metadata
  const debouncedUpdateSection = useMemo(
    () => debounce(async (itemId, sectionId, updates) => {
      try {
        debugLog('Section', 'Debounced section update:', { itemId, sectionId, updates });

        // Get all charts in this section
        const itemCharts = chordCharts[itemId] || [];
        const sectionCharts = itemCharts.filter(chart =>
          (chart.sectionId || 'default-section') === sectionId
        );

        if (sectionCharts.length === 0) {
          console.warn('No charts found for section:', sectionId);
          return;
        }

        debugLog('Section', 'Updating section charts:', sectionCharts.length);

        // Update each chart in the section
        const updatePromises = sectionCharts.map(async (chart) => {
          // Note: chart data is flattened at top level (not nested in chord_data), so we reconstruct it
          const updatedChartData = {
            fingers: chart.fingers || [],
            barres: chart.barres || [],
            tuning: chart.tuning || 'EADGBE',
            capo: chart.capo || 0,
            startingFret: chart.startingFret || 1,
            numFrets: chart.numFrets || 5,
            numStrings: chart.numStrings || 6,
            openStrings: chart.openStrings || [],
            mutedStrings: chart.mutedStrings || [],
            hasLineBreakAfter: chart.hasLineBreakAfter || false,
            sectionId: sectionId,
            sectionLabel: updates.label !== undefined ? updates.label : (chart.sectionLabel || 'Section'),
            sectionRepeatCount: updates.repeatCount !== undefined ? updates.repeatCount : (chart.sectionRepeatCount || '')
          };

          const response = await fetch(`/api/chord-charts/${chart.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              title: chart.title,
              chord_data: updatedChartData
            }),
          });

          if (!response.ok) {
            throw new Error(`Failed to update chart ${chart.id}: ${response.statusText}`);
          }

          return response.json();
        });

        await Promise.all(updatePromises);
        debugLog('Section', 'All section charts updated successfully');

      } catch (error) {
        console.error('Error updating section:', error);
      }
    }, 500),
    [chordCharts]
  );

  const updateSectionLocal = (itemId, sectionId, updates) => {
    debugLog('Section', 'Local section update:', { itemId, sectionId, updates });

    // Update local state immediately for responsive UI
    setChordSections(prev => {
      const sections = prev[itemId] || [];
      const updatedSections = sections.map(section => {
        if (section.id === sectionId) {
          return {
            ...section,
            ...updates
          };
        }
        return section;
      });

      return {
        ...prev,
        [itemId]: updatedSections
      };
    });

    // Trigger debounced backend update
    debouncedUpdateSection(itemId, sectionId, updates);
  };

  const deleteSection = async (itemId, sectionId) => {
    if (deletingSection.has(sectionId)) return;

    setDeletingSection(prev => new Set(prev).add(sectionId));

    try {
      // Get all charts in this section
      const itemCharts = chordCharts[itemId] || [];
      const sectionCharts = itemCharts.filter(chart =>
        (chart.sectionId || 'default-section') === sectionId
      );

      // Delete all charts in the section
      const deletePromises = sectionCharts.map(chart =>
        fetch(`/api/items/${itemId}/chord-charts/${chart.id}`, {
          method: 'DELETE'
        })
      );

      await Promise.all(deletePromises);

      // Update local state
      const remainingCharts = itemCharts.filter(chart =>
        (chart.sectionId || 'default-section') !== sectionId
      );

      setChordCharts(prev => ({
        ...prev,
        [itemId]: remainingCharts
      }));

      setChordSections(prev => ({
        ...prev,
        [itemId]: buildSectionsFromCharts(remainingCharts)
      }));

    } catch (error) {
      console.error('Error deleting section:', error);
    } finally {
      setDeletingSection(prev => {
        const newSet = new Set(prev);
        newSet.delete(sectionId);
        return newSet;
      });
    }
  };

  const addNewSection = (itemId) => {
    const newSectionId = `section-${Date.now()}`;
    const newSection = {
      id: newSectionId,
      label: 'New Section',
      repeatCount: '',
      chords: []
    };

    setChordSections(prev => ({
      ...prev,
      [itemId]: [...(prev[itemId] || []), newSection]
    }));

    // Open chord editor for this section
    setScrollBackContext({
      itemId: itemId,
      scrollPosition: window.scrollY
    });
    setShowChordEditor(prev => ({ ...prev, [itemId]: true }));
    setInsertionContext({
      sectionId: newSectionId,
      sectionLabel: 'New Section',
      sectionRepeatCount: ''
    });
  };

  const handleEditChordChart = (itemId, chordId, _chartData) => {
    setEditingChordId(chordId);
    setInsertionContext(null);
    setScrollBackContext({
      itemId: itemId,
      chordId: chordId,
      scrollPosition: window.scrollY
    });
    setShowChordEditor(prev => ({ ...prev, [itemId]: true }));

    // Auto-scroll to the chord editor after it opens (keep chord name field visible at top)
    setTimeout(() => {
      const editorElement = document.querySelector(`[data-editor-for-item="${itemId}"]`);
      if (editorElement) {
        editorElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        });
      }
    }, 100); // Small delay to ensure the editor has rendered
  };

  const handleDeleteChordChart = async (itemId, chordId) => {
    try {
      const response = await fetch(`/api/items/${itemId}/chord-charts/${chordId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        // Remove from local state
        setChordCharts(prev => ({
          ...prev,
          [itemId]: (prev[itemId] || []).filter(chart => chart.id !== chordId)
        }));

        // Rebuild sections
        const updatedCharts = (chordCharts[itemId] || []).filter(chart => chart.id !== chordId);
        setChordSections(prev => ({
          ...prev,
          [itemId]: buildSectionsFromCharts(updatedCharts)
        }));

        trackChordChartEvent('chord_chart_deleted', { itemId });
      }
    } catch (error) {
      console.error('Error deleting chord chart:', error);
    }
  };

  const handleInsertChordAfter = (itemId, chordId, contextData) => {
    setEditingChordId(null);
    setInsertionContext({
      afterChordId: chordId,
      sectionId: contextData.sectionId,
      sectionLabel: contextData.sectionLabel,
      sectionRepeatCount: contextData.sectionRepeatCount
    });
    setScrollBackContext({
      itemId: itemId,
      scrollPosition: window.scrollY
    });
    setShowChordEditor(prev => ({ ...prev, [itemId]: true }));
  };

  const handleSaveChordChart = async (itemId, chartData) => {
    try {
      serverDebug('handleSaveChordChart called', { editingChordId, chartData });
      const isUpdate = !!editingChordId; // Check state variable to determine if we're editing
      serverDebug('isUpdate check result', { isUpdate, editingChordId });

      // Build chart data - spread all properties (backend will build chord_data object from flattened format)
      let chartDataWithSection = { ...chartData };

      if (isUpdate) {
        // For updates, preserve the original chord's section information (copied from PracticePage)
        const originalChord = (chordCharts[itemId] || []).find(chord => chord.id === editingChordId);

        // Add section metadata to preserve original section
        chartDataWithSection.sectionId = originalChord?.sectionId;
        chartDataWithSection.sectionLabel = originalChord?.sectionLabel;
        chartDataWithSection.sectionRepeatCount = originalChord?.sectionRepeatCount;

        serverDebug('Updating chord, preserving section', {
          originalSection: {
            id: originalChord?.sectionId,
            label: originalChord?.sectionLabel,
            repeatCount: originalChord?.sectionRepeatCount
          }
        });

      } else {
        // For new chords, determine target section
        const itemSections = chordSections[itemId] || [];
        let targetSection;

        if (insertionContext) {
          // Use the insertion context section
          targetSection = {
            id: insertionContext.sectionId,
            label: insertionContext.sectionLabel,
            repeatCount: insertionContext.sectionRepeatCount
          };
        } else if (itemSections.length === 0) {
          // No sections exist, create default
          targetSection = {
            id: 'section-1',
            label: 'Verse',
            repeatCount: ''
          };
        } else {
          // Use the last section (original behavior for "Add New Chord")
          targetSection = itemSections[itemSections.length - 1];
        }

        // Add section metadata to chart data
        chartDataWithSection.sectionId = targetSection.id;
        chartDataWithSection.sectionLabel = targetSection.label;
        chartDataWithSection.sectionRepeatCount = targetSection.repeatCount;
      }

      // Handle line break after this chord - always set the value explicitly
      chartDataWithSection.hasLineBreakAfter = chartData.startOnNewLine || false;
      serverDebug('Setting line break after chord', {
        title: chartDataWithSection.title,
        hasLineBreakAfter: chartDataWithSection.hasLineBreakAfter
      });

      serverDebug('Chord data with section metadata', { chartDataWithSection });

      const url = isUpdate
        ? `/api/chord-charts/${editingChordId}`
        : `/api/items/${itemId}/chord-charts`;
      const method = isUpdate ? 'PUT' : 'POST';

      serverDebug(`${isUpdate ? 'Updating' : 'Creating'} chord chart`, { method, url });

      const response = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chartDataWithSection)
      });

      if (!response.ok) {
        throw new Error(`Failed to save chord chart: ${response.statusText}`);
      }

      if (isUpdate) {
        const updatedChart = await response.json();

        // Update local state
        setChordCharts(prev => ({
          ...prev,
          [itemId]: (prev[itemId] || []).map(chart =>
            chart.id === editingChordId ? updatedChart : chart
          )
        }));

        // Rebuild sections
        const updatedCharts = (chordCharts[itemId] || []).map(chart =>
          chart.id === editingChordId ? updatedChart : chart
        );
        setChordSections(prev => ({
          ...prev,
          [itemId]: buildSectionsFromCharts(updatedCharts)
        }));

        trackChordChartEvent('chord_chart_updated', { itemId });
      } else {
        const newChart = await response.json();

        // Add to local state
        setChordCharts(prev => ({
          ...prev,
          [itemId]: [...(prev[itemId] || []), newChart]
        }));

        // Rebuild sections
        const updatedCharts = [...(chordCharts[itemId] || []), newChart];
        setChordSections(prev => ({
          ...prev,
          [itemId]: buildSectionsFromCharts(updatedCharts)
        }));

        trackChordChartEvent('chord_chart_created', { itemId });
      }

      // Close editor
      setShowChordEditor(prev => ({ ...prev, [itemId]: false }));
      setEditingChordId(null);
      setInsertionContext(null);

    } catch (error) {
      console.error('Error saving chord chart:', error);
    }
  };

  const scrollBackToChord = () => {
    if (scrollBackContext.itemId && scrollBackContext.chordId) {
      setTimeout(() => {
        // Try to find the specific chord chart element first
        const chordElement = document.querySelector(`[data-chord-id="${scrollBackContext.chordId}"]`);
        if (chordElement) {
          chordElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
          });
        } else if (scrollBackContext.scrollPosition !== undefined) {
          // Fallback to original scroll position
          window.scrollTo({
            top: scrollBackContext.scrollPosition,
            behavior: 'smooth'
          });
        }
        setScrollBackContext({});
      }, 100);
    }
  };

  const handlePrintChords = (itemId) => {
    const charts = chordCharts[itemId] || [];
    if (charts.length === 0) return;

    // Create print window
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>Chord Charts - ${itemTitle || itemId}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { text-align: center; margin-bottom: 30px; }
            .section { margin-bottom: 40px; }
            .section-header { font-size: 18px; font-weight: bold; margin-bottom: 15px; }
            .chord-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 20px; margin-bottom: 20px; }
            .chord-item { text-align: center; }
            .chord-svg { margin-bottom: 5px; }
            .chord-title { font-weight: bold; }
            @media print { body { margin: 0; } }
          </style>
        </head>
        <body>
          <h2>Chord Charts - ${itemTitle || itemId}</h2>
          ${getChordSections(itemId).map(section => `
            <div class="section">
              <div class="section-header">${section.label} ${section.repeatCount}</div>
              <div class="chord-grid">
                ${section.chords.map(chart => `
                  <div class="chord-item">
                    <div class="chord-svg">${chart.svg_content || ''}</div>
                    <div class="chord-title">${chart.title}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  // Autocreate functions
  const validateManualChordInput = (input, itemId) => {
    if (!input || input.trim().length === 0) {
      setManualInputErrors(prev => ({ ...prev, [itemId]: null }));
      return true;
    }

    const trimmedInput = input.trim();

    // Pattern: Allow chord names (letters, numbers, #, b, ♭, ♯, /), commas, spaces, and section names on their own lines
    // Valid examples: "C, G, Am, F", "verse\nC, G, Am\nchorus\nF, C, G", "Em7, A#, Bb", "Intro D A G D", "C/G"
    const validPattern = /^[A-Za-z0-9#b♭♯/\s,\n\r-]+$/;

    if (!validPattern.test(trimmedInput)) {
      setManualInputErrors(prev => ({
        ...prev,
        [itemId]: 'Only chord names (A-G), numbers, #, b, ♭, ♯, /, commas, spaces, and section names are allowed'
      }));
      return false;
    }

    // Check for potentially problematic patterns
    const lines = trimmedInput.split(/[\n\r]+/);
    const hasValidContent = lines.some(line => {
      const cleanLine = line.trim();
      if (cleanLine.length === 0) return false;

      // Check if this is a section name (single word, letters only)
      if (/^[A-Za-z]+$/.test(cleanLine)) return true;

      // Check if this line contains only chords (space-separated or comma-separated)
      const words = cleanLine.split(/[,\s]+/).filter(word => word.trim().length > 0);
      const allWordsAreChords = words.every(word => /^[A-Ga-g][A-Za-z0-9#b♭♯/]*$/.test(word));

      return allWordsAreChords;
    });

    if (!hasValidContent) {
      setManualInputErrors(prev => ({
        ...prev,
        [itemId]: 'Please enter chord names separated by commas, spaces, or section names (e.g., "C, G, Am, F" or "D A G D" or "Intro")'
      }));
      return false;
    }

    setManualInputErrors(prev => ({ ...prev, [itemId]: null }));
    return true;
  };

  const handleSingleFileDrop = (itemId, files) => {
    if (!files || files.length === 0) return;

    // Validate file count
    if (files.length > 5) {
      alert('Maximum 5 files allowed. Please select fewer files.');
      return;
    }

    setUploadedFiles(prev => ({ ...prev, [itemId]: Array.from(files) }));
  };

  const handleProcessFiles = async (itemId) => {
    const files = uploadedFiles[itemId] || [];
    const youtubeUrl = youtubeUrls[itemId]?.trim();
    const manualChords = manualChordInput[itemId]?.trim();

    debugLog('AUTOCREATE', `handleProcessFiles called for item ${itemId}, files:`, files.length, 'youtubeUrl:', youtubeUrl, 'manualChords:', manualChords);

    // Handle YouTube URL if provided
    if (youtubeUrl) {
      await handleYouTubeUrl(itemId, youtubeUrl);
      return;
    }

    // Handle manual chord input if provided
    if (manualChords) {
      if (validateManualChordInput(manualChords, itemId)) {
        await handleManualChordInput(itemId, manualChords);
        return;
      } else {
        return; // Stop processing if validation fails
      }
    }

    // Handle files if provided
    if (files.length === 0) {
      alert('Please add at least one file, YouTube URL, or manual chord input before processing.');
      return;
    }

    await handleFileDrop(itemId, files);
  };

  const handleManualChordInput = async (itemId, chordInput) => {
    debugLog('AUTOCREATE', `Processing manual chord input for item ${itemId}:`, chordInput);

    setAutocreateProgress(prev => ({
      ...prev,
      [itemId]: 'processing'
    }));

    try {
      // Create abort controller for this request (copied from PracticePage)
      const abortController = new AbortController();
      setAutocreateAbortController(prev => ({ ...prev, [itemId]: abortController }));

      // Create a text file from the manual input and send it to the autocreate endpoint
      const textBlob = new Blob([chordInput], { type: 'text/plain' });
      const textFile = new File([textBlob], 'manual-input.txt', { type: 'text/plain' });

      const formData = new FormData();
      formData.append('file0', textFile);
      formData.append('itemId', itemId);
      formData.append('userChoice', 'chord_names'); // Indicate this is chord names input

      debugLog('AUTOCREATE', `Sending manual input to autocreate endpoint`);

      const response = await fetch('/api/autocreate-chord-charts', {
        method: 'POST',
        body: formData,
        signal: abortController.signal
      });

      if (!response.ok) {
        // Parse the error response to get detailed message
        let errorMessage = `Failed to process manual input: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage = errorData.error;
          }
          // Check if requires API key
          if (errorData.requires_api_key) {
            // Clear progress state before showing modal
            setAutocreateProgress(prev => {
              const newState = { ...prev };
              delete newState[itemId];
              return newState;
            });
            // Show API key required modal via ApiErrorModal
            setApiError({
              message: errorMessage,
              requiresApiKey: true
            });
            setShowApiErrorModal(true);
            return;
          }
        } catch (parseError) {
          console.warn('Could not parse error response:', parseError);
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      debugLog('AUTOCREATE', `Manual input processed successfully:`, result);

      // Force refresh UI state - same as other autocreate methods
      const chartResponse = await fetch(`/api/items/${itemId}/chord-charts`);
      const charts = await chartResponse.json();

      setChordCharts(prev => ({
        ...prev,
        [itemId]: charts
      }));

      setChordSections(prev => ({
        ...prev,
        [itemId]: buildSectionsFromCharts(charts)
      }));

      // Clear the manual input
      setManualChordInput(prev => ({
        ...prev,
        [itemId]: ''
      }));

      // Reset rate limit backoff on success
      resetRateLimitBackoff();
      setAutocreateProgress(prev => ({ ...prev, [itemId]: 'complete' }));

      // Show success modal
      const itemDetails = getItemDetails(itemId);
      setAutocreateSuccessData({
        itemName: itemDetails?.C || `Item ${itemId}`,
        chordCount: charts.length,
        contentType: 'chord_names',
        uploadedFileNames: 'Manual entry',
        isVisionAnalysis: false
      });
      setShowAutocreateSuccessModal(true);

      // Clean up abort controller (copied from PracticePage)
      setAutocreateAbortController(prev => {
        const newState = { ...prev };
        delete newState[itemId];
        return newState;
      });

      setTimeout(() => {
        setAutocreateProgress(prev => ({ ...prev, [itemId]: null }));
        setShowAutocreateZone(prev => ({ ...prev, [itemId]: false }));
      }, 2000);

    } catch (error) {
      console.error('Error processing manual chord input:', error);
      setAutocreateProgress(prev => ({ ...prev, [itemId]: 'error' }));

      // Clean up abort controller on error (copied from PracticePage)
      setAutocreateAbortController(prev => {
        const newState = { ...prev };
        delete newState[itemId];
        return newState;
      });

      setTimeout(() => {
        setAutocreateProgress(prev => ({ ...prev, [itemId]: null }));
      }, 3000);
    }
  };

  const handleYouTubeUrl = async (itemId, youtubeUrl) => {
    debugLog('YOUTUBE', `Processing YouTube URL for item ${itemId}:`, youtubeUrl);

    // Sanitize and validate YouTube URL format
    const sanitizedUrl = youtubeUrl.trim().replace(/[<>"']/g, '');
    const youtubeRegex = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=[\w-]+|youtu\.be\/[\w-]+)(\?.*|&.*)?$/;

    if (!youtubeRegex.test(sanitizedUrl)) {
      debugLog('YOUTUBE', `URL validation failed for: ${sanitizedUrl}`);
      setApiError({ message: 'Please enter a valid YouTube URL (e.g., https://youtube.com/watch?v=...)' });
      setShowApiErrorModal(true);
      return;
    }

    debugLog('YOUTUBE', `URL validation passed, setting progress state`);
    setAutocreateProgress(prev => ({
      ...prev,
      [itemId]: 'checking_transcript'
    }));

    try {
      // First, check if transcript is available and fetch it
      debugLog('YOUTUBE', 'Fetching transcript from YouTube API');
      const transcriptResponse = await fetch('/api/youtube/check-transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sanitizedUrl })
      });

      if (!transcriptResponse.ok) {
        throw new Error('Failed to fetch YouTube transcript');
      }

      const transcriptData = await transcriptResponse.json();

      if (!transcriptData.hasTranscript || !transcriptData.transcript) {
        setApiError({
          message: 'This YouTube video does not have a transcript available. Please try a different video or use file upload instead.'
        });
        setShowApiErrorModal(true);
        return;
      }

      debugLog('YOUTUBE', `Transcript fetched successfully, length: ${transcriptData.transcript.length} characters`);

      // Update progress to processing
      setAutocreateProgress(prev => ({
        ...prev,
        [itemId]: 'processing'
      }));

      // Create a file with the actual transcript text
      const transcriptBlob = new Blob([transcriptData.transcript], { type: 'text/plain' });
      const transcriptFile = new File([transcriptBlob], 'youtube_transcript.txt', { type: 'text/plain' });

      const formData = new FormData();
      formData.append('file0', transcriptFile);
      formData.append('itemId', itemId);
      formData.append('userChoice', 'chord_names');

      debugLog('AUTOCREATE', `Sending transcript to autocreate endpoint`);

      const response = await fetch('/api/autocreate-chord-charts', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();

        // Try to parse as JSON to check for requires_api_key flag
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { error: errorText };
        }

        // Check if this is an API key requirement error
        if (errorData.requires_api_key) {
          // Clear progress state before showing modal
          setAutocreateProgress(prev => {
            const newState = { ...prev };
            delete newState[itemId];
            return newState;
          });
          // Show API key required modal via ApiErrorModal
          setApiError({
            message: errorData.error || 'Autocreate requires an API key.',
            requiresApiKey: true
          });
          setShowApiErrorModal(true);
          return;
        }

        throw new Error(`Failed to process YouTube transcript: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      debugLog('AUTOCREATE', `YouTube transcript processed successfully:`, result);

      // Force refresh UI state
      const chartResponse = await fetch(`/api/items/${itemId}/chord-charts`);
      const charts = await chartResponse.json();

      setChordCharts(prev => ({
        ...prev,
        [itemId]: charts
      }));

      setChordSections(prev => ({
        ...prev,
        [itemId]: buildSectionsFromCharts(charts)
      }));

      // Clear the YouTube input
      setYoutubeUrls(prev => ({
        ...prev,
        [itemId]: ''
      }));

      // Reset rate limit backoff on success
      resetRateLimitBackoff();

      // Show success modal
      const itemDetails = getItemDetails(itemId);
      setAutocreateSuccessData({
        itemName: itemDetails?.C || `Item ${itemId}`,
        chordCount: charts.length,
        contentType: 'chord_names',
        uploadedFileNames: 'YouTube transcript',
        isVisionAnalysis: false
      });
      setShowAutocreateSuccessModal(true);

    } catch (error) {
      console.error('Error processing YouTube URL:', error);
      setApiError({ message: 'Failed to process YouTube URL. Please try again.' });
      setShowApiErrorModal(true);
    } finally {
      setAutocreateProgress(prev => {
        const newState = { ...prev };
        delete newState[itemId];
        return newState;
      });
    }

  };

  const handleFileDrop = async (itemId, files) => {
    try {
      setAutocreateProgress(prev => ({ ...prev, [itemId]: 'uploading' }));

      // Create abort controller for this request (copied from PracticePage)
      const abortController = new AbortController();
      setAutocreateAbortController(prev => ({ ...prev, [itemId]: abortController }));

      const formData = new FormData();
      files.forEach((file, index) => {
        formData.append(`file${index}`, file);
      });

      formData.append('itemId', itemId);

      // Show uploading for minimum 2 seconds, then switch to processing (copied from PracticePage)
      const minDisplayTime = 2000;
      let hasErrorOccurred = false;
      const processingTimer = setTimeout(() => {
        if (!hasErrorOccurred) {
          setAutocreateProgress(prev => ({ ...prev, [itemId]: 'processing' }));
        }
      }, minDisplayTime);

      const response = await fetch('/api/autocreate-chord-charts', {
        method: 'POST',
        body: formData,
        signal: abortController.signal
      });

      if (response.ok) {
        // Reset rate limit backoff on success
        resetRateLimitBackoff();
        setAutocreateProgress(prev => ({ ...prev, [itemId]: 'complete' }));

        // Refresh chord charts
        const chartsResponse = await fetch(`/api/items/${itemId}/chord-charts`);
        const charts = await chartsResponse.json();

        setChordCharts(prev => ({
          ...prev,
          [itemId]: charts
        }));

        setChordSections(prev => ({
          ...prev,
          [itemId]: buildSectionsFromCharts(charts)
        }));

        // Clear inputs
        setUploadedFiles(prev => ({ ...prev, [itemId]: [] }));

        trackChordChartEvent('autocreate_completed', { itemId, fileCount: files.length });

        // Show success modal
        const itemDetails = getItemDetails(itemId);
        const fileNames = files.map(f => f.name).join(', ');
        setAutocreateSuccessData({
          itemName: itemDetails?.C || `Item ${itemId}`,
          chordCount: charts.length,
          contentType: 'auto-detected',
          uploadedFileNames: fileNames,
          isVisionAnalysis: false
        });
        setShowAutocreateSuccessModal(true);

        // Clean up abort controller (copied from PracticePage)
        setAutocreateAbortController(prev => {
          const newState = { ...prev };
          delete newState[itemId];
          return newState;
        });

        setTimeout(() => {
          setAutocreateProgress(prev => ({ ...prev, [itemId]: null }));
          setShowAutocreateZone(prev => ({ ...prev, [itemId]: false }));
        }, 2000);

      } else {
        // Prevent the processing timer from firing after error
        hasErrorOccurred = true;
        clearTimeout(processingTimer);

        // Parse error response
        let errorMessage = `Failed to create chord charts: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage = errorData.error;
          }
          // Check if requires API key
          if (errorData.requires_api_key) {
            // Clear progress state before showing modal
            setAutocreateProgress(prev => {
              const newState = { ...prev };
              delete newState[itemId];
              return newState;
            });
            // Show API key required modal
            setApiError({
              message: errorMessage,
              requiresApiKey: true
            });
            setShowApiErrorModal(true);
            // Clean up abort controller
            setAutocreateAbortController(prev => {
              const newState = { ...prev };
              delete newState[itemId];
              return newState;
            });
            return;
          }
        } catch (parseError) {
          console.warn('Could not parse error response:', parseError);
        }

        // Show generic error modal for other errors
        setApiError({ message: errorMessage });
        setShowApiErrorModal(true);
        // Clear progress immediately for 429/rate limit errors so user is back at clean state
        setAutocreateProgress(prev => {
          const newState = { ...prev };
          delete newState[itemId];
          return newState;
        });

        // Clean up abort controller on error (copied from PracticePage)
        setAutocreateAbortController(prev => {
          const newState = { ...prev };
          delete newState[itemId];
          return newState;
        });
      }

    } catch (error) {
      // Prevent the processing timer from firing after error
      hasErrorOccurred = true;
      clearTimeout(processingTimer);

      console.error('Error processing files:', error);
      // Clear progress immediately so user is back at clean state
      setAutocreateProgress(prev => {
        const newState = { ...prev };
        delete newState[itemId];
        return newState;
      });

      // Clean up abort controller on error (copied from PracticePage)
      setAutocreateAbortController(prev => {
        const newState = { ...prev };
        delete newState[itemId];
        return newState;
      });
    }
  };

  // Autocreate functions (copied from PracticePage)
  const handleAutocreateClick = (itemId) => {
    const existingCharts = chordCharts[itemId] || [];
    if (existingCharts.length > 0) {
      // Show modal asking to delete existing charts
      setDeleteModalItemId(itemId);
      setShowDeleteChordsModal(true);
    } else {
      // No existing charts, proceed with autocreate zone
      setShowAutocreateZone(prev => ({ ...prev, [itemId]: true }));
    }
  };

  const handleDeleteExistingCharts = async () => {
    if (!deleteModalItemId) return;

    try {
      // Delete all chord charts for this item
      const existingCharts = chordCharts[deleteModalItemId] || [];
      for (const chart of existingCharts) {
        const response = await fetch(`/api/items/${deleteModalItemId}/chord-charts/${chart.id}`, {
          method: 'DELETE'
        });
        if (!response.ok) {
          throw new Error(`Failed to delete chord chart ${chart.id}`);
        }
      }

      // Force refresh chord charts (clear state first since all charts are deleted)
      setChordCharts(prev => ({
        ...prev,
        [deleteModalItemId]: []
      }));
      setChordSections(prev => ({
        ...prev,
        [deleteModalItemId]: []
      }));

      // Show autocreate zone after deletion
      setShowAutocreateZone(prev => ({ ...prev, [deleteModalItemId]: true }));

      // Close modal
      setShowDeleteChordsModal(false);
      setDeleteModalItemId(null);
    } catch (error) {
      console.error('Error deleting existing chord charts:', error);
    }
  };

  const handleShowCancelConfirmation = (itemId) => {
    setCancellingItemId(itemId);
    setShowCancelDialog(true);
  };

  // Cancel autocreate functionality (copied from PracticePage)
  const handleCancelAutocreate = (itemId) => {
    // Cancel the request if it's in progress
    if (autocreateAbortController[itemId]) {
      autocreateAbortController[itemId].abort();
    }

    // Reset all state for this item
    setAutocreateProgress(prev => {
      const newState = { ...prev };
      delete newState[itemId];
      return newState;
    });
    setAutocreateAbortController(prev => {
      const newState = { ...prev };
      delete newState[itemId];
      return newState;
    });
    setUploadedFiles(prev => {
      const newState = { ...prev };
      delete newState[itemId];
      return newState;
    });
    setYoutubeUrls(prev => ({
      ...prev,
      [itemId]: ''
    }));
    setManualChordInput(prev => ({
      ...prev,
      [itemId]: ''
    }));
    setShowAutocreateZone(prev => ({ ...prev, [itemId]: false }));
  };

  // Copy FROM modal: Open modal and load chord chart data for all items
  const handleOpenCopyFromModal = async (targetItemId) => {
    debugLog('CopyCharts', 'Opening copy FROM modal for target item:', targetItemId);

    // Load chord charts for ALL items so we know which ones have charts
    // (We need this to filter the list to only show items with charts)
    if (allItems) {
      const loadPromises = allItems
        .filter(item => item['B'] !== targetItemId)
        .map(async (item) => {
          const id = item['B'];
          // Skip if already loaded
          if (chordCharts[id]) return;
          try {
            const response = await fetch(`/api/items/${id}/chord-charts`);
            if (response.ok) {
              const charts = await response.json();
              setChordCharts(prev => ({ ...prev, [id]: charts }));
            }
          } catch (error) {
            console.error(`Error loading chord charts for item ${id}:`, error);
          }
        });

      await Promise.all(loadPromises);
    }

    setShowCopyFromModal(true);
    setCopyFromSearchTerm('');
    setSelectedSourceItem(null);
    setCopyFromProgress(null);
    setCopyFromShowOverwriteConfirmation(false);
  };

  // Copy FROM modal: Close modal
  const handleCloseCopyFromModal = () => {
    setShowCopyFromModal(false);
    setCopyFromSearchTerm('');
    setSelectedSourceItem(null);
    setCopyFromProgress(null);
    setCopyFromShowOverwriteConfirmation(false);
  };

  // Copy FROM modal: Confirm copy operation
  const handleConfirmCopyFrom = async () => {
    if (!selectedSourceItem) return;

    const sourceItem = allItems?.find(item => item['A'] === selectedSourceItem);
    const sourceItemId = sourceItem?.['B'];
    const targetItemId = itemId; // The current item in the chord charts modal

    if (!sourceItemId) return;

    // Check if current item has existing charts and needs overwrite confirmation
    const currentCharts = chordCharts[targetItemId] || [];
    if (currentCharts.length > 0 && !copyFromShowOverwriteConfirmation) {
      setCopyFromShowOverwriteConfirmation(true);
      return;
    }

    try {
      // Use the same API endpoint - source is the selected item, target is the current item
      const response = await fetch('/api/chord-charts/copy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_item_id: sourceItemId,
          target_item_ids: [targetItemId]
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to copy chord charts: ${response.statusText}`);
      }

      const result = await response.json();
      debugLog('CopyCharts', 'Chord charts copied FROM successfully:', result);

      // Track the event
      trackChordChartEvent('chord_charts_copied_from', {
        source_item_id: sourceItemId,
        target_item_id: targetItemId,
        charts_copied: result.result?.charts_found || 0
      });

      setCopyFromProgress('complete');

      // Refresh chord charts for the current item
      try {
        const refreshResponse = await fetch(`/api/items/${targetItemId}/chord-charts`);
        if (refreshResponse.ok) {
          const charts = await refreshResponse.json();
          setChordCharts(prev => ({ ...prev, [targetItemId]: charts }));
          setChordSections(prev => ({
            ...prev,
            [targetItemId]: buildSectionsFromCharts(charts)
          }));
        }
      } catch (error) {
        console.error(`Error refreshing chord charts for item ${targetItemId}:`, error);
      }
    } catch (error) {
      console.error('Error copying chord charts from source:', error);
    }
  };

  // Copy modal: Open copy TO modal (copied from PracticePage)
  const handleOpenCopyModal = async (itemId) => {
    debugLog('CopyCharts', 'Opening copy modal for item:', itemId);
    setCopySourceItemId(itemId);

    // Get source item details for fuzzy matching
    const sourceItem = allItems?.find(item => item['B'] === itemId);
    const sourceTitle = sourceItem?.['C'] || '';

    // Find similar songs first
    const similarSongs = findSimilarSongs(sourceTitle, allItems, itemId);
    debugLog('CopyCharts', 'Source:', sourceTitle);
    debugLog('CopyCharts', 'Found similar songs:', similarSongs.map(s => s['C']));

    // Load chord charts for source + similar songs
    const itemsToLoad = [itemId, ...similarSongs.map(s => s['B'])];
    debugLog('CopyCharts', 'Loading chord charts for relevant items:', itemsToLoad.length, 'items');

    for (const id of itemsToLoad) {
      try {
        const response = await fetch(`/api/items/${id}/chord-charts`);
        if (response.ok) {
          const charts = await response.json();
          setChordCharts(prev => ({ ...prev, [id]: charts }));
          debugLog('CopyCharts', `Loaded ${charts.length} charts for item ${id}`);
        }
      } catch (error) {
        console.error(`Error loading chord charts for item ${id}:`, error);
      }
    }

    setShowCopyModal(true);
    setCopySearchTerm('');
    setSelectedTargetItems(new Set());
    setCopyProgress(null);
  };

  // Copy modal: Close modal (copied from PracticePage)
  const handleCloseCopyModal = () => {
    setShowCopyModal(false);
    setCopySourceItemId(null);
    setCopySearchTerm('');
    setSelectedTargetItems(new Set());
    setItemsWithExistingCharts(new Set());
    setShowOverwriteConfirmation(false);
    setCopyProgress(null);
  };

  // Copy modal: Toggle target item selection (copied from PracticePage)
  const handleToggleTargetItem = (itemPrimaryKey) => {
    setSelectedTargetItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemPrimaryKey)) {
        newSet.delete(itemPrimaryKey);
      } else {
        newSet.add(itemPrimaryKey);
        // Lazy load chord charts for overwrite detection
        const targetItem = allItems?.find(item => item['A'] === itemPrimaryKey);
        const itemReferenceId = targetItem?.['B'];
        if (itemReferenceId) {
          loadChordChartsForItem(itemReferenceId);
        }
      }
      return newSet;
    });
  };

  // Copy modal: Confirm copy operation (copied from PracticePage)
  const handleConfirmCopy = async () => {
    debugLog('CopyCharts', 'handleConfirmCopy called', { copySourceItemId, selectedTargetItems: Array.from(selectedTargetItems) });
    if (!copySourceItemId || selectedTargetItems.size === 0) {
      debugLog('CopyCharts', 'Early return: missing source or targets');
      return;
    }

    // If there are overwrites and we haven't confirmed yet, show confirmation
    if (itemsWithExistingCharts.size > 0 && !showOverwriteConfirmation) {
      debugLog('CopyCharts', 'Showing overwrite confirmation, items with existing charts:', itemsWithExistingCharts.size);
      setShowOverwriteConfirmation(true);
      return;
    }

    try {
      const response = await fetch('/api/chord-charts/copy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_item_id: copySourceItemId,
          target_item_ids: Array.from(selectedTargetItems).map(primaryKey => {
            const targetItem = allItems?.find(item => item['A'] === primaryKey);
            return targetItem?.['B'];
          }).filter(Boolean)
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to copy chord charts: ${response.statusText}`);
      }

      const result = await response.json();
      debugLog('CopyCharts', 'Chord charts copied successfully:', result);

      // Set copy progress to complete
      setCopyProgress('complete');

      // Force refresh chord charts for all affected items
      const targetItemIds = Array.from(selectedTargetItems).map(primaryKey => {
        const targetItem = allItems?.find(item => item['A'] === primaryKey);
        return targetItem?.['B'];
      }).filter(Boolean);
      const affectedItems = [copySourceItemId, ...targetItemIds];
      debugLog('CopyCharts', 'About to refresh chord charts for affected items:', affectedItems);

      for (const itemIdToRefresh of affectedItems) {
        try {
          const refreshResponse = await fetch(`/api/items/${itemIdToRefresh}/chord-charts`);
          if (refreshResponse.ok) {
            const charts = await refreshResponse.json();

            debugLog('CopyCharts', 'Updating chordCharts state for item', itemIdToRefresh, 'with', charts.length, 'charts');
            setChordCharts(prev => ({
              ...prev,
              [itemIdToRefresh]: charts
            }));

            // Build sections from loaded chord charts
            setChordSections(prev => ({
              ...prev,
              [itemIdToRefresh]: buildSectionsFromCharts(charts)
            }));
          }
        } catch (error) {
          console.error(`Error refreshing chord charts for item ${itemIdToRefresh}:`, error);
        }
      }
    } catch (error) {
      console.error('Error copying chord charts:', error);
    }
  };

  if (!isOpen) return null;

  const itemReferenceId = itemId;

  return (
    <>
    <Dialog open={isOpen && !showCopyModal && !showCopyFromModal} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl md:max-w-3xl lg:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Music className="h-5 w-5" />
            Chord Charts - {itemTitle || itemId}
          </DialogTitle>
          <DialogDescription className="sr-only">
            View and manage chord charts for this practice item
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* This is the exact copy of the chord charts section from PracticePage.jsx lines 3357-3928 */}
          {(() => {
            const sectionsFromState = chordSections[itemReferenceId];
            const sectionsFromCharts = sectionsFromState ? null : getChordSections(itemReferenceId);
            const finalSections = sectionsFromState || sectionsFromCharts || [];

            // Map sections to JSX elements with itemReferenceId in scope
            const sections = finalSections.map((section, sectionIndex) => {
              return (
            <div key={section.id} className="mb-6">
              {/* Section header with label and repeat count */}
              <div className="flex justify-between items-center mb-3">
                {/* Section label (top-left) */}
                <input
                  type="text"
                  value={section.label}
                  onChange={(e) => {
                    debugLog('Section', 'Updating section label:', section.id, e.target.value);
                    updateSectionLocal(itemReferenceId, section.id, { label: e.target.value });
                  }}
                  className="bg-gray-900 text-white px-2 py-1 rounded text-sm font-semibold border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Section name"
                />

                {/* Repeat count, line break, and section delete */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={section.repeatCount}
                    onChange={(e) => updateSectionLocal(itemReferenceId, section.id, { repeatCount: e.target.value })}
                    className="bg-gray-900 text-white px-2 py-1 rounded text-sm w-16 text-center border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="x2"
                    maxLength="3"
                  />
                  <button
                    onClick={() => deleteSection(itemReferenceId, section.id)}
                    disabled={deletingSection.size > 0}
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                      deletingSection.size > 0
                        ? 'bg-gray-500 cursor-not-allowed'
                        : 'bg-red-600 hover:bg-red-700 cursor-pointer'
                    } text-white`}
                    title={deletingSection.size > 0 ? "Deleting..." : "Delete section"}
                  >
                    {deletingSection.size > 0 ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      '×'
                    )}
                  </button>
                </div>
              </div>

              {/* Tuning and capo info - only show on first section */}
              {sectionIndex === 0 && (() => {
                // Get tuning and capo from first chord in section (they should all be the same)
                const firstChord = section.chords[0];
                if (!firstChord) return null;

                const tuning = firstChord.tuning || 'EADGBE';
                const capo = firstChord.capo || 0;

                return (
                  <div className="text-center text-white font-bold text-sm mb-3">
                    {capo > 0 ? `${tuning} | Capo on ${capo}` : tuning}
                  </div>
                );
              })()}

              {/* Chord grid for this section */}
              {section.chords.length > 0 && (
                <div className="space-y-2">
                  {(() => {
                    // Group chords by line breaks
                    const chordRows = [];
                    let currentRow = [];

                    section.chords.forEach((chart, index) => {
                      currentRow.push(chart);

                      // Start new row if:
                      // 1. This chord has a line break after it
                      // 2. We've reached 5 chords
                      // 3. This is the last chord
                      if (chart.hasLineBreakAfter || currentRow.length >= 5 || index === section.chords.length - 1) {
                        chordRows.push([...currentRow]);
                        currentRow = [];
                      }
                    });

                    return chordRows.map((row, rowIndex) => (
                      <div
                        key={rowIndex}
                        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2"
                      >
                        {row.map(chart => (
                          <MemoizedChordChart
                            key={chart.id}
                            chart={chart}
                            onEdit={(chordId, chartData) => handleEditChordChart(itemReferenceId, chordId, chartData)}
                            onDelete={(chordId) => handleDeleteChordChart(itemReferenceId, chordId)}
                            onInsertAfter={(chordId, chartData) => handleInsertChordAfter(itemReferenceId, chordId, chartData)}
                          />
                        ))}
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>
            );
            });

            // Return the complete chord chart content including buttons and editor
            return (
              <>
                {sections}

                {/* Print button - floating above Add New Chord - only show if chord charts exist */}
                {(() => {
                  const existingCharts = chordCharts[itemReferenceId] || [];
                  if (existingCharts.length > 0) {
                    return (
                      <div className="flex justify-end mb-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePrintChords(itemReferenceId);
                          }}
                          className="p-2 border-gray-600 text-gray-400 hover:text-gray-200 hover:bg-gray-600"
                          title="Print chord charts"
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* Autocreate from files - collapsible section */}
                {(() => {
                  const existingCharts = chordCharts[itemReferenceId] || [];
                  const progress = autocreateProgress[itemReferenceId];
                  const zoneExpanded = showAutocreateZone[itemReferenceId];

                  if (existingCharts.length === 0) {
                    // No existing charts - show expandable autocreate
                    return (
                      <div className="mb-4">
                        {zoneExpanded ? (
                          <Button
                            onClick={() => setShowAutocreateZone(prev => ({
                              ...prev,
                              [itemReferenceId]: false
                            }))}
                            variant="ghost"
                            size="sm"
                            className="text-gray-400 hover:text-gray-300 mb-2"
                            title="Collapse autocreate section"
                          >
                            ←
                          </Button>
                        ) : (
                          <div className="flex justify-center">
                            <Button
                              onClick={() => setShowAutocreateZone(prev => ({
                                ...prev,
                                [itemReferenceId]: true
                              }))}
                              className="max-w-md bg-gray-700 text-gray-300 hover:bg-gray-600 mb-2 flex items-center justify-center"
                            >
                              <Upload className="h-4 w-4 mr-2" />
                              Autocreate Chord Charts
                            </Button>
                          </div>
                        )}

                        {zoneExpanded && (
                          <div className="border border-gray-600/30 rounded-lg p-4 bg-gray-800/10">
                            <div className="text-sm text-gray-400 mb-6">
                              <p>• Upload lyrics with chord names to create charts</p>
                              <p>• Upload image or PDF of chord charts to "import"</p>
                              <p>• One method at a time</p>
                            </div>

                            {!progress && (
                              <>
                                {/* Three-column layout for larger screens, stacked on mobile */}
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6 items-start">

                                  {/* Column 1: File Upload */}
                                  <div className="flex flex-col">
                                    <div className="text-center mb-2">
                                      <p className="text-gray-400 text-sm font-medium">Upload files</p>
                                    </div>
                                    <div
                                      className={`flex-1 p-4 border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                                        isDragActive[itemReferenceId]
                                          ? 'border-gray-500 bg-gray-800/20'
                                          : 'border-gray-600 hover:border-gray-500 bg-gray-800/10'
                                      }`}
                                      onDragOver={(e) => {
                                        e.preventDefault();
                                        setIsDragActive(prev => {
                                          if (prev[itemReferenceId] !== true) {
                                            return { ...prev, [itemReferenceId]: true };
                                          }
                                          return prev;
                                        });
                                      }}
                                      onDragLeave={(e) => {
                                        e.preventDefault();
                                        setIsDragActive(prev => {
                                          if (prev[itemReferenceId] !== false) {
                                            return { ...prev, [itemReferenceId]: false };
                                          }
                                          return prev;
                                        });
                                      }}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        setIsDragActive(prev => ({ ...prev, [itemReferenceId]: false }));
                                        handleSingleFileDrop(itemReferenceId, e.dataTransfer.files);
                                      }}
                                      onClick={() => {
                                        const input = document.createElement('input');
                                        input.type = 'file';
                                        input.multiple = true;
                                        input.accept = '.pdf,.png,.jpg,.jpeg';
                                        input.onchange = (e) => handleSingleFileDrop(itemReferenceId, e.target.files);
                                        input.click();
                                      }}
                                    >
                                      <div className="text-center">
                                        <Upload className={`h-12 w-12 mx-auto mb-2 ${
                                          uploadedFiles[itemReferenceId] && uploadedFiles[itemReferenceId].length > 0 ? 'text-gray-300' : 'text-gray-400'
                                        }`} />
                                        <p className={`text-sm font-medium mb-2 ${
                                          uploadedFiles[itemReferenceId] && uploadedFiles[itemReferenceId].length > 0 ? 'text-gray-200' : 'text-gray-300'
                                        }`}>Drop files or click</p>
                                        <p className="text-gray-400 text-xs mb-2">
                                          PDFs, images • 5mb max
                                        </p>
                                        {uploadedFiles[itemReferenceId] && uploadedFiles[itemReferenceId].length > 0 && (
                                          <div>
                                            <p className="text-gray-300 text-xs font-medium mb-1">
                                              {uploadedFiles[itemReferenceId].length} file(s)
                                            </p>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Column 2: YouTube URL - wrapped in form for Enter key support */}
                                  <div className="flex flex-col">
                                    <div className="text-center mb-2">
                                      <p className="text-gray-400 text-sm font-medium">YouTube guitar lesson</p>
                                      <p className="text-gray-500 text-xs">(video must have a transcript)</p>
                                    </div>
                                    <form
                                      className="flex-1 flex flex-col justify-center"
                                      onSubmit={(e) => {
                                        e.preventDefault();
                                        if (youtubeUrls[itemReferenceId]?.trim()) {
                                          handleProcessFiles(itemReferenceId);
                                        }
                                      }}
                                    >
                                      <input
                                        type="url"
                                        placeholder="Paste YouTube URL"
                                        value={youtubeUrls[itemReferenceId] || ''}
                                        onChange={(e) => {
                                          const sanitizedValue = e.target.value.replace(/[<>"']/g, '');
                                          setYoutubeUrls(prev => ({
                                            ...prev,
                                            [itemReferenceId]: sanitizedValue
                                          }));
                                        }}
                                        maxLength={500}
                                        className="w-full p-3 bg-gray-700 text-white rounded border-2 border-gray-600 focus:border-gray-500 text-sm"
                                      />
                                    </form>
                                  </div>

                                  {/* Column 3: Manual Chord Input */}
                                  <div className="flex flex-col">
                                    <div className="text-center mb-2">
                                      <p className="text-gray-400 text-sm font-medium">Manual entry</p>
                                    </div>
                                    <div className="flex-1 flex flex-col justify-center relative">
                                      <textarea
                                        placeholder="Enter song section names and chord names, like this:&#10;Intro&#10;Am7 Em/A E7sus&#10;Verse&#10;C G/B Am (space or comma-separated)"
                                        value={manualChordInput[itemReferenceId] || ''}
                                        onChange={(e) => {
                                          const value = e.target.value;
                                          if (value.length <= 500) {
                                            setManualChordInput(prev => ({
                                              ...prev,
                                              [itemReferenceId]: value
                                            }));
                                            // Validate on change
                                            validateManualChordInput(value, itemReferenceId);
                                          }
                                        }}
                                        maxLength={500}
                                        className={`w-full p-3 text-white rounded border-2 focus:border-gray-500 text-sm resize-none min-h-[160px] ${
                                          manualInputErrors[itemReferenceId] ? 'bg-red-900/20 border-red-500' : 'bg-gray-700 border-gray-600'
                                        }`}
                                      />
                                      {/* Character counter */}
                                      <div className="absolute bottom-1 right-2 text-xs text-gray-400">
                                        {(manualChordInput[itemReferenceId] || '').length}/500
                                      </div>
                                      {/* Error message */}
                                      {manualInputErrors[itemReferenceId] && (
                                        <div className="mt-1 text-xs text-red-400">
                                          {manualInputErrors[itemReferenceId]}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                </div>

                            {/* Process Button */}
                            <div className="flex justify-center">
                              <Button
                                onClick={() => handleProcessFiles(itemReferenceId)}
                                disabled={progress || (
                                  // Must have exactly one input method
                                  (uploadedFiles[itemReferenceId] || []).length === 0 && !youtubeUrls[itemReferenceId]?.trim() && !manualChordInput[itemReferenceId]?.trim() ||
                                  ((uploadedFiles[itemReferenceId] || []).length > 0 ? 1 : 0) + (youtubeUrls[itemReferenceId]?.trim() ? 1 : 0) + (manualChordInput[itemReferenceId]?.trim() ? 1 : 0) > 1
                                )}
                                className="px-6"
                              >
                                <Wand className="h-4 w-4 mr-2" />
                                Create Chord Charts
                              </Button>
                            </div>
                              </>
                            )}

                            {/* Progress/Status Display */}
                            <div
                              className="w-full p-6 border-2 border-dashed rounded-lg mt-4 bg-gray-800/10 border-gray-600/50"
                            >
                              <div className="text-center">
                                {progress === 'checking_transcripts' && (
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-center space-x-2">
                                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-500"></div>
                                      <span className="text-yellow-400">Checking for transcripts...</span>
                                    </div>
                                    <br />
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleShowCancelConfirmation(itemReferenceId)}
                                      className="text-gray-400 hover:text-gray-200 border-gray-600"
                                    >
                                      <X className="h-3 w-3 mr-1" />
                                      Cancel
                                    </Button>
                                  </div>
                                )}
                                {progress === 'reading_transcript' && (
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-center space-x-2">
                                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500"></div>
                                      <span className="text-gray-400">Reading transcript...</span>
                                    </div>
                                    <br />
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleShowCancelConfirmation(itemReferenceId)}
                                      className="text-gray-400 hover:text-gray-200 border-gray-600"
                                    >
                                      <X className="h-3 w-3 mr-1" />
                                      Cancel
                                    </Button>
                                  </div>
                                )}
                                {progress === 'uploading' && (
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-center space-x-2">
                                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500"></div>
                                      <span className="text-gray-400">Uploading files...</span>
                                    </div>
                                    <br />
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleShowCancelConfirmation(itemReferenceId)}
                                      className="text-gray-400 hover:text-gray-200 border-gray-600"
                                    >
                                      <X className="h-3 w-3 mr-1" />
                                      Cancel
                                    </Button>
                                  </div>
                                )}
                                {progress === 'processing_transcript' && (
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-center space-x-2">
                                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-500"></div>
                                      <span className="text-white">Processing transcript...</span>
                                    </div>
                                    <br />
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleShowCancelConfirmation(itemReferenceId)}
                                      className="text-gray-400 hover:text-gray-200 border-gray-600"
                                    >
                                      <X className="h-3 w-3 mr-1" />
                                      Cancel
                                    </Button>
                                  </div>
                                )}
                                {progress === 'processing' && (
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-center space-x-2">
                                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-500"></div>
                                      <div className="flex items-center">
                                        <span className="text-white">{processingMessages[processingMessageIndex]}</span>
                                        <div className="ml-2 animate-spin">⚙️</div>
                                      </div>
                                    </div>
                                    <br />
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleShowCancelConfirmation(itemReferenceId)}
                                      className="text-gray-400 hover:text-gray-200 border-gray-600"
                                    >
                                      <X className="h-3 w-3 mr-1" />
                                      Cancel
                                    </Button>
                                  </div>
                                )}
                                {progress === 'complete' && (
                                  <div className="flex items-center justify-center space-x-2">
                                    <Check className="h-4 w-4 text-green-500" />
                                    <span className="text-green-400">Chord charts created!</span>
                                  </div>
                                )}
                                {progress === 'error' && (
                                  <div className="flex items-center justify-center space-x-2">
                                    <AlertTriangle className="h-4 w-4 text-red-500" />
                                    <span className="text-red-400">Error processing files. Please try again.</span>
                                  </div>
                                )}
                                {!progress && (
                                  <>
                                    {chordCharts[itemReferenceId] && chordCharts[itemReferenceId].length > 0 ? (
                                      <>
                                        <AlertTriangle className="h-8 w-8 text-orange-400 mx-auto mb-2" />
                                        <p className="text-orange-300 font-medium mb-1">Chord charts already exist</p>
                                        <p className="text-gray-400 text-sm">
                                          Please delete all chord charts from this song before using autocreate
                                        </p>
                                      </>
                                    ) : (
                                      <>
                                        {(() => {
                                          const hasFiles = (uploadedFiles[itemReferenceId] || []).length > 0;

                                          if (hasFiles) {
                                            return (
                                              <>
                                                <Sparkles className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                                                <p className="text-gray-300 font-medium mb-1">Ready to create chord charts</p>
                                                <p className="text-gray-400 text-sm">
                                                  Click 'Create chord charts'
                                                </p>
                                              </>
                                            );
                                          } else {
                                            return (
                                              <>
                                                <Sparkles className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                                                <p className="text-gray-300 font-medium mb-1">Add a file, paste a YouTube URL, or type in the 'Manual entry' box, then click 'Create Chord Charts'</p>
                                                <p className="text-gray-400 text-xs">(The results will probably contain errors. Use the ✏️edit icon on a chart to correct it.)</p>
                                              </>
                                            );
                                          }
                                        })()}
                                      </>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  } else {
                    // Has existing charts - show replace option
                    return (
                      <div className="mb-4 flex justify-center">
                        <Button
                          variant="outline"
                          onClick={() => handleAutocreateClick(itemReferenceId)}
                          className="max-w-md text-orange-300 hover:bg-orange-800 hover:border-orange-600"
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          Replace with autocreated charts
                        </Button>
                      </div>
                    );
                  }
                })()}

                <div className="mb-4 flex justify-center">
                  <Button
                    variant="default"
                    onClick={() => {
                      setScrollBackContext({
                        itemId: itemReferenceId,
                        scrollPosition: window.scrollY
                      });
                      setShowChordEditor(prev => ({ ...prev, [itemReferenceId]: true }));
                      setTimeout(() => {
                        const editorElement = document.querySelector(`[data-editor-for-item="${itemReferenceId}"]`);
                        if (editorElement) {
                          editorElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                      }, 100);
                    }}
                    className="min-w-48"
                  >
                    + Add new chord
                  </Button>
                </div>

                <div className="mb-4 flex justify-center">
                  <Button
                    variant="default"
                    onClick={() => addNewSection(itemReferenceId)}
                    className="min-w-48"
                  >
                    + Add new section
                  </Button>
                </div>

                {/* Copy buttons - responsive: side-by-side on desktop, stacked on mobile */}
                <div className="flex flex-col sm:flex-row gap-2 mb-4 max-w-2xl mx-auto">
                  <Button
                    variant="default"
                    onClick={() => handleOpenCopyFromModal(itemReferenceId)}
                    className="flex-1"
                  >
                    Copy chord charts from other song
                  </Button>
                  <Button
                    variant="default"
                    onClick={() => handleOpenCopyModal(itemReferenceId)}
                    disabled={!chordCharts[itemReferenceId] || chordCharts[itemReferenceId].length === 0}
                    className="flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Copy chord charts to other song
                  </Button>
                </div>

                {/* Chord editor */}
                {showChordEditor[itemReferenceId] && (
                  <div data-editor-for-item={itemReferenceId}>
                    <ChordChartEditor
                    itemId={itemReferenceId}
                    defaultTuning={getItemDetails(itemReferenceId)?.H || 'EADGBE'}
                    editingChordId={editingChordId}
                    insertionContext={insertionContext}
                    onSave={(chartData) => handleSaveChordChart(itemReferenceId, chartData)}
                    onCancel={() => {
                      setShowChordEditor(prev => ({ ...prev, [itemReferenceId]: false }));
                      setEditingChordId(null);
                      setInsertionContext(null);

                      // Scroll back to the original chord chart location
                      scrollBackToChord();
                    }}
                  />
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* Modals */}
        {showAutocreateSuccessModal && (
          <AutocreateSuccessModal
            isOpen={showAutocreateSuccessModal}
            onClose={() => setShowAutocreateSuccessModal(false)}
          />
        )}

        {showCancelDialog && (
          <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel processing?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will stop the current autocreate operation. Any progress will be lost.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Continue processing</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (cancellingItemId) {
                      handleCancelAutocreate(cancellingItemId);
                    }
                    setShowCancelDialog(false);
                    setCancellingItemId(null);
                  }}
                >
                  Cancel processing
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {/* Delete Existing Chord Charts Modal (copied from PracticePage) */}
        {showDeleteChordsModal && (
          <AlertDialog open={showDeleteChordsModal} onOpenChange={setShowDeleteChordsModal}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center space-x-2">
                  <AlertTriangle className="h-5 w-5 text-orange-500" />
                  <span>Replace Existing Chord Charts</span>
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This song already has chord charts. To use autocreate, all existing chord charts must be deleted first.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => {
                  setShowDeleteChordsModal(false);
                  setDeleteModalItemId(null);
                }}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteExistingCharts}
                  className="bg-orange-500 hover:bg-orange-600 text-white border-orange-500 shadow-lg font-medium"
                >
                  Delete all & autocreate
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {/* API Error Modal */}
        <ApiErrorModal
          isOpen={showApiErrorModal}
          onClose={() => {
            setShowApiErrorModal(false);
            setApiError(null);
          }}
          error={apiError}
        />

        {/* Autocreate Success Modal */}
        <AutocreateSuccessModal
          isOpen={showAutocreateSuccessModal}
          onClose={() => {
            setShowAutocreateSuccessModal(false);
            setAutocreateSuccessData(null);
          }}
          autocreateData={autocreateSuccessData}
        />
      </DialogContent>
    </Dialog>

    {/* Copy Chord Charts Modal (copied from PracticePage) */}
    {showCopyModal && (
      <div
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]"
        onClick={handleCloseCopyModal}
      >
        <div
          className={`bg-gray-700 rounded-lg p-6 ${showOverwriteConfirmation || copyProgress === 'complete' ? 'max-w-xs' : 'w-full max-w-md'} max-h-[80vh] flex flex-col`}
          onClick={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          {copyProgress === 'complete' ? (
            <>
              <h2 className="text-xl font-bold text-white mb-4">
                Success!
              </h2>
              <div className="flex items-center justify-center space-x-2 mb-4">
                <Check className="h-6 w-6 text-green-500" />
                <span className="text-green-400 text-lg">Chord charts copied successfully!</span>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={handleCloseCopyModal}
                  className="min-w-24 bg-green-600 hover:bg-green-700"
                >
                  Done
                </Button>
              </div>
            </>
          ) : !showOverwriteConfirmation ? (
            <>
              <h2 className="text-xl font-bold text-white mb-4">
                Copy Chord Charts
              </h2>

              <p className="text-gray-300 mb-2">
                Copy chord charts from "{allItems?.find(item => item['B'] === copySourceItemId)?.['C'] || 'Unknown Song'}" to:
              </p>

              {/* Search field */}
              <input
                type="text"
                placeholder="Search songs..."
                value={copySearchTerm}
                onChange={(e) => setCopySearchTerm(e.target.value)}
                className="w-full p-2 mb-4 bg-gray-700 text-white rounded border border-gray-600 focus:border-purple-500"
              />

              {/* Scrollable song list */}
              <div className="flex-1 overflow-y-auto mb-4 min-h-0 modal-scroll">
                {sortedAndFilteredItems.map(item => (
                  <div key={item['A']} className="flex items-center mb-2">
                    <input
                      type="checkbox"
                      id={`copy-item-${item['A']}`}
                      checked={selectedTargetItems.has(item['A'])}
                      onChange={() => handleToggleTargetItem(item['A'])}
                      className="mr-3"
                    />
                    <label
                      htmlFor={`copy-item-${item['A']}`}
                      className="text-white cursor-pointer flex-1 flex items-center"
                    >
                      <span>{item['C'] || 'Untitled'}</span>
                      {itemsWithExistingCharts.has(item['A']) && (
                        <span className="text-yellow-400 ml-2 text-sm"> ⚠️will overwrite</span>
                      )}
                    </label>
                  </div>
                ))}
              </div>

              {/* Modal buttons */}
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={handleCloseCopyModal}
                  className="min-w-24"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirmCopy}
                  disabled={selectedTargetItems.size === 0}
                  style={selectedTargetItems.size === 0 ? {
                    backgroundColor: '#4b5563',
                    color: '#d1d5db',
                    opacity: '1'
                  } : itemsWithExistingCharts.size > 0 ? {
                    backgroundColor: '#dc2626',
                    color: '#ffffff',
                    opacity: '1'
                  } : {
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    opacity: '1'
                  }}
                  className="min-w-24 disabled:cursor-not-allowed"
                >
                  {itemsWithExistingCharts.size > 0
                    ? `Copy and Overwrite ${selectedTargetItems.size} song${selectedTargetItems.size !== 1 ? 's' : ''}`
                    : `Copy to ${selectedTargetItems.size} song${selectedTargetItems.size !== 1 ? 's' : ''}`
                  }
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold text-white mb-4">
                ⚠️ Confirm Overwrite
              </h2>
              <p className="text-gray-300 mb-4">
                This will overwrite existing chord charts on {itemsWithExistingCharts.size} song{itemsWithExistingCharts.size !== 1 ? 's' : ''}. Continue?
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setShowOverwriteConfirmation(false)}
                  className="min-w-24"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirmCopy}
                  className="min-w-24 bg-red-600 hover:bg-red-700"
                >
                  Overwrite
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    )}

    {/* Copy FROM modal */}
    {showCopyFromModal && (
      <div
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]"
        onClick={handleCloseCopyFromModal}
      >
        <div
          className={`bg-gray-700 rounded-lg p-6 ${copyFromShowOverwriteConfirmation || copyFromProgress === 'complete' ? 'max-w-xs' : 'w-full max-w-md'} max-h-[80vh] flex flex-col`}
          onClick={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          {copyFromProgress === 'complete' ? (
            <>
              <h2 className="text-xl font-bold text-white mb-4">
                Success!
              </h2>
              <div className="flex items-center justify-center space-x-2 mb-4">
                <Check className="h-6 w-6 text-green-500" />
                <span className="text-green-400 text-lg">Chord charts copied successfully!</span>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={handleCloseCopyFromModal}
                  className="min-w-24 bg-green-600 hover:bg-green-700"
                >
                  Done
                </Button>
              </div>
            </>
          ) : !copyFromShowOverwriteConfirmation ? (
            <>
              <h2 className="text-xl font-bold text-white mb-4">
                Copy chord charts from another song
              </h2>

              <p className="text-gray-300 mb-2">
                Select a song to copy chord charts from:
              </p>

              {/* Search field */}
              <input
                type="text"
                placeholder="Search songs..."
                value={copyFromSearchTerm}
                onChange={(e) => setCopyFromSearchTerm(e.target.value)}
                className="w-full p-2 mb-4 bg-gray-700 text-white rounded border border-gray-600 focus:border-purple-500"
              />

              {/* Scrollable song list - single select with radio buttons */}
              <div className="flex-1 overflow-y-auto mb-4 min-h-0 modal-scroll">
                {sortedAndFilteredCopyFromItems.length === 0 ? (
                  <p className="text-gray-400 text-sm italic text-center py-4">
                    No songs with chord charts found
                  </p>
                ) : (
                  sortedAndFilteredCopyFromItems.map(item => {
                    const chartCount = chordCharts[item['B']]?.length || 0;
                    return (
                      <div key={item['A']} className="flex items-center mb-2">
                        <input
                          type="radio"
                          name="copyFromSource"
                          id={`copy-from-item-${item['A']}`}
                          checked={selectedSourceItem === item['A']}
                          onChange={() => setSelectedSourceItem(item['A'])}
                          className="mr-3"
                        />
                        <label
                          htmlFor={`copy-from-item-${item['A']}`}
                          className="text-white cursor-pointer flex-1 flex items-center"
                        >
                          <span>{item['C'] || 'Untitled'}</span>
                          <span className="text-gray-400 ml-2 text-sm">({chartCount} chart{chartCount !== 1 ? 's' : ''})</span>
                        </label>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Modal buttons */}
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={handleCloseCopyFromModal}
                  className="min-w-24"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirmCopyFrom}
                  disabled={!selectedSourceItem}
                  style={!selectedSourceItem ? {
                    backgroundColor: '#4b5563',
                    color: '#d1d5db',
                    opacity: '1'
                  } : (chordCharts[itemId]?.length > 0) ? {
                    backgroundColor: '#dc2626',
                    color: '#ffffff',
                    opacity: '1'
                  } : {
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    opacity: '1'
                  }}
                  className="min-w-24 disabled:cursor-not-allowed"
                >
                  {(() => {
                    const sourceName = allItems?.find(item => item['A'] === selectedSourceItem)?.['C'] || '';
                    const hasExisting = chordCharts[itemId]?.length > 0;
                    if (!selectedSourceItem) return 'Select a song';
                    if (hasExisting) return `Copy and overwrite from "${sourceName}"`;
                    return `Copy from "${sourceName}"`;
                  })()}
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold text-white mb-4">
                Confirm overwrite
              </h2>
              <p className="text-gray-300 mb-4">
                This will overwrite the existing chord charts on "{itemTitle || itemId}". Continue?
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setCopyFromShowOverwriteConfirmation(false)}
                  className="min-w-24"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirmCopyFrom}
                  className="min-w-24 bg-red-600 hover:bg-red-700"
                >
                  Overwrite
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    )}
    </>
  );
}