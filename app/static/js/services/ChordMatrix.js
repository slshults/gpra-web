export const CellState = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  MIDDLE: 'MIDDLE',
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
  MIDDLE_HL: 'MIDDLE_HL',
  LEFT_HL: 'LEFT_HL',
  RIGHT_HL: 'RIGHT_HL'
};

export const EmptyStringState = {
  X: 'X',
  O: 'O',
  NOT_EMPTY: 'NOT_EMPTY'
};

export class ChordMatrix {
  constructor(numFrets, numStrings, cells = null, emptyStringsStates = null) {
    this.numFrets = numFrets;
    this.numStrings = numStrings;
    this.cells = cells || Array(numFrets * numStrings).fill({ state: CellState.INACTIVE });
    this.emptyStringsStates = emptyStringsStates || Array(numStrings).fill(EmptyStringState.O);
  }

  static fromChart(chord, settings) {
    if (!settings.frets || !settings.strings) {
      throw new Error('Cannot create matrix if frets or strings is not known');
    }
    
    const numFrets = settings.frets;
    const numStrings = settings.strings;

    const cells = Array(numFrets * numStrings).fill({ state: CellState.INACTIVE });
    const emptyStringsStates = Array(numStrings).fill(EmptyStringState.O);

    chord.fingers.forEach(([string, fret, textOrOptions]) => {
      const stringIndex = Math.abs(string - numStrings);

      let options = {};
      if (textOrOptions) {
        if (typeof textOrOptions === 'string') {
          options = { text: textOrOptions };
        } else {
          options = textOrOptions;
        }
      }

      if (fret === 0) { // OPEN
        emptyStringsStates[stringIndex] = EmptyStringState.O;
      } else if (fret === -1) { // SILENT
        emptyStringsStates[stringIndex] = EmptyStringState.X;
      } else {
        cells[(fret - 1) * numStrings + stringIndex] = {
          state: CellState.ACTIVE,
          ...options
        };
      }
    });

    return new ChordMatrix(numFrets, numStrings, cells, emptyStringsStates);
  }

  get rows() {
    const result = [];
    for (let i = 0; i < this.numFrets; i++) {
      result.push(this.cells.slice(i * this.numStrings, (i + 1) * this.numStrings));
    }
    return result;
  }

  toggle(stringIndex, fretIndex) {
    const newCells = [...this.cells];
    const index = fretIndex * this.numStrings + stringIndex;
    const current = newCells[index];

    newCells[index] = {
      state: current.state === CellState.ACTIVE ? CellState.INACTIVE : CellState.ACTIVE
    };

    return new ChordMatrix(this.numFrets, this.numStrings, newCells, [...this.emptyStringsStates]);
  }

  connectHighlight(fretIndex, fromString, toString) {
    const newCells = [...this.cells];
    const startIdx = Math.min(fromString, toString);
    const endIdx = Math.max(fromString, toString);

    // Clear any existing highlights in this row
    for (let i = 0; i < this.numStrings; i++) {
      const idx = fretIndex * this.numStrings + i;
      const cell = newCells[idx];
      if (cell.state.endsWith('_HL')) {
        newCells[idx] = { state: CellState.INACTIVE };
      }
    }

    // Add new highlights
    if (endIdx - startIdx >= 2) {
      newCells[fretIndex * this.numStrings + startIdx] = { state: CellState.LEFT_HL };
      newCells[fretIndex * this.numStrings + endIdx] = { state: CellState.RIGHT_HL };
      
      for (let i = startIdx + 1; i < endIdx; i++) {
        newCells[fretIndex * this.numStrings + i] = { state: CellState.MIDDLE_HL };
      }
    }

    return new ChordMatrix(this.numFrets, this.numStrings, newCells, [...this.emptyStringsStates]);
  }

  connectHighlighted() {
    const newCells = [...this.cells];
    
    // Convert highlights to regular connections
    for (let i = 0; i < newCells.length; i++) {
      const cell = newCells[i];
      if (cell.state === CellState.LEFT_HL) {
        newCells[i] = { state: CellState.LEFT };
      } else if (cell.state === CellState.RIGHT_HL) {
        newCells[i] = { state: CellState.RIGHT };
      } else if (cell.state === CellState.MIDDLE_HL) {
        newCells[i] = { state: CellState.MIDDLE };
      }
    }

    return new ChordMatrix(this.numFrets, this.numStrings, newCells, [...this.emptyStringsStates]);
  }

  toVexchord() {
    const fingers = [];
    const barres = [];

    // Handle individual fingers
    this.cells.forEach((cell, index) => {
      if (cell.state === CellState.ACTIVE) {
        const fret = Math.floor(index / this.numStrings) + 1;
        const string = this.numStrings - (index % this.numStrings);
        fingers.push([string, fret, cell.text]);
      }
    });

    // Handle barres
    for (let fret = 0; fret < this.numFrets; fret++) {
      let start = null;
      let current = null;

      for (let string = 0; string < this.numStrings; string++) {
        const cell = this.cells[fret * this.numStrings + string];
        
        if (cell.state === CellState.LEFT) {
          start = string;
        } else if (cell.state === CellState.RIGHT && start !== null) {
          barres.push({
            fromString: this.numStrings - start,
            toString: this.numStrings - string,
            fret: fret + 1,
            text: cell.text
          });
          start = null;
        }
        
        if ([CellState.LEFT, CellState.MIDDLE, CellState.RIGHT].includes(cell.state)) {
          current = string;
        }
      }
    }

    // Handle empty strings
    this.emptyStringsStates.forEach((state, index) => {
      if (state === EmptyStringState.X) {
        fingers.push([this.numStrings - index, -1]);
      } else if (state === EmptyStringState.O) {
        fingers.push([this.numStrings - index, 0]);
      }
    });

    return { fingers, barres };
  }
} 