import { useState, useMemo, useEffect, useRef } from 'react';
import { ChordChartEditor } from '@components/ChordChartEditor';

const PublicChordEditor = () => {
  const [editorKey, setEditorKey] = useState(0);

  // Read URL params once on mount so deep-links (?id=N or ?chord=NAME) auto-populate
  // the editor. ?id wins when both are present.
  const { initialChordId, initialChordName } = useMemo(() => {
    if (typeof window === 'undefined') return { initialChordId: null, initialChordName: null };
    const params = new URLSearchParams(window.location.search);
    const idRaw = params.get('id');
    const id = idRaw && /^\d+$/.test(idRaw) ? parseInt(idRaw, 10) : null;
    const name = params.get('chord');
    return {
      initialChordId: id,
      initialChordName: id ? null : (name || null),
    };
  }, []);

  // Capture deep-link arrivals so we can see which chords social posts (and any
  // other inbound link) are driving lookups for. UTM params from the daily-post
  // formatter are auto-attached by PostHog. Ref-guarded against StrictMode's
  // dev-only double-invocation.
  const lookupCapturedRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (initialChordId == null && !initialChordName) return;
    if (lookupCapturedRef.current) return;
    lookupCapturedRef.current = true;
    window.posthog?.capture('chord_lookup', {
      lookup_source: initialChordId != null ? 'deep_link_id' : 'deep_link_name',
      common_chord_id: initialChordId,
      chord_name: initialChordName,
    });
  }, [initialChordId, initialChordName]);

  const handleClear = () => {
    setEditorKey(prev => prev + 1);
  };

  return (
    <ChordChartEditor
      key={editorKey}
      itemId={null}
      onSave={handleClear}
      saveButtonLabel="Clear and start over"
      showLineBreak={false}
      initialChordId={initialChordId}
      initialChordName={initialChordName}
    />
  );
};

export default PublicChordEditor;
