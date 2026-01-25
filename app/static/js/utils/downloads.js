/**
 * Download Utilities for GPRA
 * Handles file downloads and PDF generation for chord charts
 */

import { jsPDF } from 'jspdf';
import JSZip from 'jszip';

/**
 * Get ISO date string for filenames
 * @returns {string} Date in YYYY-MM-DD format
 */
const getDateStr = () => new Date().toISOString().split('T')[0];

/**
 * Load SVGuitar library if not already loaded
 * @returns {Promise<void>}
 */
const ensureSVGuitarLoaded = () => {
  return new Promise((resolve, reject) => {
    if (window.svguitar) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    // Use CDN version (same as ChordChartsModal and PracticePage)
    script.src = 'https://omnibrain.github.io/svguitar/js/svguitar.umd.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load SVGuitar library'));
    document.body.appendChild(script);
  });
};

/**
 * Render a chord chart to SVG string using SVGuitar
 * @param {Object} chartData - The chord chart data
 * @returns {string} SVG markup string
 */
const renderChordToSVG = (chartData) => {
  // Create a temporary container
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '-9999px';
  document.body.appendChild(container);

  try {
    // Create SVGuitar instance
    const chartInstance = new window.svguitar.SVGuitarChord(container);

    // Configure for PDF - use 5:6 aspect ratio (slightly taller than wide)
    const config = {
      strings: chartData.numStrings || 6,
      frets: chartData.numFrets || 5,
      position: chartData.startingFret || 1,
      tuning: [], // Hide tuning labels
      width: 150,
      height: 165,
      fretSize: 1.2,
      fingerSize: 0.75,
      sidePadding: 0.2,
      fontFamily: 'Arial, sans-serif',
      // Dark colors for PDF (will be on white background)
      color: '#333333',           // Dark finger dots
      backgroundColor: 'transparent',
      strokeColor: '#333333',     // Dark grid lines
      textColor: '#333333',       // Dark text
      fretLabelColor: '#333333',  // Dark fret labels
      fingerTextColor: '#ffffff', // White text on dark dots
      fingerTextSize: 28,
      title: chartData.title || '' // Keep SVGuitar's built-in title (don't add duplicate below)
    };

    // Process fingers - combine regular fingers with open and muted strings
    const processedFingers = (chartData.fingers || []).map(finger => {
      const [string, fret, fingerNumber] = finger;
      if (fingerNumber && fingerNumber !== 'undefined') {
        return [string, fret, fingerNumber];
      }
      return [string, fret];
    });

    const allFingers = [
      ...processedFingers,
      ...(chartData.openStrings || []).map(string => [string, 0]),
      ...(chartData.mutedStrings || []).map(string => [string, 'x'])
    ];

    const chordData = {
      fingers: allFingers,
      barres: chartData.barres || []
    };

    // Render the chart
    chartInstance.configure(config).chord(chordData).draw();

    // Get the SVG element
    const svg = container.querySelector('svg');
    if (!svg) {
      throw new Error('SVG not rendered');
    }

    // Get SVG as string
    const svgString = new XMLSerializer().serializeToString(svg);

    return svgString;
  } finally {
    // Clean up
    document.body.removeChild(container);
  }
};

/**
 * Convert SVG string to PNG data URL using canvas
 * @param {string} svgString - SVG markup
 * @param {number} width - Output width
 * @param {number} height - Output height
 * @returns {Promise<string>} PNG data URL
 */
const svgToPng = (svgString, width, height) => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Fill with white background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);

    const img = new Image();
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load SVG into image'));
    };

    img.src = url;
  });
};

/**
 * Generic download helper - fetches URL and triggers browser download
 * @param {string} url - API endpoint to fetch
 * @param {string} defaultFilename - Fallback filename if not provided by server
 * @returns {Promise<void>}
 */
export const downloadFile = async (url, defaultFilename) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.statusText}`);
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;

  // Try to get filename from Content-Disposition header, fallback to default
  const contentDisposition = response.headers.get('Content-Disposition');
  if (contentDisposition) {
    const match = contentDisposition.match(/filename="?([^";\n]+)"?/);
    if (match) {
      a.download = match[1];
    } else {
      a.download = defaultFilename;
    }
  } else {
    a.download = defaultFilename;
  }

  a.click();
  window.URL.revokeObjectURL(downloadUrl);
};

/**
 * Download practice items as CSV or JSON
 * @param {string} format - 'csv' or 'json'
 * @returns {Promise<void>}
 */
export const downloadItems = async (format = 'json') => {
  return downloadFile(
    `/api/user/export/items?format=${format}`,
    `items-${getDateStr()}.${format}`
  );
};

/**
 * Download routines as CSV or JSON
 * @param {string} format - 'csv' or 'json'
 * @returns {Promise<void>}
 */
export const downloadRoutines = async (format = 'json') => {
  return downloadFile(
    `/api/user/export/routines?format=${format}`,
    `routines-${getDateStr()}.${format}`
  );
};

/**
 * Download chord charts as JSON
 * @returns {Promise<void>}
 */
export const downloadChordChartsJson = async () => {
  return downloadFile(
    '/api/user/export/chord-charts',
    `chord-charts-${getDateStr()}.json`
  );
};

/**
 * Download all user data as ZIP bundle, including PDF chord charts
 * @returns {Promise<void>}
 */
export const downloadAllData = async () => {
  // Ensure SVGuitar is loaded for PDF generation
  await ensureSVGuitarLoaded();

  const dateStr = getDateStr();

  // Fetch the base ZIP from the backend
  const zipResponse = await fetch('/api/user/export/all');
  if (!zipResponse.ok) {
    throw new Error(`Failed to fetch export data: ${zipResponse.statusText}`);
  }

  // Load the ZIP using JSZip
  const zipBlob = await zipResponse.blob();
  const zip = await JSZip.loadAsync(zipBlob);

  // Fetch chord charts data for PDF generation
  const chartsResponse = await fetch('/api/user/export/chord-charts');
  if (!chartsResponse.ok) {
    throw new Error(`Failed to fetch chord charts: ${chartsResponse.statusText}`);
  }

  const chartsData = await chartsResponse.json();

  // Generate PDFs for items that have chord charts
  if (chartsData.items && chartsData.items.length > 0) {
    for (const item of chartsData.items) {
      // Skip items without charts
      if (!item.charts || item.charts.length === 0) continue;

      try {
        // Generate PDF for this item
        const pdfData = await generateSingleItemPDF(item, dateStr);

        // Create sanitized filename: "ChordChartPDFs/Item Name - Chord Charts.pdf"
        const itemName = sanitizeFilename(item.item_title || 'Untitled');
        const filename = `ChordChartPDFs/${itemName} - Chord Charts.pdf`;

        // Add to ZIP
        zip.file(filename, pdfData);
      } catch (pdfError) {
        console.error(`Failed to generate PDF for "${item.item_title}":`, pdfError);
        // Continue with other items even if one fails
      }
    }
  }

  // Generate and download the combined ZIP
  const combinedZipBlob = await zip.generateAsync({ type: 'blob' });
  const downloadUrl = window.URL.createObjectURL(combinedZipBlob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `gpra-export-${dateStr}.zip`;
  a.click();
  window.URL.revokeObjectURL(downloadUrl);
};

/**
 * Sanitize a filename by replacing invalid characters with dashes
 * @param {string} name - The original name
 * @returns {string} Sanitized filename
 */
const sanitizeFilename = (name) => {
  // Replace characters that are invalid in filenames: / \ : * ? " < > |
  return name.replace(/[/\\:*?"<>|]/g, '-').trim();
};

/**
 * Generate a PDF for a single item's chord charts
 * @param {Object} item - Item with charts data
 * @param {string} dateStr - Date string for footer
 * @returns {Promise<Uint8Array>} PDF as binary data
 */
const generateSingleItemPDF = async (item, dateStr) => {
  // Create PDF document (A4 size, landscape for better chord layout)
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const usableWidth = pageWidth - (margin * 2);

  // Column settings (5 columns like print view)
  const numColumns = 5;
  const columnWidth = usableWidth / numColumns;
  // Chart dimensions in mm for PDF - use 5:6 aspect ratio to match SVG config
  const chartImageWidth = columnWidth - 6;  // Leave some padding
  const chartImageHeight = (chartImageWidth * 11) / 10;  // Maintain ~1:1.1 aspect ratio
  const chartBlockHeight = chartImageHeight + 2; // Total height (title is in SVG, just need small padding)

  let currentY = margin;

  // Helper to add a new page
  const addNewPage = () => {
    pdf.addPage();
    currentY = margin;
  };

  // Add item title
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.text(item.item_title || 'Untitled', margin, currentY);
  currentY += 6;

  // Add tuning info if available
  if (item.tuning) {
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'italic');
    pdf.text(`Tuning: ${item.tuning}`, margin, currentY);
    currentY += 5;
  }

  // Group charts by section (API uses 'sectionLabel' not 'section_name')
  const sections = {};
  for (const chart of item.charts) {
    const sectionName = chart.sectionLabel || 'General';
    if (!sections[sectionName]) {
      sections[sectionName] = [];
    }
    sections[sectionName].push(chart);
  }

  // Render each section
  for (const [sectionName, charts] of Object.entries(sections)) {
    // Check if we need a new page
    if (currentY + chartBlockHeight + 8 > pageHeight - margin) {
      addNewPage();
    }

    // Section header
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.text(sectionName, margin, currentY);
    currentY += 5;

    // Render charts in rows of 5 columns
    let columnIndex = 0;
    let maxRowHeight = 0;

    for (const chart of charts) {
      // Check if we need to wrap to next row
      if (columnIndex >= numColumns) {
        columnIndex = 0;
        currentY += maxRowHeight + 3;
        maxRowHeight = 0;

        // Check if new row needs new page
        if (currentY + chartBlockHeight > pageHeight - margin) {
          addNewPage();
        }
      }

      const chartX = margin + (columnIndex * columnWidth);
      const chartY = currentY;

      try {
        // Render the chord as SVG using SVGuitar
        const svgString = renderChordToSVG(chart);

        // Convert SVG to PNG - match the 5:6 aspect ratio from SVGuitar config
        // Use 2x resolution for better quality when scaled down
        const pngDataUrl = await svgToPng(svgString, 300, 330);

        // Add the image to the PDF
        // Center the image within the column
        const imageX = chartX + (columnWidth - chartImageWidth) / 2;
        pdf.addImage(pngDataUrl, 'PNG', imageX, chartY, chartImageWidth, chartImageHeight);
        // Note: Chord name is rendered by SVGuitar's built-in title - no need to add duplicate text below

      } catch (renderError) {
        // Fallback: draw a placeholder box with chord name if rendering fails
        console.error('Failed to render chord:', chart.title, renderError);

        pdf.setDrawColor(150);
        pdf.rect(chartX + 2, chartY, columnWidth - 6, chartImageHeight);

        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'bold');
        pdf.text(chart.title || 'Unknown', chartX + 4, chartY + 15);

        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'normal');
        pdf.text('(Render failed)', chartX + 4, chartY + 22);
      }

      maxRowHeight = Math.max(maxRowHeight, chartBlockHeight);
      columnIndex++;
    }

    // Move Y past the last row
    currentY += maxRowHeight + 5;
  }

  // Add footer with export date to all pages
  const totalPages = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(128);
    pdf.text(
      `Guitar Practice Routine App - Exported ${dateStr} - Page ${i} of ${totalPages}`,
      margin,
      pageHeight - 5
    );
    pdf.setTextColor(0);
  }

  // Return PDF as binary array
  return pdf.output('arraybuffer');
};

/**
 * Generate chord charts as a ZIP file containing one PDF per item
 * Each PDF contains the item's chord charts organized by section
 * @returns {Promise<void>}
 */
export const generateChordChartsPDF = async () => {
  // Ensure SVGuitar is loaded first
  await ensureSVGuitarLoaded();

  // Fetch chord charts data
  const response = await fetch('/api/user/export/chord-charts');
  if (!response.ok) {
    throw new Error(`Failed to fetch chord charts: ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.items || data.items.length === 0) {
    throw new Error('No chord charts to export');
  }

  const dateStr = getDateStr();
  const zip = new JSZip();

  // Generate a PDF for each item and add to ZIP
  for (const item of data.items) {
    // Skip items without charts
    if (!item.charts || item.charts.length === 0) continue;

    // Generate PDF for this item
    const pdfData = await generateSingleItemPDF(item, dateStr);

    // Create sanitized filename: "Item Name - Chord Charts.pdf"
    const itemName = sanitizeFilename(item.item_title || 'Untitled');
    const filename = `${itemName} - Chord Charts.pdf`;

    // Add to ZIP
    zip.file(filename, pdfData);
  }

  // Generate and download the ZIP
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const downloadUrl = window.URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `chord-charts-${dateStr}.zip`;
  a.click();
  window.URL.revokeObjectURL(downloadUrl);
};

// Default export for convenience
export default {
  downloadFile,
  downloadItems,
  downloadRoutines,
  downloadChordChartsJson,
  downloadAllData,
  generateChordChartsPDF
};
