import React, { useEffect, useCallback, useState, useRef, useMemo, memo } from 'react';
import { trackPracticeEvent, trackActiveRoutine, trackChordChartEvent, trackSongbookLinkClick } from '../utils/analytics';
import { supportsFolderOpening, isMobileDevice, getFileManagerName } from '../utils/platform';

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
import { Button } from '@ui/button';
import { useActiveRoutine } from '@hooks/useActiveRoutine';
import { useItemDetails } from '@hooks/useItemDetails';
import { usePracticeItems } from '@hooks/usePracticeItems';
import { useNavigation } from '@contexts/NavigationContext';
import { ChevronDown, ChevronRight, Check, Plus, FileText, Book, Music, Upload, AlertTriangle, X, Wand, Sparkles, Loader2, Printer } from 'lucide-react';
import { NoteEditor } from './NoteEditor';
import { ChordChartEditor } from './ChordChartEditor';
import ApiErrorModal from './ApiErrorModal';
import AutocreateSuccessModal from './AutocreateSuccessModal';
import { serverDebug, serverInfo } from '../utils/logging';
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

// Data transformation no longer needed - DataLayer returns proper format directly

// Custom Play icon with solid triangle
const PlayIcon = ({ className }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    className={className}
  >
    <path d="M8 5v14l11-7z" />
  </svg>
);

// Custom Pause icon with solid bars
const PauseIcon = ({ className }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    className={className}
  >
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);

// Custom Reset icon
const ResetIcon = ({ className }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    className={className}
  >
    <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
  </svg>
);

// Format seconds to MM:SS
const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Format minutes to HH:MM
const formatHoursAndMinutes = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};

// Memoized chord chart component that only re-renders when chord data changes
const MemoizedChordChart = memo(({ chart, onEdit, onDelete, onInsertAfter }) => {
  const chartRef = useRef(null);
  
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
          width: 220,             // Match editor dimensions
          height: 310,            // Match editor dimensions
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

        // Style the SVG to fit the container and add accessibility attributes
        setTimeout(() => {
          const svg = chartRef.current?.querySelector('svg');
          if (svg) {
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.style.maxWidth = '180px';
            svg.style.maxHeight = '192px';
            svg.style.position = 'relative';
            svg.style.zIndex = '1';

            // Add accessibility attributes
            svg.setAttribute('role', 'img');
            svg.setAttribute('aria-label', generateChordDescription(chart));
          }
        }, 50);
      } catch (error) {
        console.error('Error rendering memoized chord chart:', error);
      }
    };

    renderChart();
  }, [chart]); // Only re-render when chart data changes

  return (
    <div
      className="bg-gray-800 p-1 rounded-lg relative"
      data-chord-id={chart.id}
      style={{
        minWidth: '0',
        maxWidth: '100%',
        width: '100%',
        position: 'relative'
      }}
    >
      {/* Edit button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onEdit(chart.id, chart);
        }}
        className="absolute bottom-1 left-1 w-6 h-6 text-gray-400 hover:text-gray-200 flex items-center justify-center text-sm transition-colors cursor-pointer z-20 bg-gray-900 bg-opacity-75 rounded shadow-lg"
        title="Edit chord chart"
        style={{
          position: 'absolute',
          bottom: '4px',
          left: '4px',
          zIndex: 20
        }}
        aria-label="Edit chord chart"
      >
        ✏️
      </button>

      {/* Delete button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(chart.id);
        }}
        className="absolute bottom-1 right-1 w-6 h-6 text-red-500 hover:text-red-700 flex items-center justify-center text-lg font-black transition-colors cursor-pointer z-20 bg-gray-900 bg-opacity-75 rounded shadow-lg"
        title="Delete chord chart"
        style={{
          position: 'absolute',
          bottom: '4px',
          right: '4px',
          zIndex: 20
        }}
        aria-label="Delete chord chart"
      >
        ×
      </button>

      {/* Insert after button */}
      {onInsertAfter && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onInsertAfter(chart.id, chart);
          }}
          className="absolute bottom-1 right-8 w-6 h-6 bg-blue-500 hover:bg-blue-400 text-white rounded-full flex items-center justify-center text-sm font-bold transition-colors cursor-pointer z-20 shadow-lg"
          title="Insert chord after this one"
          style={{
            position: 'absolute',
            bottom: '4px',
            right: '32px',
            zIndex: 20
          }}
          aria-label="Insert chord after this one"
        >
          +
        </button>
      )}
      
      <div className="relative mx-auto flex items-center justify-center overflow-hidden" style={{width: '180px', height: '192px'}}>
        <div
          ref={chartRef}
          className="w-full h-full"
        >
          {/* SVGuitar chart will be rendered here */}
        </div>
      </div>
      <div className="text-sm font-semibold mt-2 text-center text-gray-300">{chart.title}</div>
    </div>
  );
});

// Helper function to generate accessible description for chord charts
const generateChordDescription = (chart) => {
  const actualChartData = chart.chordData || chart;
  const title = chart.title || 'Chord';

  // Build description parts
  const parts = [`${title} chord diagram.`];

  // Describe finger positions
  const fingers = actualChartData.fingers || [];
  if (fingers.length > 0) {
    const fingerPositions = fingers.map(finger => {
      const [string, fret, fingerNum] = finger;
      const stringNum = 7 - string; // Convert to 1-indexed from high to low (string 1 = high E)
      const fingerText = fingerNum ? ` with finger ${fingerNum}` : '';
      return `string ${stringNum} fret ${fret}${fingerText}`;
    });
    parts.push(`Finger positions: ${fingerPositions.join(', ')}.`);
  }

  // Describe open strings
  const openStrings = actualChartData.openStrings || [];
  if (openStrings.length > 0) {
    const openStringNums = openStrings.map(s => 7 - s).sort((a, b) => a - b);
    parts.push(`Open strings: ${openStringNums.join(', ')}.`);
  }

  // Describe muted strings
  const mutedStrings = actualChartData.mutedStrings || [];
  if (mutedStrings.length > 0) {
    const mutedStringNums = mutedStrings.map(s => 7 - s).sort((a, b) => a - b);
    parts.push(`Muted strings: ${mutedStringNums.join(', ')}.`);
  }

  // Describe barres
  const barres = actualChartData.barres || [];
  if (barres.length > 0) {
    const barreDescriptions = barres.map(barre => {
      const fromString = 7 - barre.fromString;
      const toString = 7 - barre.toString;
      return `Barre at fret ${barre.fret} from string ${fromString} to ${toString}`;
    });
    parts.push(`${barreDescriptions.join('. ')}.`);
  }

  return parts.join(' ');
};

// Helper functions for copy modal fuzzy matching (outside component to avoid re-creation)
// Text normalization function for consistent matching
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
  console.log('DEBUG: findSimilarSongs - sourceTitle:', sourceTitle, '-> baseName:', baseName, '-> normalized:', normalizedBaseName);
  
  return allItems.filter(item => {
    // Skip the source item itself
    // sourceItemId is Item ID (Column B), so compare with item['B']
    if (item['B'] === sourceItemId) return false;
    
    const itemTitle = item['C'] || '';
    const itemBaseName = extractBaseSongName(itemTitle);
    const normalizedItemBaseName = normalizeText(itemBaseName);
    
    // FIXED: More precise similarity matching - require significant overlap
    // Only match if the normalized base names are identical OR one is a substantial subset of the other
    const matches = normalizedBaseName === normalizedItemBaseName ||
                   (normalizedBaseName.length > 3 && normalizedItemBaseName.includes(normalizedBaseName)) ||
                   (normalizedItemBaseName.length > 3 && normalizedBaseName.includes(normalizedItemBaseName));
    
    // Debug logging for potential matches
    if (itemTitle.toLowerCase().includes('feelin') || itemTitle.toLowerCase().includes('alright')) {
      console.log('DEBUG: Checking item:', itemTitle, '-> itemBaseName:', itemBaseName, '-> normalized:', normalizedItemBaseName, '-> matches:', matches);
      console.log('  normalizedBaseName:', normalizedBaseName);
      console.log('  normalizedItemBaseName:', normalizedItemBaseName);
    }
    
    return matches;
  });
};

export const PracticePage = () => {
  const { routine } = useActiveRoutine();
  const { fetchItemDetails, getItemDetails, isLoadingItem } = useItemDetails();
  useNavigation();
  
  const { items: allItems } = usePracticeItems();
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [expandedNotes, setExpandedNotes] = useState(new Set());
  const [activeTimers, setActiveTimers] = useState(new Set());
  const [notes, setNotes] = useState({});
  const [isNoteEditorOpen, setIsNoteEditorOpen] = useState(false);
  const [editingNoteItemId, setEditingNoteItemId] = useState(null);
  const [timers, setTimers] = useState({});
  const [expandedChords, setExpandedChords] = useState(new Set());
  const [chordCharts, setChordCharts] = useState({});
  const [showChordEditor, setShowChordEditor] = useState({});

  // Section management state
  const [chordSections, setChordSections] = useState({});
  const [deletingSection, setDeletingSection] = useState(new Set());
  const [editingChordId, setEditingChordId] = useState(null);
  const [insertionContext, setInsertionContext] = useState(null);
  const [scrollBackContext, setScrollBackContext] = useState(null);
  
  // Chord chart copy modal state
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copySourceItemId, setCopySourceItemId] = useState(null);
  const [copySearchTerm, setCopySearchTerm] = useState('');
  const [selectedTargetItems, setSelectedTargetItems] = useState(new Set());
  const [itemsWithExistingCharts, setItemsWithExistingCharts] = useState(new Set());
  const [showOverwriteConfirmation, setShowOverwriteConfirmation] = useState(false);
  
  // Autocreate chord charts from files
  const [showDeleteChordsModal, setShowDeleteChordsModal] = useState(false);
  const [deleteModalItemId, setDeleteModalItemId] = useState(null);
  const [autocreateProgress, setAutocreateProgress] = useState({});
  const [copyProgress, setCopyProgress] = useState(null);

  // Copy from modal state
  const [showCopyFromModal, setShowCopyFromModal] = useState(false);
  const [copyFromSearchTerm, setCopyFromSearchTerm] = useState('');
  const [selectedSourceItem, setSelectedSourceItem] = useState(null);
  const [copyFromTargetItemId, setCopyFromTargetItemId] = useState(null);
  const [isDragActive, setIsDragActive] = useState({});
  const [showAutocreateZone, setShowAutocreateZone] = useState({});
  const [autocreateAbortController, setAutocreateAbortController] = useState({});
  const [processingMessageIndex, setProcessingMessageIndex] = useState(0);
// oxlint-disable-next-line no-unused-vars
  const [messageQueue, setMessageQueue] = useState([]);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);

  // Songbook folder path copy modal state
  const [showFolderPathModal, setShowFolderPathModal] = useState(false);
  const [copiedFolderPath, setCopiedFolderPath] = useState('');
  const [pendingCancelItemId, setPendingCancelItemId] = useState(null);
  
  // Single file tracking for all uploaded files
  const [uploadedFiles, setUploadedFiles] = useState({});
  const [showMixedContentModal, setShowMixedContentModal] = useState(false);
  const [mixedContentData, setMixedContentData] = useState(null);
  const [showUnsupportedFormatModal, setShowUnsupportedFormatModal] = useState(false);
  const [unsupportedFormatData, setUnsupportedFormatData] = useState(null);
  
  // API Error modal state
  const [showApiErrorModal, setShowApiErrorModal] = useState(false);
  const [apiError, setApiError] = useState(null);

  // Autocreate Success modal state
  const [showAutocreateSuccessModal, setShowAutocreateSuccessModal] = useState(false);
  const [autocreateSuccessData, setAutocreateSuccessData] = useState(null);

  // YouTube URL state for transcript-based chord creation
  const [youtubeUrls, setYoutubeUrls] = useState({});
  const [manualChordInput, setManualChordInput] = useState({});
  const [manualInputErrors, setManualInputErrors] = useState({});
  const [showNoTranscriptModal, setShowNoTranscriptModal] = useState(false);
  const [noTranscriptData, setNoTranscriptData] = useState(null);
  const [manualTranscript, setManualTranscript] = useState('');

  // No chord names found modal state
  const [showNoChordNamesModal, setShowNoChordNamesModal] = useState(false);

  // Notification state - use ref for immediate updates
  const notifyOnCompleteRef = useRef({});
  const [notificationConfirmMessage, setNotificationConfirmMessage] = useState(null);
  const [originalTitle, setOriginalTitle] = useState(null);

  // Rotating processing messages for entertainment
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
    "Yeah, I could show you a progress bar, but we both know it would just lie to you",
    "This is taking precisely as long as it needs to take",
    "Meanwhile, your guitar is getting dusty just sitting there...",
    "Quality over speed, as they say in the chord chart business. We'll see which this turns out to be",
    "Calculating the optimal finger placement for maximum laziness...",
    "Teaching AI to read guitar tabs is harder than teaching humans, surprisingly",
    "Processing at the speed of artisanal chord crafting",
    "Your patience is being converted into beautiful chord diagrams",
    "Still faster than drawing the chord charts by hand",
    "Fun fact: I process thousands of tokens per second, but this still takes a while. Go figure.",
    "At least you're not on hold listening to elevator music right now",
    "I'd apologize for the wait, but I'm kinda busy with building your chord charts",
    "Remember when you had to buy chord books? Yeah, this is still better than that",
    "I'm doing math that would make your guitar teacher's head spin. Or maybe just mild geometry.",
    "Analyzing fret positions with the intensity of a guitarist tuning by ear in a loud bar",
    "If you're wondering why this takes so long: perfectionism. Just kidding, it's token processing limits.",
    "Good news: I found all the chords. Bad news: I'm still drawing the little dots",
    "Pro tip: This wait time is perfect for questioning your life choices that led to learning Wonderwall",
    "Yes, I could work faster, but then where would the suspense be?",
    "Translating guitar hieroglyphics into something your fingers can actually use...",
    "Automating what should have been automated decades ago. You're welcome.",
    "The AI is thinking. Or maybe procrastinating. Hard to tell, really.",
    "Breaking news: Local AI still processing, guitarist growing older by the second",
    "This would go faster if you stopped watching. Seriously, go practice your scales or something.",
    "Reminder: You could have practiced barre chords for 2 minutes by now. Just saying.",
    "I promise this is the most interesting thing happening on your screen right now. Probably.",
    "Currently debating whether that's a Cadd9 or just someone's finger slipped on the photo"
  ];

  // Request notification permission and set up completion notification
  const handleNotifyRequest = async (itemId) => {
    console.log('[NOTIFY] Notification button clicked for itemId:', itemId);

    // Always enable title notification - use ref for immediate updates
    notifyOnCompleteRef.current[itemId] = true;
    setNotificationConfirmMessage(itemId);
    console.log('[NOTIFY] Notification enabled for itemId:', itemId);
    console.log('[NOTIFY] Current ref state:', notifyOnCompleteRef.current);

    // Clear the confirmation message after 10 seconds
    setTimeout(() => {
      setNotificationConfirmMessage(null);
    }, 10000);

    // Also request browser notification permission if supported
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        console.log('[NOTIFY] Requesting browser notification permission...');
        await Notification.requestPermission();
      } catch (error) {
        console.error('[NOTIFY] Error requesting notification permission:', error);
      }
    }
  };

  // Send notification when charts are ready (browser notification + title flash)
  const sendCompletionNotification = (itemName) => {
    console.log('[NOTIFY] Attempting to send notification for:', itemName);

    // Change page title to notify user
    if (!originalTitle) {
      setOriginalTitle(document.title);
    }
    document.title = '🎸 Chord charts ready!';
    console.log('[NOTIFY] Changed title to: Chord charts ready!');

    // Also try browser notification if supported
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        console.log('[NOTIFY] Creating browser notification...');
        new Notification('Chord charts ready! 🎸', {
          body: `Your chord charts for "${itemName}" are finally ready!`,
          icon: '/static/favicon.ico',
          tag: 'chord-charts-ready'
        });
        console.log('[NOTIFY] Browser notification created successfully');
      } catch (error) {
        console.error('[NOTIFY] Error sending browser notification:', error);
      }
    }
  };

  // Restore original title on any user interaction
  const restoreTitle = useCallback(() => {
    if (originalTitle) {
      document.title = originalTitle;
      setOriginalTitle(null);
      console.log('[NOTIFY] Restored original title');
    }
  }, [originalTitle]);

  // Add click listener to restore title on any user interaction
  useEffect(() => {
    if (originalTitle) {
      const handleClick = () => restoreTitle();
      document.addEventListener('click', handleClick);
      document.addEventListener('keydown', handleClick);

      return () => {
        document.removeEventListener('click', handleClick);
        document.removeEventListener('keydown', handleClick);
      };
    }
  }, [originalTitle, restoreTitle]);

  // Helper function to group chords into sections based on persisted metadata
  const getChordSections = (itemId) => {
    const charts = chordCharts[itemId] || [];
    
    console.log(`[DEBUG] getChordSections for item ${itemId}:`, charts);
    
    if (charts.length === 0) {
      return [];
    }
    
    // Group chords by their section metadata
    const sectionMap = new Map();
    
    charts.forEach(chart => {
      const sectionId = chart.sectionId || 'section-1';
      const sectionLabel = chart.sectionLabel || 'Verse';
      const sectionRepeatCount = chart.sectionRepeatCount || '';
      
      console.log(`[DEBUG] Processing chord ${chart.id} (${chart.title}) for section ${sectionId}`, {
        chordSectionId: chart.sectionId, 
        chordSectionLabel: chart.sectionLabel,
        fallbackUsed: !chart.sectionId
      });
      
      if (!sectionMap.has(sectionId)) {
        sectionMap.set(sectionId, {
          id: sectionId,
          label: sectionLabel,
          repeatCount: sectionRepeatCount,
          chords: []
        });
      }
      
      sectionMap.get(sectionId).chords.push(chart);
    });
    
    // Convert map to array and sort by section creation order
    const sections = Array.from(sectionMap.values());
    
    
    return sections;
  };

  // Helper function to build sections from charts array (used after autocreate)
  const buildSectionsFromCharts = (charts) => {
    if (charts.length === 0) {
      return [];
    }
    
    // Group chords by their section metadata
    const sectionMap = new Map();
    
    charts.forEach(chart => {
      const sectionId = chart.sectionId || 'section-1';
      const sectionLabel = chart.sectionLabel || 'Verse';
      const sectionRepeatCount = chart.sectionRepeatCount || '';
      
      if (!sectionMap.has(sectionId)) {
        sectionMap.set(sectionId, {
          id: sectionId,
          label: sectionLabel,
          repeatCount: sectionRepeatCount,
          chords: []
        });
      }
      
      sectionMap.get(sectionId).chords.push(chart);
    });
    
    // Convert to array and sort sections by the order of their first chord
    const sections = Array.from(sectionMap.values()).sort((a, b) => {
      const aMinOrder = Math.min(...a.chords.map(c => c.order || 0));
      const bMinOrder = Math.min(...b.chords.map(c => c.order || 0));
      return aMinOrder - bMinOrder;
    });
    
    // Sort chords within each section by order
    sections.forEach(section => {
      section.chords.sort((a, b) => (a.order || 0) - (b.order || 0));
    });
    
    return sections;
  };

  // Combined function to get both persisted and temporary sections

  // Function to add a new section
  const addNewSection = (itemId, label = 'New Section') => {
    console.log('Adding new section for item:', itemId, 'with label:', label);
    
    const newSection = {
      id: `section-${Date.now()}`,
      label,
      repeatCount: '',
      chords: []
    };
    
    setChordSections(prev => {
      const updated = {
        ...prev,
        [itemId]: [...(prev[itemId] || []), newSection]
      };
      console.log('Updated chordSections:', updated);
      return updated;
    });
  };


  // Debounced version of updateSection for real-time typing
  const debouncedUpdateSection = useCallback(
    debounce(async (itemId, sectionId, updates) => {
      console.log('Debounced section update:', sectionId, updates);
      
      try {
        // Fetch fresh chord charts from the backend to avoid stale state issues
        const response = await fetch(`/api/items/${itemId}/chord-charts`);
        if (!response.ok) {
          throw new Error(`Failed to fetch chord charts for item ${itemId}`);
        }
        const freshCharts = await response.json();
        
        // DataLayer now returns proper format directly
        const transformedFreshCharts = freshCharts;
        
        console.log(`[DEBUG] Fresh charts for item ${itemId}:`, transformedFreshCharts.map(c => ({
          id: c.id, 
          title: c.title, 
          sectionId: c.sectionId || 'default-section'
        })));
        
        // Get all chord charts for this section that need to be updated
        const chartsToUpdate = transformedFreshCharts.filter(chart => 
          (chart.sectionId || 'section-1') === sectionId
        );
        
        if (chartsToUpdate.length === 0) {
          console.log(`No chord charts to update for section: ${sectionId}. This might be a new section without any chord charts yet.`);
          return;
        }
        
        console.log(`Updating ${chartsToUpdate.length} chord charts for section ${sectionId}:`, chartsToUpdate.map(c => c.id));
        
        // Update each chord chart in the backend
        const updatePromises = chartsToUpdate.map(chart => {
          const updateData = {};
          if (updates.label !== undefined) {
            updateData.sectionLabel = updates.label;
          }
          if (updates.repeatCount !== undefined) {
            updateData.sectionRepeatCount = updates.repeatCount;
          }
          
          console.log(`Updating chord chart ${chart.id} with:`, updateData);
          
          return fetch(`/api/chord-charts/${chart.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
          }).then(response => {
            if (!response.ok) {
              throw new Error(`Failed to update chord chart ${chart.id}: ${response.status} ${response.statusText}`);
            }
            return response.json();
          });
        });
        
        await Promise.all(updatePromises);
        console.log(`Successfully persisted ${chartsToUpdate.length} chord charts for section ${sectionId}`);
        
      } catch (error) {
        console.error('Error persisting section updates:', error);
      }
    }, 500), // 500ms delay
    [] // Remove chordCharts dependency to avoid stale closures
  );

  // Fast local-only section update for immediate UI feedback
  const updateSectionLocal = (itemId, sectionId, updates) => {
    // Update the section in local state immediately
    setChordSections(prev => ({
      ...prev,
      [itemId]: (prev[itemId] || []).map(section =>
        section.id === sectionId ? { ...section, ...updates } : section
      )
    }));
    
    // Update chord charts in local state immediately
    setChordCharts(prev => ({
      ...prev,
      [itemId]: (prev[itemId] || []).map(chart => {
        if ((chart.sectionId || 'section-1') === sectionId) {
          return {
            ...chart,
            sectionLabel: updates.label !== undefined ? updates.label : chart.sectionLabel,
            sectionRepeatCount: updates.repeatCount !== undefined ? updates.repeatCount : chart.sectionRepeatCount
          };
        }
        return chart;
      })
    }));
    
    // Debounce the backend update
    debouncedUpdateSection(itemId, sectionId, updates);
  };

  const deleteSection = async (itemId, sectionId) => {
    // Validate itemId
    if (!itemId) {
      console.error('ERROR: deleteSection called with empty itemId', { itemId, sectionId });
      return;
    }

    // Prevent double-clicking/double-triggering
    const sectionKey = `${itemId}-${sectionId}`;
    if (deletingSection.has(sectionKey)) {
      console.log(`Delete already in progress for section ${sectionId}`);
      return;
    }

    setDeletingSection(prev => new Set([...prev, sectionKey]));

    try {
      // Get all chord charts in this section
      const chartsToDelete = (chordCharts[itemId] || []).filter(chart => 
        (chart.sectionId || 'section-1') === sectionId
      );
      
      if (chartsToDelete.length === 0) {
        console.log(`No chord charts to delete in section ${sectionId}`);
        // Just remove the empty section from local state
        setChordSections(prev => ({
          ...prev,
          [itemId]: (prev[itemId] || []).filter(section => section.id !== sectionId)
        }));
        return;
      }
      
      const chordIds = chartsToDelete.map(chart => chart.id);
      console.log(`Batch deleting ${chartsToDelete.length} chord charts from section ${sectionId}:`, chordIds);
      console.log(`DEBUG: Sending item_id=${itemId} to batch-delete endpoint`);

      // Use batch delete endpoint
      const response = await fetch('/api/chord-charts/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chord_ids: chordIds,
          item_id: itemId  // Add item context for sharing-aware deletion
        })
      });

      if (!response.ok) {
        if (response.status === 429) {
          const errorData = await response.json();
          console.warn('Rate limit exceeded, will retry after delay');
          // Show user-friendly message for rate limits
          alert(`Rate limit exceeded. Please wait a moment and try again. (${errorData.error})`);
          return;
        }
        throw new Error(`HTTP ${response.status}: Failed to batch delete chord charts`);
      }

      const result = await response.json();
      console.log('Batch delete result:', result);

      // Handle partial successes
      if (result.deleted && result.deleted.length > 0) {
        console.log(`Successfully deleted ${result.deleted.length} chord charts`);
      }
      
      if (result.not_found && result.not_found.length > 0) {
        console.warn(`${result.not_found.length} chord charts were already deleted:`, result.not_found);
      }
      
      if (result.failed && result.failed.length > 0) {
        console.error(`Failed to delete ${result.failed.length} chord charts:`, result.failed);
      }

      // Always update local state optimistically (backend handles partial failures)
      // Remove chord charts from local state
      setChordCharts(prev => ({
        ...prev,
        [itemId]: (prev[itemId] || []).filter(chart => 
          (chart.sectionId || 'section-1') !== sectionId
        )
      }));
      
      // Remove section from local state
      setChordSections(prev => ({
        ...prev,
        [itemId]: (prev[itemId] || []).filter(section => section.id !== sectionId)
      }));

      // Only throw if batch delete completely failed
      if (!result.success && result.failed && result.failed.length === chordIds.length) {
        throw new Error(result.error || 'All chord chart deletions failed');
      }
      
    } catch (error) {
      console.error('Error deleting section:', error);
      // TODO: Add user-visible error notification
    } finally {
      // Always clear the deleting state
      setDeletingSection(prev => {
        const next = new Set(prev);
        next.delete(sectionKey);
        return next;
      });
    }
  };



  // Lazy-load chord charts only when chord section is expanded
  // Batch load chord charts for all items in the routine
  const loadAllChordCharts = useCallback(async () => {
    console.log('[DEBUG BATCH] loadAllChordCharts called');
    if (!routine || !routine.items) return;
    
    // Get all item IDs that need chord charts loaded
    const allItemIds = routine.items.map(item => item['B']);
    const itemIds = allItemIds.filter(itemId => !chordCharts[itemId]); // Only load if not already loaded
    console.log('[DEBUG BATCH] All routine items:', allItemIds, 'Items needing loading:', itemIds, 'Current chordCharts keys:', Object.keys(chordCharts));
    
    if (itemIds.length === 0) return;
    
    try {
      const response = await fetch('/api/chord-charts/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_ids: itemIds })
      });
      
      if (response.ok) {
        const batchResults = await response.json();
        
        // DataLayer now returns proper format directly
        const transformedBatchResults = batchResults;
        
        // Update chord charts state with all results
        setChordCharts(prev => ({
          ...prev,
          ...transformedBatchResults
        }));
        
        // Build sections for each item using existing getChordSections logic
        Object.entries(transformedBatchResults).forEach(([itemId, charts]) => {
          if (charts.length === 0) {
            setChordSections(prev => ({
              ...prev,
              [itemId]: []
            }));
          } else {
            // Group chords by their section metadata (same logic as getChordSections)
            const sectionMap = new Map();
            
            charts.forEach(chart => {
              const sectionId = chart.sectionId || 'section-1';
              const sectionLabel = chart.sectionLabel || 'Verse';
              const sectionRepeatCount = chart.sectionRepeatCount || '';
              
              if (!sectionMap.has(sectionId)) {
                sectionMap.set(sectionId, {
                  id: sectionId,
                  label: sectionLabel,
                  repeatCount: sectionRepeatCount,
                  chords: []
                });
              }
              
              sectionMap.get(sectionId).chords.push(chart);
            });
            
            const sections = Array.from(sectionMap.values());
            setChordSections(prev => ({
              ...prev,
              [itemId]: sections
            }));
          }
        });
      }
    } catch (error) {
      console.error('Error batch loading chord charts:', error);
    }
  }, [routine]);
  
  // Batch load chord charts when routine changes
  useEffect(() => {
    console.log('[DEBUG EFFECT] useEffect triggered for routine/loadAllChordCharts');
    if (routine && routine.items) {
      loadAllChordCharts();
      // Track active routine when practice page is visited
      trackActiveRoutine(routine.name);
    }
  }, [routine, loadAllChordCharts]);

  
  // Detect items with existing chord charts for overwrite warnings
  useEffect(() => {
    if (selectedTargetItems.size > 0) {
      const itemsWithCharts = new Set();
      selectedTargetItems.forEach(itemId => {
        // itemId is the primary key (Column A), but chord charts are stored by ItemID (Column B)
        const targetItem = allItems?.find(item => item['A'] === itemId);
        const itemReferenceId = targetItem?.['B'];
        const existingCharts = chordCharts[itemReferenceId] || [];
        if (existingCharts.length > 0) {
          itemsWithCharts.add(itemId);
        }
      });
      setItemsWithExistingCharts(itemsWithCharts);
    } else {
      setItemsWithExistingCharts(new Set());
    }
  }, [selectedTargetItems, chordCharts, allItems]);
  
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
  
  const loadChordChartsForItem = async (itemReferenceId) => {
    // Skip if already loaded
    if (chordCharts[itemReferenceId]) {
      return;
    }
    
    try {
      const response = await fetch(`/api/items/${itemReferenceId}/chord-charts`);
      if (response.ok) {
        const charts = await response.json();
        
        // DataLayer now returns proper format directly
        const transformedCharts = charts;
        
        // Update chord charts state
        setChordCharts(prev => ({
          ...prev,
          [itemReferenceId]: transformedCharts
        }));
        
        // Build sections from loaded chord charts
        if (transformedCharts.length === 0) {
          setChordSections(prev => ({
            ...prev,
            [itemReferenceId]: []
          }));
          return;
        }
        
        // Group chords by their section metadata
        const sectionMap = new Map();
        
        transformedCharts.forEach(chart => {
          const sectionId = chart.sectionId || 'section-1';
          const sectionLabel = chart.sectionLabel || 'Verse';
          const sectionRepeatCount = chart.sectionRepeatCount || '';
          
          if (!sectionMap.has(sectionId)) {
            sectionMap.set(sectionId, {
              id: sectionId,
              label: sectionLabel,
              repeatCount: sectionRepeatCount,
              chords: []
            });
          }
          
          sectionMap.get(sectionId).chords.push(chart);
        });
        
        // Update sections state
        setChordSections(prev => ({
          ...prev,
          [itemReferenceId]: Array.from(sectionMap.values())
        }));
        
        console.log('[DEBUG] Loaded chord charts for item:', itemReferenceId, charts.length);
      }
    } catch (error) {
      console.error('Error loading chord charts for item:', itemReferenceId, error);
    }
  };
  
  const completedItemIds = useMemo(() => {
    if (routine?.items) {
      return new Set(
        routine.items
          .filter(item => item['D'] === 'TRUE')  // Column D is completed status
          .map(item => item['A'])  // Column A is routine entry ID
      );
    }
    return new Set();
  }, [routine]);

  const [completedItems, setCompletedItems] = useState(new Set());

  // Create audio context for timer completion sound
  const audioContext = useRef(null);
  const gainNode = useRef(null);
  const timerSound = useRef(null);
  const audioBuffer = useRef(null);

  // Initialize Web Audio API context and nodes
  useEffect(() => {
    audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
    
    // Create gain node
    gainNode.current = audioContext.current.createGain();
    gainNode.current.gain.value = 3.0;  // Competing with electric guitar! 🎸

    // Connect nodes
    gainNode.current.connect(audioContext.current.destination);

    // Load and decode audio file
    fetch('/static/sound/timesUp.mp3')
      .then(response => response.arrayBuffer())
      .then(arrayBuffer => audioContext.current.decodeAudioData(arrayBuffer))
      .then(decodedBuffer => {
        audioBuffer.current = decodedBuffer;
      })
      .catch(e => console.error('Error loading sound:', e));

    return () => {
      if (audioContext.current) {
        audioContext.current.close();
      }
    };
  }, []);

  // Timer countdown effect
  useEffect(() => {
    const interval = setInterval(() => {
      setTimers(prev => {
        const next = { ...prev };
        let changed = false;
        activeTimers.forEach(itemId => {
          if (next[itemId] > 0) {
            next[itemId] = next[itemId] - 1;
            changed = true;
            
            // Play sound when timer hits zero
            if (next[itemId] === 0) {
              // Stop any currently playing sound
              if (timerSound.current) {
                timerSound.current.stop();
              }
              
              // Create and play new sound using Web Audio API
              if (audioBuffer.current && audioContext.current) {
                timerSound.current = audioContext.current.createBufferSource();
                timerSound.current.buffer = audioBuffer.current;
                timerSound.current.connect(gainNode.current);
                timerSound.current.start();
              }
            }
          }
        });
        return changed ? next : prev;
      });
    }, 1000);

    console.log('Timer effect: Active timers:', Array.from(activeTimers));
    return () => {
      clearInterval(interval);
      // Clean up audio if it's playing
      if (timerSound.current) {
        timerSound.current.stop();
        timerSound.current = null;
      }
    };
  }, [activeTimers]);

  // Effect to sync completedItems with completedItemIds when routine changes  
  useEffect(() => {
    setCompletedItems(completedItemIds);
  }, [completedItemIds]);

  // Fetch notes for an item
  const fetchNotes = useCallback(async (itemId) => {
    try {
      const response = await fetch(`/api/items/${itemId}/notes`);
      if (!response.ok) throw new Error('Failed to fetch notes');
      const data = await response.json();
      if (data.notes) {
        setNotes(prev => ({
          ...prev,
          [itemId]: data.notes
        }));
      }
    } catch (error) {
      console.error('Error fetching notes:', error);
    }
  }, []);


  // Memoized similar items calculation for copy modal
  // FIXED: Remove getItemDetails dependency to prevent unnecessary recalculations during search
  const similarItemIds = useMemo(() => {
    if (!copySourceItemId || !allItems) return new Set();
    
    // Get source item directly from allItems instead of using getItemDetails
    // This prevents recalculation when getItemDetails recreates due to cache changes
    // copySourceItemId is Item ID (Column B), so find by item['B']
    const sourceItem = allItems.find(item => item['B'] === copySourceItemId);
    const sourceTitle = sourceItem?.['C'] || '';
    const allFilteredItems = allItems.filter(item => item['B'] !== copySourceItemId);
    
    return new Set(
      findSimilarSongs(sourceTitle, allFilteredItems, copySourceItemId).map(item => item['A'])
    );
  }, [copySourceItemId, allItems]);

  // Memoized filtered and sorted items for copy modal
  const sortedAndFilteredItems = useMemo(() => {
    if (!allItems) return [];
    
    return allItems
      .filter(item => {
        // Filter out the source item
        // copySourceItemId is Item ID (Column B), so compare with item['B']
        if (item['B'] === copySourceItemId) return false;
        
        // Filter by search term
        if (copySearchTerm.trim()) {
          const title = item['C'] || '';
          
          const normalizedTitle = normalizeText(title);
          const normalizedSearch = normalizeText(copySearchTerm);
          
          // Handle empty search after normalization
          if (!normalizedSearch) return true;
          
          console.log(`DEBUG SEARCH: "${copySearchTerm}" -> "${normalizedSearch}" searching in "${title}" -> "${normalizedTitle}" -> match: ${normalizedTitle.includes(normalizedSearch)}`);
          
          return normalizedTitle.includes(normalizedSearch);
        }
        
        return true;
      })
      .sort((a, b) => {
        // If there's an active search term, only sort alphabetically to respect search results
        if (copySearchTerm.trim()) {
          const aTitle = a['C'] || '';
          const bTitle = b['C'] || '';
          return aTitle.localeCompare(bTitle);
        }
        
        // Check if items are similar to source using pre-calculated set
        const aIsSimilar = similarItemIds.has(a['A']);
        const bIsSimilar = similarItemIds.has(b['A']);
        
        // Sort similar songs to the top (only when no search term)
        if (aIsSimilar && !bIsSimilar) return -1;
        if (!aIsSimilar && bIsSimilar) return 1;
        
        // Within each group (similar/non-similar), sort alphabetically
        const aTitle = a['C'] || '';
        const bTitle = b['C'] || '';
        return aTitle.localeCompare(bTitle);
      });
  }, [allItems, copySourceItemId, copySearchTerm, similarItemIds]);

  // Memoized similar items calculation for copy FROM modal (copied from working copy TO logic)
  const similarItemIdsForCopyFrom = useMemo(() => {
    if (!copyFromTargetItemId || !allItems) return new Set();

    // Get target item for "copy from" modal - copyFromTargetItemId is the destination
    const targetItem = allItems.find(item => item['B'] === copyFromTargetItemId);
    const targetTitle = targetItem?.['C'] || '';
    const allFilteredItems = allItems.filter(item => item['B'] !== copyFromTargetItemId);

    return new Set(
      findSimilarSongs(targetTitle, allFilteredItems, copyFromTargetItemId).map(item => item['A'])
    );
  }, [copyFromTargetItemId, allItems]);

  // Filtered and sorted items for copy FROM modal (copied from working copy TO logic)
  const sortedAndFilteredCopyFromItems = useMemo(() => {
    if (!allItems) return [];

    return allItems
      .filter(item => {
        // Filter out the target item
        if (item['B'] === copyFromTargetItemId) return false;

        // Filter by search term
        if (copyFromSearchTerm.trim()) {
          const title = item['C'] || '';

          const normalizedTitle = normalizeText(title);
          const normalizedSearch = normalizeText(copyFromSearchTerm);

          // Handle empty search after normalization
          if (!normalizedSearch) return true;

          return normalizedTitle.includes(normalizedSearch);
        }

        return true;
      })
      .sort((a, b) => {
        // If there's an active search term, only sort alphabetically to respect search results
        if (copyFromSearchTerm.trim()) {
          const aTitle = a['C'] || '';
          const bTitle = b['C'] || '';
          return aTitle.localeCompare(bTitle);
        }

        // Check if items are similar to target using pre-calculated set
        const aIsSimilar = similarItemIdsForCopyFrom.has(a['A']);
        const bIsSimilar = similarItemIdsForCopyFrom.has(b['A']);

        // Sort similar songs to the top (only when no search term)
        if (aIsSimilar && !bIsSimilar) return -1;
        if (!aIsSimilar && bIsSimilar) return 1;

        // Within each group (similar/non-similar), sort alphabetically
        const aTitle = a['C'] || '';
        const bTitle = b['C'] || '';
        return aTitle.localeCompare(bTitle);
      });
  }, [allItems, copyFromTargetItemId, copyFromSearchTerm, similarItemIdsForCopyFrom]);

  // State to track chord chart counts for all items (for Copy FROM modal)
  const [allItemChordCounts, setAllItemChordCounts] = useState({});

  // Load chord chart counts for all items when Copy FROM modal opens
  useEffect(() => {
    if (showCopyFromModal && allItems && Object.keys(allItemChordCounts).length === 0) {
      const loadAllChordCounts = async () => {
        const counts = {};

        // Get all unique item IDs
        const itemIds = allItems.map(item => item['B']);

        try {
          // Use batch API to get chord charts efficiently
          const response = await fetch('/api/chord-charts/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_ids: itemIds })
          });

          if (response.ok) {
            const batchResults = await response.json();

            // Count charts for each item
            Object.entries(batchResults).forEach(([itemId, charts]) => {
              counts[itemId] = (charts || []).length;
            });

            setAllItemChordCounts(counts);
          }
        } catch (error) {
          console.error('Error loading chord chart counts:', error);
        }
      };

      loadAllChordCounts();
    }
  }, [showCopyFromModal, allItems, allItemChordCounts]);

  // Apply chord chart filtering using the loaded counts
  const copyFromItemsWithCharts = useMemo(() => {
    return sortedAndFilteredCopyFromItems.filter(item => {
      const itemReferenceId = item['B'];
      return allItemChordCounts[itemReferenceId] > 0;
    });
  }, [sortedAndFilteredCopyFromItems, allItemChordCounts]);

  // Esc key handler for closing modals
  useEffect(() => {
    const handleEscKey = (event) => {
      if (event.key === 'Escape') {
        if (showCopyModal) {
          handleCloseCopyModal();
        } else if (showCopyFromModal) {
          handleCloseCopyFromModal();
        } else if (showDeleteChordsModal) {
          setShowDeleteChordsModal(false);
          setDeleteModalItemId(null);
        } else if (showMixedContentModal) {
          setShowMixedContentModal(false);
        } else if (showUnsupportedFormatModal) {
          setShowUnsupportedFormatModal(false);
        } else if (showCancelConfirmation) {
          setShowCancelConfirmation(false);
        } else if (showApiErrorModal) {
          setShowApiErrorModal(false);
        } else if (showNoTranscriptModal) {
          setShowNoTranscriptModal(false);
          setNoTranscriptData(null);
          setManualTranscript('');
        } else if (showNoChordNamesModal) {
          setShowNoChordNamesModal(false);
        }
      }
    };

    document.addEventListener('keydown', handleEscKey);
    return () => document.removeEventListener('keydown', handleEscKey);
  }, [showCopyModal, showCopyFromModal, showDeleteChordsModal, showMixedContentModal, showUnsupportedFormatModal, showCancelConfirmation, showApiErrorModal, showNoTranscriptModal, showNoChordNamesModal]);

  // Initialize timer for an item
  const initTimer = useCallback((itemId, duration) => {
    console.log(`Initializing timer for item ${itemId} with duration ${duration} minutes`);
    setTimers(prev => {
      if (!prev[itemId]) {
        return {
          ...prev,
          [itemId]: duration * 60 // Convert minutes to seconds
        };
      }
      return prev;
    });
  }, []);

  // Modified toggleItem to lazy-load item details when expanding
  const toggleItem = async (itemId) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
        // Lazy-load item details when expanding
        const routineItem = routine.items.find(item => item['A'] === itemId);  // Column A is ID
        if (routineItem) {
          const itemReferenceId = routineItem['B'];  // Column B is Item ID
          
          // Fetch full item details if not already cached
          fetchItemDetails(itemReferenceId).then(itemDetails => {
            if (itemDetails) {
              // Initialize timer using fetched details
              initTimer(itemId, itemDetails['E'] || 5);  // Column E is Duration
              // Fetch notes when expanding
              fetchNotes(itemReferenceId);
            }
          });
        }
      }
      return next;
    });
  };

  const toggleTimer = async (itemId, e) => {
    e?.stopPropagation(); // Prevent expand/collapse when clicking timer
    const routineItem = routine.items.find(item => item['A'] === itemId);  // Column A is ID
    if (routineItem) {
      // Resume AudioContext on first user interaction (required for browser autoplay policies)
      if (audioContext.current && audioContext.current.state === 'suspended') {
        try {
          await audioContext.current.resume();
          console.log('[AUDIO] AudioContext resumed after user interaction');
        } catch (error) {
          console.error('[AUDIO] Failed to resume AudioContext:', error);
        }
      }

      // Stop any playing sound when timer controls are used
      if (timerSound.current) {
        timerSound.current.stop();
      }

      // Only initialize timer if it doesn't exist
      if (!timers[itemId]) {
        console.log(`Timer ${itemId} not found, initializing...`);
        // Try to get cached item details, fallback to default
        const itemDetails = getItemDetails(routineItem['B']);
        const duration = itemDetails?.['E'] || 5;  // Column E is Duration
        initTimer(itemId, duration);
      } else {
        console.log(`Timer ${itemId} exists with value ${timers[itemId]}`);
      }
      
      setActiveTimers(prev => {
        const next = new Set(prev);
        const itemDetails = getItemDetails(routineItem['B']);
        const itemName = itemDetails?.['C'] || `Item ${itemId}`; // Column C is Title
        
        if (next.has(itemId)) {
          console.log(`Deactivating timer ${itemId}`);
          next.delete(itemId);
          
          // Calculate elapsed time for timer stopped event
          const initialDuration = (itemDetails?.['E'] || 5) * 60; // Column E is Duration in minutes, convert to seconds
          const currentTimer = timers[itemId] || initialDuration;
          const elapsedSeconds = initialDuration - currentTimer;
          
          trackPracticeEvent('timer_stopped', itemName, {
            time_elapsed_seconds: Math.max(0, elapsedSeconds),
            initial_duration_minutes: itemDetails?.['E'] || 5
          });
        } else {
          console.log(`Activating timer ${itemId}`);
          next.add(itemId);
          trackPracticeEvent('started_timer', itemName);
        }
        return next;
      });
    }
  };

  const toggleComplete = async (routineEntryId, e) => {
    e?.stopPropagation(); // Prevent expand/collapse when clicking checkbox
    const newState = !completedItems.has(routineEntryId);
    
    try {
      const response = await fetch(`/api/routines/${routine.id}/items/${routineEntryId}/complete`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ completed: newState })
      });

      if (!response.ok) throw new Error('Failed to update completion state');

      const result = await response.json();
      if (result.success) {
        setCompletedItems(prev => {
          const next = new Set(prev);
          if (newState) {
            next.add(routineEntryId);
            
            // Track completion with timer data
            const routineItem = routine.items.find(item => item['A'] === routineEntryId);
            if (routineItem) {
              const itemDetails = getItemDetails(routineItem['B']);
              const itemName = itemDetails?.['C'] || `Item ${routineEntryId}`; // Column C is Title
              const initialDuration = (itemDetails?.['E'] || 5) * 60; // Column E is Duration in minutes, convert to seconds
              const currentTimer = timers[routineEntryId] || initialDuration;
              const elapsedSeconds = initialDuration - currentTimer;
              
              trackPracticeEvent('marked_done', itemName, {
                time_elapsed_seconds: Math.max(0, elapsedSeconds),
                was_timer_active: activeTimers.has(routineEntryId),
                initial_duration_minutes: itemDetails?.['E'] || 5
              });
            }
            
            // Stop timer when marking complete
            setActiveTimers(prev => {
              const next = new Set(prev);
              next.delete(routineEntryId);
              return next;
            });

            // When marking as complete:
            // 1. Find the current item's index
            const currentIndex = routine.items.findIndex(item => item['A'] === routineEntryId);
            // 2. Collapse current item
            setExpandedItems(prev => {
              const next = new Set(prev);
              next.delete(routineEntryId);
              // 3. If there's a next item, expand it
              if (currentIndex < routine.items.length - 1) {
                const nextItem = routine.items[currentIndex + 1];
                next.add(nextItem['A']);
                // Lazy-load details for next item
                const nextItemReferenceId = nextItem['B'];
                fetchItemDetails(nextItemReferenceId).then(itemDetails => {
                  if (itemDetails) {
                    // Initialize timer and fetch notes for next item
                    initTimer(nextItem['A'], itemDetails['E'] || 5);
                    fetchNotes(nextItemReferenceId);
                  }
                });
              }
              return next;
            });
          } else {
            next.delete(routineEntryId);
          }
          return next;
        });
      }
    } catch (error) {
      console.error('Error updating completion state:', error);
    }
  };

  const resetTimer = async (itemId, e) => {
    e?.stopPropagation();

    // Resume AudioContext on user interaction (required for browser autoplay policies)
    if (audioContext.current && audioContext.current.state === 'suspended') {
      try {
        await audioContext.current.resume();
        console.log('[AUDIO] AudioContext resumed after user interaction');
      } catch (error) {
        console.error('[AUDIO] Failed to resume AudioContext:', error);
      }
    }

    // Stop any playing sound when timer is reset
    if (timerSound.current) {
      timerSound.current.stop();
    }

    const routineItem = routine.items.find(item => item['A'] === itemId);  // Column A is ID
    if (routineItem) {
      // Try to get cached item details, fallback to default
      const itemDetails = getItemDetails(routineItem['B']);
      const duration = itemDetails?.['E'] || 5;  // Column E is Duration
      const itemName = itemDetails?.['C'] || `Item ${itemId}`; // Column C is Title
      
      setTimers(prev => ({
        ...prev,
        [itemId]: duration * 60
      }));
      
      trackPracticeEvent('timer_reset', itemName);
    }
  };

  const addNote = async (itemId, e) => {
    e?.stopPropagation();
    setEditingNoteItemId(itemId);
    setIsNoteEditorOpen(true);
  };

  const handleNoteSave = async () => {
    await fetchNotes(editingNoteItemId);
    setEditingNoteItemId(null);
  };

  const toggleNotes = (itemId, e) => {
    e?.stopPropagation();
    setExpandedNotes(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const resetProgress = async (e) => {
    e?.stopPropagation();
    try {
      const response = await fetch(`/api/routines/${routine.id}/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) throw new Error('Failed to reset progress');

      setCompletedItems(new Set());
    } catch (error) {
      console.error('Error resetting progress:', error);
    }
  };

  // Calculate total and completed minutes (simplified for now - may not be exact until items are loaded)
  const { totalMinutes, completedMinutes } = useMemo(() => {
    if (!routine?.items) return { totalMinutes: 0, completedMinutes: 0 };
    
    const total = routine.items.reduce((sum, item) => {
      // Try to get cached details, fallback to estimated default
      const itemDetails = getItemDetails(item['B']);
      const duration = parseInt(itemDetails?.['E']) || 5; // Default 5 minutes
      return sum + duration;
    }, 0);
    
    const completed = routine.items
      .filter(item => completedItems.has(item['A']))
      .reduce((sum, item) => {
        // Try to get cached details, fallback to estimated default
        const itemDetails = getItemDetails(item['B']);
        const duration = parseInt(itemDetails?.['E']) || 5; // Default 5 minutes
        return sum + duration;
      }, 0);
    
    return { totalMinutes: total, completedMinutes: completed };
  }, [routine, completedItems, getItemDetails]);

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

  const toggleChords = (itemId, e) => {
    e?.stopPropagation();
    setExpandedChords(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
        // Lazy-load chord charts when chord section is expanded
        const routineItem = routine.items.find(item => item['A'] === itemId);
        if (routineItem) {
          const itemReferenceId = routineItem['B'];  // Column B is Item ID
          loadChordChartsForItem(itemReferenceId);
        }
      }
      return next;
    });
  };

  const handleSaveChordChart = async (itemId, chartData) => {
    try {
      serverInfo('Saving chord chart for item', { itemId, chartData });
      serverDebug('PracticePage handleSaveChordChart called', { editingChordId, chartData });

      // Determine if we're creating or updating
      const isUpdate = chartData.editingChordId;
      serverDebug('PracticePage isUpdate check result', { isUpdate, editingChordIdFromState: editingChordId, editingChordIdFromChartData: chartData.editingChordId });

      // Build chart data - spread all properties flat (backend builds chord_data from flattened format)
      let chartDataWithSection = { ...chartData };
      
      if (isUpdate) {
        // For updates, preserve the original chord's section information
        const originalChord = (chordCharts[itemId] || []).find(chord => chord.id === chartData.editingChordId);
        
        // Add section metadata to existing chartDataWithSection
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
        const itemSections = chordSections[itemId] || getChordSections(itemId);
        let targetSection;
        
        // Check if we have insertion context (inserting after specific chord)
        if (chartData.insertionContext) {
          // Use section from insertion context
          targetSection = {
            id: chartData.insertionContext.sectionId,
            label: chartData.insertionContext.sectionLabel,
            repeatCount: chartData.insertionContext.sectionRepeatCount
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
        
        
        // Add section metadata to existing chartDataWithSection
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
        ? `/api/chord-charts/${chartData.editingChordId}`
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

      const savedChart = await response.json();
      serverInfo('Chord chart saved successfully', { savedChart });
      
      // DEBUG: Detailed logging of saved chord data format
      console.log('DEBUG: Saved chord detailed breakdown:', {
        id: savedChart.id,
        title: savedChart.title,
        fingers: savedChart.fingers,
        fingersType: typeof savedChart.fingers,
        fingersLength: savedChart.fingers?.length,
        barres: savedChart.barres,
        barresType: typeof savedChart.barres,
        tuning: savedChart.tuning,
        startingFret: savedChart.startingFret,
        numFrets: savedChart.numFrets,
        numStrings: savedChart.numStrings,
        openStrings: savedChart.openStrings,
        mutedStrings: savedChart.mutedStrings
      });

      // Update local state with the saved chart
      setChordCharts(prev => {
        const itemCharts = prev[itemId] || [];
        
        if (isUpdate) {
          // Update existing chord - ensure consistent type comparison
          const editingId = parseInt(chartData.editingChordId);
          serverDebug('Updating chordCharts state', { 
            editingId, 
            editingChordIdOriginal: chartData.editingChordId,
            existingChartIds: itemCharts.map(c => ({ id: c.id, type: typeof c.id }))
          });
          
          let updatedCharts = itemCharts.map(chart => {
            const match = parseInt(chart.id) === editingId;
            if (match) {
              serverDebug('Found matching chord to update', { chart: chart.id, editingId });
              console.log('DEBUG: State update - replacing old chart:', {
                oldChart: chart,
                newChart: savedChart,
                fingersOld: chart.fingers,
                fingersNew: savedChart.fingers
              });
            }
            return match ? savedChart : chart;
          });
          
          // Apply line break updater if it exists (for line break before edited chord)
          if (chartDataWithSection._lineBreakUpdater) {
            serverDebug('Applying stored line break updater to preserve line breaks');
            updatedCharts = chartDataWithSection._lineBreakUpdater(updatedCharts);
          }
          
          serverDebug('Updated charts result', { 
            originalCount: itemCharts.length, 
            updatedCount: updatedCharts.length,
            foundMatch: updatedCharts.some(c => parseInt(c.id) === editingId),
            hasLineBreakUpdater: !!chartDataWithSection._lineBreakUpdater
          });
          
          return {
            ...prev,
            [itemId]: updatedCharts
          };
        } else {
          // Add new chord
          let finalCharts = [...itemCharts, savedChart];
          
          // Apply line break updater if it exists (for line break before new chord)  
          if (chartDataWithSection._lineBreakUpdater) {
            serverDebug('Applying stored line break updater to preserve line breaks for new chord');
            finalCharts = chartDataWithSection._lineBreakUpdater(finalCharts);
          }
          
          return {
            ...prev,
            [itemId]: finalCharts
          };
        }
      });

      // Update sections state
      setChordSections(prev => {
        const itemSections = prev[itemId] || [];
        
        if (isUpdate) {
          // Update existing chord in sections - ensure consistent type comparison
          const editingId = parseInt(chartData.editingChordId);
          serverDebug('Updating chordSections state', { 
            editingId,
            sectionsCount: itemSections.length
          });
          
          let updatedSections = itemSections.map(section => {
            const updatedChords = section.chords.map(chord => {
              const match = parseInt(chord.id) === editingId;
              if (match) {
                serverDebug('Found matching chord in section', { 
                  sectionId: section.id, 
                  sectionLabel: section.label,
                  chordId: chord.id,
                  editingId 
                });
              }
              return match ? savedChart : chord;
            });
            
            return {
              ...section,
              chords: updatedChords
            };
          });
          
          // Apply line break updater to sections as well if it exists
          if (chartDataWithSection._lineBreakUpdater) {
            serverDebug('Applying line break updater to sections state');
            updatedSections = updatedSections.map(section => ({
              ...section,
              chords: chartDataWithSection._lineBreakUpdater(section.chords)
            }));
          }
          
          return {
            ...prev,
            [itemId]: updatedSections
          };
        } else {
          // Add new chord to section
          // If no sections exist, create a default one
          if (itemSections.length === 0) {
            const newSections = [{
              id: 'section-1',
              label: 'Verse',
              repeatCount: '',
              chords: [savedChart]
            }];
            
            // Apply line break updater if it exists
            if (chartDataWithSection._lineBreakUpdater) {
              serverDebug('Applying line break updater to new section');
              newSections[0].chords = chartDataWithSection._lineBreakUpdater(newSections[0].chords);
            }
            
            return {
              ...prev,
              [itemId]: newSections
            };
          }
          
          // Add to appropriate section with proper insertion logic
          const updatedSections = [...itemSections];
          
          if (chartData.insertionContext) {
            // Insert at specific position within target section
            const targetSectionIndex = updatedSections.findIndex(section => 
              section.id === chartData.insertionContext.sectionId
            );
            
            if (targetSectionIndex >= 0) {
              const targetSection = { ...updatedSections[targetSectionIndex] };
              const insertOrder = chartData.insertionContext.insertOrder;
              
              // Find insertion point and insert chord
              const insertionIndex = targetSection.chords.findIndex(chord => 
                parseInt(chord.order) >= insertOrder
              );
              
              if (insertionIndex >= 0) {
                // Insert in the middle of the section
                targetSection.chords = [
                  ...targetSection.chords.slice(0, insertionIndex),
                  savedChart,
                  ...targetSection.chords.slice(insertionIndex)
                ];
              } else {
                // Insert at the end of the section
                targetSection.chords = [...targetSection.chords, savedChart];
              }
              
              updatedSections[targetSectionIndex] = targetSection;
            } else {
              // Target section not found, add to last section as fallback
              const lastSection = { ...updatedSections[updatedSections.length - 1] };
              lastSection.chords = [...lastSection.chords, savedChart];
              updatedSections[updatedSections.length - 1] = lastSection;
            }
          } else {
            // Original behavior: add to the last section
            const lastSection = { ...updatedSections[updatedSections.length - 1] };
            lastSection.chords = [...lastSection.chords, savedChart];
            updatedSections[updatedSections.length - 1] = lastSection;
          }
          
          // Apply line break updater if it exists
          if (chartDataWithSection._lineBreakUpdater) {
            serverDebug('Applying line break updater to updated sections');
            updatedSections.forEach(section => {
              section.chords = chartDataWithSection._lineBreakUpdater(section.chords);
            });
          }
          
          return {
            ...prev,
            [itemId]: updatedSections
          };
        }
      });

      // With memoized components, updates will automatically trigger re-renders

      // Track chord chart action
      const routineItem = routine.items.find(item => item['B'] === itemId);
      if (routineItem) {
        const itemDetails = getItemDetails(itemId);
        const itemName = itemDetails?.['C'] || `Item ${itemId}`; // Column C is Title
        
        if (isUpdate) {
          trackChordChartEvent('edited', itemName, {
            chord_name: chartData.title || 'Unknown Chord',
            section_id: chartDataWithSection.sectionId,
            section_label: chartDataWithSection.sectionLabel
          });
        } else {
          trackChordChartEvent('added', itemName, {
            chord_name: chartData.title || 'Unknown Chord',
            section_id: chartDataWithSection.sectionId,
            section_label: chartDataWithSection.sectionLabel
          });
        }
      }

      // Hide the editor after saving and clear editing state
      setShowChordEditor(prev => ({
        ...prev,
        [itemId]: false
      }));
      setEditingChordId(null);
      setInsertionContext(null);

      // Scroll back to the original chord chart location
      scrollBackToChord();

    } catch (error) {
      console.error('Error saving chord chart:', error);
      // TODO: Add user-visible error handling
    }
  };

  const handleDeleteChordChart = async (itemId, chordId) => {
    try {
      console.log('Deleting chord chart:', chordId, 'for item:', itemId);
      
      const response = await fetch(`/api/items/${itemId}/chord-charts/${chordId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        if (response.status === 429) {
          const errorData = await response.json();
          console.warn('Rate limit exceeded for individual delete');
          alert(`Rate limit exceeded. Please wait a moment and try again. (${errorData.error})`);
          return;
        }
        throw new Error(`Failed to delete chord chart: ${response.statusText}`);
      }

      console.log('Chord chart deleted successfully');

      // Track chord chart deletion
      const routineItem = routine.items.find(item => item['B'] === itemId);
      if (routineItem) {
        const itemDetails = getItemDetails(itemId);
        const itemName = itemDetails?.['C'] || `Item ${itemId}`; // Column C is Title
        
        // Get chord info before deleting for tracking
        const chordToDelete = (chordCharts[itemId] || []).find(chart => chart.id === chordId);
        
        trackChordChartEvent('deleted', itemName, {
          chord_name: chordToDelete?.title || 'Unknown Chord',
          chord_id: chordId
        });
      }

      // Update local state by removing the chart
      setChordCharts(prev => {
        const itemCharts = prev[itemId] || [];
        return {
          ...prev,
          [itemId]: itemCharts.filter(chart => chart.id !== chordId)
        };
      });

      // Also remove from sections
      setChordSections(prev => {
        const itemSections = prev[itemId] || [];
        const updatedSections = itemSections.map(section => ({
          ...section,
          chords: section.chords.filter(chart => chart.id !== chordId)
        }));
        
        return {
          ...prev,
          [itemId]: updatedSections
        };
      });

    } catch (error) {
      console.error('Error deleting chord chart:', error);
      // TODO: Add user-visible error handling
    }
  };

  const scrollBackToChord = () => {
    if (scrollBackContext) {
      setTimeout(() => {
        // Try to find the specific chord chart element first
        const chordElement = document.querySelector(`[data-chord-id="${scrollBackContext.chordId}"]`);
        if (chordElement) {
          chordElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
          });
        } else {
          // Fallback to original scroll position
          window.scrollTo({
            top: scrollBackContext.scrollPosition,
            behavior: 'smooth'
          });
        }
      }, 100);
      setScrollBackContext(null);
    }
  };

  const handleEditChordChart = (itemId, chordId, chartData) => {
    console.log('Edit chord chart:', chordId, 'for item:', itemId, 'with data:', chartData);

    // Store context for scrolling back after edit
    setScrollBackContext({
      itemId,
      chordId,
      scrollPosition: window.scrollY
    });

    // Show the chord editor for this item
    setShowChordEditor(prev => ({
      ...prev,
      [itemId]: true
    }));

    // Set the editing chord ID in the editor so it knows to update instead of create
    // We'll need to pass this to the ChordChartEditor component
    setEditingChordId(chordId);

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

  const handleInsertChordAfter = (itemId, afterChordId, afterChartData) => {
    console.log('Insert chord after:', afterChordId, 'for item:', itemId, 'with data:', afterChartData);

    // Store context for scrolling back after insert (use the afterChordId to scroll back to)
    setScrollBackContext({
      itemId,
      chordId: afterChordId,
      scrollPosition: window.scrollY
    });

    // Show the chord editor for this item
    setShowChordEditor(prev => ({
      ...prev,
      [itemId]: true
    }));

    // Set insertion context - we'll pass this to the ChordChartEditor
    // insertOrder should be the position to insert at, not after
    setInsertionContext({
      afterChordId,
      sectionId: afterChartData.sectionId,
      sectionLabel: afterChartData.sectionLabel,
      sectionRepeatCount: afterChartData.sectionRepeatCount,
      insertOrder: parseInt(afterChartData.order) + 1
    });

    // Clear editing chord ID since this is a new chord
    setEditingChordId(null);

    // Auto-scroll to the chord editor after it opens
    setTimeout(() => {
      const editorElement = document.querySelector(`[data-editor-for-item="${itemId}"]`);
      if (editorElement) {
        editorElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest'
        });
      }
    }, 100);
  };

  // Print chord charts functionality
  const handlePrintChords = (itemId) => {
    console.log('Print button clicked for item:', itemId);
    // Add print class to chord chart container
    const chordContainer = document.querySelector(`[data-item-id="${itemId}"].chord-charts-container`);
    console.log('Found container:', chordContainer);
    if (chordContainer) {
      chordContainer.classList.add('chord-chart-print-area');
      window.print();
      // Remove print class after printing
      setTimeout(() => {
        chordContainer.classList.remove('chord-chart-print-area');
      }, 100);
    } else {
      console.error('Could not find chord charts container for item:', itemId);
    }
  };


  // Chord chart copy functionality
  const handleOpenCopyModal = async (itemId) => {
    console.log('Opening copy modal for item:', itemId);
    setCopySourceItemId(itemId);

    // Get source item details for fuzzy matching
    // itemId is the Item ID (Column B), but we need to find the actual item in allItems
    const sourceItem = allItems?.find(item => item['B'] === itemId);
    const sourceTitle = sourceItem?.['C'] || '';

    // Find similar songs first
    const similarSongs = findSimilarSongs(sourceTitle, allItems, itemId);
    console.log('Source:', sourceTitle);
    console.log('Found similar songs:', similarSongs.map(s => s['C']));

    // TARGETED APPROACH: Only load chord charts for source + similar songs (not all items)
    // This matches the efficient approach from the working sheets version
    const itemsToLoad = [itemId, ...similarSongs.map(s => s['B'])]; // Use ItemIDs (Column B)
    console.log('Loading chord charts for relevant items:', itemsToLoad.length, 'items');

    for (const id of itemsToLoad) {
      try {
        const response = await fetch(`/api/items/${id}/chord-charts`);
        if (response.ok) {
          const charts = await response.json();
          setChordCharts(prev => ({ ...prev, [id]: charts }));
          console.log(`Loaded ${charts.length} charts for item ${id}`);
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

  const handleCloseCopyModal = () => {
    setShowCopyModal(false);
    setCopySourceItemId(null);
    setCopySearchTerm('');
    setSelectedTargetItems(new Set());
    setItemsWithExistingCharts(new Set());
    setShowOverwriteConfirmation(false);
    setCopyProgress(null);
  };

  const handleToggleTargetItem = (itemId) => {
    setSelectedTargetItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
        // Lazy load chord charts for this item if not already loaded (for overwrite detection)
        // Note: itemId here is the primary key (Column A), but we need ItemID (Column B) for API
        const targetItem = allItems?.find(item => item['A'] === itemId);
        const itemReferenceId = targetItem?.['B'];
        if (itemReferenceId) {
          loadChordChartsForItem(itemReferenceId);
        }
      }
      return newSet;
    });
  };

  const handleConfirmCopy = async () => {
    console.log('handleConfirmCopy called', { copySourceItemId, selectedTargetItems: Array.from(selectedTargetItems) });
    if (!copySourceItemId || selectedTargetItems.size === 0) {
      console.log('Early return: missing source or targets');
      return;
    }

    // If there are overwrites and we haven't confirmed yet, show confirmation
    if (itemsWithExistingCharts.size > 0 && !showOverwriteConfirmation) {
      console.log('Showing overwrite confirmation, items with existing charts:', itemsWithExistingCharts.size);
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
            // Convert primary key (Column A) to ItemID (Column B)
            const targetItem = allItems?.find(item => item['A'] === primaryKey);
            return targetItem?.['B'];
          }).filter(Boolean) // Remove any undefined values
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to copy chord charts: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('Chord charts copied successfully:', result);

      // Set copy progress to complete to show success message
      setCopyProgress('complete');

      // Force refresh chord charts for all affected items using the proven autocreate pattern
      // Convert primary keys (Column A) to ItemIDs (Column B) for targets, same as API call body
      const targetItemIds = Array.from(selectedTargetItems).map(primaryKey => {
        const targetItem = allItems?.find(item => item['A'] === primaryKey);
        return targetItem?.['B'];
      }).filter(Boolean);
      const affectedItems = [copySourceItemId, ...targetItemIds];
      console.log('[DEBUG COPY] About to refresh chord charts for affected items:', affectedItems);
      for (const itemId of affectedItems) {
        try {
          const response = await fetch(`/api/items/${itemId}/chord-charts`);
          if (response.ok) {
            const charts = await response.json();

            // Update chord charts state like autocreate does
            console.log('[DEBUG COPY] Updating chordCharts state for item', itemId, 'with', charts.length, 'charts');
            setChordCharts(prev => ({
              ...prev,
              [itemId]: charts
            }));

            // Build sections from loaded chord charts using inline logic like autocreate
            if (charts.length === 0) {
              setChordSections(prev => ({
                ...prev,
                [itemId]: []
              }));
            } else {
              // Group chords by their section metadata (same logic as autocreate)
              const sectionMap = new Map();

              charts.forEach(chart => {
                const sectionId = chart.sectionId || 'section-1';
                const sectionLabel = chart.sectionLabel || 'Verse';
                const sectionRepeatCount = chart.sectionRepeatCount || '';

                if (!sectionMap.has(sectionId)) {
                  sectionMap.set(sectionId, {
                    id: sectionId,
                    label: sectionLabel,
                    repeatCount: sectionRepeatCount,
                    chords: []
                  });
                }

                sectionMap.get(sectionId).chords.push(chart);
              });

              // Convert to array and sort sections by the order of their first chord
              const sections = Array.from(sectionMap.values()).sort((a, b) => {
                const aFirstOrder = a.chords.length > 0 ? (a.chords[0].order || 0) : 0;
                const bFirstOrder = b.chords.length > 0 ? (b.chords[0].order || 0) : 0;
                return aFirstOrder - bFirstOrder;
              });

              console.log('[DEBUG COPY] Updating chordSections state for item', itemId, 'with', sections.length, 'sections');
              setChordSections(prev => ({
                ...prev,
                [itemId]: sections
              }));
            }
          }
        } catch (refreshError) {
          console.error('Error refreshing chord charts for item', itemId, refreshError);
        }
      }

      handleCloseCopyModal();
    } catch (error) {
      console.error('Error copying chord charts:', error);
      // TODO: Add user-visible error handling
    }
  };

  // Overwrite confirmation handlers
  const handleOverwriteConfirmed = () => {
    console.log('Overwrite confirmed, proceeding with copy');
    setShowOverwriteConfirmation(false);
    // Continue with the copy by calling handleConfirmCopy again
    handleConfirmCopy();
  };

  const handleOverwriteCancelled = () => {
    console.log('Overwrite cancelled, returning to item selection');
    setShowOverwriteConfirmation(false);
    // Stay in the modal, return to item selection
  };

  // Copy from modal functions (simplified to match working copy TO modal)
  const handleOpenCopyFromModal = (itemId) => {
    console.log('Opening copy from modal for item:', itemId);
    setCopyFromTargetItemId(itemId);
    setShowCopyFromModal(true);
    setCopyFromSearchTerm('');
    setSelectedSourceItem(null);
  };

  const handleCloseCopyFromModal = () => {
    setShowCopyFromModal(false);
    setCopyFromTargetItemId(null);
    setCopyFromSearchTerm('');
    setSelectedSourceItem(null);
    setAllItemChordCounts({}); // Clear chord count cache
  };

  const handleConfirmCopyFrom = async () => {
    console.log('handleConfirmCopyFrom called', { selectedSourceItem, copyFromTargetItemId });
    if (!selectedSourceItem || !copyFromTargetItemId) {
      console.log('Early return: missing source or target');
      return;
    }

    try {
      const response = await fetch('/api/chord-charts/copy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_item_id: selectedSourceItem,
          target_item_ids: [copyFromTargetItemId]
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to copy chord charts: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('Chord charts copied successfully:', result);

      // Force refresh chord charts for target item
      const response2 = await fetch(`/api/items/${copyFromTargetItemId}/chord-charts`);
      if (response2.ok) {
        const charts = await response2.json();

        setChordCharts(prev => ({
          ...prev,
          [copyFromTargetItemId]: charts
        }));

        // Build sections from loaded chord charts
        if (charts.length === 0) {
          setChordSections(prev => ({
            ...prev,
            [copyFromTargetItemId]: []
          }));
        } else {
          const sectionMap = new Map();

          charts.forEach(chart => {
            const sectionId = chart.sectionId || 'section-1';
            const sectionLabel = chart.sectionLabel || 'Verse';
            const sectionRepeatCount = chart.sectionRepeatCount || '';

            if (!sectionMap.has(sectionId)) {
              sectionMap.set(sectionId, {
                id: sectionId,
                label: sectionLabel,
                repeatCount: sectionRepeatCount,
                chords: []
              });
            }

            sectionMap.get(sectionId).chords.push(chart);
          });

          const sections = Array.from(sectionMap.values()).sort((a, b) => {
            const aFirstOrder = a.chords.length > 0 ? (a.chords[0].order || 0) : 0;
            const bFirstOrder = b.chords.length > 0 ? (b.chords[0].order || 0) : 0;
            return aFirstOrder - bFirstOrder;
          });

          setChordSections(prev => ({
            ...prev,
            [copyFromTargetItemId]: sections
          }));
        }
      }

      handleCloseCopyFromModal();
    } catch (error) {
      console.error('Error copying chord charts:', error);
      // TODO: Add user-visible error handling
    }
  };

  // Autocreate functions
  const handleAutocreateClick = (itemId) => {
    const existingCharts = chordCharts[itemId] || [];
    if (existingCharts.length > 0) {
      // Show modal asking to delete existing charts
      setDeleteModalItemId(itemId);
      setShowDeleteChordsModal(true);
    } else {
      // No existing charts, proceed with file selection
      // This will be handled by the drag-and-drop zone
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
      
      // Close modal
      setShowDeleteChordsModal(false);
      setDeleteModalItemId(null);
    } catch (error) {
      console.error('Error deleting existing chord charts:', error);
    }
  };

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
  };

  const handleShowCancelConfirmation = (itemId) => {
    setPendingCancelItemId(itemId);
    setShowCancelConfirmation(true);
  };

  const handleConfirmCancel = () => {
    if (pendingCancelItemId) {
      handleCancelAutocreate(pendingCancelItemId);
    }
    setShowCancelConfirmation(false);
    setPendingCancelItemId(null);
  };

  const handleCancelDialog = () => {
    setShowCancelConfirmation(false);
    setPendingCancelItemId(null);
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

  // Validate manual chord input pattern
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

  const handleProcessFiles = async (itemId) => {
    const files = uploadedFiles[itemId] || [];
    const youtubeUrl = youtubeUrls[itemId]?.trim();
    const manualChords = manualChordInput[itemId]?.trim();

    console.log(`[AUTOCREATE] handleProcessFiles called for item ${itemId}, files:`, files.length, 'youtubeUrl:', youtubeUrl, 'manualChords:', manualChords);

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
    console.log(`[AUTOCREATE] Processing manual chord input for item ${itemId}:`, chordInput);

    setAutocreateProgress(prev => ({
      ...prev,
      [itemId]: 'processing'
    }));

    try {
      // Create a text file from the manual input and send it to the autocreate endpoint
      const textBlob = new Blob([chordInput], { type: 'text/plain' });
      const textFile = new File([textBlob], 'manual-input.txt', { type: 'text/plain' });

      const formData = new FormData();
      formData.append('file0', textFile);
      formData.append('itemId', itemId);
      formData.append('userChoice', 'chord_names'); // Indicate this is chord names input

      console.log(`[AUTOCREATE] Sending manual input to autocreate endpoint`);

      const response = await fetch('/api/autocreate-chord-charts', {
        method: 'POST',
        body: formData
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
      console.log(`[AUTOCREATE] Manual input processed successfully:`, result);

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

      // Show success modal - same as other autocreate methods
      const itemDetails = getItemDetails(itemId);
      setAutocreateSuccessData({
        itemTitle: itemDetails?.C || `Item ${itemId}`,
        chordsCreated: charts.length,
        processingMethod: 'Manual Entry'
      });
      setShowAutocreateSuccessModal(true);

    } catch (error) {
      console.error('Error processing manual chord input:', error);

      // Check if this is an API key required error
      if (error.message && error.message.startsWith('API_KEY_REQUIRED: ')) {
        const message = error.message.replace('API_KEY_REQUIRED: ', '');
        setApiError({
          message: message,
          requiresApiKey: true
        });
      } else {
        setApiError({ message: error.message || 'Failed to process manual chord input. Please try again.' });
      }

      setShowApiErrorModal(true);
    } finally {
      setAutocreateProgress(prev => {
        const newState = { ...prev };
        delete newState[itemId];
        return newState;
      });
    }
  };


  const handleYouTubeUrl = async (itemId, youtubeUrl) => {
    console.log(`[YOUTUBE] Processing YouTube URL for item ${itemId}:`, youtubeUrl);

    // Sanitize and validate YouTube URL format
    const sanitizedUrl = youtubeUrl.trim().replace(/[<>"']/g, '');
    const youtubeRegex = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=[\w-]+|youtu\.be\/[\w-]+)(\?.*|&.*)?$/;

    if (!youtubeRegex.test(sanitizedUrl)) {
      setApiError({ message: 'Please enter a valid YouTube URL (e.g., https://youtube.com/watch?v=...)' });
      setShowApiErrorModal(true);
      return;
    }

    setAutocreateProgress(prev => ({
      ...prev,
      [itemId]: 'checking_transcript'
    }));

    try {
      // First, check if transcript is available and fetch it
      console.log('[YOUTUBE] Fetching transcript from YouTube API');
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

      console.log(`[YOUTUBE] Transcript fetched successfully, length: ${transcriptData.transcript.length} characters`);

      // Now process the transcript using the existing function
      await processYouTubeTranscript(itemId, transcriptData.transcript);

    } catch (error) {
      console.error('Error processing YouTube URL:', error);
      setApiError({ message: 'Failed to process YouTube URL. Please try again.' });
      setShowApiErrorModal(true);
      setAutocreateProgress(prev => {
        const newState = { ...prev };
        delete newState[itemId];
        return newState;
      });
    }

  };

  const processYouTubeTranscript = async (itemId, transcript) => {
    try {
      // Set reading transcript state for YouTube processing
      setAutocreateProgress({ [itemId]: 'reading_transcript' });

      // Use existing autocreate endpoint with chord_names type
      const formData = new FormData();

      // Add itemId to form data (not headers)
      formData.append('itemId', itemId);

      // Create a virtual file with the transcript content
      const transcriptBlob = new Blob([transcript], { type: 'text/plain' });
      formData.append('file0', transcriptBlob, 'youtube_transcript.txt');

      // Show uploading for minimum 2 seconds, then switch to processing
      const minDisplayTime = 2000;

      setTimeout(() => {
        setAutocreateProgress({ [itemId]: 'processing' });
      }, minDisplayTime);

      const response = await fetch('/api/autocreate-chord-charts', {
        method: 'POST',
        headers: { 'X-Item-Id': itemId },
        body: formData
      });

      if (!response.ok) {
        // Parse the error response to get the detailed message
        let errorMessage = `Failed to create chord charts: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage = errorData.error;
          }
          // If it requires an API key, throw special error to trigger the API key modal
          if (errorData.requires_api_key) {
            throw new Error('API_KEY_REQUIRED: ' + errorMessage);
          }
        } catch (parseError) {
          // If JSON parsing fails, use the statusText
          if (!parseError.message.startsWith('API_KEY_REQUIRED')) {
            console.warn('Could not parse error response:', parseError);
          } else {
            throw parseError; // Re-throw API key required errors
          }
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      console.log('[YOUTUBE] Chord charts created successfully:', result);

      // Check if the result contains the "no chord names found" error
      if (result.error && result.error.includes('No chord names found in this transcript')) {
        // Show the "no chord names found" modal instead of success
        setShowNoChordNamesModal(true);
        setAutocreateProgress(prev => {
          const newState = { ...prev };
          delete newState[itemId];
          return newState;
        });
        // Clear YouTube URL
        setYoutubeUrls(prev => ({ ...prev, [itemId]: '' }));
        return;
      }

      // Track autocreate chord charts success (YouTube transcript flow)
      const routineItem = routine.items.find(item => item['B'] === itemId);
      if (routineItem) {
        const itemDetails = getItemDetails(itemId);
        const itemName = itemDetails?.['C'] || `Item ${itemId}`; // Column C is Title

        trackChordChartEvent('autocreated', itemName, {
          content_type: 'youtube_transcript',
          source: 'youtube_url'
        });
      }

      // Show success modal for YouTube transcripts
      const itemDetails = getItemDetails(itemId);
      setAutocreateSuccessData({
        itemName: itemDetails?.['C'] || `Item ${itemId}`,
        chordCount: result.chord_count || 0,
        contentType: 'youtube_transcript',
        uploadedFileNames: 'YouTube transcript',
        isVisionAnalysis: false
      });
      setShowAutocreateSuccessModal(true);

      // Force refresh chord charts for this item (same as file upload)
      try {
        const response2 = await fetch(`/api/items/${itemId}/chord-charts`);
        if (response2.ok) {
          const charts = await response2.json();

          // Transform chord data from Google Sheets format to expected format
          const transformedCharts = charts;

          // Update chord charts state like manual creation does
          setChordCharts(prev => ({
            ...prev,
            [itemId]: transformedCharts
          }));

          // Build sections from loaded chord charts (same logic as file upload)
          if (transformedCharts.length === 0) {
            setChordSections(prev => ({
              ...prev,
              [itemId]: []
            }));
          } else {
            // Group chords by their section metadata (same logic as getChordSections)
            const sectionMap = new Map();

            transformedCharts.forEach(chart => {
              const sectionId = chart.sectionId || 'section-1';
              const sectionLabel = chart.sectionLabel || 'Verse';
              const sectionRepeatCount = chart.sectionRepeatCount || '';

              if (!sectionMap.has(sectionId)) {
                sectionMap.set(sectionId, {
                  id: sectionId,
                  label: sectionLabel,
                  repeatCount: sectionRepeatCount,
                  chords: []
                });
              }

              sectionMap.get(sectionId).chords.push(chart);
            });

            const sections = Array.from(sectionMap.values());
            setChordSections(prev => ({
              ...prev,
              [itemId]: sections
            }));
          }
        }
      } catch (refreshError) {
        console.error('Error refreshing chord charts:', refreshError);
        // Don't fail the whole operation if refresh fails
      }

      // Clear YouTube URL and progress state after successful processing
      setYoutubeUrls(prev => ({ ...prev, [itemId]: '' }));
      setAutocreateProgress(prev => {
        const newState = { ...prev };
        delete newState[itemId];
        return newState;
      });

    } catch (error) {
      console.error('Error processing YouTube transcript:', error);

      // Check if this is an API key required error
      if (error.message && error.message.startsWith('API_KEY_REQUIRED: ')) {
        const message = error.message.replace('API_KEY_REQUIRED: ', '');
        setApiError({
          message: message,
          requiresApiKey: true
        });
      } else {
        setApiError({ message: error.message || 'Failed to create chord charts from transcript. Please try again.' });
      }

      setShowApiErrorModal(true);
      setAutocreateProgress(prev => {
        const newState = { ...prev };
        delete newState[itemId];
        return newState;
      });
    }
  };

  const handleMixedContentChoice = async (contentType) => {
    if (!mixedContentData) return;
    
    const { itemId, files } = mixedContentData;
    
    console.log(`[AUTOCREATE] handleMixedContentChoice called with contentType: ${contentType}, itemId: ${itemId}, files:`, files.length);
    
    try {
      setAutocreateProgress({ [itemId]: 'processing' });
      setShowMixedContentModal(false);
      
      console.log(`[AUTOCREATE] Starting processing for ${contentType} with ${files.length} files`);
      
      // Create FormData and add user choice
      const formData = new FormData();
      files.forEach((file, index) => {
        // We need to reconstruct the file from the base64 data
        const byteCharacters = atob(file.data);
        const byteNumbers = Array.from({ length: byteCharacters.length });
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const reconstructedFile = new File([byteArray], file.name, { type: file.media_type });
        formData.append(`file${index}`, reconstructedFile);
      });
      formData.append('itemId', itemId);
      formData.append('userChoice', contentType); // Add user's choice
      
      console.log(`[AUTOCREATE] Sending API request to /api/autocreate-chord-charts`);
      
      const response = await fetch('/api/autocreate-chord-charts', {
        method: 'POST',
        body: formData
      });

      console.log(`[AUTOCREATE] API response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        let errorMessage = 'Failed to process files';
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage = errorData.error;
          }
          // Check if requires API key
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
      
      console.log(`[AUTOCREATE] API response data:`, result);
      
      if (result.success) {
        console.log(`[AUTOCREATE] Processing successful, setting state to complete`);
        setAutocreateProgress({ [itemId]: 'complete' });

        // Get item details once for reuse
        const itemDetails = getItemDetails(itemId);
        const itemName = itemDetails?.['C'] || `Item ${itemId}`;

        // Send notification if user requested it
        console.log('[NOTIFY] Checking notification request for itemId:', itemId);
        console.log('[NOTIFY] notifyOnComplete ref:', notifyOnCompleteRef.current);
        if (notifyOnCompleteRef.current[itemId]) {
          console.log('[NOTIFY] User requested notification, sending...');
          sendCompletionNotification(itemName);
        } else {
          console.log('[NOTIFY] No notification requested for this item');
        }

        // Track autocreate chord charts success
        const routineItem = routine.items.find(item => item['B'] === itemId);
        if (routineItem) {
          trackChordChartEvent('autocreated', itemName, {
            file_count: files?.length || 0,
            content_type: contentType || 'mixed',
            uploaded_file_names: files?.map(f => f.name).join(', ') || ''
          });
        }

        // Show success modal for visual analysis (more complex processing)
        setAutocreateSuccessData({
          itemName,
          chordCount: result.chord_count || 0,
          contentType: contentType || 'mixed',
          uploadedFileNames: files?.map(f => f.name).join(', ') || '',
          isVisionAnalysis: contentType === 'chord_charts' || result.used_vision_analysis === true
        });
        setShowAutocreateSuccessModal(true);

        // Force refresh chord charts
        try {
          const chartsResponse = await fetch(`/api/items/${itemId}/chord-charts`);
          if (chartsResponse.ok) {
            const charts = await chartsResponse.json();
            const transformedCharts = charts;
            setChordCharts(prev => ({ ...prev, [itemId]: transformedCharts }));
            
            if (transformedCharts && transformedCharts.length > 0) {
              const sections = buildSectionsFromCharts(transformedCharts);
              setChordSections(prev => ({ ...prev, [itemId]: sections }));
            }
          }
        } catch (error) {
          console.error('Failed to refresh chord charts after mixed content choice:', error);
        }
        
        // Clear state after delay
        setTimeout(() => {
          setAutocreateProgress(prev => {
            const newState = { ...prev };
            delete newState[itemId];
            return newState;
          });
          setUploadedFiles(prev => {
            const newState = { ...prev };
            delete newState[itemId];
            return newState;
          });
          setMixedContentData(null);
        }, 2000);
      }
    } catch (error) {
      console.error(`[AUTOCREATE] Error processing mixed content choice:`, error);
      console.error(`[AUTOCREATE] Full error details:`, {
        message: error.message,
        stack: error.stack,
        name: error.name
      });

      // Check if this is an API key required error
      if (error.message && error.message.startsWith('API_KEY_REQUIRED: ')) {
        const message = error.message.replace('API_KEY_REQUIRED: ', '');
        setApiError({
          message: message,
          requiresApiKey: true
        });
      } else {
        setApiError({ message: error.message || 'Failed to process files. Please try again.' });
      }

      setShowApiErrorModal(true);
      setAutocreateProgress(prev => {
        const newState = { ...prev };
        delete newState[itemId];
        return newState;
      });
      setMixedContentData(null);
    }
  };
  
  const handleFileDrop = async (itemId, files) => {
    if (!files || files.length === 0) return;
    
    // Validate file count
    if (files.length > 5) {
      alert('Maximum 5 files allowed. Please select fewer files.');
      return;
    }
    
    try {
      setAutocreateProgress({ [itemId]: 'uploading' });
      
      // Create abort controller for this request
      const abortController = new AbortController();
      setAutocreateAbortController(prev => ({ ...prev, [itemId]: abortController }));
      
      const formData = new FormData();
      Array.from(files).forEach((file, index) => {
        formData.append(`file${index}`, file);
      });
      formData.append('itemId', itemId);
      
      // Show uploading for minimum 2 seconds, then switch to processing
      const minDisplayTime = 2000;
      
      setTimeout(() => {
        setAutocreateProgress({ [itemId]: 'processing' });
      }, minDisplayTime);
      
      const response = await fetch('/api/autocreate-chord-charts', {
        method: 'POST',
        body: formData,
        signal: abortController.signal
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to process files');
      }
      
      const result = await response.json();
      
      // Check if user needs to choose between mixed content types
      if (result.needs_user_choice) {
        setMixedContentData({
          itemId: itemId,
          options: result.mixed_content_options || [],
          files: result.files || []
        });
        setShowMixedContentModal(true);
        setAutocreateProgress(prev => {
          const newState = { ...prev };
          delete newState[itemId];
          return newState;
        });
        return;
      }

      // Check for unsupported file formats
      if (result.error === 'unsupported_format') {
        setUnsupportedFormatData({
          message: result.message,
          title: result.title
        });
        setShowUnsupportedFormatModal(true);
        setAutocreateProgress(prev => {
          const newState = { ...prev };
          delete newState[itemId];
          return newState;
        });
        return;
      }
      
      setAutocreateProgress({ [itemId]: 'complete' });

      // Get item details once for reuse
      const itemDetails = getItemDetails(itemId);
      const itemName = itemDetails?.['C'] || `Item ${itemId}`;

      // Send notification if user requested it
      console.log('[NOTIFY] Checking notification request for itemId (direct flow):', itemId);
      console.log('[NOTIFY] notifyOnComplete ref (direct flow):', notifyOnCompleteRef.current);
      if (notifyOnCompleteRef.current[itemId]) {
        console.log('[NOTIFY] User requested notification (direct flow), sending...');
        sendCompletionNotification(itemName);
      } else {
        console.log('[NOTIFY] No notification requested for this item (direct flow)');
      }

      // Track autocreate chord charts success (direct upload flow)
      const routineItem = routine.items.find(item => item['B'] === itemId);
      if (routineItem) {
        trackChordChartEvent('autocreated', itemName, {
          file_count: result.file_count || 0,
          content_type: result.content_type || 'auto-detected',
          uploaded_file_names: result.uploaded_file_names || ''
        });
      }

      // Show success modal for visual analysis (more complex processing)
      setAutocreateSuccessData({
        itemName,
        chordCount: result.chord_count || 0,
        contentType: result.content_type || 'auto-detected',
        uploadedFileNames: result.uploaded_file_names || '',
        isVisionAnalysis: result.content_type === 'chord_charts' || result.used_vision_analysis === true || (!result.content_type && result.used_vision_analysis !== false)
      });
      setShowAutocreateSuccessModal(true);

      // Force refresh chord charts for this item (don't use loadChordChartsForItem as it skips if already loaded)
      try {
        const response = await fetch(`/api/items/${itemId}/chord-charts`);
        if (response.ok) {
          const charts = await response.json();
          
          // Transform chord data from Google Sheets format to expected format
          const transformedCharts = charts;
          
          // Update chord charts state like manual creation does
          setChordCharts(prev => ({
            ...prev,
            [itemId]: transformedCharts
          }));
          
          // Build sections from loaded chord charts
          if (transformedCharts.length === 0) {
            setChordSections(prev => ({
              ...prev,
              [itemId]: []
            }));
          } else {
            // Group chords by their section metadata (same logic as getChordSections)
            const sectionMap = new Map();
            
            transformedCharts.forEach(chart => {
              const sectionId = chart.sectionId || 'section-1';
              const sectionLabel = chart.sectionLabel || 'Verse';
              const sectionRepeatCount = chart.sectionRepeatCount || '';
              
              if (!sectionMap.has(sectionId)) {
                sectionMap.set(sectionId, {
                  id: sectionId,
                  label: sectionLabel,
                  repeatCount: sectionRepeatCount,
                  chords: []
                });
              }
              
              sectionMap.get(sectionId).chords.push(chart);
            });
            
            // Convert to array and sort sections by the order of their first chord
            const sections = Array.from(sectionMap.values()).sort((a, b) => {
              const aMinOrder = Math.min(...a.chords.map(c => c.order || 0));
              const bMinOrder = Math.min(...b.chords.map(c => c.order || 0));
              return aMinOrder - bMinOrder;
            });
            
            // Sort chords within each section by order
            sections.forEach(section => {
              section.chords.sort((a, b) => (a.order || 0) - (b.order || 0));
            });
            
            setChordSections(prev => ({
              ...prev,
              [itemId]: sections
            }));
          }
        }
      } catch (error) {
        console.error('Failed to refresh chord charts after autocreate:', error);
      }
      
      // Clear progress and close autocreate zone after a delay
      setTimeout(() => {
        setAutocreateProgress(prev => {
          const newState = { ...prev };
          delete newState[itemId];
          return newState;
        });
        setShowAutocreateZone(prev => ({ ...prev, [itemId]: false }));
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
      }, 5000);
      
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Autocreate request was cancelled');
        return;
      }

      console.error('Error in autocreate:', error);

      // Check if this is an API error that needs special handling
      const errorMsg = error.message || error.toString();

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
          delete newState[itemId];
          return newState;
        });
      } else if (errorMsg.includes('529') || errorMsg.includes('overloaded') ||
          errorMsg.includes('429') || errorMsg.includes('rate limit') ||
          errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503') ||
          errorMsg.includes('timeout')) {
        // Show API error modal for these specific errors
        setApiError(error);
        setShowApiErrorModal(true);
        setAutocreateProgress({ [itemId]: 'idle' }); // Reset to idle state
      } else {
        // Generic error handling for other errors
        setAutocreateProgress({ [itemId]: 'error' });
      }
      
      // Clear error state after delay (only for generic errors)
      if (!(errorMsg.includes('529') || errorMsg.includes('overloaded') || 
            errorMsg.includes('429') || errorMsg.includes('rate limit') ||
            errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503') ||
            errorMsg.includes('timeout'))) {
        setTimeout(() => {
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
      }, 5000);
      }
    }
  };


  return (
    <div className="max-w-1130px mx-auto border border-gray-700 rounded-lg p-6" style={{maxWidth: '1130px'}}>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">{routine?.name}</h1>
        <div className="flex flex-col items-end gap-2">
          <div className="text-xl font-mono">
            {formatHoursAndMinutes(completedMinutes)} / {formatHoursAndMinutes(totalMinutes - completedMinutes)}
          </div>
          <Button
            variant="outline"
            onClick={resetProgress}
            className="text-gray-300 hover:text-white"
          >
            Reset Progress
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {routine?.items?.map((routineItem) => {
          const isExpanded = expandedItems.has(routineItem['A']);  // Column A is ID
          const isNotesExpanded = expandedNotes.has(routineItem['A']);
          const isTimerActive = activeTimers.has(routineItem['A']);
          const isCompleted = completedItems.has(routineItem['A']);  // Use routine entry ID for completion state
          
          // Get full item details from cache if available, otherwise use defaults
          const itemDetails = getItemDetails(routineItem['B']);
          const timerValue = timers[routineItem['A']] !== undefined 
            ? timers[routineItem['A']] 
            : (itemDetails?.['E'] || 5) * 60;  // Column E is Duration
          const itemNotes = notes[routineItem['B']] || '';
          const isChordsExpanded = expandedChords.has(routineItem['A']);
          
          // For collapsed items, use minimal details; for expanded items, use full details or loading state
          const displayTitle = routineItem.minimalDetails?.['C'] || 'Loading...';
          const isLoadingDetails = isExpanded && !itemDetails && isLoadingItem(routineItem['B']);
          
          return (
            <div
              key={routineItem['A']}  // Column A is ID
              className="rounded-lg bg-gray-800 overflow-hidden"
            >
              <h2 className="sr-only">Practice Item: {displayTitle}</h2>
              <div
                className="flex items-center justify-between p-5 cursor-pointer hover:bg-gray-700"
                onClick={() => toggleItem(routineItem['A'])}  // Column A is ID
                role="button"
                aria-expanded={isExpanded}
                aria-controls={`practice-item-content-${routineItem['A']}`}
                tabIndex={0}
                data-item-header={routineItem['A']}
                data-expanded={isExpanded ? 'true' : 'false'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleItem(routineItem['A']);
                  }
                }}
              >
                <div className="flex items-center space-x-4">
                  <button
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${isCompleted
                        ? 'bg-green-500 border-green-500 text-white'
                        : 'border-gray-400 text-transparent hover:border-gray-300'}`}
                    onClick={(e) => toggleComplete(routineItem['A'], e)}  // Column A is ID
                    aria-label={isCompleted ? 'Mark as incomplete' : 'Mark as complete'}
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                  </button>
                  {isExpanded ? (
                    <ChevronDown className="h-5 w-5 text-gray-400" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-gray-400" aria-hidden="true" />
                  )}
                  <span className={`text-xl ${isCompleted ? 'line-through text-gray-500' : ''}`} id={`practice-item-title-${routineItem['A']}`}>
                    {displayTitle}
                    {isLoadingDetails && <span className="text-gray-500 ml-2" role="status" aria-live="polite">(Loading details...)</span>}
                  </span>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-gray-400"
                      onClick={(e) => toggleTimer(routineItem['A'], e)}
                      title={activeTimers.has(routineItem['A']) ? "Pause timer" : "Start timer"}
                    >
                      {activeTimers.has(routineItem['A']) ? (
                        <PauseIcon className="h-5 w-5" />
                      ) : (
                        <PlayIcon className="h-5 w-5" />
                      )}
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-gray-400"
                      onClick={(e) => resetTimer(routineItem['A'], e)}
                      title="Reset timer"
                    >
                      <ResetIcon className="h-5 w-5" />
                    </Button>

                    <span className="text-lg font-mono" title="Time remaining">
                      {formatTime(timerValue)}
                    </span>
                  </div>
                </div>
              </div>
              {isExpanded && (
                <div className="px-8 pb-6">
                  {/* Timer section */}
                  <div className="flex flex-col items-center justify-center py-8 space-y-6" data-tour="practice-timer">
                    <button
                      onClick={(e) => toggleTimer(routineItem['A'], e)}  // Column A is ID
                      className="w-48 h-48 rounded-full border-4 border-gray-600 flex items-center justify-center hover:border-gray-500 transition-colors"
                    >
                      {isTimerActive ? (
                        <PauseIcon className="h-24 w-24 text-red-500" />
                      ) : (
                        <PlayIcon className="h-24 w-24 text-green-500" />
                      )}
                    </button>
                    <div className="flex flex-col items-center space-y-2">
                      <div className="text-5xl font-mono">
                        {formatTime(timerValue)}
                      </div>
                      {!isTimerActive && timerValue !== (itemDetails?.['E'] || 5) * 60 && (  // Column E is Duration
                        <button
                          onClick={(e) => resetTimer(routineItem['A'], e)}  // Column A is ID
                          className="flex items-center space-x-2 text-gray-400 hover:text-gray-300 transition-colors"
                        >
                          <ResetIcon className="h-4 w-4" />
                          <span>Reset Timer</span>
                        </button>
                      )}
                    </div>

                    {/* Mark as done button - centered below timer */}
                    <div className="flex justify-center mt-6">
                      <Button
                        variant="outline"
                        className="max-w-md text-gray-300 hover:text-white"
                        onClick={(e) => toggleComplete(routineItem['A'], e)}
                      >
                        Mark as done
                      </Button>
                    </div>
                  </div>

                  {/* Description */}
                  <div className="space-y-2 px-4">
                    {/* Chord Charts Section Wrapper - for tour highlighting */}
                    <div data-tour="chord-charts-section">
                      {/* Chord Charts toggle */}
                      <div
                        className="flex items-center justify-between p-2 hover:bg-gray-700 rounded cursor-pointer"
                        onClick={(e) => toggleChords(routineItem['A'], e)}
                        role="button"
                        aria-expanded={isChordsExpanded}
                        aria-controls={`chord-charts-content-${routineItem['A']}`}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleChords(routineItem['A'], e);
                          }
                        }}
                      >
                        <div className="flex items-center">
                          {isChordsExpanded ? (
                            <ChevronDown className="h-5 w-5 text-gray-400 mr-2" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-5 w-5 text-gray-400 mr-2" aria-hidden="true" />
                          )}
                          <h3 className="text-xl text-gray-300 flex items-center" id={`chord-charts-title-${routineItem['A']}`} data-tour="chord-charts">
                            <Music className="h-5 w-5 mr-2" aria-hidden="true" />
                            Chord charts
                          </h3>
                        </div>
                      </div>

                      {/* Collapsible chord chart content */}
                      {isChordsExpanded && (
                        <div
                          id={`chord-charts-content-${routineItem['A']}`}
                          className="bg-gray-700 rounded-lg p-4 chord-charts-container relative"
                          data-item-id={routineItem['B']}
                          role="region"
                          aria-labelledby={`chord-charts-title-${routineItem['A']}`}
                        >
                        
                        {/* Display chord sections */}
                        {(() => {
                          // Define itemReferenceId at the top level of this scope
                          const itemReferenceId = routineItem['B'];  // Column B is Item ID
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
                                  console.log('Updating section label:', section.id, e.target.value);
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
                                      className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2"
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
                              
                              {/* Add new section button */}
                              {/* Toggle for chord editor */}
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
                                            Autocreate chord charts
                                          </Button>
                                        </div>
                                      )}
                                      
                                      {zoneExpanded && (
                                        <div className="border border-gray-600/30 rounded-lg p-4 bg-gray-800/10">
                                          <div className="text-sm text-gray-400 mb-6">
                                            <p>• Upload lyrics with chord names to create charts</p>
                                            <p>• Upload chord diagrams to import existing charts</p>
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
                                                      {uploadedFiles[itemReferenceId] && uploadedFiles[itemReferenceId].length > 0 ? (
                                                        <div>
                                                          <p className="text-gray-300 text-xs font-medium mb-1">
                                                            {uploadedFiles[itemReferenceId].length} file(s)
                                                          </p>
                                                        </div>
                                                      ) : (
                                                        <p className="text-gray-400 text-xs">
                                                          Lyrics or chord charts
                                                        </p>
                                                      )}
                                                    </div>
                                                  </div>
                                                </div>

                                                {/* Column 2: YouTube URL */}
                                                <div className="flex flex-col">
                                                  <div className="text-center mb-2">
                                                    <p className="text-gray-400 text-sm font-medium">YouTube guitar lesson</p>
                                                  </div>
                                                  <div className="flex-1 flex flex-col justify-center">
                                                    <input
                                                      type="url"
                                                      placeholder="YouTube guitar lesson URL (transcript required)"
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
                                                  </div>
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
                                              Create chord charts
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
                                                <div className="space-y-3" role="status" aria-live="polite">
                                                  <div className="flex items-center justify-center space-x-2">
                                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500" aria-hidden="true"></div>
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
                                                <div className="space-y-3" role="status" aria-live="polite">
                                                  <div className="flex items-center justify-center space-x-2">
                                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-500" aria-hidden="true"></div>
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
                                                  {notificationConfirmMessage === itemReferenceId ? (
                                                    <div className="text-center space-y-3">
                                                      <div className="text-green-400 text-sm">
                                                        ✅ Got it, you can go do stuff in other tabs, we'll notify you when the charts are ready
                                                      </div>
                                                    </div>
                                                  ) : (
                                                    <div className="flex items-center justify-center space-x-2">
                                                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-500" aria-hidden="true"></div>
                                                      <div className="flex items-center">
                                                        <span className="text-white">{processingMessages[processingMessageIndex]}</span>
                                                        <div className="ml-2 animate-spin" aria-hidden="true">⚙️</div>
                                                      </div>
                                                    </div>
                                                  )}
                                                  <br />
                                                  <div className="flex gap-2 justify-center">
                                                    {!notifyOnCompleteRef.current[itemReferenceId] && !notificationConfirmMessage && (
                                                      <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleNotifyRequest(itemReferenceId)}
                                                        className="text-blue-400 hover:text-blue-300 border-blue-600"
                                                      >
                                                        🔔 Notify me when ready
                                                      </Button>
                                                    )}
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
                                                              <p className="text-gray-300 font-medium mb-1">Add a file above, then click 'Create Chord Charts'</p>
                                                              <p className="text-gray-400 text-xs">(The results will probably contain errors, use the ✏️edit icon to make any corrections needed.)</p>
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
                                  className="flex-1 bg-purple-700 text-purple-300 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  Copy chord charts to other song
                                </Button>
                              </div>

                              {/* Chord editor */}
                              {showChordEditor[itemReferenceId] && (
                                <div data-editor-for-item={itemReferenceId}>
                                  <ChordChartEditor
                                  itemId={itemReferenceId}
                                  defaultTuning={itemDetails?.H || 'EADGBE'}
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
                    )}
                    </div>
                    {/* End Chord Charts Section Wrapper */}

                    {/* Notes toggle */}
                    <div
                      className="flex items-center justify-between p-2 hover:bg-gray-700 rounded cursor-pointer"
                      onClick={(e) => toggleNotes(routineItem['A'], e)}  // Column A is ID
                      role="button"
                      aria-expanded={isNotesExpanded}
                      aria-controls={`notes-content-${routineItem['A']}`}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleNotes(routineItem['A'], e);
                        }
                      }}
                    >
                      <div className="flex items-center">
                        {isNotesExpanded ? (
                          <ChevronDown className="h-5 w-5 text-gray-400 mr-2" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-gray-400 mr-2" aria-hidden="true" />
                        )}
                        <h3 className="text-xl text-gray-300 flex items-center" id={`notes-title-${routineItem['A']}`}>
                          <FileText className="h-5 w-5 mr-2" aria-hidden="true" />
                          Notes
                        </h3>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-gray-300"
                        onClick={(e) => {
                          e.stopPropagation();
                          addNote(routineItem['B'], e);  // Column B is Item ID
                        }}
                      >
                        <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                        {itemNotes ? 'Edit note' : 'Add note'}
                      </Button>
                    </div>

                    {/* Collapsible notes content */}
                    {isNotesExpanded && itemNotes && (
                      <div
                        id={`notes-content-${routineItem['A']}`}
                        className="px-4"
                        role="region"
                        aria-labelledby={`notes-title-${routineItem['A']}`}
                      >
                        <div className="bg-gray-700 p-3 rounded">
                          <p className="text-gray-300 whitespace-pre-wrap">{itemNotes}</p>
                        </div>
                      </div>
                    )}

                    {/* Tuning and Songbook section */}
                    <div className="mt-4">
                      <div className="flex items-center justify-between">
                        {/* Songbook folder link - show for desktop OR mobile */}
                        {(itemDetails?.['I'] || itemDetails?.['F']) && (supportsFolderOpening() || isMobileDevice()) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();

                              // Column I = Songbook path (new items), Column F = Description (legacy items with path)
                              const folderPath = itemDetails['I'] || itemDetails['F'];
                              const itemName = itemDetails?.['C'] || `Item ${routineItem['A']}`;

                              // Track songbook link click
                              trackSongbookLinkClick(itemName, folderPath);

                              if (isMobileDevice()) {
                                // Mobile: Just show the path
                                setCopiedFolderPath(folderPath);
                                setShowFolderPathModal(true);
                              } else {
                                // Desktop: Copy to clipboard and show instructions
                                navigator.clipboard.writeText(folderPath).then(() => {
                                  setCopiedFolderPath(folderPath);
                                  setShowFolderPathModal(true);
                                }).catch(err => {
                                  console.error('Failed to copy to clipboard:', err);
                                  // Fallback: still show modal with path
                                  setCopiedFolderPath(folderPath);
                                  setShowFolderPathModal(true);
                                });
                              }
                            }}
                            className="text-gray-400 hover:text-gray-300 hover:underline flex items-center"
                            title={isMobileDevice() ? 'View folder path' : 'Copy folder path'}
                          >
                            <Book className="h-4 w-4 mr-2" />
                            {isMobileDevice() ? 'View Songbook Folder' : 'Copy Folder Path'}
                          </button>
                        )}
                        {/* Tuning */}
                        {itemDetails?.['H'] && (
                          <span className="text-sm font-mono font-bold text-gray-400">
                            {itemDetails['H']}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {expandedItems.has(routineItem['A']) && (
                <div
                  id={`practice-item-content-${routineItem['A']}`}
                  className="px-5 pb-5"
                  role="region"
                  aria-labelledby={`practice-item-title-${routineItem['A']}`}
                >
                  <div className="text-gray-400">
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add NoteEditor */}
      <NoteEditor
        open={isNoteEditorOpen}
        onOpenChange={setIsNoteEditorOpen}
        itemId={editingNoteItemId}
        currentNote={editingNoteItemId ? notes[editingNoteItemId] : ''}
        onNoteSave={handleNoteSave}
      />

      {/* Copy Chord Charts Modal */}
      {showCopyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div
            className={`bg-gray-700 rounded-lg p-6 ${showOverwriteConfirmation || copyProgress === 'complete' ? 'max-w-xs' : 'w-full max-w-md'} max-h-[80vh] flex flex-col`}
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
                <Button
                  onClick={handleCloseCopyModal}
                  className="w-full bg-green-600 hover:bg-green-700"
                >
                  Done
                </Button>
              </>
            ) : !showOverwriteConfirmation ? (
              <>
                <h2 className="text-xl font-bold text-white mb-4">
                  Copy chord charts
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
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={handleCloseCopyModal}
                    className="flex-1"
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
                      backgroundColor: '#5b1f1f',
                      color: '#ffffff',
                      opacity: '1'
                    }}
                    className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:cursor-not-allowed"
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
                <h3 className="text-lg font-semibold text-white mb-4">
                  Confirm Overwrite
                </h3>
                <p className="text-gray-300 mb-4">
                  {itemsWithExistingCharts.size} of the selected songs already have chord charts. 
                  Copying will replace all existing chord charts in those songs.
                </p>
                
                {/* List of songs being overwritten */}
                <div className="bg-gray-600 rounded p-3 mb-4">
                  <p className="text-sm text-gray-200 mb-2 font-medium">Songs that will be overwritten:</p>
                  <ul className="text-sm text-gray-300 space-y-1">
                    {sortedAndFilteredItems
                      .filter(item => selectedTargetItems.has(item['A']) && itemsWithExistingCharts.has(item['A']))
                      .map(item => (
                        <li key={item['A']} className="flex items-center">
                          <span className="text-yellow-400 mr-2">•</span>
                          {item['C'] || 'Unknown Song'}
                        </li>
                      ))}
                  </ul>
                </div>
                
                <p className="text-sm text-gray-400 mb-6">
                  This action cannot be undone.
                </p>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    onClick={handleOverwriteCancelled} 
                    className="flex-1"
                  >
                    Go Back
                  </Button>
                  <Button 
                    onClick={handleOverwriteConfirmed} 
                    className="flex-1 bg-red-600 hover:bg-red-700"
                  >
                    Yes, Overwrite
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Copy From Other Song Modal */}
      {showCopyFromModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div
            className="bg-gray-700 rounded-lg p-6 w-full max-w-md max-h-[80vh] flex flex-col"
            onWheel={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold text-white mb-4">
              Copy chord charts from other song
            </h2>

            <p className="text-gray-300 mb-2">
              Copy chord charts to "{allItems?.find(item => item['B'] === copyFromTargetItemId)?.['C'] || 'Unknown Song'}" from:
            </p>

            {/* Search field */}
            <input
              type="text"
              placeholder="Search songs with chord charts..."
              value={copyFromSearchTerm}
              onChange={(e) => setCopyFromSearchTerm(e.target.value)}
              className="w-full p-2 mb-4 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500"
            />

            {/* Scrollable song list - only items with chord charts */}
            <div className="flex-1 overflow-y-auto mb-4 min-h-0 modal-scroll">
              {copyFromItemsWithCharts.map(item => (
                <div key={item['A']} className="flex items-center mb-2">
                  <input
                    type="radio"
                    id={`copy-from-item-${item['A']}`}
                    name="copyFromSource"
                    checked={selectedSourceItem === item['B']}
                    onChange={() => setSelectedSourceItem(item['B'])}
                    className="mr-3"
                  />
                  <label
                    htmlFor={`copy-from-item-${item['A']}`}
                    className="flex-1 cursor-pointer text-white hover:text-gray-300"
                  >
                    {item['C'] || 'Unknown Song'}
                    <span className="text-xs text-gray-400 ml-2">
                      ({allItemChordCounts[item['B']] || 0} charts)
                    </span>
                  </label>
                </div>
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleCloseCopyFromModal}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmCopyFrom}
                disabled={!selectedSourceItem}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Copy chord charts
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Existing Chord Charts Modal */}
      <AlertDialog open={showDeleteChordsModal} onOpenChange={setShowDeleteChordsModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <span>Replace existing chord charts</span>
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

      {/* Mixed Content Choice Modal */}
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

      {/* Unsupported Format Modal */}
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

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={showCancelConfirmation} onOpenChange={setShowCancelConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you wanna do that?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll have to wait just as long next time if you start over
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDialog}>
              *sigh* Ok, I'll wait...
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmCancel}>
              Yes, damnit, cancel!
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      {/* Folder Path Copy Modal */}
      <AlertDialog open={showFolderPathModal} onOpenChange={setShowFolderPathModal}>
        <AlertDialogContent className="bg-gray-800 border-gray-700 max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-gray-100">
              {isMobileDevice() ? 'Songbook Folder Path' : 'Path Copied to Clipboard'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-300">
              {isMobileDevice() ? (
                <>
                  <p className="mb-2">Here's the folder path for this item:</p>
                  <code className="block bg-gray-900 p-2 rounded text-sm break-all text-gray-200">
                    {copiedFolderPath}
                  </code>
                </>
              ) : (
                <>
                  <p className="mb-2">
                    The path has been copied to your clipboard. Open <strong>{getFileManagerName()}</strong>, paste, then hit <kbd className="bg-gray-700 px-2 py-1 rounded text-xs">Enter</kbd> to open the folder.
                  </p>
                  <code className="block bg-gray-900 p-2 rounded text-sm break-all text-gray-200">
                    {copiedFolderPath}
                  </code>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => setShowFolderPathModal(false)}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* No Transcript Modal */}
      {showNoTranscriptModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-700 rounded-lg p-6 w-full max-w-md max-h-[80vh] flex flex-col">
            <h2 className="text-xl font-bold text-white mb-4">
              No Transcripts Available
            </h2>

            <p className="text-gray-300 mb-4">
              Oh, drag. This YouTube video doesn't have transcripts on it. So, go find a free tool to generate transcripts from YouTube videos, then copy/paste the transcript below:
            </p>

            <textarea
              value={manualTranscript}
              onChange={(e) => setManualTranscript(e.target.value)}
              placeholder="Paste the transcript here..."
              className="w-full h-32 p-3 bg-gray-800 text-white rounded border border-gray-600 focus:border-red-500 resize-none mb-4"
              maxLength={25000}
            />

            <p className="text-xs text-gray-400 mb-4">
              {manualTranscript.length}/25,000 characters
            </p>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowNoTranscriptModal(false);
                  setNoTranscriptData(null);
                  setManualTranscript('');
                }}
                className="flex-1 border-gray-600 text-gray-300 hover:bg-gray-600"
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  if (!manualTranscript.trim()) {
                    alert('Please paste a transcript before proceeding.');
                    return;
                  }

                  const { itemId } = noTranscriptData;
                  setShowNoTranscriptModal(false);
                  setNoTranscriptData(null);

                  await processYouTubeTranscript(itemId, manualTranscript);
                  setManualTranscript('');
                }}
                disabled={!manualTranscript.trim()}
                className={`flex-1 ${
                  !manualTranscript.trim()
                    ? 'border-gray-600 text-gray-500 cursor-not-allowed'
                    : 'border-gray-600 text-gray-300 hover:bg-gray-700'
                }`}
              >
                <Wand className="h-4 w-4 mr-2" />
                🪄 Create chord charts
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* No Chord Names Found Modal */}
      <Dialog open={showNoChordNamesModal} onOpenChange={(open) => !open && setShowNoChordNamesModal(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-orange-500" />
              No Chord Names Found
            </DialogTitle>
            <DialogDescription className="text-left space-y-1">
              <p>So, um, we can't find any chord names mentioned in this video. Sorry, we can't create tablature yet, just chord charts.</p>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 -mt-2">
            <Button onClick={() => setShowNoChordNamesModal(false)} className="min-w-20">
              Ok
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}; 