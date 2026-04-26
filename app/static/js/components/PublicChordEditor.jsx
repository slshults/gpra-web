import { useState, useMemo } from 'react';
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
