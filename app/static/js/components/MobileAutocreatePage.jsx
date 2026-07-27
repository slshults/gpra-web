// app/static/js/components/MobileAutocreatePage.jsx
// Full-screen mobile autocreate creator (design 5a).
//
// The mobile chord UI never had an autocreate entry point — PracticePage returns
// its mobile view long before the desktop autocreate zone renders, so on a phone
// the only way in was the desktop 3-column zone stacked inside ChordChartsModal.
// This is a new front door on the same flow: the backend and every handler are
// unchanged, and this component is presentational. Both PracticePage and
// ChordChartsModal own their own copy of the autocreate state (they always have)
// and pass it down here, so neither one's logic is duplicated a third time.
//
// Rendered as fixed inset-0 at zIndex 80, which is how the other full-screen
// mobile sheets sit over the 60-z bottom tab bar. That also puts it above the
// z-50 Radix dialog layer, so the parent passes `hidden` while any of the
// autocreate modals (effort selector, mixed content, errors, success) is open —
// the sheet stays mounted and keeps its state, it just steps out of the way.
import { useRef, useState } from 'react';
// AlertTriangle is TriangleAlert's name in the lucide version pinned here
import { AlertTriangle, Camera, ChevronLeft, Image as ImageIcon, Loader2, Sparkles, Upload } from 'lucide-react';

const METHODS = [
  { value: 'upload', label: 'Upload' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'camera', label: 'Camera' },
  { value: 'manual', label: 'Manual' },
];

// The server caps uploads at 5 MB and rejects anything larger after the whole
// file has gone up. Phone photos routinely clear that, so check here first.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const FIELD_STYLE = {
  backgroundColor: '#0b1120',
  border: '1px solid #374151',
  borderRadius: '10px',
  color: '#f3f4f6',
  boxSizing: 'border-box',
};

const MobileAutocreatePage = ({
  itemName,
  existingChartCount = 0,
  files = [],
  onFilesSelected,
  youtubeUrl = '',
  onYoutubeUrlChange,
  manualInput = '',
  onManualInputChange,
  manualError,
  onMethodChange,
  onSubmit,
  onClose,
  progress,
  processingMessage,
  onCancel,
  claudeless = false,
  hidden = false,
}) => {
  const [method, setMethod] = useState('upload');
  const [sizeError, setSizeError] = useState(null);
  const uploadInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  const busy = !!progress && progress !== 'complete' && progress !== 'error';

  const selectMethod = (next) => {
    if (next === method) return;
    setMethod(next);
    setSizeError(null);
    // One method at a time is the existing product rule, and the submit handler
    // routes by whichever input is populated — so clear the others on switch.
    onMethodChange?.(next);
  };

  // Backend takes exactly one file per request, so the pickers are single-file.
  const handlePicked = (event) => {
    const picked = Array.from(event.target.files || []);
    event.target.value = '';
    if (!picked.length) return;
    if (picked[0].size > MAX_UPLOAD_BYTES) {
      setSizeError(`That file is ${(picked[0].size / 1024 / 1024).toFixed(1)} MB — the limit is 5 MB.`);
      return;
    }
    setSizeError(null);
    onFilesSelected?.(picked);
  };

  const pasteYoutubeUrl = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) onYoutubeUrlChange?.(text.trim());
    } catch {
      // Clipboard permission denied or unavailable — the field is still typable
    }
  };

  const hasInputForMethod = () => {
    switch (method) {
      case 'youtube':
        return !!youtubeUrl.trim();
      case 'manual':
        return !!manualInput.trim();
      default:
        return files.length > 0;
    }
  };

  const canSubmit = !busy && hasInputForMethod();

  const selectedFileName = files.length ? files[0].name : null;

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ zIndex: 80, backgroundColor: '#020817', display: hidden ? 'none' : 'flex' }}
    >
      <div className="flex-1 overflow-y-auto" style={{ paddingBottom: '16px' }}>
        {/* Sticky header */}
        <div
          className="sticky flex items-center"
          style={{
            top: 0,
            zIndex: 40,
            height: '52px',
            gap: '8px',
            padding: '0 14px',
            backgroundColor: 'rgba(17,24,39,0.96)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            borderBottom: '1px solid #1f2937',
            boxSizing: 'border-box',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center shrink-0"
            style={{ width: '32px', height: '44px', marginLeft: '-8px', color: '#9ca3af' }}
            aria-label="Back to chord charts"
            data-ph-capture-attribute-button="mobile-autocreate-back"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="min-w-0">
            <div className="font-bold" style={{ fontSize: '15px', color: '#f3f4f6' }}>Create chord charts</div>
            {itemName && (
              <div className="truncate" style={{ fontSize: '10.5px', color: '#6b7280' }}>{itemName}</div>
            )}
          </div>
        </div>

        {busy ? (
          /* Processing — same rotating messages the desktop zone shows */
          <div style={{ margin: '12px', padding: '28px 16px', backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: '14px' }}>
            <div className="flex flex-col items-center text-center" style={{ gap: '10px' }}>
              <Loader2 className="animate-spin" size={26} color="#fb923c" />
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#d1d5db' }}>
                {processingMessage || 'Analyzing chord diagrams…'}
              </div>
              <div style={{ fontSize: '11.5px', color: '#6b7280' }}>Usually 5–30 seconds</div>
              <button
                type="button"
                onClick={onCancel}
                style={{ marginTop: '6px', minHeight: '44px', padding: '0 18px', borderRadius: '10px', border: '1px solid #374151', color: '#d1d5db', fontSize: '13px', fontWeight: 600 }}
                data-ph-capture-attribute-button="mobile-autocreate-cancel"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Method tabs */}
            <div className="flex" style={{ margin: '12px', backgroundColor: '#1f2937', borderRadius: '10px', padding: '3px', gap: '2px' }}>
              {METHODS.map((m) => {
                const active = m.value === method;
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => selectMethod(m.value)}
                    className="flex items-center justify-center font-bold"
                    style={{
                      flex: 1,
                      height: '34px',
                      borderRadius: '8px',
                      fontSize: '12.5px',
                      backgroundColor: active ? '#f97316' : 'transparent',
                      color: active ? '#111827' : '#9ca3af',
                    }}
                    aria-pressed={active}
                    data-ph-capture-attribute-button={`mobile-autocreate-${m.value}`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>

            {method === 'upload' && (
              <div className="flex flex-col" style={{ padding: '0 12px', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  className="flex flex-col items-center justify-center w-full"
                  style={{ height: '220px', borderRadius: '14px', border: '1.5px dashed #374151', gap: '8px' }}
                  data-ph-capture-attribute-button="mobile-autocreate-choose-file"
                >
                  <Upload size={30} color="#9ca3af" />
                  <div style={{ fontSize: '15px', fontWeight: 600, color: '#d1d5db' }}>
                    {selectedFileName || 'Tap to choose a file'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>PDF, PNG, JPG · 5 MB max</div>
                </button>
                <div className="text-center" style={{ fontSize: '11.5px', color: '#6b7280' }}>
                  Lyrics with chord names create charts · chord diagrams "import"
                </div>
              </div>
            )}

            {method === 'youtube' && (
              <div className="flex flex-col" style={{ padding: '0 12px', gap: '10px' }}>
                <div className="flex" style={{ gap: '8px' }}>
                  <input
                    type="url"
                    inputMode="url"
                    value={youtubeUrl}
                    onChange={(e) => onYoutubeUrlChange?.(e.target.value)}
                    placeholder="Paste a YouTube link…"
                    aria-label="YouTube link"
                    maxLength={500}
                    style={{ ...FIELD_STYLE, flex: 1, height: '48px', padding: '0 12px', fontSize: '13px' }}
                  />
                  <button
                    type="button"
                    onClick={pasteYoutubeUrl}
                    className="flex items-center font-semibold shrink-0"
                    style={{ height: '48px', padding: '0 16px', borderRadius: '10px', backgroundColor: '#1f2937', border: '1px solid #374151', color: '#d1d5db', fontSize: '13px' }}
                    data-ph-capture-attribute-button="mobile-autocreate-paste"
                  >
                    Paste
                  </button>
                </div>
                <div style={{ fontSize: '11.5px', color: '#6b7280' }}>
                  The video must have a transcript — most lesson videos do.
                </div>
              </div>
            )}

            {method === 'camera' && (
              <div className="flex flex-col" style={{ padding: '0 12px', gap: '12px' }}>
                {/* Tapping anywhere here opens the phone's own camera, which brings
                    its own viewfinder, flip control and shutter. */}
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex flex-col items-center justify-center text-center w-full"
                  style={{ height: '360px', borderRadius: '14px', backgroundColor: '#0b1120', border: '1px solid #1f2937', gap: '8px', padding: '0 24px', boxSizing: 'border-box' }}
                  data-ph-capture-attribute-button="mobile-autocreate-camera"
                >
                  <Camera size={38} color="#4b5563" strokeWidth={1.6} />
                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#9ca3af' }}>
                    {selectedFileName || 'Position the chord sheet in frame'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#4b5563' }}>Flatten the page · even light works best</div>
                </button>
                <div className="flex items-center justify-center" style={{ gap: '28px', padding: '4px 0' }}>
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="flex items-center justify-center"
                    style={{ width: '44px', height: '44px', color: '#9ca3af' }}
                    aria-label="Choose an existing photo"
                    data-ph-capture-attribute-button="mobile-autocreate-gallery"
                  >
                    <ImageIcon size={22} />
                  </button>
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex items-center justify-center"
                    style={{ width: '64px', height: '64px', borderRadius: '50%', border: '4px solid #f3f4f6' }}
                    aria-label="Take a photo"
                    data-ph-capture-attribute-button="mobile-autocreate-shutter"
                  >
                    <span style={{ width: '50px', height: '50px', borderRadius: '50%', backgroundColor: '#f3f4f6' }} />
                  </button>
                  {/* The mock's flip-camera control lives in the native camera UI */}
                  <span style={{ width: '44px' }} aria-hidden="true" />
                </div>
              </div>
            )}

            {method === 'manual' && (
              <div style={{ padding: '0 12px' }}>
                <textarea
                  value={manualInput}
                  onChange={(e) => {
                    if (e.target.value.length <= 500) onManualInputChange?.(e.target.value);
                  }}
                  maxLength={500}
                  aria-label="Chord names"
                  placeholder={claudeless
                    ? "Type chord names separated by commas. Use 'Enter' for line breaks.\nExample:\nG, C, Am, F\nD, Em, D"
                    : 'Enter song section names and chord names, like this:\nIntro\nAm7 Em/A E7sus\nVerse\nC G/B Am (space or comma-separated)'}
                  className="w-full"
                  style={{
                    ...FIELD_STYLE,
                    height: '220px',
                    padding: '12px',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: '13px',
                    lineHeight: 1.7,
                    resize: 'none',
                    borderColor: manualError ? '#ef4444' : '#374151',
                  }}
                />
                <div className="flex items-start justify-between" style={{ gap: '8px', padding: '8px 2px 0' }}>
                  <div style={{ fontSize: '11.5px', color: manualError ? '#f87171' : '#6b7280' }}>
                    {manualError || (claudeless
                      ? "We'll look up each chord in our library of common shapes."
                      : 'Section name on its own line, chords below it')}
                  </div>
                  <div className="shrink-0" style={{ fontSize: '11px', color: '#6b7280' }}>{manualInput.length}/500</div>
                </div>
              </div>
            )}

            {sizeError && (
              <div style={{ margin: '12px 12px 0', fontSize: '12px', color: '#f87171' }}>{sizeError}</div>
            )}

            {/* Replace warning — this is the mobile stand-in for the desktop
                "Replace existing chord charts" dialog. Replace-only by design. */}
            {existingChartCount > 0 && (
              <div
                style={{
                  margin: '14px 12px 0',
                  backgroundColor: 'rgba(251,146,60,0.08)',
                  border: '1px solid rgba(249,115,22,0.35)',
                  borderRadius: '12px',
                  padding: '12px',
                }}
              >
                <div className="flex items-start" style={{ gap: '8px' }}>
                  <AlertTriangle size={16} color="#fb923c" className="shrink-0" style={{ marginTop: '1px' }} />
                  <div className="min-w-0">
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#fdba74' }}>
                      This song already has {existingChartCount} chord chart{existingChartCount === 1 ? '' : 's'}
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#9ca3af', marginTop: '2px' }}>
                      Creating new charts will replace all of them.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Inline, as high in the flow as it can sit — not a pinned footer */}
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className="flex items-center justify-center w-full font-bold"
              style={{
                margin: '12px',
                width: 'calc(100% - 24px)',
                height: '48px',
                borderRadius: '10px',
                backgroundColor: canSubmit ? '#f97316' : '#374151',
                color: canSubmit ? '#111827' : '#6b7280',
                fontSize: '15px',
                gap: '8px',
              }}
              data-ph-capture-attribute-button="mobile-autocreate-create"
            >
              <Sparkles size={17} />
              Create chord charts
            </button>
          </>
        )}
      </div>

      {/* Hidden pickers. capture="environment" asks for the rear camera; the
          gallery input deliberately omits it so it opens the photo library. */}
      <input ref={uploadInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handlePicked} style={{ display: 'none' }} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handlePicked} style={{ display: 'none' }} />
      <input ref={galleryInputRef} type="file" accept="image/*" onChange={handlePicked} style={{ display: 'none' }} />
    </div>
  );
};

export default MobileAutocreatePage;
