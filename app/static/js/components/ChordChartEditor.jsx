import { useState, useEffect, useRef } from 'react';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { debugLog } from '@utils/logging';
import { acceptAllCookies, hasFullPostHogSdk } from '@utils/consent';

const defaultChartConfig = {
  strings: 6,
  frets: 5,
  fretSize: 1.2,          // Normal fret height for readability
  fingerSize: 0.75,       // Larger finger size for better text visibility
  sidePadding: 0.2,       // Standard padding
  fontFamily: 'Arial',
  // Key: set explicit dimensions that work well
  width: 128,             // Reduced ~20% (was 160)
  height: 176,            // Reduced ~20% (was 220)
  // Dark theme colors for visibility
  color: '#ffffff',           // White finger dots
  fingerColor: '#ffffff',     // White finger/barre fill
  backgroundColor: 'transparent',
  strokeColor: '#ffffff',     // White grid lines
  textColor: '#ffffff',       // White text
  fretLabelColor: '#ffffff',  // White fret labels
  barreChordStrokeColor: '#ffffff', // White barre outline
  barreChordStyle: 'arc',           // Arc style (rectangle has a fill bug in v2.5.1)
  // Finger text settings - using SVGuitar's correct property names
  fingerTextColor: '#000000', // Black text on white dots for contrast
  fingerTextSize: 28          // Larger text size for better visibility
};

// Utility function for API requests with exponential backoff
const fetchWithBackoff = async (url, options = {}, maxRetries = 2, onRetry = null) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Per-attempt timeout so a hung request can't leave loading states stuck
      // (callers' finally blocks can't run while a fetch is still pending).
      // 5s x 2 attempts keeps worst-case recovery ~11s including backoff —
      // long enough for a slow lookup, short enough not to read as frozen.
      const response = await fetch(url, { signal: AbortSignal.timeout(5000), ...options });

      // If rate limited, wait and retry
      if (response.status === 429) {
        const waitTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        const message = `Rate limited. Waiting ${waitTime/1000}s before retry ${attempt + 1}/${maxRetries}`;
        
        if (onRetry) onRetry(message);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      return response;
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      
      const waitTime = Math.pow(2, attempt) * 1000;
      const message = `Request failed. Waiting ${waitTime/1000}s before retry ${attempt + 1}/${maxRetries}`;
      
      if (onRetry) onRetry(message);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  throw new Error(`Failed after ${maxRetries} attempts`);
};

export const ChordChartEditor = ({ itemId, onSave, onCancel, editingChordId = null, insertionContext = null, defaultTuning = 'EADGBE', saveButtonLabel = null, showLineBreak = true, initialChordId = null, initialChordName = null, mobileLayout = false }) => {
  const [title, setTitle] = useState('');
  const [startingFret, setStartingFret] = useState(1);
  const [numFrets, setNumFrets] = useState(5);
  const [numStrings, setNumStrings] = useState(6);
  const [editMode, setEditMode] = useState('dots');
  
  // Keep ref in sync with state
  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);
  const [tuning, setTuning] = useState(defaultTuning);
  const [capo, setCapo] = useState(0);
  
  // Chord data state
  const [fingers, setFingers] = useState([]); // Start with empty chord
  const [barres, setBarres] = useState([]);
  
  // Debug barres state changes
  useEffect(() => {
  }, [barres]);
  const [openStrings, setOpenStrings] = useState(new Set()); // Track open strings (0)
  const [mutedStrings, setMutedStrings] = useState(new Set()); // Track muted strings (x)
  const [isLoadingChord, setIsLoadingChord] = useState(false); // Loading state for API requests
  const [loadError, setLoadError] = useState(null); // Surfaced when chord data fails to load
  // Read once: the save-failure note offers the chat widget only if the SDK
  // that provides it will actually have loaded
  const [cookiesAllowed] = useState(hasFullPostHogSdk);
  const [cookiesJustAllowed, setCookiesJustAllowed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null); // Surfaced when onSave rejects
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false); // Toggle for advanced settings
  const [selectedFinger, setSelectedFinger] = useState(null); // Track selected finger for number input [string, fret]
  const [addLineBreak, setAddLineBreak] = useState(false); // Whether to add line break after this chord
  const [chartsInitialized, setChartsInitialized] = useState(false); // Flips true after SVGuitar loads — re-fires the draw effect with the latest state closure

  // Mobile redesign (design 2b): single WYSIWYG chart below the sm breakpoint.
  // Gated behind the mobileLayout prop so only opted-in contexts (currently the
  // public chord finder) get the new layout.
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setIsMobile(mq.matches);
    // Listen to both: some environments (emulated viewports) resize without
    // firing matchMedia change events
    mq.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  const useMobileUI = mobileLayout && isMobile;
  // Current-value mirror for event handlers (layoutRef below is different: it
  // tracks the *previous* value to detect layout flips)
  const useMobileUIRef = useRef(useMobileUI);
  useEffect(() => {
    useMobileUIRef.current = useMobileUI;
  }, [useMobileUI]);

  const editorChartRef = useRef(null);
  const resultChartRef = useRef(null);
  const editorContainerRef = useRef(null);
  const editModeRef = useRef(editMode);
  const lastChordDataRef = useRef(null);

  // Autofill function to copy existing chord fingerings
  const tryAutofill = async (chordName) => {
    if (!chordName.trim()) return;

    try {
      setIsLoadingChord(true);
      setLoadError(null);

      let chordToUse = null;

      // Try item-specific chords first (only if we have an itemId)
      if (itemId) {
        // Fetch existing chord charts for this item
        const response = await fetchWithBackoff(`/api/items/${itemId}/chord-charts`, {});
        if (response.ok) {
          const existingChords = await response.json();

          // Find matching chord name (case-insensitive)
          const matches = existingChords.filter(chart =>
            chart.title.toLowerCase() === chordName.toLowerCase()
          );

          if (matches.length === 1) {
            chordToUse = matches[0];
          } else if (matches.length > 1) {
            // Multiple matches - use the first one (earliest in order/ID)
            // Sort by order (or ID if order is the same) and take the first one
            matches.sort((a, b) => {
              const orderA = parseInt(a.order) || 0;
              const orderB = parseInt(b.order) || 0;
              if (orderA !== orderB) return orderA - orderB;
              // If order is the same, use ID as tiebreaker
              return (parseInt(a.id) || 0) - (parseInt(b.id) || 0);
            });
            chordToUse = matches[0]; // Take the first (earliest)
          }
        }
      }

      // Fallback: Search common chords database if no item-specific match found
      if (!chordToUse) {
        try {
          // Add a reasonable delay to avoid rapid API calls
          await new Promise(resolve => setTimeout(resolve, 1000));

          const searchResponse = await fetchWithBackoff(`/api/chord-charts/common/search?name=${encodeURIComponent(chordName)}`, {});

          if (searchResponse.ok) {
            const commonMatches = await searchResponse.json();

            // commonMatches is already filtered by the backend

            if (commonMatches.length > 0) {
              // Use the first common chord match (they should be curated)
              chordToUse = commonMatches[0];
            }
            // No matches isn't a failure - the chord just isn't in the common
            // set, and the user builds it by hand. Stay quiet.
          } else {
            // This is the lookup most likely to fail, so it has to be the one
            // that speaks up - otherwise the user gets a silently empty editor
            setLoadError("Couldn't look up that chord — you can still build it manually.");
          }
        } catch (commonError) {
          console.error('Error fetching common chords:', commonError);
          setLoadError("Couldn't look up that chord — you can still build it manually.");
        }
      }

      // Populate editor with existing chord data
      if (chordToUse) {
        setStartingFret(chordToUse.startingFret || 1);
        setNumFrets(chordToUse.numFrets || 5);
        setNumStrings(chordToUse.numStrings || 6);
        setTuning(chordToUse.tuning || defaultTuning);
        setCapo(chordToUse.capo || 0);
        
        // Convert finger objects to [string, fret, fingerNumber] arrays if needed
        const fingersData = chordToUse.fingers || [];
        const normalizedFingers = fingersData.map(finger => {
          // If it's already an array, ensure 3 elements
          if (Array.isArray(finger)) {
            const [s, f, num] = finger;
            return [s, f, num]; // Keep all 3 elements (num might be undefined)
          }
          // If it's an object with string/fret properties, convert to array
          if (finger && typeof finger === 'object' && 'string' in finger && 'fret' in finger) {
            // Preserve finger number if it exists
            const fingerNum = finger.fingerNumber || finger[2];
            return [finger.string, finger.fret, fingerNum]; // Always 3 elements
          }
          // Fallback: assume it's already in the right format but ensure 3 elements
          const [s, f, num] = Array.isArray(finger) ? finger : [finger[0], finger[1], finger[2]];
          return [s, f, num];
        });
        
        setFingers(normalizedFingers);
        
        // Handle barres from autofill - they should be stored correctly already
        const autofillBarres = chordToUse.barres || [];
        
        setBarres(autofillBarres);
        setOpenStrings(new Set(chordToUse.openStrings || []));
        setMutedStrings(new Set(chordToUse.mutedStrings || []));
        // IMPORTANT: Never copy line break state during autofill - it's chord-specific, not shape-specific
        setAddLineBreak(false);
      }
      
    } catch (error) {
      console.error('Error during autofill:', error);
      // Non-blocking: the lookup failed but the editor is fully usable, so say
      // so rather than implying a retry is the way forward
      setLoadError("Couldn't look up that chord — you can still build it manually.");
    } finally {
      setIsLoadingChord(false);
    }
  };

  // Load a specific common-chord voicing by id (for /find-a-chord-chart?id=N)
  const loadChordById = async (id) => {
    try {
      setIsLoadingChord(true);
      const response = await fetchWithBackoff(`/api/chord-charts/common/${id}`);
      if (!response.ok) {
        // 404 or error: leave editor blank for the user to start fresh
        return;
      }
      const chord = await response.json();
      setTitle(chord.title || '');
      setStartingFret(chord.startingFret || 1);
      setNumFrets(chord.numFrets || 5);
      setNumStrings(chord.numStrings || 6);
      setTuning(chord.tuning || defaultTuning);
      setCapo(chord.capo || 0);

      const fingersData = chord.fingers || [];
      const normalizedFingers = fingersData.map(finger => {
        if (Array.isArray(finger)) {
          const [s, f, num] = finger;
          return [s, f, num];
        }
        if (finger && typeof finger === 'object' && 'string' in finger && 'fret' in finger) {
          const fingerNum = finger.fingerNumber || finger[2];
          return [finger.string, finger.fret, fingerNum];
        }
        const [s, f, num] = Array.isArray(finger) ? finger : [finger[0], finger[1], finger[2]];
        return [s, f, num];
      });
      setFingers(normalizedFingers);
      setBarres(chord.barres || []);
      setOpenStrings(new Set(chord.openStrings || []));
      setMutedStrings(new Set(chord.mutedStrings || []));
      setAddLineBreak(false);
    } catch (error) {
      console.error('Error loading chord by id:', error);
    } finally {
      setIsLoadingChord(false);
    }
  };

  // Load existing chord data when editing
  useEffect(() => {
    if (editingChordId && itemId) {
      const loadChordForEditing = async () => {
        try {
          setIsLoadingChord(true);
          setLoadError(null);

          const response = await fetchWithBackoff(`/api/items/${itemId}/chord-charts`);
          if (response.ok) {
            const chords = await response.json();
            // Convert editingChordId to same type as chord.id for comparison
            const chordToEdit = chords.find(chord => 
              parseInt(chord.id) === parseInt(editingChordId)
            );
            
            if (chordToEdit) {
              debugLog('ChordEditor', 'Loading chord for editing:', {
                id: chordToEdit.id,
                title: chordToEdit.title,
                hasLineBreakAfter: chordToEdit.hasLineBreakAfter,
                editingChordId
              });

              setTitle(chordToEdit.title || '');
              setStartingFret(chordToEdit.startingFret || 1);
              setNumFrets(chordToEdit.numFrets || 5);
              setNumStrings(chordToEdit.numStrings || 6);
              setTuning(chordToEdit.tuning || defaultTuning);
              setCapo(chordToEdit.capo || 0);

              // Load finger positions (preserve finger numbers)
              const fingersData = chordToEdit.fingers || [];
              const normalizedFingers = fingersData.map(finger => {
                if (Array.isArray(finger)) {
                  const [s, f, num] = finger;
                  return [s, f, num]; // Ensure 3 elements (num might be undefined)
                }
                if (finger && typeof finger === 'object' && 'string' in finger && 'fret' in finger) {
                  // Preserve finger number if it exists
                  const fingerNum = finger.fingerNumber || finger[2];
                  return [finger.string, finger.fret, fingerNum]; // Always 3 elements
                }
                // Fallback: ensure 3 elements
                const [s, f, num] = Array.isArray(finger) ? finger : [finger[0], finger[1], finger[2]];
                return [s, f, num];
              });

              setFingers(normalizedFingers);

              // Handle barres - the stored barre fret numbers might need adjustment
              // based on the loaded chord's startingFret
              const loadedBarres = chordToEdit.barres || [];

              // No need to adjust barre fret numbers when loading - they should be stored correctly
              // The issue was in the display/click detection, not in storage
              setBarres(loadedBarres);
              setOpenStrings(new Set(chordToEdit.openStrings || []));
              setMutedStrings(new Set(chordToEdit.mutedStrings || []));

              // Load existing line break status with debug logging
              const lineBreakValue = chordToEdit.hasLineBreakAfter || false;
              debugLog('ChordEditor', 'Setting addLineBreak to:', lineBreakValue, 'from hasLineBreakAfter:', chordToEdit.hasLineBreakAfter);
              setAddLineBreak(lineBreakValue);
            } else {
            }
          } else {
            console.error('Failed to fetch chord charts:', response.status);
            setLoadError("Couldn't load this chord — please try again.");
          }
        } catch (error) {
          console.error('Error loading chord for editing:', error);
          setLoadError("Couldn't load this chord — please try again.");
        } finally {
          setIsLoadingChord(false);
        }
      };
      
      loadChordForEditing();
    } else if (editingChordId) {
    } else if (initialChordId) {
      // Public chord-finder deep-link: ?id=N — load the precise voicing
      loadChordById(initialChordId);
    } else if (initialChordName) {
      // Public chord-finder deep-link: ?chord=NAME — set the name and trigger
      // the existing autofill path. setTitle here is the final word on the
      // title (this branch runs after the reset branch would have).
      setTitle(initialChordName);
      tryAutofill(initialChordName);
    } else {
      // Reset form when not editing (new chord)
      setTitle('');
      setStartingFret(1);
      setNumFrets(5);
      setNumStrings(6);
      setTuning(defaultTuning);
      setCapo(0);
      setFingers([]);
      setBarres([]);
      setOpenStrings(new Set());
      setMutedStrings(new Set());
      setShowAdvancedSettings(false); // Reset to collapsed for new chords
      setAddLineBreak(false); // Reset line break option
    }
  }, [editingChordId, itemId, defaultTuning]);

  // Initialize SVGuitar
  useEffect(() => {
    // Load SVGuitar UMD script if not already loaded
    if (!window.svguitar) {
      const script = document.createElement('script');
      script.src = 'https://omnibrain.github.io/svguitar/js/svguitar.umd.js';
      script.async = true;
      script.onload = () => {
        initializeCharts();
      };
      document.body.appendChild(script);
    } else {
      initializeCharts();
    }
    
    // Cleanup on unmount
    return () => {
      removeEditorHandlers();
    };
  }, []);

  const initializeCharts = () => {
    try {
      editorChartRef.current = new window.svguitar.SVGuitarChord('#editor-chart');
      // The mobile layout renders a single WYSIWYG chart — no #result-chart element
      resultChartRef.current = document.querySelector('#result-chart')
        ? new window.svguitar.SVGuitarChord('#result-chart')
        : null;
      setChartsInitialized(true);
    } catch (error) {
      console.error('Error initializing charts:', error);
    }
  };

  // Re-create the SVGuitar instances when the layout flips between mobile and
  // desktop — the switch remounts the chart containers, so the old instances
  // point at detached DOM. (layoutRef holds the previous layout for flip
  // detection; useMobileUIRef above is the current-value mirror for handlers.)
  const layoutRef = useRef(useMobileUI);
  useEffect(() => {
    if (layoutRef.current === useMobileUI) return;
    layoutRef.current = useMobileUI;
    if (!window.svguitar) return;
    lastChordDataRef.current = null;
    initializeCharts();
    updateCharts();
  }, [useMobileUI]);

  // Store the current event handler reference
  const currentHandlerRef = useRef(null);

  // In-flight mobile barre drag ({ fret, from, to, moved } | null)
  const barreDragRef = useRef(null);
  
  const removeEditorHandlers = () => {
    const h = currentHandlerRef.current;
    if (!h || !h.svg) return;
    h.svg.removeEventListener('click', h.clickHandler);
    h.svg.removeEventListener('mousedown', h.mousedownHandler);
    h.svg.removeEventListener('pointerdown', h.pointerdownHandler);
    h.svg.removeEventListener('pointermove', h.pointermoveHandler);
    h.svg.removeEventListener('pointerup', h.pointerupHandler);
    h.svg.removeEventListener('pointercancel', h.pointercancelHandler);
  };

  const setupEditorInteraction = () => {
    if (!editorContainerRef.current) {
      return;
    }

    const svg = editorContainerRef.current.querySelector('svg');
    if (!svg) {
      return;
    }

    // Remove the old handlers if they exist
    removeEditorHandlers();

    // Prevent text selection on rapid clicks/double-clicks
    const mousedownHandler = (event) => {
      // Prevent text selection on multiple rapid clicks (double-click, etc.)
      if (event.detail > 1) {
        event.preventDefault();
        event.stopPropagation();
        return false;
      }

      // Always prevent default mousedown behavior on SVG to avoid text selection
      event.preventDefault();
    };

    // Handle the actual click interaction
    const clickHandler = (event) => {
      event.stopPropagation(); // Prevent event bubbling
      event.preventDefault();  // Prevent any remaining default behavior

      handleEditorClick(event);
    };

    // Mobile barres mode: drag across strings to draw a barre. The drag is
    // tracked here via pointer events; the click that fires after pointerup is
    // ignored for barres on mobile (see handleEditorClick).
    const pointerdownHandler = (event) => {
      if (!useMobileUIRef.current || editModeRef.current !== 'barres') return;
      const pos = getPositionFromPoint(svg, event.clientX, event.clientY);
      if (!pos || pos.zone !== 'fret') return;
      barreDragRef.current = { fret: pos.fret, from: pos.string, to: pos.string, moved: false };
      try { svg.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    };
    const pointermoveHandler = (event) => {
      const drag = barreDragRef.current;
      if (!drag) return;
      const pos = getPositionFromPoint(svg, event.clientX, event.clientY);
      if (!pos || pos.zone !== 'fret') return;
      if (pos.string !== drag.to) {
        drag.to = pos.string;
        drag.moved = true;
      }
    };
    const pointerupHandler = () => {
      const drag = barreDragRef.current;
      if (!drag) return;
      barreDragRef.current = null;
      commitBarreDrag(drag);
    };
    const pointercancelHandler = () => {
      barreDragRef.current = null;
    };

    // Apply CSS user-select none to SVG for comprehensive text selection prevention
    svg.style.userSelect = 'none';
    svg.style.webkitUserSelect = 'none';
    svg.style.mozUserSelect = 'none';
    svg.style.msUserSelect = 'none';

    // Add the handlers
    svg.addEventListener('mousedown', mousedownHandler);
    svg.addEventListener('click', clickHandler);
    svg.addEventListener('pointerdown', pointerdownHandler);
    svg.addEventListener('pointermove', pointermoveHandler);
    svg.addEventListener('pointerup', pointerupHandler);
    svg.addEventListener('pointercancel', pointercancelHandler);

    // Store references for cleanup
    currentHandlerRef.current = {
      svg,
      clickHandler,
      mousedownHandler,
      pointerdownHandler,
      pointermoveHandler,
      pointerupHandler,
      pointercancelHandler
    };
  };

  // Translate a client-space point into chart coordinates.
  // Returns { zone: 'nut', string } | { zone: 'fret', string, fret } | null.
  //
  // SVGuitar layout analysis:
  // - There's padding around the actual fretboard
  // - Strings are vertical lines, frets are horizontal
  // - Frets are the spaces BETWEEN the fret wires, not the wires themselves
  const getPositionFromPoint = (svg, clientX, clientY) => {
    const rect = svg.getBoundingClientRect();
    const svgViewBox = svg.viewBox.baseVal;

    // Check if SVG is ready - if not, just skip this interaction
    if (!svgViewBox || svgViewBox.width === 0 || svgViewBox.height === 0 ||
        rect.width === 0 || rect.height === 0) {
      return null;
    }

    // Account for SVG scaling - the SVG viewBox vs actual display size
    const scaleX = svgViewBox.width / rect.width;
    const scaleY = svgViewBox.height / rect.height;
    if (!isFinite(scaleX) || !isFinite(scaleY)) {
      console.error('Invalid scale values:', { scaleX, scaleY });
      return null;
    }

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    // Use SVG viewBox dimensions for calculations, not display dimensions
    const chartWidth = svgViewBox.width;
    const chartHeight = svgViewBox.height;

    // Adjusted margins based on SVGuitar's actual layout. SVGuitar uses
    // relatively consistent top/bottom margins - the position indicator
    // doesn't significantly change the chord chart area.
    const marginX = chartWidth * 0.15;
    const marginY = chartHeight * 0.08;

    const fretboardWidth = chartWidth - (marginX * 2);
    const fretboardHeight = chartHeight - (marginY * 2);

    // Outside the chart area entirely
    if (x < marginX || x > chartWidth - marginX) {
      return null;
    }

    // Calculate string (vertical position across width) - same for both nut and fretboard
    const stringRatio = (x - marginX) / fretboardWidth;
    const stringIndex = Math.floor(stringRatio * numStrings);
    if (stringIndex < 0 || stringIndex >= numStrings) {
      return null;
    }

    // Convert to SVGuitar's string numbering (1-based, high E = 1)
    const svguitarString = numStrings - stringIndex; // Flip the order

    // Nut area is above the fretboard proper
    if (y < marginY) {
      return { zone: 'nut', string: svguitarString };
    }
    if (y > chartHeight - marginY) {
      return null;
    }

    // Calculate fret (horizontal position down height). SVGuitar uses 1-based
    // fret numbering relative to the chart position.
    const fretIndex = Math.ceil(((y - marginY) / fretboardHeight) * numFrets);
    if (fretIndex < 1 || fretIndex > numFrets) {
      return null;
    }

    return { zone: 'fret', string: svguitarString, fret: fretIndex };
  };

  const handleEditorClick = (event) => {
    if (!event || !event.currentTarget) {
      console.error('handleEditorClick called with invalid event');
      return;
    }

    const currentEditMode = editModeRef.current;
    if (currentEditMode !== 'dots' && currentEditMode !== 'fingers' && currentEditMode !== 'barres') return;

    const pos = getPositionFromPoint(event.currentTarget, event.clientX, event.clientY);
    if (!pos) return;

    debugLog('ChordEditor', 'Click debug:', pos);

    if (pos.zone === 'nut') {
      toggleNutMarker(pos.string);
      return;
    }

    // Handle the click based on current edit mode
    if (currentEditMode === 'dots') {
      toggleFinger(pos.string, pos.fret);
    } else if (currentEditMode === 'fingers') {
      if (useMobileUIRef.current) {
        // No keyboard on mobile: tapping cycles the finger number instead
        cycleFingerNumber(pos.string, pos.fret);
      } else {
        selectFingerForNumbering(pos.string, pos.fret);
      }
    } else if (currentEditMode === 'barres') {
      // Mobile barres are handled by the pointer drag handlers
      if (!useMobileUIRef.current) {
        toggleBarre(pos.string, pos.fret);
      }
    }
  };

  const toggleFinger = (string, fret) => {
    
    // Remove any nut markers when adding a finger position
    setOpenStrings(prev => {
      const next = new Set(prev);
      next.delete(string);
      return next;
    });
    setMutedStrings(prev => {
      const next = new Set(prev);
      next.delete(string);
      return next;
    });
    
    setFingers(prev => {
      const existingIndex = prev.findIndex((finger) => {
        const [s, f] = finger;
        const matches = s === string && f === fret;
        return matches;
      });
      
      if (existingIndex >= 0) {
        // Remove existing finger
        const newFingers = prev.filter((_, index) => index !== existingIndex);
        return newFingers;
      } else {
        // Add new finger with 3-element structure for finger numbering
        const newFingers = [...prev, [string, fret, undefined]];
        return newFingers;
      }
    });
  };

  const toggleNutMarker = (stringNum) => {
    const isOpen = openStrings.has(stringNum);
    const isMuted = mutedStrings.has(stringNum);
    
    // Remove any fretted notes on this string when adding nut markers
    setFingers(prev => prev.filter(([s]) => s !== stringNum));
    
    if (!isOpen && !isMuted) {
      // State: none → open
      setOpenStrings(prev => new Set([...prev, stringNum]));
    } else if (isOpen) {
      // State: open → muted
      setOpenStrings(prev => {
        const next = new Set(prev);
        next.delete(stringNum);
        return next;
      });
      setMutedStrings(prev => new Set([...prev, stringNum]));
    } else if (isMuted) {
      // State: muted → none
      setMutedStrings(prev => {
        const next = new Set(prev);
        next.delete(stringNum);
        return next;
      });
    }
  };

  const toggleBarre = (_string, fret) => {
    // SVGuitar arc-style barres render at the top edge of the fret space (on the fret wire
    // above), so a barre at fret N visually appears in fret N-1. Add 1 to compensate.
    const barreFret = fret + 1;

    setBarres(prev => {
      const existingIndex = prev.findIndex(barre => {
        return barre.fret === barreFret;
      });

      if (existingIndex >= 0) {
        // Remove existing barre
        const newBarres = prev.filter((_, index) => index !== existingIndex);
        return newBarres;
      } else {
        // Add new barre
        const newBarre = {
          fromString: 6,
          toString: 1,
          fret: barreFret,
          text: '1'
        };
        const newBarres = [...prev, newBarre];
        return newBarres;
      }
    });
  };

  // Mobile barres mode: commit a finished drag (or tap) from the pointer handlers.
  const commitBarreDrag = ({ fret, from, to, moved }) => {
    // Same wire-above compensation as toggleBarre
    const barreFret = fret + 1;
    const fromString = Math.max(from, to);
    const toString = Math.min(from, to);

    setBarres(prev => {
      const existingIndex = prev.findIndex(barre => barre.fret === barreFret);
      if (existingIndex >= 0) {
        // A drag over an existing barre re-spans it; a plain tap removes it
        return moved
          ? prev.map((barre, i) => (i === existingIndex ? { ...barre, fromString, toString } : barre))
          : prev.filter((_, i) => i !== existingIndex);
      }
      // A drag draws just the spanned strings; a plain tap draws a full barre
      return [...prev, moved
        ? { fromString, toString, fret: barreFret, text: '1' }
        : { fromString: numStrings, toString: 1, fret: barreFret, text: '1' }];
    });
  };

  // Mobile fingers mode: tap a position to cycle its finger number
  // (no dot → 1 → 2 → 3 → 4 → T → back to a plain dot).
  // Note: desktop's keyboard flow stores thumb as '5'; here it's 'T'. Finger
  // values are opaque display text end-to-end (nothing parses them), so the
  // asymmetry is intentional — 'T' is the conventional label and reads better
  // on a chart.
  const FINGER_CYCLE = ['1', '2', '3', '4', 'T'];
  const cycleFingerNumber = (string, fret) => {
    // Remove any nut markers when adding a finger position
    setOpenStrings(prev => {
      const next = new Set(prev);
      next.delete(string);
      return next;
    });
    setMutedStrings(prev => {
      const next = new Set(prev);
      next.delete(string);
      return next;
    });

    setFingers(prev => {
      const existingIndex = prev.findIndex(([s, f]) => s === string && f === fret);
      if (existingIndex === -1) {
        return [...prev, [string, fret, FINGER_CYCLE[0]]];
      }
      const [s, f, currentNumber] = prev[existingIndex];
      const cyclePos = FINGER_CYCLE.indexOf(currentNumber);
      // Past 'T' → back to an unnumbered dot; unnumbered (-1) → '1'
      const nextNumber = cyclePos === FINGER_CYCLE.length - 1 ? undefined : FINGER_CYCLE[cyclePos + 1];
      return prev.map((finger, i) => (i === existingIndex ? [s, f, nextNumber] : finger));
    });
  };

  const selectFingerForNumbering = (string, fret) => {
    // First ensure there's a finger at this position
    const existingFingerIndex = fingers.findIndex(finger => {
      const [s, f] = finger;
      return s === string && f === fret;
    });
    
    if (existingFingerIndex === -1) {
      // No finger here, add one first but don't trigger re-render immediately
      
      // Remove any nut markers when adding a finger position
      setOpenStrings(prev => {
        const next = new Set(prev);
        next.delete(string);
        return next;
      });
      setMutedStrings(prev => {
        const next = new Set(prev);
        next.delete(string);
        return next;
      });
      
      // Add the finger and set it as selected in one batch update
      setFingers(prev => {
        const newFingers = [...prev, [string, fret, undefined]];
        return newFingers;
      });
      
      // Set this position as selected for number input
      setSelectedFinger([string, fret]);
    } else {
      // Set this position as selected for number input
      setSelectedFinger([string, fret]);
    }
  };

  const setFingerNumber = (string, fret, number) => {
    
    setFingers(prev => {
      return prev.map(finger => {
        const [s, f, currentNumber] = finger;
        
        if (s === string && f === fret) {
          return [s, f, number];
        }
        // Ensure all fingers have 3-element structure
        return finger.length === 3 ? finger : [s, f, currentNumber];
      });
    });
  };

  const updateCharts = () => {
    if (!editorChartRef.current) {
      return;
    }

    // If the chart element doesn't exist in DOM, skip (the result chart is
    // optional — the mobile layout renders a single WYSIWYG chart)
    const editorElement = document.querySelector('#editor-chart');
    const resultElement = document.querySelector('#result-chart');
    if (!editorElement) {
      return;
    }

    try {
      const config = {
        ...defaultChartConfig,
        strings: numStrings,
        frets: numFrets,
        position: startingFret,
        tuning: []  // Empty array to hide SVGuitar's built-in tuning labels
      };

      // Combine regular fingers with open and muted strings
      // Process fingers to ensure proper finger number format for SVGuitar
      const processedFingers = fingers.map(finger => {
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
        ...Array.from(openStrings).map(string => [string, 0]),
        // Add muted strings as [string, 'x']
        ...Array.from(mutedStrings).map(string => [string, 'x'])
      ];

      const chordData = {
        fingers: allFingers,
        barres
      };


      // Check if chord data or title has actually changed
      const chartStateString = JSON.stringify({ chordData, title });
      const hasChanged = chartStateString !== lastChordDataRef.current;
      
      if (hasChanged) {
        lastChordDataRef.current = chartStateString;
        
        // Update existing charts without recreating them
        editorChartRef.current
          .configure(config)
          .chord(chordData)
          .draw();

        if (resultChartRef.current && resultElement) {
          resultChartRef.current
            .configure({
              ...config,
              title
            })
            .chord(chordData)
            .draw();
        }

      } else {
      }
      
      // Add explicit debug output to check if finger text is being applied
      setTimeout(() => {
        const editorSvg = document.querySelector('#editor-chart svg');
        const resultSvg = document.querySelector('#result-chart svg');
        
        // Check for finger text elements in the SVG
        if (editorSvg) {
          // Finger text elements available via: editorSvg.querySelectorAll('text[fill="#000000"]')
        }
        
        if (resultSvg) {
          // Finger text elements available via: resultSvg.querySelectorAll('text[fill="#000000"]')
        }
        
        // Style the SVGs
        if (editorSvg) {
          if (useMobileUIRef.current) {
            // Mobile WYSIWYG chart: scale the finished SVG up into the larger
            // touch-friendly container (never change the SVGuitar config per
            // size). height + width:auto keeps the element box at the viewBox
            // aspect ratio, which the tap coordinate math depends on.
            editorSvg.style.width = 'auto';
            editorSvg.style.height = '290px';
            editorSvg.style.maxWidth = '100%';
            editorSvg.style.maxHeight = 'none';
          } else {
            editorSvg.style.width = '100%';
            editorSvg.style.height = '100%';
            editorSvg.style.maxWidth = '128px';  // Reduced ~20% (was 160)
            editorSvg.style.maxHeight = '180px'; // Reduced ~20% (was 224)
          }
          // Barre dragging needs the browser's touch gestures disabled;
          // leave scrolling alone in the other modes
          editorSvg.style.touchAction = (useMobileUIRef.current && editModeRef.current === 'barres') ? 'none' : '';
        }

        if (resultSvg) {
          resultSvg.style.width = '100%';
          resultSvg.style.height = '100%';
          resultSvg.style.maxWidth = '128px';  // Reduced ~20% (was 160)
          resultSvg.style.maxHeight = '180px'; // Reduced ~20% (was 224)
        }
        
        setupEditorInteraction();
      }, 100);
    } catch (error) {
      console.error('Error updating charts:', error);
    }
  };

  useEffect(() => {
    updateCharts();
  }, [title, startingFret, numFrets, numStrings, fingers, barres, tuning, openStrings, mutedStrings, chartsInitialized]);

  // Keyboard event listener for finger numbers
  useEffect(() => {
    const handleKeyPress = (event) => {
      if (editMode !== 'fingers' || !selectedFinger) return;
      
      const key = event.key;
      if (['1', '2', '3', '4', '5'].includes(key)) {
        const [string, fret] = selectedFinger;
        setFingerNumber(string, fret, key);
        setSelectedFinger(null); // Clear selection after setting number
        event.preventDefault();
      } else if (key === 'Escape') {
        setSelectedFinger(null); // Clear selection on escape
        event.preventDefault();
      }
    };

    if (editMode === 'fingers') {
      document.addEventListener('keydown', handleKeyPress);
      return () => document.removeEventListener('keydown', handleKeyPress);
    }
  }, [editMode, selectedFinger]);

  // Keep touch-action in sync with the current mode (barre dragging must not
  // fight the browser's scroll gesture; other modes should scroll normally)
  useEffect(() => {
    const svg = editorContainerRef.current?.querySelector('svg');
    if (!svg) return;
    svg.style.touchAction = (useMobileUI && editMode === 'barres') ? 'none' : '';
  }, [editMode, useMobileUI]);

  // The save button can sit at the bottom edge of a scrolled modal, so bring
  // the error into view rather than trusting it to be on screen already
  const saveErrorRef = useRef(null);
  useEffect(() => {
    if (saveError) {
      saveErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [saveError]);

  // Determine if the save button should be enabled.
  // Public editor (saveButtonLabel set): enabled when any chart content exists.
  // In-app editor: enabled when the chord has a title.
  const hasChartContent = title.trim() || fingers.length > 0 || barres.length > 0 || openStrings.size > 0 || mutedStrings.size > 0;
  const canSave = saveButtonLabel ? hasChartContent : Boolean(title.trim());

  const idleSaveLabel = saveButtonLabel || (editingChordId ? 'Update chord chart' : 'Add chord chart');
  const saveButtonText = isSaving ? 'Saving...' : idleSaveLabel;

  // Where to report a problem that keeps happening. Wording matches the FAQ
  // and about pages. The chat widget needs the full PostHog SDK, which only
  // loads for users who accepted cookies - so pointing everyone at it would
  // send the rest looking for a bubble that isn't on their screen.
  // Deliberately no reload: this note only shows after a failed save, so the
  // user's chord is unsaved and a reload would discard it. Consent is stored
  // now; the widget appears on their next page load.
  const handleAllowCookies = async () => {
    try {
      await acceptAllCookies({ reload: false });
      setCookiesJustAllowed(true);
    } catch (error) {
      // Storage blocked - consent didn't stick, so don't claim it did. The
      // GitHub link in the unchanged note is still a working way to report.
      console.error('Failed to store cookie consent:', error);
    }
  };

  const renderReportProblemNote = () => {
    if (cookiesAllowed) {
      return (
        <>
          If it keeps happening, use the chat widget in the bottom-right corner, or{' '}
          <a
            href="https://github.com/slshults/gpra-web/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-400 hover:underline"
            data-ph-capture-attribute-link="chord-editor-report-problem"
          >
            open a bug report on GitHub
          </a>.
        </>
      );
    }

    if (cookiesJustAllowed) {
      return (
        <>
          Cookies allowed — refresh the page and the chat widget will be in the
          bottom-right corner. Save your chord first, it isn't saved yet.
        </>
      );
    }

    return (
      <>
          <button
            type="button"
            onClick={handleAllowCookies}
            className="text-orange-400 hover:underline"
            data-ph-capture-attribute-button="chord-editor-allow-cookies"
          >
            Allow cookies
          </button>
          {' '}to use the chat widget to report the problem, or{' '}
          <a
            href="https://github.com/slshults/gpra-web/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-400 hover:underline"
            data-ph-capture-attribute-link="chord-editor-report-problem"
          >
            open a bug report on GitHub
          </a>.
      </>
    );
  };

  const reportProblemNote = (
    <>
      <p className="text-xs text-gray-400 mt-1">{renderReportProblemNote()}</p>
      {/* The note is a sibling of the role="alert" error, so swapping states
          would otherwise be silent to a screen reader - and activating "Allow
          cookies" unmounts the button, dropping focus. Starts empty so mounting
          announces nothing; only the swap speaks. */}
      <p aria-live="polite" className="sr-only">
        {cookiesJustAllowed ? 'Cookies allowed. Refresh the page to get the chat widget.' : ''}
      </p>
    </>
  );

  // Feedback under the save button in both layouts: why the button is
  // disabled, or why the last save attempt failed
  const saveFeedback = (
    <>
      {!canSave && (
        <p className="text-xs text-gray-400">
          {saveButtonLabel ? 'Nothing to clear yet' : 'Enter a chord name to save'}
        </p>
      )}
      {/* scrollMarginBottom keeps scrollIntoView from parking this behind
          MobileTabBar, which is fixed over the bottom of the viewport. On mobile
          the chat bubble also floats over the bottom-right and covered the tail
          of the note below - including the words describing where the bubble is
          - so pad the whole block clear of it. Inline styles because the
          Tailwind build only ships classes already in use. */}
      {saveError && (
        <div
          ref={saveErrorRef}
          style={{ scrollMarginBottom: '96px', paddingRight: useMobileUI ? '60px' : undefined }}
        >
          <p className="text-sm text-red-400" role="alert">
            {`${saveError} — your chord wasn't saved, please try again`}
          </p>
          {reportProblemNote}
        </div>
      )}
    </>
  );

  const handleSave = async () => {
    const saveData = {
      title,
      startingFret,
      numFrets,
      numStrings,
      tuning,
      capo,
      fingers,
      barres,
      openStrings: Array.from(openStrings),
      mutedStrings: Array.from(mutedStrings),
      // Both new and existing chords use startOnNewLine to affect the previous chord
      startOnNewLine: addLineBreak,
      editingChordId,  // Pass this so the save handler knows whether to create or update
      // Include insertion context for proper positioning and section metadata
      insertionContext
    };

    debugLog('ChordEditor', 'Saving chord with line break data:', {
      title,
      addLineBreak,
      startOnNewLine: addLineBreak,
      editingChordId
    });

    setSaveError(null);
    setIsSaving(true);
    try {
      // Parents close the editor on success and throw on failure, so the
      // error lands here — next to the button the user clicked
      await onSave(saveData);
    } catch (error) {
      setSaveError(error?.message || 'Failed to save chord chart');
    } finally {
      setIsSaving(false);
    }
  };

  // Mobile WYSIWYG layout (design 2b): one live chart, segmented mode control,
  // tap/drag interactions, stepper settings. Only one layout subtree mounts at
  // a time (this early return), so the #editor-chart id is never duplicated.
  if (useMobileUI) {
    const helperText = {
      dots: 'Tap a fret to place or remove a dot · tap above the nut for open / mute',
      fingers: 'Tap a dot to cycle its finger number 1–4 · T for thumb',
      barres: 'Drag across strings on a fret to draw a barre · tap a barre to remove it',
    }[editMode];

    return (
      <div className="bg-gray-800 p-3" style={{ borderRadius: '12px' }}>
        <div className="space-y-3">
          {/* Chord name field */}
          <div>
            <div className="text-xs text-blue-400 mb-1">Chord name</div>
            <div className="relative">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => tryAutofill(title)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    e.target.blur(); // dismisses the keyboard; blur triggers autofill
                  }
                }}
                placeholder="Type a chord name, e.g. Am7"
                className="bg-gray-900"
                style={{ height: '44px', fontSize: '15px' }}
                disabled={isLoadingChord}
              />
              {isLoadingChord && (
                <div className="absolute right-2 top-3 text-yellow-400 text-xs" role="status" aria-live="polite">
                  <span className="sr-only">Loading chord data</span>
                  <span aria-hidden="true">Loading...</span>
                </div>
              )}
            </div>
            {loadError && !isLoadingChord && (
              <p className="text-xs text-yellow-400 mt-1" role="alert">{loadError}</p>
            )}
          </div>

          {/* Mode segmented control */}
          <div className="flex border border-gray-700 bg-gray-900 overflow-hidden" style={{ borderRadius: '10px' }}>
            {[['dots', 'Dots'], ['fingers', 'Fingers'], ['barres', 'Barres']].map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setEditMode(mode)}
                className={`flex-1 text-sm font-semibold ${editMode === mode ? 'bg-blue-600 text-white' : 'text-gray-300'}`}
                style={{ height: '44px' }}
                data-ph-capture-attribute-button={`chord-editor-${mode}-mode`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Live WYSIWYG chart */}
          <div className="bg-gray-900" style={{ borderRadius: '12px', padding: '16px' }}>
            <div className="mx-auto flex items-center justify-center overflow-hidden select-none" style={{ maxWidth: '270px', height: '290px' }}>
              <div id="editor-chart" ref={editorContainerRef} className="cursor-pointer select-none" />
            </div>
            <div className="text-xs text-gray-500 text-center mt-2">{helperText}</div>
          </div>

          {/* Starting fret stepper */}
          <div className="flex items-center justify-between bg-gray-900 border border-gray-700 px-3" style={{ borderRadius: '10px', height: '52px' }}>
            <span className="text-sm text-gray-300">Starting fret</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setStartingFret(prev => Math.max(1, prev - 1))}
                className="border border-gray-700 text-gray-200 text-lg"
                style={{ width: '44px', height: '40px', borderRadius: '8px' }}
                aria-label="Decrease starting fret"
                data-ph-capture-attribute-button="chord-editor-fret-decrease"
              >
                −
              </button>
              <span
                className="text-sm text-white text-center"
                style={{ width: '28px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              >
                {startingFret}
              </span>
              <button
                onClick={() => setStartingFret(prev => Math.min(15, prev + 1))}
                className="border border-gray-700 text-gray-200 text-lg"
                style={{ width: '44px', height: '40px', borderRadius: '8px' }}
                aria-label="Increase starting fret"
                data-ph-capture-attribute-button="chord-editor-fret-increase"
              >
                +
              </button>
            </div>
          </div>

          {/* Line break option */}
          {showLineBreak && (
            <div className="flex items-center justify-between bg-gray-900 border border-gray-700 px-3" style={{ borderRadius: '10px', height: '52px' }}>
              <label htmlFor="addLineBreakMobile" className="text-sm text-gray-300 cursor-pointer">
                Line break after ↩️
              </label>
              <input
                type="checkbox"
                id="addLineBreakMobile"
                checked={addLineBreak}
                onChange={(e) => setAddLineBreak(e.target.checked)}
                className="w-4 h-4 text-blue-600 bg-gray-900 border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
              />
            </div>
          )}

          {/* More settings toggle */}
          <button
            type="button"
            className="block text-left text-blue-400 cursor-pointer"
            style={{ fontSize: '13px' }}
            onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
          >
            {showAdvancedSettings ? 'Hide settings…' : 'More settings…'}
          </button>

          {showAdvancedSettings && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-white mb-1">Tuning</div>
                <Input
                  value={tuning}
                  onChange={(e) => setTuning(e.target.value)}
                  placeholder="EADGBE"
                  className="bg-gray-900"
                />
              </div>
              <div>
                <div className="text-sm text-white mb-1">Capo</div>
                <Input
                  type="number"
                  min="0"
                  max="12"
                  value={capo}
                  onChange={(e) => setCapo(parseInt(e.target.value) || 0)}
                  className="bg-gray-900"
                />
              </div>
              <div>
                <div className="text-sm text-white mb-1">Number of frets</div>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={numFrets}
                  onChange={(e) => setNumFrets(parseInt(e.target.value) || 5)}
                  className="bg-gray-900"
                />
              </div>
              <div>
                <div className="text-sm text-white mb-1">Number of strings</div>
                <Input
                  type="number"
                  min="4"
                  max="12"
                  value={numStrings}
                  onChange={(e) => setNumStrings(parseInt(e.target.value) || 6)}
                  className="bg-gray-900"
                />
              </div>
            </div>
          )}

          {/* Action buttons */}
          <Button
            onClick={handleSave}
            className={`w-full ${canSave ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`}
            style={{ height: '48px', borderRadius: '10px' }}
            disabled={!canSave || isSaving}
            data-ph-capture-attribute-button={editingChordId ? "chord-editor-update" : "chord-editor-save"}
          >
            {saveButtonText}
          </Button>
          {saveFeedback}

          {onCancel && (
            <Button
              onClick={onCancel}
              variant="outline"
              className="w-full border-gray-600 text-gray-300 hover:bg-gray-700"
              style={{ height: '48px', borderRadius: '10px' }}
              data-ph-capture-attribute-button="chord-editor-cancel"
            >
              Cancel
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="space-y-4">
        {/* Chord Name field */}
        <div>
          <div className="text-sm text-blue-400 mb-1">Chord name</div>
          <div className="relative">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => tryAutofill(title)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  tryAutofill(title);
                }
              }}
              placeholder="Enter the chord name, then hit 'Enter'"
              className="bg-gray-900"
              disabled={isLoadingChord}
            />
            {isLoadingChord && (
              <div className="absolute right-2 top-2 text-yellow-400 text-xs" role="status" aria-live="polite">
                <span className="sr-only">Loading chord data</span>
                <span aria-hidden="true">Loading...</span>
              </div>
            )}
          </div>
          {loadError && !isLoadingChord && (
            <p className="text-xs text-yellow-400 mt-1" role="alert">{loadError}</p>
          )}
        </div>

        {/* Show more settings toggle */}
        <div 
          className="text-sm text-blue-400 hover:underline cursor-pointer"
          onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
        >
          {showAdvancedSettings ? 'Hide advanced settings...' : 'Show more settings...'}
        </div>

        {/* Advanced settings - collapsible */}
        {showAdvancedSettings && (
          <div className="space-y-4">
            {/* Basic advanced settings */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-sm text-white mb-1">Tuning</div>
                <Input
                  value={tuning}
                  onChange={(e) => setTuning(e.target.value)}
                  placeholder="EADGBE"
                  className="bg-gray-900"
                />
              </div>
              <div>
                <div className="text-sm text-white mb-1">Capo</div>
                <Input
                  type="number"
                  min="0"
                  max="12"
                  value={capo}
                  onChange={(e) => setCapo(parseInt(e.target.value) || 0)}
                  className="bg-gray-900"
                />
              </div>
              <div>
                <div className="text-sm text-white mb-1">Starting fret</div>
                <Input
                  type="number"
                  min="1"
                  max="15"
                  value={startingFret}
                  onChange={(e) => setStartingFret(parseInt(e.target.value) || 1)}
                  className="bg-gray-900"
                />
              </div>
            </div>

            {/* Second row of advanced settings */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-white mb-1">Number of frets</div>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={numFrets}
                  onChange={(e) => setNumFrets(parseInt(e.target.value) || 5)}
                  className="bg-gray-900"
                />
              </div>
              <div>
                <div className="text-sm text-white mb-1">Number of strings</div>
                <Input
                  type="number"
                  min="4"
                  max="12"
                  value={numStrings}
                  onChange={(e) => setNumStrings(parseInt(e.target.value) || 6)}
                  className="bg-gray-900"
                />
              </div>
            </div>
          </div>
        )}


        {/* Editor and Result sections */}
        <div className="flex gap-8 justify-center">
          <div>
            <div className="text-lg text-white mb-2">Editor</div>
            <div className="border border-gray-700 rounded-lg px-1 pt-1 pb-0">
              <div className="relative w-32 mx-auto flex items-center justify-center overflow-hidden select-none" style={{height: '184px'}}>
                <div id="editor-chart" ref={editorContainerRef} className="cursor-pointer select-none" />
              </div>
            </div>
          </div>

          <div>
            <div className="text-lg text-white mb-2">Result</div>
            <div className="border border-gray-700 rounded-lg px-1 pt-1 pb-0">
              <div className="relative w-32 mx-auto flex items-center justify-center overflow-hidden select-none" style={{height: '184px'}}>
                <div id="result-chart" className="select-none" />
              </div>
            </div>
          </div>
        </div>


        {/* Edit mode buttons */}
        <div className="flex gap-2">
          <Button
            variant={editMode === 'dots' ? 'default' : 'outline'}
            onClick={() => setEditMode('dots')}
            className={`flex-1 ${
              editMode === 'dots'
                ? 'bg-blue-700 hover:bg-blue-800 text-white'
                : 'bg-black hover:bg-gray-800 text-gray-300 border border-gray-600'
            }`}
            data-ph-capture-attribute-button="chord-editor-dots-mode"
          >
            Edit dots
          </Button>
          <Button
            variant={editMode === 'fingers' ? 'default' : 'outline'}
            onClick={() => {
              setEditMode('fingers');
            }}
            className={`flex-1 ${
              editMode === 'fingers'
                ? '!bg-blue-800 hover:!bg-blue-900 !text-white !border !border-blue-600'
                : '!bg-black hover:!bg-gray-800 !text-gray-300 !border !border-gray-600'
            }`}
            data-ph-capture-attribute-button="chord-editor-fingers-mode"
          >
            Edit fingers
          </Button>
          <Button
            variant={editMode === 'barres' ? 'default' : 'outline'}
            onClick={() => setEditMode('barres')}
            className={`flex-1 ${
              editMode === 'barres'
                ? '!bg-green-700 hover:!bg-green-800 !text-white !border !border-green-600'
                : '!bg-black hover:!bg-gray-800 !text-gray-300 !border !border-gray-600'
            }`}
            data-ph-capture-attribute-button="chord-editor-barres-mode"
          >
            Edit barres
          </Button>
        </div>

        {/* Mode-specific instructions */}
        {editMode === 'dots' && (
          <div className="bg-gray-700 bg-opacity-50 border border-gray-600 rounded-lg p-3 text-sm text-gray-200">
            Click on a string above the fret where you want to add a dot
          </div>
        )}

        {editMode === 'barres' && (
          <div className="bg-green-900 bg-opacity-50 border border-green-600 rounded-lg p-3 text-sm text-green-200">
            Click on any fret to add/remove a full barre across all strings at that fret. Perfect for chords like F, B, F#m, etc.
          </div>
        )}

        {editMode === 'fingers' && (
          <div className="bg-blue-900 bg-opacity-50 border border-blue-600 rounded-lg p-3 text-sm text-blue-200">
            Click on a finger position, then press 1-5 keys to assign finger numbers (5 = thumb). Press Escape to cancel selection.
            {selectedFinger && (
              <div className="mt-2 text-yellow-300">
                Selected position: String {selectedFinger[0]}, Fret {selectedFinger[1]} - Press 1, 2, 3, 4, or 5
              </div>
            )}
          </div>
        )}
        
        {/* Line break option */}
        {showLineBreak && (
          <div className="flex items-center space-x-2 bg-gray-700 rounded-lg p-3">
            <input
              type="checkbox"
              id="addLineBreak"
              checked={addLineBreak}
              onChange={(e) => setAddLineBreak(e.target.checked)}
              className="w-4 h-4 text-blue-600 bg-gray-900 border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
            />
            <label htmlFor="addLineBreak" className="text-sm text-gray-300 cursor-pointer">
              Line break after ↩️
            </label>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            className={`flex-1 ${canSave ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`}
            disabled={!canSave || isSaving}
            data-ph-capture-attribute-button={editingChordId ? "chord-editor-update" : "chord-editor-save"}
          >
            {saveButtonText}
          </Button>

          {onCancel && (
            <Button
              onClick={onCancel}
              variant="outline"
              className="flex-1 border-gray-600 text-gray-300 hover:bg-gray-700"
              data-ph-capture-attribute-button="chord-editor-cancel"
            >
              Cancel
            </Button>
          )}
        </div>
        {saveFeedback}
      </div>
    </div>
  );
};