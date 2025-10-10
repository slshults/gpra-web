import React from 'react';
import { CellState } from '../services/ChordMatrix';

const StyledGrid = ({ numFrets, numStrings, width, height, children }) => {
  const style = {
    display: 'grid',
    marginLeft: `${width / numStrings / 2}px`,
    position: 'relative',
    width: `${width - width / numStrings}px`,
    gridTemplateColumns: `repeat(${numStrings - 1}, 1fr)`,
    gridTemplateRows: `repeat(${numFrets}, ${height / 4}px)`,
    gap: '1px',
    padding: '1px 1px 0 1px',
    backgroundColor: 'var(--text-color)',
  };

  return (
    <div style={style}>
      {children}
    </div>
  );
};

const Cell = ({ state, text, onClick, onMouseDown, onMouseEnter, onTouchStart, onTouchMove }) => {
  const getBackgroundColor = () => {
    switch (state) {
      case CellState.ACTIVE:
      case CellState.LEFT:
      case CellState.MIDDLE:
      case CellState.RIGHT:
        return 'var(--primary)';
      case CellState.LEFT_HL:
      case CellState.MIDDLE_HL:
      case CellState.RIGHT_HL:
        return 'var(--primary-hover)';
      default:
        return 'var(--background)';
    }
  };

  const style = {
    backgroundColor: getBackgroundColor(),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    userSelect: 'none',
    color: state === CellState.INACTIVE ? 'var(--text-muted)' : 'var(--text-color)',
    fontSize: '0.875rem',
    fontWeight: 'bold',
  };

  return (
    <div
      style={style}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
    >
      {text}
    </div>
  );
};

export const ChordGrid = ({ matrix, onMatrixChange, width = 200, height = 250 }) => {
  const [startFrom, setStartFrom] = React.useState(null);

  const handleCellClick = (stringIndex, fretIndex) => {
    onMatrixChange(matrix.toggle(stringIndex, fretIndex));
  };

  const handleMouseDown = (stringIndex, fretIndex) => {
    setStartFrom({ stringIndex, fretIndex });
  };

  const handleMouseEnter = (stringIndex, fretIndex) => {
    if (startFrom && Math.abs(stringIndex - startFrom.stringIndex) > 0) {
      onMatrixChange(
        matrix.connectHighlight(
          startFrom.fretIndex,
          startFrom.stringIndex,
          stringIndex
        )
      );
    }
  };

  const handleTouchMove = (e, fretIndex) => {
    const touch = e.touches[0];
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!element) return;

    const stringIndex = parseInt(element.dataset.stringIndex);
    if (isNaN(stringIndex)) return;

    if (startFrom && Math.abs(stringIndex - startFrom.stringIndex) > 0) {
      onMatrixChange(
        matrix.connectHighlight(
          startFrom.fretIndex,
          startFrom.stringIndex,
          stringIndex
        )
      );
    }
  };

  React.useEffect(() => {
    const handleMouseUp = () => {
      if (startFrom) {
        onMatrixChange(matrix.connectHighlighted());
        setStartFrom(null);
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', handleMouseUp);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchend', handleMouseUp);
    };
  }, [matrix, startFrom, onMatrixChange]);

  return (
    <StyledGrid
      numFrets={matrix.numFrets}
      numStrings={matrix.numStrings}
      width={width}
      height={height}
    >
      {matrix.rows.map((row, fretIndex) =>
        row.map((cell, stringIndex) => (
          <Cell
            key={`${fretIndex}-${stringIndex}`}
            {...cell}
            onClick={() => handleCellClick(stringIndex, fretIndex)}
            onMouseDown={() => handleMouseDown(stringIndex, fretIndex)}
            onMouseEnter={() => handleMouseEnter(stringIndex, fretIndex)}
            onTouchStart={() => handleMouseDown(stringIndex, fretIndex)}
            onTouchMove={(e) => handleTouchMove(e, fretIndex)}
            data-string-index={stringIndex}
            data-fret-index={fretIndex}
          />
        ))
      )}
    </StyledGrid>
  );
}; 