#!/usr/bin/env python3
"""
Check and optionally fix PostgreSQL sequence synchronization issues.

This utility checks all database sequences to ensure they're synchronized with
the actual maximum ID values in their tables. This is important after migrating
data from Google Sheets where IDs were preserved but sequences weren't updated.

Usage:
    python3 scripts/check_sequences.py          # Check only
    python3 scripts/check_sequences.py --fix    # Check and auto-fix issues
"""

import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import DatabaseTransaction
from app.models import Item, Routine, RoutineItem, ChordChart, ActiveRoutine
from sqlalchemy import text, func

def check_and_fix_sequences(auto_fix=False):
    """Check all sequences and optionally fix them."""

    with DatabaseTransaction() as db:
        # Define tables with their correct ID column names
        tables = [
            ('items', Item, 'id'),
            ('routines', Routine, 'id'),
            ('routine_items', RoutineItem, 'id'),
            ('chord_charts', ChordChart, 'chord_id'),  # Uses chord_id instead of id
            ('active_routine', ActiveRoutine, 'id')
        ]

        print("\nSequence Sync Check:")
        print("=" * 70)

        issues_found = []

        for table_name, model, id_field in tables:
            try:
                id_column = getattr(model, id_field)
                max_id = db.query(func.max(id_column)).scalar() or 0

                # Get sequence current value
                seq_name = f"{table_name}_{id_field}_seq"
                try:
                    result = db.execute(text(f"SELECT last_value FROM {seq_name}"))
                    seq_value = result.scalar()

                    out_of_sync = seq_value < max_id
                    status = "✗ OUT OF SYNC" if out_of_sync else "✓ OK"

                    print(f"{table_name:20} | Max ID: {max_id:5} | Seq: {seq_value:5} | {status}")

                    if out_of_sync:
                        issues_found.append((table_name, seq_name, max_id, seq_value))

                except Exception as e:
                    if "does not exist" not in str(e):
                        print(f"{table_name:20} | Max ID: {max_id:5} | Seq: ERROR - {str(e)[:30]}")

            except Exception as e:
                print(f"{table_name:20} | Error: {str(e)[:40]}")

        print("=" * 70)

        if issues_found:
            print("\n⚠️  Issues Found:")
            print("=" * 70)

            for table, seq, max_id, seq_val in issues_found:
                print(f"{table}: sequence at {seq_val}, should be at least {max_id}")

                if auto_fix:
                    print(f"  → Fixing {seq}...")
                    db.execute(text(f"SELECT setval('{seq}', {max_id})"))
                    db.commit()
                    print(f"  ✓ Fixed!")
                else:
                    print(f"  Fix: SELECT setval('{seq}', {max_id});")

            print("=" * 70)

            if not auto_fix:
                print("\nRun with --fix flag to automatically fix these issues.")
        else:
            print("\n✓ All sequences are properly synchronized!")

        return len(issues_found) == 0

if __name__ == '__main__':
    auto_fix = '--fix' in sys.argv

    if auto_fix:
        print("Running in AUTO-FIX mode...\n")

    all_ok = check_and_fix_sequences(auto_fix)

    sys.exit(0 if all_ok else 1)
