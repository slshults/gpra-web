"""
OCR-based chord extraction module for power-efficient chord chart creation.
Based on successful testing with "For What It's Worth" PDF extraction.
"""
import pytesseract
from pdf2image import convert_from_bytes, convert_from_path
import re
import logging
from collections import Counter
from PIL import Image
import io
import base64

logger = logging.getLogger(__name__)

def extract_chords_from_file(file_data, file_type='pdf', filename='unknown'):
    """
    Extract chord names from PDF or image files using OCR.

    Args:
        file_data: File content as bytes (for PDF) or base64 string (for images)
        file_type: 'pdf' or 'image'
        filename: Original filename for logging

    Returns:
        dict: {
            'success': bool,
            'chords': list of unique chord names,
            'chord_counts': dict of chord name -> count,
            'confidence': 'high' | 'medium' | 'low',
            'raw_text': extracted text (for debugging)
        }
    """
    try:
        logger.info(f"[CHORD_OCR] Starting OCR extraction for {filename} (type: {file_type})")

        if file_type == 'pdf':
            return _extract_from_pdf(file_data, filename)
        elif file_type == 'image':
            return _extract_from_image(file_data, filename)
        else:
            return {
                'success': False,
                'error': f'Unsupported file type: {file_type}',
                'chords': [],
                'chord_counts': {},
                'confidence': 'low'
            }

    except Exception as e:
        logger.error(f"[CHORD_OCR] Error extracting chords from {filename}: {str(e)}")
        return {
            'success': False,
            'error': str(e),
            'chords': [],
            'chord_counts': {},
            'confidence': 'low'
        }

def _extract_from_pdf(pdf_bytes, filename):
    """Extract chords from PDF using pdf2image + tesseract"""
    try:
        # Convert PDF to images
        logger.debug(f"[CHORD_OCR] Converting PDF {filename} to images")
        pages = convert_from_bytes(pdf_bytes)

        all_text = ""
        for i, page in enumerate(pages):
            logger.debug(f"[CHORD_OCR] Processing page {i+1}/{len(pages)}")
            # Extract text with OCR
            text = pytesseract.image_to_string(page)
            all_text += text + "\n"

        logger.debug(f"[CHORD_OCR] Extracted {len(all_text)} characters of text")
        return _extract_chords_from_text(all_text, filename)

    except Exception as e:
        logger.error(f"[CHORD_OCR] PDF processing error for {filename}: {str(e)}")
        raise

def _extract_from_image(image_data, filename):
    """Extract chords from image using tesseract"""
    try:
        # Decode base64 image data
        logger.debug(f"[CHORD_OCR] Decoding image data for {filename}")
        image_bytes = base64.b64decode(image_data)
        image = Image.open(io.BytesIO(image_bytes))

        # Extract text with OCR
        logger.debug(f"[CHORD_OCR] Running OCR on image {filename}")
        text = pytesseract.image_to_string(image)

        logger.debug(f"[CHORD_OCR] Extracted {len(text)} characters of text")
        return _extract_chords_from_text(text, filename)

    except Exception as e:
        logger.error(f"[CHORD_OCR] Image processing error for {filename}: {str(e)}")
        raise

def _extract_chords_from_text(text, filename):
    """Extract chord names from OCR text using proven regex patterns"""
    try:
        logger.debug(f"[CHORD_OCR] Analyzing text for chord patterns in {filename}")

        # Comprehensive chord pattern based on successful "For What It's Worth" extraction
        # Matches: A, Em, F#m7, Cadd9, Dsus4, etc.
        chord_pattern = r'\b[A-G][#b]?(?:maj|min|m|sus|add|dim|aug)?\d*\b'

        # Find all potential chords
        potential_chords = re.findall(chord_pattern, text, re.IGNORECASE)

        # Clean and filter chords
        cleaned_chords = []
        for chord in potential_chords:
            # Convert to consistent case (first letter uppercase)
            chord = chord.strip()
            if len(chord) >= 1:
                chord = chord[0].upper() + chord[1:].lower()
                # Filter out obvious non-chords (common false positives)
                if not _is_likely_false_positive(chord):
                    cleaned_chords.append(chord)

        # Count occurrences
        chord_counts = Counter(cleaned_chords)
        unique_chords = list(chord_counts.keys())

        # Determine confidence based on number of chords found
        confidence = _calculate_confidence(unique_chords, chord_counts, text)

        logger.info(f"[CHORD_OCR] Found {len(unique_chords)} unique chords in {filename}: {unique_chords}")
        logger.debug(f"[CHORD_OCR] Chord counts: {dict(chord_counts)}")

        return {
            'success': True,
            'chords': unique_chords,
            'chord_counts': dict(chord_counts),
            'confidence': confidence,
            'raw_text': text[:500] + '...' if len(text) > 500 else text  # Truncate for logging
        }

    except Exception as e:
        logger.error(f"[CHORD_OCR] Text analysis error for {filename}: {str(e)}")
        raise

def _is_likely_false_positive(chord):
    """Filter out common false positives that match chord pattern but aren't chords"""
    false_positives = {
        'a', 'an', 'and', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in',
        'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'we',
        'all', 'are', 'but', 'can', 'for', 'get', 'had', 'has', 'her', 'him',
        'his', 'how', 'its', 'may', 'new', 'not', 'now', 'old', 'our', 'out',
        'see', 'the', 'too', 'was', 'way', 'who', 'you', 'your'
    }
    return chord.lower() in false_positives

def _calculate_confidence(chords, chord_counts, raw_text):
    """Calculate confidence level based on OCR results"""
    num_chords = len(chords)
    total_mentions = sum(chord_counts.values())
    text_length = len(raw_text)

    # High confidence: 4+ unique chords, multiple mentions each
    if num_chords >= 4 and total_mentions >= 8:
        return 'high'

    # Medium confidence: 2-3 chords with decent mentions
    if num_chords >= 2 and total_mentions >= 4:
        return 'medium'

    # Low confidence: Few chords or mentions
    return 'low'

def should_use_ocr_result(ocr_result, minimum_chords=2):
    """
    Determine if OCR result is good enough to skip LLM processing.
    Now includes text quality checks to catch gibberish output.

    Args:
        ocr_result: Result from extract_chords_from_file()
        minimum_chords: Minimum number of unique chords to consider success

    Returns:
        bool: True if OCR result should be used, False to fall back to LLM
    """
    if not ocr_result.get('success', False):
        return False

    chords = ocr_result.get('chords', [])
    confidence = ocr_result.get('confidence', 'low')
    raw_text = ocr_result.get('raw_text', '')

    # Must have at least minimum_chords unique chords
    if len(chords) < minimum_chords:
        logger.info(f"[CHORD_OCR] Only found {len(chords)} chords, need {minimum_chords}. Falling back to LLM.")
        return False

    # NEW: Text quality checks to catch gibberish
    text_quality_score = _assess_text_quality(raw_text)
    if text_quality_score < 0.3:  # 30% quality threshold
        logger.info(f"[CHORD_OCR] Poor text quality (score: {text_quality_score:.2f}). Text appears garbled, falling back to LLM.")
        return False

    # Accept medium or high confidence results (with quality check passed)
    if confidence in ['medium', 'high']:
        logger.info(f"[CHORD_OCR] OCR success! Found {len(chords)} chords with {confidence} confidence and good text quality.")
        return True

    # Low confidence with many chords might still be good (if quality is decent)
    if confidence == 'low' and len(chords) >= 4:
        logger.info(f"[CHORD_OCR] Low confidence but {len(chords)} chords found with acceptable text quality. Using OCR result.")
        return True

    logger.info(f"[CHORD_OCR] {confidence} confidence with {len(chords)} chords. Falling back to LLM.")
    return False

def _assess_text_quality(text):
    """
    Assess the quality of OCR-extracted text to detect gibberish.
    Returns a score from 0.0 (pure gibberish) to 1.0 (perfect text).

    Args:
        text: Raw OCR text to assess

    Returns:
        float: Quality score between 0.0 and 1.0
    """
    if not text or len(text.strip()) < 10:
        return 0.0

    # Clean text for analysis
    cleaned_text = text.strip()
    total_chars = len(cleaned_text)

    # Count readable elements
    readable_chars = 0
    word_count = 0
    single_char_fragments = 0

    # Split into words and analyze
    words = re.split(r'\s+', cleaned_text)
    for word in words:
        # Remove punctuation for analysis
        clean_word = re.sub(r'[^\w]', '', word)
        if len(clean_word) == 0:
            continue

        if len(clean_word) == 1:
            single_char_fragments += 1
        elif len(clean_word) >= 2:
            word_count += 1
            readable_chars += len(clean_word)

    # Calculate quality metrics
    if total_chars == 0:
        return 0.0

    # Readable character ratio (excluding spaces/punctuation)
    readable_ratio = readable_chars / max(total_chars, 1)

    # Word formation ratio (multi-char words vs single chars)
    total_fragments = word_count + single_char_fragments
    if total_fragments == 0:
        word_formation_ratio = 0.0
    else:
        word_formation_ratio = word_count / total_fragments

    # Length factor (very short text is suspicious)
    length_factor = min(1.0, len(cleaned_text) / 50)  # Full credit at 50+ chars

    # Check for common gibberish patterns
    gibberish_penalty = 0.0
    gibberish_patterns = [
        r'[a-zA-Z]{1}\s+[a-zA-Z]{1}\s+[a-zA-Z]{1}',  # Single chars: "o D t"
        r'^[^a-zA-Z]*[a-zA-Z]{1,2}[^a-zA-Z]*$',       # Very short isolated chars
        r'[a-zA-Z][^a-zA-Z\s]{3,}[a-zA-Z]',          # Chars mixed with symbols
    ]

    for pattern in gibberish_patterns:
        if re.search(pattern, cleaned_text):
            gibberish_penalty += 0.2

    # Calculate final score
    quality_score = (
        readable_ratio * 0.4 +           # 40% weight on readable chars
        word_formation_ratio * 0.4 +     # 40% weight on word formation
        length_factor * 0.2              # 20% weight on length
    ) - gibberish_penalty

    # Clamp to 0.0-1.0 range
    quality_score = max(0.0, min(1.0, quality_score))

    logger.debug(f"[CHORD_OCR] Text quality assessment: "
                f"readable_ratio={readable_ratio:.2f}, "
                f"word_formation_ratio={word_formation_ratio:.2f}, "
                f"length_factor={length_factor:.2f}, "
                f"gibberish_penalty={gibberish_penalty:.2f}, "
                f"final_score={quality_score:.2f}")

    return quality_score

def test_ocr_extraction():
    """Test function for development - can be removed in production"""
    try:
        # Test with a sample image or PDF if available
        logger.info("[CHORD_OCR] OCR module loaded successfully")
        return True
    except Exception as e:
        logger.error(f"[CHORD_OCR] Test failed: {str(e)}")
        return False

# Test the module on import
if __name__ == '__main__':
    test_ocr_extraction()