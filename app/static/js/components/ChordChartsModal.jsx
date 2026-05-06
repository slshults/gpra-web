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

import { autocreateStore, fireAutocreateNotification } from '@utils/autocreateStore';
import { Button } from '@ui/button';
import { Check, Music, Upload, AlertTriangle, X, Wand, Sparkles, Loader2, Printer, Bell } from 'lucide-react';
import { ChordChartEditor } from './ChordChartEditor';
import ApiErrorModal, { resetRateLimitBackoff } from './ApiErrorModal';
import AutocreateSuccessModal from './AutocreateSuccessModal';
import UpsellAutocreateModal from './UpsellAutocreateModal';
import { useAutocreateAccess } from '@hooks/useAutocreateAccess';
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
        <div className="relative w-32 mx-auto flex items-center justify-center overflow-hidden rounded" style={{height: '184px'}}>
          <div
            ref={chartRef}
            className="w-full h-full"
          >
            {/* SVGuitar chart will be rendered here */}
          </div>
          {(() => {
            const d = chart.chordData || chart;
            const isVisuallyEmpty = !(d.fingers?.length || d.barres?.length || d.openStrings?.length || d.mutedStrings?.length) && chart.title?.trim();
            if (!isVisuallyEmpty) return null;
            const handleOverlayActivate = (e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowMenu(false);
              onEdit(chart.id, {
                title: chart.title,
                ...chart,
                sectionId: chart.sectionId,
                sectionLabel: chart.sectionLabel,
                sectionRepeatCount: chart.sectionRepeatCount
              });
            };
            return (
              <div
                role="button"
                tabIndex={0}
                onClick={handleOverlayActivate}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') handleOverlayActivate(e);
                }}
                className="absolute inset-0 bg-gray-900/80 rounded flex flex-col items-center justify-center text-center px-2 cursor-pointer z-10"
                aria-label="Create chord chart"
              >
                <div className="text-gray-300 text-[10px] leading-tight">No chord shape found</div>
                <div className="text-white text-xs font-semibold mt-1">Tap to create</div>
              </div>
            );
          })()}
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

  // Notification UX state
  const [notifyRequested, setNotifyRequested] = useState({});
  const [showNotifyInfoModal, setShowNotifyInfoModal] = useState(false);
  const [notifyPermissionDenied, setNotifyPermissionDenied] = useState({});

  // Queue gating state
  const [showQueueGateModal, setShowQueueGateModal] = useState(false);
  const [showQueueActiveItemModal, setShowQueueActiveItemModal] = useState(false);

  // Effort selector state
  const [showEffortSelector, setShowEffortSelector] = useState(false);
  const [selectedEffort, setSelectedEffort] = useState('medium');

  // Mixed content and unsupported format modals
  const [showMixedContentModal, setShowMixedContentModal] = useState(false);
  const [mixedContentData, setMixedContentData] = useState(null);
  const [showUnsupportedFormatModal, setShowUnsupportedFormatModal] = useState(false);
  const [unsupportedFormatData, setUnsupportedFormatData] = useState(null);

  // Mount tracking ref for safe state updates from async operations
  const isMountedRef = useRef(false);

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
    "Perfect chord charts take hours to craft. These will take less time. They won't be perfect.",
    "Yeah, I could show you a progress bar, but we both know it would just lie to you",
    "This is taking precisely as long as it needs to take",
    "Meanwhile, your guitar is getting dusty, just sitting there...",
    "Quality over speed, as they say in the chord chart business. We'll see which this turns out to be...",
    "Calculating the optimal finger placement for maximum laziness...",
    "Teaching AI to read guitar tabs is harder than teaching humans, surprisingly",
    "Processing at the speed of artisanal chord crafting",
    "Your patience is being converted into beautiful chord diagrams",
    "Still faster than drawing the chord charts by hand",
    "Fun fact: I process thousands of tokens per second, but this still takes a while.",
    "At least you're not on hold listening to elevator music right now",
    "I'd apologize for the wait, but I'm kinda busy building your chord charts",
    "Remember when you had to buy chord books? Yeah, this is still better than that",
    "I'm doing math that would make your guitar teacher's head spin.",
    "Analyzing fret positions with the intensity of a guitarist tuning by ear in a loud bar",
    "If you're wondering why this takes so long: perfectionism. JK, it's because of token processing limits.",
    "Good news: I found all the chords. Bad news: I'm still drawing the little dots",
    "Pro tip: This wait time is perfect for questioning the life choices that led you to learning Wonderwall",
    "Even if I could work faster, where would the suspense be in that?",
    "Automating what should have been automated decades ago...",
    "The AI is still thinking. Or maybe procrastinating. Hard to tell, really.",
    "Breaking news: Local AI still processing, guitarist growing older by the second",
    "This would go faster if you stopped watching. Seriously, go practice your scales or something.",
    "You could have practiced barre chords for 2 minutes by now.",
    "This is not the most interesting thing happening on your screen right now. Probably.",
    "Currently debating whether that's a Cadd9 or a smudge",
    "I'm zooming and enhancing like a detective in a crime show, except the crime is your handwriting",
    "Counting dots on a grid. This is what I went to AI school for.",
    "If I had fingers, I'd be playing these chords instead of drawing them",
    "Putting tiny dots on a grid so you don't have to",
    "String 6, fret 3... string 5, fret 2... string 4... oh sorry, I count out loud when I'm concentrating...",
    "Top of the grid is the nut. Have to remind myself every time.",
    "Reading the dots, not what I *think* the chord should be. There's a difference.",
    "If a chord comes out non-standard, that's probably correct. Probably.",
    "Counting fret lines... 1, 2, 3... is that a smudge or a fourth line? This is what I went to AI school for.",
    "Other AI assistants are out there writing poetry. I'm counting fret lines.",
    "There's a '7fr' in the corner of this one. Pretending I don't see it.",
    "You can fix any chord in about 4 seconds with the pencil icon, just FYI.",
    "Six strings, six strings, six strings. Don't let me forget.",
    "Drawing little numbers next to the dots — those are finger numbers. We've had musical notation for 400 years and we still need finger numbers.",
    "Negotiating with your pinky to see if it'll cooperate on that 4th-fret stretch",
    "That chord has like 47 valid voicings. I'm picking one. You're welcome.",
    "Tab purists are already mad at me and I haven't even finished yet",
    "Pretending I don't see that this whole thing would be easier with a capo on 2",
    "Translating 'how the song sounds' into 'where your fingers should go.' Surprisingly different languages.",
    "This one's a barre chord. I'm sorry in advance to your index finger.",
    "Could explain the harmonic theory behind this voicing, but you came here for the dots",
    "Don't tell anyone I had to double-check what a Cadd9/F# was",
    "Reminder: a chord chart is a polite suggestion, not a binding contract",
    "Your guitar teacher would have charged you for these by now",
    "Drawing chords that aren't power chords. Such variety. Much wow.",
    "Counting frets from the top, even though my training data keeps trying to count from the bottom"
  ];
  const [processingMessageIndex, setProcessingMessageIndex] = useState(0);
  const [_messageQueue, setMessageQueue] = useState([]);

  // Modal and copy states
  const [showApiErrorModal, setShowApiErrorModal] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [showAutocreateSuccessModal, setShowAutocreateSuccessModal] = useState(false);
  const [autocreateSuccessData, setAutocreateSuccessData] = useState(null);

  // Autocreate access gating (free tier without API key -> Claudeless UX)
  const { autocreateEnabled, loading: autocreateAccessLoading } = useAutocreateAccess();
  const showDisabledAutocreate = !autocreateAccessLoading && !autocreateEnabled;
  const [upsellModal, setUpsellModal] = useState({ open: false, trigger: null });
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
  }, [autocreateProgress, processingMessages.length]);

  // Mount/unmount tracking + restore state from autocreateStore
  useEffect(() => {
    isMountedRef.current = true;

    // Restore any active requests from the module-level store for this item
    const activeEntry = autocreateStore.getActive(itemId);
    if (activeEntry) {
      setAutocreateProgress(prev => ({ ...prev, [itemId]: 'processing' }));
      setShowAutocreateZone(prev => ({ ...prev, [itemId]: true }));
      if (activeEntry.notifyRequested) {
        setNotifyRequested(prev => ({ ...prev, [itemId]: true }));
      }
    }

    // Consume any completed requests for this item
    const completed = autocreateStore.consumeCompleted(itemId);
    if (completed) {
      if (completed.status === 'success') {
        const result = completed.result;
        setAutocreateSuccessData({
          itemName: result.itemName,
          chordCount: result.chordCount || 0,
          contentType: result.contentType || 'auto-detected',
          uploadedFileNames: result.uploadedFileNames || '',
          isVisionAnalysis: true
        });
        setShowAutocreateSuccessModal(true);
        // Refresh chord charts for this item
        (async () => {
          try {
            const response = await fetch(`/api/items/${itemId}/chord-charts`);
            if (response.ok) {
              const charts = await response.json();
              if (isMountedRef.current) {
                setChordCharts(prev => ({ ...prev, [itemId]: charts }));
                setChordSections(prev => ({ ...prev, [itemId]: buildSectionsFromCharts(charts) }));
              }
            }
          } catch (e) {
            debugLog('AUTOCREATE', 'Failed to refresh charts on remount:', e);
          }
        })();
      } else if (completed.status === 'error') {
        setApiError({ message: completed.result?.error || 'Autocreate failed. Please try again.' });
        setShowApiErrorModal(true);
      }
      // Clean up progress state
      setAutocreateProgress(prev => {
        const newState = { ...prev };
        delete newState[itemId];
        return newState;
      });
      setShowAutocreateZone(prev => ({ ...prev, [itemId]: false }));
    }

    return () => {
      isMountedRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleNotifyMe = async (notifyItemId) => {
    const itemName = itemTitle || `Item ${notifyItemId}`;

    // Track the event
    trackChordChartEvent('autocreate_notification_requested', itemName);

    // Check current permission status
    if (typeof Notification === 'undefined') {
      setNotifyPermissionDenied(prev => ({ ...prev, [notifyItemId]: true }));
      return;
    }

    if (Notification.permission === 'granted') {
      trackChordChartEvent('autocreate_notification_granted', itemName);
      autocreateStore.setNotifyRequested(notifyItemId);
      setNotifyRequested(prev => ({ ...prev, [notifyItemId]: true }));
      setShowNotifyInfoModal(true);
      return;
    }

    if (Notification.permission === 'denied') {
      trackChordChartEvent('autocreate_notification_denied', itemName);
      setNotifyPermissionDenied(prev => ({ ...prev, [notifyItemId]: true }));
      return;
    }

    // Request permission
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        trackChordChartEvent('autocreate_notification_granted', itemName);
        autocreateStore.setNotifyRequested(notifyItemId);
        setNotifyRequested(prev => ({ ...prev, [notifyItemId]: true }));
        setShowNotifyInfoModal(true);
      } else {
        trackChordChartEvent('autocreate_notification_denied', itemName);
        setNotifyPermissionDenied(prev => ({ ...prev, [notifyItemId]: true }));
      }
    } catch (e) {
      debugLog('NOTIFY', 'Permission request failed:', e);
      trackChordChartEvent('autocreate_notification_denied', itemName);
      setNotifyPermissionDenied(prev => ({ ...prev, [notifyItemId]: true }));
    }
  };

  const handleEffortConfirm = () => {
    const files = uploadedFiles[itemId] || [];
    const itemName = itemTitle || `Item ${itemId}`;
    trackChordChartEvent('autocreate_effort_selected', itemName, { effort_level: selectedEffort });
    setShowEffortSelector(false);
    handleFileDrop(itemId, files, selectedEffort);
  };

  const handleMixedContentChoice = async (contentType) => {
    if (!mixedContentData) return;

    const { itemId: mixedItemId, files } = mixedContentData;

    debugLog('AUTOCREATE', `handleMixedContentChoice called with contentType: ${contentType}, itemId: ${mixedItemId}, files:`, files.length);

    try {
      if (isMountedRef.current) {
        setAutocreateProgress(prev => ({ ...prev, [mixedItemId]: 'processing' }));
        setShowMixedContentModal(false);
      }

      // Create FormData and add user choice
      const formData = new FormData();
      files.forEach((file, index) => {
        const byteCharacters = atob(file.data);
        const byteNumbers = Array.from({ length: byteCharacters.length });
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const reconstructedFile = new File([byteArray], file.name, { type: file.media_type });
        formData.append(`file${index}`, reconstructedFile);
      });
      formData.append('itemId', mixedItemId);
      formData.append('userChoice', contentType);
      formData.append('effortLevel', selectedEffort);

      const response = await fetch('/api/autocreate-chord-charts', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        let errorMessage = 'Failed to process files';
        try {
          const errorData = await response.json();
          if (errorData.error) errorMessage = errorData.error;
          if (errorData.requires_api_key) {
            throw new Error('API_KEY_REQUIRED: ' + errorMessage);
          }
        } catch (parseError) {
          if (!parseError.message.startsWith('API_KEY_REQUIRED')) {
            console.warn('Could not parse error response:', parseError);
          } else {
            throw parseError;
          }
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      resetRateLimitBackoff();

      const itemName = itemTitle || `Item ${mixedItemId}`;
      trackChordChartEvent('autocreated', itemName, {
        file_count: result.file_count || 0,
        content_type: result.content_type || contentType,
        uploaded_file_names: result.uploaded_file_names || ''
      });

      if (isMountedRef.current) {
        setAutocreateSuccessData({
          itemName,
          chordCount: result.chord_count || 0,
          contentType: result.content_type || contentType,
          uploadedFileNames: result.uploaded_file_names || '',
          isVisionAnalysis: contentType === 'chord_charts'
        });
        setShowAutocreateSuccessModal(true);

        // Refresh chord charts
        const chartsResponse = await fetch(`/api/items/${mixedItemId}/chord-charts`);
        if (chartsResponse.ok) {
          const charts = await chartsResponse.json();
          setChordCharts(prev => ({ ...prev, [mixedItemId]: charts }));
          setChordSections(prev => ({ ...prev, [mixedItemId]: buildSectionsFromCharts(charts) }));
        }

        setTimeout(() => {
          if (isMountedRef.current) {
            setAutocreateProgress(prev => {
              const newState = { ...prev };
              delete newState[mixedItemId];
              return newState;
            });
            setShowAutocreateZone(prev => ({ ...prev, [mixedItemId]: false }));
          }
        }, 2000);
      }
    } catch (error) {
      console.error('Error processing mixed content choice:', error);
      if (isMountedRef.current) {
        const errorMsg = error.message || error.toString();
        if (errorMsg.startsWith('API_KEY_REQUIRED: ')) {
          setApiError({ message: errorMsg.replace('API_KEY_REQUIRED: ', ''), requiresApiKey: true });
        } else {
          setApiError({ message: errorMsg });
        }
        setShowApiErrorModal(true);
        setAutocreateProgress(prev => {
          const newState = { ...prev };
          delete newState[mixedItemId];
          return newState;
        });
      }
    }
  };

  const handleProcessFiles = async (processItemId) => {
    const files = uploadedFiles[processItemId] || [];
    const youtubeUrl = youtubeUrls[processItemId]?.trim();
    const manualChords = manualChordInput[processItemId]?.trim();

    debugLog('AUTOCREATE', `handleProcessFiles called for item ${processItemId}, files:`, files.length, 'youtubeUrl:', youtubeUrl, 'manualChords:', manualChords);

    // Handle YouTube URL if provided
    if (youtubeUrl) {
      await handleYouTubeUrl(processItemId, youtubeUrl);
      return;
    }

    // Handle manual chord input if provided
    if (manualChords) {
      if (validateManualChordInput(manualChords, processItemId)) {
        if (showDisabledAutocreate) {
          // Claudeless path — look up names in common_chords library
          await handleFromNamesSubmit(processItemId, manualChords);
        } else {
          await handleManualChordInput(processItemId, manualChords);
        }
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

    // Queue gate: only one visual analysis at a time
    const activeVisual = autocreateStore.getActiveVisualAnalysis();
    if (activeVisual && activeVisual.itemId !== processItemId) {
      const itemName = itemTitle || `Item ${processItemId}`;
      trackChordChartEvent('autocreate_queue_gate_hit', itemName);
      setShowQueueGateModal(true);
      return;
    }

    // Show effort selector before starting visual analysis
    setSelectedEffort('medium');
    setShowEffortSelector(true);
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

  // Claudeless path for free-tier users without an API key: looks up chord
  // names in the common_chords library and creates blank charts for unknowns.
  const handleFromNamesSubmit = async (itemId, chordInput) => {
    debugLog('AUTOCREATE', `Claudeless from-names submit for item ${itemId}:`, chordInput);

    const chordCountEstimate = chordInput
      .split(/[\s,\n\r]+/)
      .filter(word => /^[A-Ga-g][A-Za-z0-9#b♭♯/]*$/.test(word.trim()))
      .length;
    const hasLinebreaks = /[\n\r]/.test(chordInput);

    trackChordChartEvent('chord_charts_from_names_submitted', itemTitle || `Item ${itemId}`, {
      chord_count_estimate: chordCountEstimate,
      has_linebreaks: hasLinebreaks
    });

    setAutocreateProgress(prev => ({ ...prev, [itemId]: 'processing' }));

    try {
      const response = await fetch('/api/chord-charts/from-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, text: chordInput })
      });

      if (!response.ok) {
        let errorMessage = `Failed to create chord charts: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.error) errorMessage = errorData.error;
        } catch (e) {
          // ignore parse failure
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      debugLog('AUTOCREATE', 'from-names result:', result);

      resetRateLimitBackoff();

      // Refresh chord charts UI state
      const chartResponse = await fetch(`/api/items/${itemId}/chord-charts`);
      const charts = await chartResponse.json();

      setChordCharts(prev => ({ ...prev, [itemId]: charts }));
      setChordSections(prev => ({ ...prev, [itemId]: buildSectionsFromCharts(charts) }));

      // Clear the manual input
      setManualChordInput(prev => ({ ...prev, [itemId]: '' }));

      const missingChords = result.missing_chords || [];
      if (missingChords.length > 0) {
        trackChordChartEvent('chord_charts_from_names_chord_missed', itemTitle || `Item ${itemId}`, {
          missing_count: missingChords.length,
          missing_names: missingChords
        });
        const missingCount = missingChords.length;
        alert(`Created ${result.charts_created ?? result.chord_charts_created ?? charts.length} chord charts. ${missingCount} chord${missingCount === 1 ? '' : 's'} didn't match shapes in our library — tap any blank chart to fill it in.`);
      }

      setAutocreateProgress(prev => ({ ...prev, [itemId]: 'complete' }));

      const itemDetails = getItemDetails(itemId);
      setAutocreateSuccessData({
        itemName: itemDetails?.C || `Item ${itemId}`,
        chordCount: result.charts_created ?? result.chord_charts_created ?? charts.length,
        contentType: 'chord_names',
        uploadedFileNames: 'Manual entry',
        isVisionAnalysis: false
      });
      setShowAutocreateSuccessModal(true);

      setTimeout(() => {
        setAutocreateProgress(prev => ({ ...prev, [itemId]: null }));
        setShowAutocreateZone(prev => ({ ...prev, [itemId]: false }));
      }, 2000);

    } catch (error) {
      console.error('Error in handleFromNamesSubmit:', error);
      setApiError({ message: error.message || 'Failed to create chord charts. Please try again.' });
      setShowApiErrorModal(true);
      setAutocreateProgress(prev => {
        const newState = { ...prev };
        delete newState[itemId];
        return newState;
      });
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

  const handleFileDrop = (dropItemId, files, effortLevel = 'medium') => {
    if (!files || files.length === 0) return;

    // Validate file count
    if (files.length > 5) {
      alert('Maximum 5 files allowed. Please select fewer files.');
      return;
    }

    // Get item name for notifications before starting
    const itemName = itemTitle || `Item ${dropItemId}`;

    // Flag to prevent processing timer from firing after error
    let hasErrorOccurred = false;
    let processingTimer = null;

    setAutocreateProgress(prev => ({ ...prev, [dropItemId]: 'uploading' }));

    // Create abort controller for this request
    const abortController = new AbortController();
    setAutocreateAbortController(prev => ({ ...prev, [dropItemId]: abortController }));

    // Register in module-level store (persists across unmount/remount)
    autocreateStore.startRequest(dropItemId, itemName, abortController, 'visual_analysis');

    const formData = new FormData();
    Array.from(files).forEach((file, index) => {
      formData.append(`file${index}`, file);
    });
    formData.append('itemId', dropItemId);
    formData.append('effortLevel', effortLevel);

    // Show uploading for minimum 2 seconds, then switch to processing
    const minDisplayTime = 2000;

    processingTimer = setTimeout(() => {
      if (!hasErrorOccurred) {
        if (isMountedRef.current) {
          setAutocreateProgress(prev => ({ ...prev, [dropItemId]: 'processing' }));
        }
      }
    }, minDisplayTime);

    // Use Promise chain instead of await so it runs even if component unmounts
    fetch('/api/autocreate-chord-charts', {
      method: 'POST',
      body: formData,
      signal: abortController.signal
    })
      .then(response => {
        if (!response.ok) {
          return response.json().then(errorData => {
            throw new Error(errorData.error || 'Failed to process files');
          });
        }
        return response.json();
      })
      .then(result => {
        // Check if user needs to choose between mixed content types
        if (result.needs_user_choice) {
          autocreateStore.clearRequest(dropItemId);
          if (isMountedRef.current) {
            setMixedContentData({
              itemId: dropItemId,
              options: result.mixed_content_options || [],
              files: result.files || []
            });
            setShowMixedContentModal(true);
            setAutocreateProgress(prev => {
              const newState = { ...prev };
              delete newState[dropItemId];
              return newState;
            });
          }
          return;
        }

        // Check for unsupported file formats
        if (result.error === 'unsupported_format') {
          autocreateStore.clearRequest(dropItemId);
          if (isMountedRef.current) {
            setUnsupportedFormatData({
              message: result.message,
              title: result.title
            });
            setShowUnsupportedFormatModal(true);
            setAutocreateProgress(prev => {
              const newState = { ...prev };
              delete newState[dropItemId];
              return newState;
            });
          }
          return;
        }

        // Reset rate limit backoff on success
        resetRateLimitBackoff();
        if (processingTimer) clearTimeout(processingTimer);

        // Track autocreate chord charts success
        trackChordChartEvent('autocreated', itemName, {
          file_count: result.file_count || 0,
          content_type: result.content_type || 'auto-detected',
          uploaded_file_names: result.uploaded_file_names || ''
        });

        // Fire browser notification if user opted in (works even when unmounted)
        const storeEntry = autocreateStore.getActive(dropItemId);
        if (storeEntry?.notifyRequested) {
          fireAutocreateNotification(
            'Chord charts ready!',
            `${itemName} has new chord charts.`
          );
        }

        // Update module-level store with success (handledInline = true if component is mounted)
        autocreateStore.completeRequest(dropItemId, 'success', {
          itemName,
          chordCount: result.chord_count || 0,
          chordLoadFailures: result.chord_load_failures || 0,
          contentType: result.content_type || 'auto-detected',
          uploadedFileNames: result.uploaded_file_names || '',
          isVisionAnalysis: result.content_type === 'chord_charts' || result.used_vision_analysis === true || (!result.content_type && result.used_vision_analysis !== false)
        }, isMountedRef.current);

        // Only update React state if component is still mounted
        if (isMountedRef.current) {
          setAutocreateProgress(prev => ({ ...prev, [dropItemId]: 'complete' }));

          setAutocreateSuccessData({
            itemName,
            chordCount: result.chord_count || 0,
            chordLoadFailures: result.chord_load_failures || 0,
            contentType: result.content_type || 'auto-detected',
            uploadedFileNames: result.uploaded_file_names || '',
            isVisionAnalysis: result.content_type === 'chord_charts' || result.used_vision_analysis === true || (!result.content_type && result.used_vision_analysis !== false)
          });
          setShowAutocreateSuccessModal(true);

          // Force refresh chord charts for this item
          fetch(`/api/items/${dropItemId}/chord-charts`)
            .then(resp => resp.ok ? resp.json() : Promise.reject('Failed to fetch charts'))
            .then(charts => {
              if (isMountedRef.current) {
                setChordCharts(prev => ({ ...prev, [dropItemId]: charts }));
                setChordSections(prev => ({ ...prev, [dropItemId]: buildSectionsFromCharts(charts) }));
              }
            })
            .catch(err => console.error('Failed to refresh chord charts after autocreate:', err));

          // Clear progress and close autocreate zone after a delay
          setTimeout(() => {
            if (isMountedRef.current) {
              setAutocreateProgress(prev => {
                const newState = { ...prev };
                delete newState[dropItemId];
                return newState;
              });
              setShowAutocreateZone(prev => ({ ...prev, [dropItemId]: false }));
              setAutocreateAbortController(prev => {
                const newState = { ...prev };
                delete newState[dropItemId];
                return newState;
              });
              setUploadedFiles(prev => {
                const newState = { ...prev };
                delete newState[dropItemId];
                return newState;
              });
              setNotifyRequested(prev => {
                const newState = { ...prev };
                delete newState[dropItemId];
                return newState;
              });
            }
          }, 5000);
        }
      })
      .catch(error => {
        // Prevent the processing timer from firing after error
        hasErrorOccurred = true;
        if (processingTimer) clearTimeout(processingTimer);

        if (error.name === 'AbortError') {
          debugLog('AUTOCREATE', 'Request was cancelled by user');
          autocreateStore.cancelRequest(dropItemId);
          return;
        }

        console.error('Error in autocreate:', error);

        const errorMsg = error.message || error.toString();

        // Fire error notification if user opted in (works even when unmounted)
        const storeEntry = autocreateStore.getActive(dropItemId);
        if (storeEntry?.notifyRequested) {
          fireAutocreateNotification(
            'Autocreate failed',
            `Autocreate failed for ${itemName}. Please try again.`
          );
        }

        // Update module-level store with error (handledInline = true if component is mounted)
        autocreateStore.completeRequest(dropItemId, 'error', { error: errorMsg, itemName }, isMountedRef.current);

        // Only update React state if component is still mounted
        if (!isMountedRef.current) return;

        // Check for API key required error first
        if (errorMsg.startsWith('API_KEY_REQUIRED: ')) {
          const message = errorMsg.replace('API_KEY_REQUIRED: ', '');
          setApiError({
            message: message,
            requiresApiKey: true
          });
          setShowApiErrorModal(true);
          setAutocreateProgress(prev => {
            const newState = { ...prev };
            delete newState[dropItemId];
            return newState;
          });
        } else if (errorMsg.includes('529') || errorMsg.includes('overloaded') ||
            errorMsg.includes('429') || errorMsg.includes('rate limit') ||
            errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503') ||
            errorMsg.includes('timeout')) {
          setApiError(error);
          setShowApiErrorModal(true);
          setAutocreateProgress(prev => {
            const newState = { ...prev };
            delete newState[dropItemId];
            return newState;
          });
        } else {
          setAutocreateProgress(prev => ({ ...prev, [dropItemId]: 'error' }));
        }

        // Clear error state after delay (only for generic errors)
        if (!(errorMsg.includes('529') || errorMsg.includes('overloaded') ||
              errorMsg.includes('429') || errorMsg.includes('rate limit') ||
              errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503') ||
              errorMsg.includes('timeout'))) {
          setTimeout(() => {
            if (isMountedRef.current) {
              setAutocreateProgress(prev => {
                const newState = { ...prev };
                delete newState[dropItemId];
                return newState;
              });
              setAutocreateAbortController(prev => {
                const newState = { ...prev };
                delete newState[dropItemId];
                return newState;
              });
            }
          }, 5000);
        }
      });
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
  const handleCancelAutocreate = (cancelItemId) => {
    // Cancel the request if it's in progress
    if (autocreateAbortController[cancelItemId]) {
      autocreateAbortController[cancelItemId].abort();
    }
    // Also cancel in the module-level store
    autocreateStore.cancelRequest(cancelItemId);

    // Reset all state for this item
    setAutocreateProgress(prev => {
      const newState = { ...prev };
      delete newState[cancelItemId];
      return newState;
    });
    setAutocreateAbortController(prev => {
      const newState = { ...prev };
      delete newState[cancelItemId];
      return newState;
    });
    setUploadedFiles(prev => {
      const newState = { ...prev };
      delete newState[cancelItemId];
      return newState;
    });
    setNotifyRequested(prev => {
      const newState = { ...prev };
      delete newState[cancelItemId];
      return newState;
    });
    setNotifyPermissionDenied(prev => {
      const newState = { ...prev };
      delete newState[cancelItemId];
      return newState;
    });
    setYoutubeUrls(prev => ({
      ...prev,
      [cancelItemId]: ''
    }));
    setManualChordInput(prev => ({
      ...prev,
      [cancelItemId]: ''
    }));
    setShowAutocreateZone(prev => ({ ...prev, [cancelItemId]: false }));
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
      <DialogContent className="max-w-[95vw] sm:max-w-2xl md:max-w-3xl lg:max-w-4xl max-h-[90vh] overflow-y-auto" modalName="Chord charts">
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
                                    {showDisabledAutocreate ? (
                                      <div
                                        className="flex-1 p-4 border-2 border-dashed rounded-lg opacity-50 cursor-not-allowed border-gray-600 bg-gray-800/10 relative"
                                        onDragOver={(e) => { e.preventDefault(); }}
                                        onDrop={(e) => {
                                          e.preventDefault();
                                          setUpsellModal({ open: true, trigger: 'upload' });
                                        }}
                                        onClick={() => setUpsellModal({ open: true, trigger: 'upload' })}
                                      >
                                        <div className="text-center">
                                          <Upload className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                                          <p className="text-sm font-medium mb-2 text-gray-300">Drop files or click</p>
                                          <p className="text-gray-400 text-xs mb-2">PDFs, images • 5mb max</p>
                                          <span className="inline-block mt-1 text-[10px] uppercase tracking-wide bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded px-2 py-0.5">
                                            Upgrade required
                                          </span>
                                        </div>
                                      </div>
                                    ) : (
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
                                          const activeVisual = autocreateStore.getActiveVisualAnalysis();
                                          if (activeVisual && activeVisual.itemId !== itemReferenceId) {
                                            setShowQueueGateModal(true);
                                            return;
                                          }
                                          handleSingleFileDrop(itemReferenceId, e.dataTransfer.files);
                                        }}
                                        onClick={() => {
                                          const activeVisual = autocreateStore.getActiveVisualAnalysis();
                                          if (activeVisual && activeVisual.itemId !== itemReferenceId) {
                                            setShowQueueGateModal(true);
                                            return;
                                          }
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
                                    )}
                                  </div>

                                  {/* Column 2: YouTube URL - wrapped in form for Enter key support */}
                                  <div className="flex flex-col">
                                    <div className="text-center mb-2">
                                      <p className="text-gray-400 text-sm font-medium">YouTube guitar lesson</p>
                                      <p className="text-gray-500 text-xs">(video must have a transcript)</p>
                                    </div>
                                    {showDisabledAutocreate ? (
                                      <div
                                        className="flex-1 flex flex-col justify-center opacity-50 cursor-not-allowed"
                                        onClick={() => setUpsellModal({ open: true, trigger: 'youtube' })}
                                      >
                                        <input
                                          type="url"
                                          placeholder="Paste YouTube URL"
                                          readOnly
                                          onFocus={(e) => {
                                            e.target.blur();
                                            setUpsellModal({ open: true, trigger: 'youtube' });
                                          }}
                                          className="w-full p-3 bg-gray-700 text-white rounded border-2 border-gray-600 text-sm cursor-not-allowed"
                                        />
                                        <div className="text-center mt-2">
                                          <span className="inline-block text-[10px] uppercase tracking-wide bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded px-2 py-0.5">
                                            Upgrade required
                                          </span>
                                        </div>
                                      </div>
                                    ) : (
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
                                    )}
                                  </div>

                                  {/* Column 3: Manual Chord Input */}
                                  <div className="flex flex-col">
                                    <div className="text-center mb-2">
                                      <p className="text-gray-400 text-sm font-medium">Manual entry</p>
                                    </div>
                                    <div className="flex-1 flex flex-col justify-center relative">
                                      <textarea
                                        placeholder={showDisabledAutocreate
                                          ? "Type chord names separated commas. 'Enter' for line breaks.\nExample:\nG, C, Am, F\nD, Em, D"
                                          : "Enter song section names and chord names, like this:\nIntro\nAm7 Em/A E7sus\nVerse\nC G/B Am (space or comma-separated)"}
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
                                      {showDisabledAutocreate && (
                                        <div className="mt-2 text-xs text-gray-400">
                                          We'll look up each chord in our library of common shapes. Unknown ones get a blank chart you can fill in.
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
                                  <div className="space-y-3" role="status" aria-live="polite">
                                    <div className="flex items-center justify-center space-x-2">
                                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-500" aria-hidden="true"></div>
                                      <div className="flex items-center">
                                        <span className="text-white">{processingMessages[processingMessageIndex]}</span>
                                        <div className="ml-2 animate-spin" aria-hidden="true">⚙️</div>
                                      </div>
                                    </div>

                                    {/* Notification UX - only shows for visual analysis */}
                                    {autocreateStore.getActive(itemReferenceId) && (
                                    <div className="mt-4 text-center space-y-3">
                                      <p className="text-gray-400 text-sm px-4">
                                        You don't have to keep watching. You can go build other stuff while you wait.
                                        <br />
                                        Check back in 10 or 15 minutes, and/or hit the button:
                                      </p>

                                      {notifyPermissionDenied[itemReferenceId] ? (
                                        <div className="inline-block rounded-md bg-gray-700/50 border border-gray-600 px-4 py-2">
                                          <p className="text-gray-400 text-sm">Check back in 10-15 minutes</p>
                                        </div>
                                      ) : notifyRequested[itemReferenceId] ? (
                                        <div className="inline-block rounded-md bg-indigo-900/40 border border-indigo-600/50 px-4 py-2">
                                          <p className="text-indigo-300 text-sm">We'll try to notify you</p>
                                          <p className="text-indigo-300 text-sm">when the charts are ready</p>
                                        </div>
                                      ) : (
                                        <div className="flex justify-center">
                                          <Button
                                            size="sm"
                                            onClick={() => handleNotifyMe(itemReferenceId)}
                                            className="bg-indigo-600 hover:bg-indigo-700 text-white"
                                            title="Get notified on this device when the charts are ready for this item."
                                          >
                                            <Bell className="h-3 w-3 mr-1" />
                                            Notify me
                                          </Button>
                                        </div>
                                      )}
                                    </div>
                                    )}

                                    <div className="flex justify-center pt-1">
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
                    disabled={!!autocreateProgress[itemReferenceId] && autocreateProgress[itemReferenceId] !== 'complete'}
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
                    className="min-w-48 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    + Add new chord
                  </Button>
                </div>

                <div className="mb-4 flex justify-center">
                  <Button
                    variant="default"
                    disabled={!!autocreateProgress[itemReferenceId] && autocreateProgress[itemReferenceId] !== 'complete'}
                    onClick={() => addNewSection(itemReferenceId)}
                    className="min-w-48 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    + Add new section
                  </Button>
                </div>

                {/* Copy buttons - responsive: side-by-side on desktop, stacked on mobile */}
                <div className="flex flex-col sm:flex-row gap-2 mb-4 max-w-2xl mx-auto">
                  <Button
                    variant="default"
                    disabled={!!autocreateProgress[itemReferenceId] && autocreateProgress[itemReferenceId] !== 'complete'}
                    onClick={() => handleOpenCopyFromModal(itemReferenceId)}
                    className="flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Copy chord charts from other song
                  </Button>
                  <Button
                    variant="default"
                    onClick={() => handleOpenCopyModal(itemReferenceId)}
                    disabled={(!chordCharts[itemReferenceId] || chordCharts[itemReferenceId].length === 0) || (!!autocreateProgress[itemReferenceId] && autocreateProgress[itemReferenceId] !== 'complete')}
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

        {/* Autocreate Upsell Modal (free tier without API key) */}
        <UpsellAutocreateModal
          isOpen={upsellModal.open}
          onClose={() => setUpsellModal({ open: false, trigger: null })}
          trigger={upsellModal.trigger}
        />

        {/* Notification info modal */}
        <Dialog open={showNotifyInfoModal} onOpenChange={setShowNotifyInfoModal}>
          <DialogContent modalName="autocreate-notify-info-modal" className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Notifications enabled</DialogTitle>
              <DialogDescription>
                You can go to other pages and check back in 10 or 15 minutes.
                <br /><br />
                We'll try to notify you on this device when the chord charts are ready.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end">
              <Button onClick={() => setShowNotifyInfoModal(false)}>
                Ok
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Queue gate modal - shown when user tries to start a second visual analysis */}
        <Dialog open={showQueueGateModal} onOpenChange={setShowQueueGateModal}>
          <DialogContent modalName="autocreate-queue-gate-modal" className="max-w-md">
            <DialogHeader>
              <DialogTitle>One at a time</DialogTitle>
              <DialogDescription asChild>
                <div>
                  <p>
                    Sorry, we can only handle one pdf or image at a time, and you still have{' '}
                    <button
                      className="text-blue-400 hover:text-blue-300 underline cursor-pointer bg-transparent border-none p-0 font-inherit"
                      onClick={() => {
                        setShowQueueGateModal(false);
                        setShowQueueActiveItemModal(true);
                      }}
                    >
                      one running
                    </button>
                    . You can still build chord charts with YouTube lesson URLs, or build charts manually on other items while you wait.
                  </p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end">
              <Button onClick={() => setShowQueueGateModal(false)}>
                Ok
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Queue active item modal - shows which item is currently processing */}
        <Dialog open={showQueueActiveItemModal} onOpenChange={setShowQueueActiveItemModal}>
          <DialogContent modalName="autocreate-queue-active-item-modal" className="max-w-md">
            <DialogHeader>
              <DialogTitle>In progress</DialogTitle>
              <DialogDescription asChild>
                <div>
                  {(() => {
                    const activeVisual = autocreateStore.getActiveVisualAnalysis();
                    return activeVisual ? (
                      <p>
                        Currently creating chord charts for: <strong>{activeVisual.itemName}</strong>
                      </p>
                    ) : (
                      <p>No visual analysis currently running.</p>
                    );
                  })()}
                </div>
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowQueueActiveItemModal(false)}>
                Keep waiting
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const activeVisual = autocreateStore.getActiveVisualAnalysis();
                  if (activeVisual) {
                    setShowQueueActiveItemModal(false);
                    handleShowCancelConfirmation(activeVisual.itemId);
                  }
                }}
              >
                Cancel autocreate
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Effort selector modal - shown before starting visual analysis */}
        <Dialog open={showEffortSelector} onOpenChange={(open) => {
          if (!open) {
            setShowEffortSelector(false);
          }
        }}>
          <DialogContent modalName="autocreate-effort-selector-modal" className="max-w-md">
            <DialogHeader>
              <DialogTitle>Pick your speed</DialogTitle>
              <DialogDescription className="text-gray-400 text-sm">
                You can leave the page to work on other stuff while you wait. Claude will do his best at any setting, but you'll likely need to fix a chart or two when it's done. (tap any chart's pencil icon to fix it.)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-600 hover:border-gray-500 cursor-pointer transition-colors"
                onClick={() => setSelectedEffort('low')}>
                <input type="radio" name="effort-modal" value="low"
                  checked={selectedEffort === 'low'}
                  onChange={() => setSelectedEffort('low')}
                  className="mt-1 text-indigo-500 focus:ring-indigo-500" />
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-white font-medium">Quick</span>
                    <span className="text-gray-400 text-sm">~1–2 min</span>
                  </div>
                  <div className="text-gray-400 text-xs mt-0.5">Fast and loose. Some finger markers may be in the wrong place, but you can fix them yourself.</div>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-lg border border-indigo-500/60 bg-indigo-500/5 hover:border-indigo-400 cursor-pointer transition-colors"
                onClick={() => setSelectedEffort('medium')}>
                <input type="radio" name="effort-modal" value="medium"
                  checked={selectedEffort === 'medium'}
                  onChange={() => setSelectedEffort('medium')}
                  className="mt-1 text-indigo-500 focus:ring-indigo-500" />
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-white font-medium">Balanced</span>
                    <span className="text-gray-400 text-sm">~2–5 min</span>
                    <span className="text-indigo-300 text-xs ml-auto px-2 py-0.5 bg-indigo-500/20 rounded">Recommended</span>
                  </div>
                  <div className="text-gray-400 text-xs mt-0.5">Better accuracy, just takes a bit longer.</div>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-600 hover:border-gray-500 cursor-pointer transition-colors"
                onClick={() => setSelectedEffort('high')}>
                <input type="radio" name="effort-modal" value="high"
                  checked={selectedEffort === 'high'}
                  onChange={() => setSelectedEffort('high')}
                  className="mt-1 text-indigo-500 focus:ring-indigo-500" />
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-white font-medium">Thorough</span>
                    <span className="text-gray-400 text-sm">~5–15 min</span>
                  </div>
                  <div className="text-gray-400 text-xs mt-0.5">Thinking goes to 11. Can help with dense or unusual layout, or with crappy image files. Sometimes overthinks it though.</div>
                </div>
              </label>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleEffortConfirm}>
                <Wand className="h-4 w-4 mr-2" />
                Create charts
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Mixed content modal */}
        <AlertDialog open={showMixedContentModal} onOpenChange={setShowMixedContentModal}>
          <AlertDialogContent className="w-80 min-h-[600px]">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center space-x-2">
                <AlertTriangle className="h-5 w-5 text-blue-500" />
                <span>Mixed Content Detected</span>
              </AlertDialogTitle>
              <AlertDialogDescription>
                Your file contains both chord names and chord charts. How would you like to process it?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-4 my-8">
              <AlertDialogAction
                onClick={() => handleMixedContentChoice('chord_names')}
                className="w-full h-auto p-6 flex flex-col items-center bg-slate-700 hover:bg-slate-600 text-white"
              >
                <div className="font-medium">Process Chord Names</div>
                <div className="text-sm text-slate-300 mt-1">(standard tuning)</div>
              </AlertDialogAction>
              <AlertDialogAction
                onClick={() => handleMixedContentChoice('chord_charts')}
                className="w-full p-4 bg-slate-700 hover:bg-slate-600 text-white"
              >
                Import chord charts
              </AlertDialogAction>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => {
                setShowMixedContentModal(false);
                setMixedContentData(null);
              }}>
                Cancel
              </AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Unsupported format modal */}
        <AlertDialog open={showUnsupportedFormatModal} onOpenChange={setShowUnsupportedFormatModal}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center space-x-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <span>{unsupportedFormatData?.title || 'Format Not Supported'}</span>
              </AlertDialogTitle>
              <AlertDialogDescription>
                {unsupportedFormatData?.message || 'Sorry, we can only build chord charts. This file format is not supported.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={() => {
                setShowUnsupportedFormatModal(false);
                setUnsupportedFormatData(null);
              }}>
                OK
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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