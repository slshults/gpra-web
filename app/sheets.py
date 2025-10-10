from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from google.auth.transport.requests import Request
from flask import current_app
import gspread
import os
import logging
from datetime import datetime
from functools import lru_cache
import time
import threading
import json

# Set up logging
logging.basicConfig(level=logging.DEBUG)

# Global rate limiting for batch operations
_last_batch_operation_time = 0
_batch_operation_lock = threading.Lock()

def _throttle_batch_operation():
    """Ensure minimum time between batch operations to avoid rate limits"""
    global _last_batch_operation_time
    with _batch_operation_lock:
        current_time = time.time()
        time_since_last = current_time - _last_batch_operation_time
        min_interval = 1.0  # Minimum 1 second between batch operations
        
        if time_since_last < min_interval:
            sleep_time = min_interval - time_since_last
            logging.info(f"Throttling batch operation - sleeping {sleep_time:.2f}s")
            time.sleep(sleep_time)
        
        _last_batch_operation_time = time.time()

def retry_on_rate_limit(func, max_retries=3, base_delay=1):
    """
    Retry a function on rate limit errors with exponential backoff and jitter.
    """
    import random
    
    for attempt in range(max_retries + 1):
        try:
            return func()
        except Exception as e:
            error_str = str(e).lower()
            # Check for various rate limit error messages
            is_rate_limit = any(phrase in error_str for phrase in [
                'quota exceeded', 'rate_limit_exceeded', 'too many requests',
                '429', 'rate limit', 'quota', 'exceed', 'throttl'
            ])
            
            # Also check for specific Google API errors
            if hasattr(e, 'resp') and hasattr(e.resp, 'status'):
                if e.resp.status in ['429', 429]:  # Too Many Requests
                    is_rate_limit = True
            
            if is_rate_limit and attempt < max_retries:
                # Exponential backoff with jitter: 1-2s, 2-4s, 4-8s
                delay = base_delay * (2 ** attempt)
                # Add random jitter (0-50% of delay) to prevent thundering herd
                jitter = random.uniform(0, delay * 0.5)
                total_delay = delay + jitter
                logging.warning(f"Rate limit hit, retrying in {total_delay:.2f}s (attempt {attempt + 1}/{max_retries + 1})")
                time.sleep(total_delay)
                continue
            else:
                # Either not a rate limit error, or we've exhausted retries
                raise

# Define number of columns for each sheet type
ITEMS_COLUMNS = 8        # A through H (A=ID, B=Item ID, C=Title, D=Notes, E=Duration, F=Description, G=order, H=Tuning)
ROUTINE_COLUMNS = 4      # A through D (A=ID, B=Item ID, C=order, D=completed)
ROUTINES_COLUMNS = 4     # A through D
CHORDCHARTS_COLUMNS = 6  # A through F (A=ChordID, B=ItemID, C=Title, D=ChordData, E=CreatedAt, F=Order)

@lru_cache(maxsize=1)
def get_credentials():
    """Get or refresh Google OAuth2 credentials."""
    logging.debug("Entered get_credentials")
    token_file = 'token.json'
    try:
        if os.path.exists(token_file):
            logging.debug("Token file found")
            creds = Credentials.from_authorized_user_file(token_file)
            if creds and creds.valid:
                return creds, None
                
            if creds and creds.expired and creds.refresh_token:
                try:
                    logging.debug("Refreshing credentials")
                    creds.refresh(Request())
                    # Save refreshed credentials
                    with open(token_file, 'w') as token:
                        token.write(creds.to_json())
                    return creds, None
                except Exception as e:
                    logging.debug(f"Refresh failed: {str(e)}")
                    # If refresh fails, delete the token file and fall through to create new flow
                    os.remove(token_file)
                    
        # Either no token file or refresh failed
        logging.debug("Creating new flow from environment variables")
        
        # Build client config from environment variables
        client_config = {
            "installed": {
                "client_id": os.getenv('GOOGLE_CLIENT_ID'),
                "client_secret": os.getenv('GOOGLE_CLIENT_SECRET'),
                "project_id": os.getenv('GOOGLE_PROJECT_ID', 'practiceroutineapp'),
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                "redirect_uris": ["http://localhost"]
            }
        }
        
        # Validate required environment variables
        if not client_config["installed"]["client_id"] or not client_config["installed"]["client_secret"]:
            raise ValueError("Missing required Google OAuth environment variables: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET")
        
        flow = Flow.from_client_config(
            client_config,
            scopes=['https://www.googleapis.com/auth/spreadsheets'],
            redirect_uri=current_app.config['OAUTH2_REDIRECT_URI']
        )
        return None, flow
    except Exception as e:
        logging.error(f"Error in get_credentials: {str(e)}")
        return None, None

@lru_cache(maxsize=1)
def get_spread():
    """Get the Google Spreadsheet instance."""
    logging.debug("Entered get_spread")
    spread_id = os.getenv('GOOGLE_SPREADSHEET_ID')
    if not spread_id:
        raise ValueError("GOOGLE_SPREADSHEET_ID not set in environment variables")
    creds, _ = get_credentials()
    if not creds:
        logging.debug("No valid credentials found")
        raise ValueError("No valid credentials available. Please authenticate first.")
    
    try:
        client = gspread.authorize(creds)
        spread = client.open_by_key(spread_id)
        return spread
    except Exception as e:
        logging.error(f"Error connecting to spreadsheet: {str(e)}")
        raise ValueError(f"Failed to connect to spreadsheet: {str(e)}")

def invalidate_caches():
    """Invalidate all caches when data is modified."""
    get_credentials.cache_clear()
    get_spread.cache_clear()

def sheet_to_records(worksheet, is_routine_worksheet=True, max_empty_rows=50):
    """Convert worksheet data to list of dictionaries.
    This function is header-row agnostic - it uses column letters (A, B, C...) 
    to read and write data, ignoring whatever content might be in row 1.
    
    Args:
        worksheet: The worksheet to read from
        is_routine_worksheet: Whether this is a routine worksheet (affects column count)
        max_empty_rows: Maximum consecutive empty rows before stopping (default 50)
    """
    try:
        # Get number of columns based on sheet type
        if worksheet.title == 'ChordCharts':
            num_columns = CHORDCHARTS_COLUMNS
        elif worksheet.title == 'Routines':
            # Special case: Routines index sheet has specific column structure
            num_columns = ROUTINES_COLUMNS
        elif is_routine_worksheet:
            num_columns = ROUTINE_COLUMNS
        else:
            num_columns = ITEMS_COLUMNS
        
        last_col = chr(ord('A') + num_columns - 1)
        
        # For large sheets like CommonChords, try to find the actual end first
        if worksheet.title in ['CommonChords', 'ChordCharts', 'Items'] and num_columns > 3:
            try:
                # Get the first column to find where data ends
                col_a_values = worksheet.col_values(1)  # Column A values
                if len(col_a_values) <= 1:  # Only header or empty
                    return []
                
                # Find the last row with data by looking for consecutive empty cells
                last_row_with_data = len(col_a_values)
                empty_count = 0
                
                for i in range(len(col_a_values) - 1, 0, -1):  # Go backwards from end
                    if not col_a_values[i] or not str(col_a_values[i]).strip():
                        empty_count += 1
                        if empty_count >= max_empty_rows:
                            last_row_with_data = i + max_empty_rows  # Keep some buffer
                            break
                    else:
                        empty_count = 0
                
                # Ensure we don't go below row 2 (first data row)
                last_row_with_data = max(last_row_with_data, 2)
                
                # If we detected a reasonable endpoint, use it
                if last_row_with_data < len(col_a_values) * 0.8:  # Only if we saved at least 20%
                    range_str = f'A2:{last_col}{last_row_with_data}'
                    logging.info(f"Optimized range for {worksheet.title}: {range_str} (saved {len(col_a_values) - last_row_with_data} empty rows)")
                else:
                    range_str = f'A2:{last_col}'
                    logging.debug(f"Using full range for {worksheet.title}: {range_str}")
            except Exception as e:
                logging.warning(f"Failed to optimize range for {worksheet.title}, using full range: {str(e)}")
                range_str = f'A2:{last_col}'
        else:
            # For smaller sheets, use the original approach
            range_str = f'A2:{last_col}'
        
        data_range = worksheet.get(range_str, value_render_option='FORMATTED_VALUE')  # Get values as strings
        if not data_range:  # No data rows
            return []
            
        data_rows = data_range
        logging.debug(f"Number of data rows loaded from {worksheet.title}: {len(data_rows)}")
        
        # Convert rows to records using column letters
        processed_records = []
        for row in data_rows:
            record = {}
            # Ensure we have all columns by padding with empty strings
            padded_row = row + [''] * (num_columns - len(row))
            
            # Process each column
            for idx in range(num_columns):
                col_letter = chr(ord('A') + idx)
                value = padded_row[idx] if idx < len(padded_row) else ''
                # Just store the value as-is if it exists, otherwise empty string
                record[col_letter] = value if value not in (None, '') else ''
                
            processed_records.append(record)
        
        # Log the sequences for debugging
        logging.debug(f"ID sequence: {[r.get('A') for r in processed_records[:10]]}")  # Only show first 10
        if worksheet.title != 'Routines':  # Only show order sequence for non-Routines sheets
            order_col = 'C' if is_routine_worksheet else 'G'
            logging.debug(f"Order sequence: {[r.get(order_col) for r in processed_records[:10]]}")  # Only show first 10
        
        return processed_records
    except Exception as e:
        logging.error(f"Error in sheet_to_records: {str(e)}")
        raise

def records_to_sheet(worksheet, records, is_routine_worksheet=True):
    """Write records back to sheet, handling all columns at once"""
    if not records:
        return True
        
    # Determine range based on worksheet type
    if worksheet.title == 'ChordCharts':
        num_cols = CHORDCHARTS_COLUMNS
        col_end = 'F'
    elif worksheet.title == 'Routines':
        # Special case: Routines index sheet
        num_cols = ROUTINES_COLUMNS
        col_end = 'D'
    elif is_routine_worksheet:
        num_cols = ROUTINE_COLUMNS
        col_end = 'D'
    else:
        num_cols = ITEMS_COLUMNS
        col_end = 'H'
    
    # Convert records to rows, preserving all columns
    rows = []
    for record in records:
        logging.debug(f"Processing record: {record}")
        row = []
        for i in range(num_cols):
            col = chr(ord('A') + i)
            row.append(record.get(col, ''))
        rows.append(row)
    
    # Calculate range - extend beyond our data to clear unused rows
    range_start = f'A2'
    data_end_row = len(rows) + 1  # +1 because we start at row 2
    clear_end_row = max(data_end_row + 50, 100)  # Clear extra rows to handle deletions
    range_str = f'{range_start}:{col_end}{clear_end_row}'
    logging.debug(f"Writing to range: {range_str}")
    
    # Extend rows with empty rows to clear unused space - this avoids separate batch_clear call
    extended_rows = rows + [[''] * num_cols] * (clear_end_row - data_end_row)
    logging.debug(f"Data rows to write: {len(rows)} data + {len(extended_rows) - len(rows)} clearing rows")
    
    # Write all data at once (including clearing unused rows)
    worksheet.update(range_str, extended_rows, value_input_option='USER_ENTERED')
    logging.debug(f"Sheet update completed")
    logging.debug(f"Updated sheet with {len(rows)} records")
    
    return True

def ensure_completed_column(worksheet):
    """Ensure the worksheet has a completed column in column D"""
    try:
        logging.debug("Ensuring completed column exists...")
        
        # Get all values
        all_values = worksheet.get_all_values()
        if len(all_values) > 1:  # If there are data rows
            # Create a list of FALSE values for all data rows
            false_values = [['FALSE'] for _ in range(len(all_values) - 1)]
            # Update all cells in column D starting from D2
            if false_values:  # Only update if there are rows to update
                range_end = f'D{len(all_values)}'
                worksheet.update(f'D2:{range_end}', false_values)
            
        logging.debug("Completed column verified in column D")
        return True
    except Exception as e:
        logging.error(f"Error ensuring completed column: {str(e)}")
        raise

def initialize_routines_sheet():
    """Create and initialize the Routines index sheet if it doesn't exist."""
    try:
        spread = get_spread()
        
        # Check if Routines sheet exists
        try:
            sheet = spread.worksheet('Routines')
            logging.debug("Routines sheet already exists")
            return True
                
        except:
            logging.debug("Creating new Routines sheet")
            sheet = spread.add_worksheet('Routines', rows=1000, cols=20)
            return True
            
    except Exception as e:
        logging.error(f"Error initializing Routines sheet: {str(e)}")
        raise

def create_routine(routine_name):
    """Create a new routine with proper sheet initialization and tracking."""
    try:
        spread = get_spread()
        
        # Get current routines to check for duplicates and get next ID
        routines_sheet = spread.worksheet('Routines')
        current_routines = get_all_routine_records()
        
        # Check for duplicate names (case insensitive)
        if any(r['B'].lower() == routine_name.lower() for r in current_routines):  # Column B for name
            raise ValueError(f"Routine '{routine_name}' already exists")
            
        # Get all worksheet names to avoid conflicts
        all_worksheets = spread.worksheets()
        existing_names = set(ws.title for ws in all_worksheets)
        logging.debug(f"Existing worksheet names: {existing_names}")
        
        # Find the next available ID that doesn't conflict with existing worksheet names
        used_ids = set()
        # Add IDs from existing routines
        used_ids.update(int(float(r['A'])) for r in current_routines)
        # Add any numeric worksheet names that might exist
        used_ids.update(int(float(name)) for name in existing_names if name.replace('.', '').isdigit())
        
        if used_ids:
            new_id = max(used_ids) + 1
        else:
            new_id = 1
            
        logging.debug(f"Selected new ID: {new_id}")
        
        # Generate new order
        new_order = max([int(float(r['D'])) for r in current_routines], default=-1) + 1  # Column D for order
        
        # Create new worksheet using ID as the sheet name
        worksheet = spread.add_worksheet(str(new_id), rows=1000, cols=20)
        
        # Add header row
        header_row = ['ID', 'Item ID', 'order', 'completed']
        worksheet.update('A1:D1', [header_row])
        
        # Ensure completed column exists
        ensure_completed_column(worksheet)
        
        # Format timestamp in desired format
        now = datetime.now()
        timestamp = now.strftime('%Y-%m-%d %I:%M%p PST')
        
        # Add entry to Routines index
        new_routine = [
            str(new_id),    # Column A: ID
            routine_name,    # Column B: name
            timestamp,       # Column C: created
            str(new_order)  # Column D: order
        ]
        routines_sheet.append_row(new_routine, value_input_option='USER_ENTERED')
        
        invalidate_caches()
        return {
            'ID': new_id,
            'name': routine_name,
            'created': timestamp,
            'order': new_order
        }
        
    except Exception as e:
        logging.error(f"Error in create_routine: {str(e)}")
        raise

def get_all_items():
    """Get all items from the Items sheet."""
    try:
        spread = get_spread()
        logging.debug("Reading from Items sheet...")
        
        worksheet = spread.worksheet('Items')
        records = sheet_to_records(worksheet, is_routine_worksheet=False)
        
        return records
    except Exception as e:
        logging.error(f"Error in get_all_items: {str(e)}")
        return []

def add_item(item):
    """Add a new item with proper error handling."""
    try:
        spread = get_spread()
        logging.debug("Starting add operation...")
        logging.debug(f"Received item data: {item}")
        
        # Initialize missing columns with defaults
        required_columns = {
            'A': '',  # ID (will be set later)
            'B': '',  # Item ID (same as A for items)
            'C': '',  # Title
            'D': '',  # Notes
            'E': '5',  # Duration
            'F': '',  # Description
            'G': '',  # Order (will be set later)
            'H': ''   # Tuning
        }
        
        # Update with provided values
        for col in required_columns:
            if col in item:
                required_columns[col] = item[col]
        
        item = required_columns  # Use our complete item dictionary
        logging.debug(f"Normalized item data: {item}")
        
        # Get the worksheet and current records
        worksheet = spread.worksheet('Items')
        records = sheet_to_records(worksheet, is_routine_worksheet=False)
        logging.debug(f"Current records: {records}")
        
        # Generate new ID
        new_id = max([int(float(r['A'])) for r in records], default=0) + 1
        item['A'] = str(new_id)  # Column A for ID
        item['B'] = str(new_id)  # Column B for Item ID (same as A for items)
        logging.debug(f"Generated new ID: {new_id}")
        
        # Check for duplicate titles
        base_title = item['C']  # Column C for Title
        count = 1
        while any(r['C'].lower() == item['C'].lower() for r in records):  # Column C for Title
            item['C'] = f"{base_title} ({count})"  # Column C for Title
            count += 1
        logging.debug(f"Final title after duplicate check: {item['C']}")
        
        # Set order to end of list
        max_order = max([int(float(r['G'])) for r in records], default=-1)  # Column G for order
        item['G'] = str(max_order + 1)  # Column G for order
        logging.debug(f"Set order to: {item['G']}")
        
        # Add new record and save
        records.append(item)
        logging.debug(f"Attempting to save item: {item}")
        success = records_to_sheet(worksheet, records, is_routine_worksheet=False)
        
        if success:
            logging.debug("Successfully saved item")
            invalidate_caches()
            return item
            
        logging.error("Failed to save item")
        return None
    except Exception as e:
        logging.error(f"Error in add_item: {str(e)}")
        raise ValueError(f"Failed to add item: {str(e)}")

def update_item(item_id, item):
    """Update an item with error handling."""
    try:
        spread = get_spread()
        logging.debug(f"Starting update operation for item_id: {item_id}")
        logging.debug(f"Received item data: {item}")
        
        # Get the worksheet and current records
        worksheet = spread.worksheet('Items')
        records = sheet_to_records(worksheet, is_routine_worksheet=False)
        
        # Find and update the item
        updated = False
        for record in records:
            if str(record['A']) == str(item_id):  # Convert both to strings for comparison
                logging.debug(f"Found record to update: {record}")
                # Keep the existing record and only update the fields that were sent
                for col_letter in item:
                    if col_letter != 'A' and col_letter != 'G':  # Don't update ID or order
                        record[col_letter] = item[col_letter]
                logging.debug(f"Updated record: {record}")
                updated = True
                break
                
        if not updated:
            raise ValueError(f"Item {item_id} not found")
            
        # Write back to sheet
        success = records_to_sheet(worksheet, records, is_routine_worksheet=False)
        if success:
            invalidate_caches()
            return item
            
        return None
    except Exception as e:
        logging.error(f"Error in update_item: {str(e)}")
        raise ValueError(f"Failed to update item: {str(e)}")

def delete_item(item_id):
    """Delete an item and update order values."""
    try:
        spread = get_spread()
        logging.debug(f"Starting delete operation for item_id: {item_id}")
        
        # Get the worksheet and current records
        worksheet = spread.worksheet('Items')
        records = sheet_to_records(worksheet, is_routine_worksheet=False)
        
        # Find the item to delete
        item_id = int(float(item_id))
        deleted_item = next((item for item in records if int(float(item['A'])) == item_id), None)  # Column A for ID
        
        if not deleted_item:
            logging.error(f"Item {item_id} not found")
            return False
            
        deleted_order = int(float(deleted_item['G']))  # Column G for order
        logging.debug(f"Found item {item_id} with order {deleted_order}")
        
        # Remove the item and update orders
        records = [r for r in records if int(float(r['A'])) != item_id]  # Column A for ID
        for record in records:
            if int(float(record['G'])) > deleted_order:  # Column G for order
                record['G'] = str(int(float(record['G'])) - 1)  # Column G for order
                
        # Write back to sheet
        success = records_to_sheet(worksheet, records, is_routine_worksheet=False)
        if success:
            invalidate_caches()
            
        return success
    except Exception as e:
        logging.error(f"Error in delete_item: {str(e)}")
        return False

def update_items_order(items):
    """Update items with their new order."""
    try:
        spread = get_spread()
        logging.debug("Starting order update operation...")
        
        # Get the worksheet
        worksheet = spread.worksheet('Items')
        
        # Update order values to match new positions
        for i, item in enumerate(items):
            item['G'] = str(i)  # Column G for order
            
        # Write back to sheet
        success = records_to_sheet(worksheet, items, is_routine_worksheet=False)
        if success:
            invalidate_caches()
            return items
            
        return []
    except Exception as e:
        logging.error(f"Error in update_items_order: {str(e)}")
        return []

def get_routine(routine_id):
    """Get a specific routine's items."""
    spread = get_spread()
    
    try:
        # Get the worksheet directly using the ID as the sheet name
        worksheet = spread.worksheet(str(routine_id))
        records = sheet_to_records(worksheet, is_routine_worksheet=True)
        return records
    except Exception:
        raise ValueError(f"Routine with ID {routine_id} not found")

def get_active_routine():
    """Get the currently active routine ID."""
    try:
        spread = get_spread()
        
        # Get ActiveRoutine sheet (should already exist)
        try:
            sheet = spread.worksheet('ActiveRoutine')
        except gspread.WorksheetNotFound:
            # Only create if it truly doesn't exist
            try:
                sheet = spread.add_worksheet('ActiveRoutine', rows=1, cols=1)
                sheet.update('A1', '')
            except Exception as create_error:
                # If creation fails (e.g., already exists), try to get it again
                if "already exists" in str(create_error):
                    sheet = spread.worksheet('ActiveRoutine')
                else:
                    raise create_error
            
        # Get active routine ID
        active_id = sheet.acell('A1').value
        return active_id if active_id else None
        
    except Exception as e:
        logging.error(f"Error getting active routine: {str(e)}")
        return None

def set_routine_active(routine_id, active=True):
    """Set the active status of a routine."""
    try:
        spread = get_spread()
        logging.debug(f"Setting routine active status: {routine_id}, active={active}")
        
        # Get ActiveRoutine sheet (should already exist)
        try:
            sheet = spread.worksheet('ActiveRoutine')
        except gspread.WorksheetNotFound:
            # Only create if it truly doesn't exist
            try:
                sheet = spread.add_worksheet('ActiveRoutine', rows=1, cols=1)
            except Exception as create_error:
                # If creation fails (e.g., already exists), try to get it again
                if "already exists" in str(create_error):
                    sheet = spread.worksheet('ActiveRoutine')
                else:
                    raise create_error
        
        # If activating, simply write the ID
        if active:
            sheet.update('A1', str(routine_id))
            logging.debug(f"Set {routine_id} as active routine")
            return True
            
        # If deactivating, only clear if this routine is active
        current = sheet.acell('A1').value
        if current and current == str(routine_id):
            sheet.update('A1', '')
            logging.debug(f"Cleared active routine {routine_id}")
            return True
            
        return True  # No-op if deactivating non-active routine
        
    except Exception as e:
        logging.error(f"Error setting routine active status: {str(e)}")
        return False

def get_all_routine_records():
    """Get all records from the Routines index sheet."""
    try:
        spread = get_spread()
        worksheet = spread.worksheet('Routines')
        # Routines index sheet is NOT a routine worksheet - it's the index of all routines
        records = sheet_to_records(worksheet, is_routine_worksheet=False)
        return records
    except Exception as e:
        logging.error(f"Error getting routine records: {str(e)}")
        return []

def get_all_routines():
    """Get all routines with metadata and active status."""
    spread = get_spread()
    active_id = get_active_routine()
    
    # Get complete routine records from Routines index sheet
    routine_records = get_all_routine_records()
    
    # Add active status to each record
    routines = []
    for record in routine_records:
        # Compare IDs to determine active status
        routine = {
            'ID': record['A'],  # Column A for ID
            'name': record['B'],  # Column B for name
            'created': record['C'],  # Column C for created date
            'order': record['D'],  # Column D for order
            'active': record['A'] == active_id if active_id else False  # Compare IDs
        }
        routines.append(routine)
    
    # Sort by order field
    routines.sort(key=lambda x: x['order'])
    
    return routines

def test_sheets_connection():
    """Test the connection to the spreadsheet."""
    logging.debug("Entered test_sheets_connection")
    try:
        spread = get_spread()
        worksheet = spread.worksheet('Items')
        records = sheet_to_records(worksheet, is_routine_worksheet=False)
        logging.debug(f"Read {len(records)} items from the sheet")
        
        return {
            "success": True,
            "message": "Successfully tested sheets connection",
            "details": {
                "items_read": len(records)
            }
        }
    except Exception as e:
        logging.error(f"Test failed: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }

def add_to_routine(routine_id, item_id, notes=""):
    """Add an item to a routine."""
    try:
        spread = get_spread()
        worksheet = spread.worksheet(str(routine_id))  # Use ID as sheet name
        
        # Get only the ID and order columns to minimize data transfer
        id_col = worksheet.col_values(1)[1:]  # Skip header row
        order_col = worksheet.col_values(3)[1:]  # Skip header row
        
        # Generate new ID and order
        new_id = max([int(float(id_)) for id_ in id_col if id_], default=0) + 1
        max_order = max([int(float(order)) for order in order_col if order], default=-1)
        
        # Append just the new row directly
        new_row = [str(new_id), str(item_id), str(max_order + 1), 'FALSE']
        worksheet.append_row(new_row, value_input_option='USER_ENTERED')
        
        invalidate_caches()
        return {
            'A': str(new_id),           # ID (routine entry ID)
            'B': str(item_id),          # Item ID (reference to Items sheet)
            'C': str(max_order + 1),    # Order
            'D': 'FALSE'                # Completed
        }
            
    except Exception as e:
        logging.error(f"Error in add_to_routine: {str(e)}")
        raise ValueError(f"Failed to add to routine: {str(e)}")

def update_routine_order(routine_id, items):
    """Update routine items with their new order."""
    try:
        spread = get_spread()
        logging.debug(f"Starting routine order update for {routine_id}...")
        logging.debug(f"Received items for reordering: {items}")
        
        worksheet = spread.worksheet(str(routine_id))  # Use ID as sheet name
        
        # Get existing items to ensure we have all data
        existing_items = sheet_to_records(worksheet, is_routine_worksheet=True)
        logging.debug(f"Existing items: {existing_items}")
        
        # Create a map of routine entry IDs to their new order
        new_orders = {item['A']: item['C'] for item in items}
        logging.debug(f"New orders map: {new_orders}")
        
        # Update only the order (column C) for each item
        result_items = []
        for item in existing_items:
            if item['A'] in new_orders:
                # Only update the order, preserve everything else
                item['C'] = new_orders[item['A']]
            result_items.append(item)
            
        logging.debug(f"Final items to write: {result_items}")
        
        # Write back to sheet
        success = records_to_sheet(worksheet, result_items, is_routine_worksheet=True)
        if success:
            invalidate_caches()
            return result_items
        
        return existing_items  # Return original order if write fails
        
    except Exception as e:
        logging.error(f"Error in update_routine_order: {str(e)}")
        return existing_items  # Return original order on error

def update_routines_order(routines):
    """Update the order of routines in the Routines sheet"""
    try:
        # Get the Routines sheet
        spread = get_spread()
        routines_sheet = spread.worksheet('Routines')

        # Get existing routines
        existing_routines = sheet_to_records(routines_sheet, is_routine_worksheet=True)

        # Create a map of ID to new order
        order_map = {update['A']: update['D'] for update in routines}

        # Update orders for routines that are in the updates
        for routine in existing_routines:
            if routine['A'] in order_map:
                routine['D'] = order_map[routine['A']]

        # Write back to sheet
        success = records_to_sheet(routines_sheet, existing_routines, is_routine_worksheet=True)
        if success:
            invalidate_caches()
        return success
    except Exception as e:
        logging.error(f"Error updating routines order: {str(e)}")
        return False

def delete_routine(routine_id):
    """Delete a routine by ID."""
    try:
        spread = get_spread()
        
        # Convert routine_id to integer for comparison
        routine_id_int = int(float(routine_id))
        logging.debug(f"Attempting to delete routine with ID: {routine_id_int}")
        
        # First check if this is the active routine and deactivate if needed
        active_id = get_active_routine()
        if active_id and int(float(active_id)) == routine_id_int:
            logging.debug(f"Deactivating routine {routine_id_int} before deletion")
            set_routine_active(routine_id_int, active=False)
        
        # Get routine info from Routines sheet
        routines = get_all_routine_records()
        routine = next((r for r in routines if int(float(r['A'])) == routine_id_int), None)  # Column A for ID
        
        if not routine:
            logging.error(f"Routine with ID {routine_id_int} not found in routines list")
            raise ValueError(f"Routine with ID {routine_id_int} not found")
            
        logging.debug(f"Found routine to delete: {routine}")
        
        # Get the order value before deletion
        deleted_order = int(float(routine['D']))  # Column D for order
        logging.debug(f"Routine to delete has order: {deleted_order}")
            
        # Delete the worksheet using ID as sheet name
        try:
            # List all worksheets first to debug
            all_worksheets = spread.worksheets()
            worksheet_names = [ws.title for ws in all_worksheets]
            logging.debug(f"Available worksheets: {worksheet_names}")
            
            routine_id_str = str(routine_id_int)
            logging.debug(f"Looking for worksheet with title: {routine_id_str}")
            
            # Try to get the worksheet first
            try:
                worksheet = spread.worksheet(routine_id_str)
                logging.debug(f"Found worksheet with title: {worksheet.title}")
            except Exception as ws_get_error:
                logging.error(f"Error getting worksheet: {str(ws_get_error)}")
                logging.error(f"Error type: {type(ws_get_error)}")
                raise
            
            # If we got the worksheet, try to delete it
            spread.del_worksheet(worksheet)
            logging.debug(f"Successfully deleted worksheet for routine {routine_id_str}")
        except gspread.exceptions.WorksheetNotFound:
            logging.warning(f"Worksheet {routine_id_str} not found, continuing with routine deletion")
            # Continue even if worksheet doesn't exist - it might have been deleted previously
            pass
        except Exception as ws_error:
            logging.error(f"Error deleting worksheet: {str(ws_error)}")
            logging.error(f"Error type: {type(ws_error)}")
            raise
        
        # Remove from Routines index and update orders
        try:
            routines_sheet = spread.worksheet('Routines')
            records = sheet_to_records(routines_sheet)
            logging.debug(f"Current records before deletion: {records}")
            
            # Remove the routine and update orders for remaining routines
            updated_records = []
            for record in records:
                current_id = int(float(record['A']))
                if current_id != routine_id_int:
                    current_order = int(float(record['D']))
                    if current_order > deleted_order:
                        # Decrease order by 1 for all routines that were after the deleted one
                        record['D'] = str(current_order - 1)
                    updated_records.append(record)
            
            logging.debug(f"Updated records after reordering: {updated_records}")
                    
            # Write back to sheet
            success = records_to_sheet(routines_sheet, updated_records)
            if success:
                invalidate_caches()
                logging.debug("Successfully updated Routines index sheet")
                return True
            else:
                logging.error("Failed to write updated records back to Routines sheet")
                raise Exception("Failed to update Routines index sheet")
        except Exception as idx_error:
            logging.error(f"Error updating Routines index: {str(idx_error)}")
            raise
        
    except Exception as e:
        logging.error(f"Error in delete_routine: {str(e)}")
        logging.error(f"Error type: {type(e)}")
        if hasattr(e, '__dict__'):
            logging.error(f"Error details: {e.__dict__}")
        return False

def update_routine_item(routine_id, item_id, item):
    """Update a single item in a routine (e.g., to update notes)."""
    try:
        spread = get_spread()
        worksheet = spread.worksheet(str(routine_id))  # Use ID as sheet name
        records = sheet_to_records(worksheet, is_routine_worksheet=True)
        
        # Find and update the item
        item_id = str(item_id)  # Ensure string comparison
        updated = False
        for record in records:
            if record['A'] == item_id:  # Use column A (routine entry ID)
                # Preserve ID and order
                item['A'] = record['A']  # Use column A (routine entry ID)
                item['C'] = record['C']  # Use column C (order)
                # Update the record
                record.update(item)
                updated = True
                break
                
        if not updated:
            raise ValueError(f"Item {item_id} not found in routine {routine_id}")
            
        # Write back to sheet
        success = records_to_sheet(worksheet, records, is_routine_worksheet=True)
        if success:
            invalidate_caches()
            return item
            
        return None
    except Exception as e:
        logging.error(f"Error in update_routine_item: {str(e)}")
        raise ValueError(f"Failed to update routine item: {str(e)}")

def remove_from_routine(routine_id, routine_entry_id):
    """Remove an item from a routine using its routine entry ID (column A)."""
    try:
        logging.debug(f"Starting remove_from_routine for routine: {routine_id}, routine_entry_id: {routine_entry_id}")
        spread = get_spread()
        worksheet = spread.worksheet(str(routine_id))  # Use ID as sheet name
        records = sheet_to_records(worksheet, is_routine_worksheet=True)
        logging.debug(f"Initial records: {records}")
        
        # Find and remove the item using routine entry ID (column A)
        deleted_item = next((item for item in records if item['A'] == routine_entry_id), None)
        logging.debug(f"Found item to delete: {deleted_item}")
        if not deleted_item:
            logging.error(f"No item found with routine entry ID {routine_entry_id}")
            return False
            
        # Remove the row and update order numbers
        records = [r for r in records if r['A'] != routine_entry_id]
        logging.debug(f"Records after removal: {records}")
        
        # Update order values sequentially
        for i, record in enumerate(records):
            record['C'] = str(i)
        logging.debug(f"Records after reordering: {records}")
            
        # Write back to sheet
        success = records_to_sheet(worksheet, records, is_routine_worksheet=True)
        logging.debug(f"Write back success: {success}")
        if success:
            invalidate_caches()
            
        return success
    except Exception as e:
        logging.error(f"Error in remove_from_routine: {str(e)}")
        return False

def get_worksheet(worksheet_name):
    """Get a worksheet by name."""
    try:
        spread = get_spread()
        
        # Get all worksheet names
        all_worksheets = spread.worksheets()
        
        # Find the worksheet with a case-insensitive match
        for ws in all_worksheets:
            if ws.title.lower() == worksheet_name.lower():
                return ws
                
        raise gspread.exceptions.WorksheetNotFound(worksheet_name)
    except Exception as e:
        logging.error(f"Error getting worksheet {worksheet_name}: {str(e)}")
        raise

# ChordCharts functions
def initialize_chordcharts_sheet():
    """Create and initialize the ChordCharts sheet if it doesn't exist."""
    try:
        spread = get_spread()
        
        # Check if ChordCharts sheet exists
        try:
            sheet = spread.worksheet('ChordCharts')
            logging.debug("ChordCharts sheet already exists")
            return True
                
        except gspread.WorksheetNotFound:
            logging.debug("Creating new ChordCharts sheet")
            sheet = spread.add_worksheet('ChordCharts', rows=1000, cols=20)
            
            # Add header row
            header_row = ['ChordID', 'ItemID', 'Title', 'ChordData', 'CreatedAt', 'Order']
            sheet.update('A1:F1', [header_row])
            return True
            
    except Exception as e:
        logging.error(f"Error initializing ChordCharts sheet: {str(e)}")
        raise

def get_chord_charts_for_item(item_id):
    """Get all chord charts for a specific item."""
    try:
        spread = get_spread()
        
        # Initialize sheet if it doesn't exist
        initialize_chordcharts_sheet()
        
        sheet = spread.worksheet('ChordCharts')
        records = sheet_to_records(sheet, is_routine_worksheet=False)
        
        # Filter by ItemID (handle comma-separated values) and sort by Order
        item_id_str = str(item_id)
        item_charts = []
        for r in records:
            item_ids = r.get('B', '').split(',')  # Split on comma
            item_ids = [id.strip() for id in item_ids]  # Remove whitespace
            if item_id_str in item_ids:
                item_charts.append(r)
        
        # Sort by Order (column F)
        item_charts.sort(key=lambda x: int(float(x.get('F', 0))))
        
        # Parse ChordData JSON for each chart
        parsed_charts = []
        for chart in item_charts:
            try:
                import json
                chord_data_raw = chart.get('D', '{}')  # Column D = ChordData
                
                # Skip empty or corrupted chord data
                if not chord_data_raw or chord_data_raw.strip() in ['', '{}']:
                    logging.warning(f"Skipping chord chart {chart.get('A', 'unknown')} with empty/corrupted data")
                    continue
                
                chart_data = json.loads(chord_data_raw)
                
                # Validate essential chord data exists
                if not chart_data or not isinstance(chart_data, dict):
                    logging.warning(f"Skipping chord chart {chart.get('A', 'unknown')} with invalid data structure")
                    continue
                
                # Ensure hasLineBreakAfter field exists for all chords
                if 'hasLineBreakAfter' not in chart_data:
                    chart_data['hasLineBreakAfter'] = False
                
                parsed_charts.append({
                    'id': chart.get('A'),  # Column A = ChordID
                    'itemId': chart.get('B'),  # Column B = ItemID
                    'title': chart.get('C'),  # Column C = Title
                    'createdAt': chart.get('E'),  # Column E = CreatedAt
                    'order': chart.get('F'),  # Column F = Order
                    **chart_data  # Spread the chord data (fingers, barres, tuning, etc.)
                })
            except (json.JSONDecodeError, ValueError, TypeError) as e:
                logging.error(f"Error parsing chord chart data for chart {chart.get('A', 'unknown')}: {str(e)}")
                continue
                
        return parsed_charts
        
    except Exception as e:
        logging.error(f"Error getting chord charts for item {item_id}: {str(e)}")
        return []

def add_chord_chart(item_id, chord_data):
    """Add a new chord chart for an item."""
    try:
        import json
        spread = get_spread()
        
        # Initialize sheet if it doesn't exist
        initialize_chordcharts_sheet()
        
        sheet = spread.worksheet('ChordCharts')
        records = sheet_to_records(sheet, is_routine_worksheet=False)
        
        # Generate new ChordID
        new_id = max([int(float(r.get('A', 0))) for r in records if r.get('A')], default=0) + 1
        
        # Get all ItemIDs that should be included for this item
        # Check if any existing chord charts for this item have multiple ItemIDs
        item_id_str = str(item_id)
        all_item_ids = set([item_id_str])  # Start with the current item ID
        
        # Find all chord charts that include this item ID
        for record in records:
            record_item_ids = record.get('B', '').split(',')
            record_item_ids = [id.strip() for id in record_item_ids if id.strip()]
            if item_id_str in record_item_ids:
                # This chart belongs to our item, include all its ItemIDs
                all_item_ids.update(record_item_ids)
        
        # Create comma-separated ItemID string
        item_ids_str = ', '.join(sorted(all_item_ids))
        
        # Get item charts for order management
        item_charts = []
        for r in records:
            record_item_ids = r.get('B', '').split(',')
            record_item_ids = [id.strip() for id in record_item_ids if id.strip()]
            if item_id_str in record_item_ids:
                item_charts.append(r)
        
        # Handle insertion context for proper order assignment
        if 'insertionContext' in chord_data and chord_data['insertionContext']:
            # Insert after specific chord with order rebalancing
            insertion_order = chord_data['insertionContext']['insertOrder']
            new_order = insertion_order
            
            # Filter to same section only for order rebalancing
            target_section_id = chord_data['insertionContext']['sectionId']
            
            logging.info(f"Inserting chord at order {insertion_order} in section {target_section_id}")
            
            # Update order for existing chords that need to be shifted
            shifts_made = 0
            for record in records:
                record_item_ids = record.get('B', '').split(',')
                record_item_ids = [id.strip() for id in record_item_ids if id.strip()]
                
                if item_id_str in record_item_ids:
                    current_order = int(float(record.get('F', 0)))
                    
                    # Check if this chord is in the same section by parsing its chord data
                    try:
                        import json
                        record_chord_data = json.loads(record.get('D', '{}'))
                        record_section_id = record_chord_data.get('sectionId', 'section-1')
                        
                        # Only increment order for chords in same section with order >= insertion point
                        if record_section_id == target_section_id and current_order >= insertion_order:
                            old_order = record['F']
                            record['F'] = str(current_order + 1)
                            shifts_made += 1
                            logging.info(f"Shifted chord {record.get('A')} ({record_chord_data.get('title', 'Unknown')}) from order {old_order} to {record['F']}")
                    except (json.JSONDecodeError, ValueError):
                        # Skip records with invalid JSON
                        logging.warning(f"Skipping record {record.get('A')} with invalid JSON")
                        continue
            
            logging.info(f"Made {shifts_made} order shifts for insertion")
        else:
            # Original behavior: add to end
            max_order = max([int(float(r.get('F', -1))) for r in item_charts], default=-1)
            new_order = max_order + 1
        
        # Format timestamp
        now = datetime.now()
        timestamp = now.strftime('%Y-%m-%d %I:%M%p PST')
        
        # Extract title and chord data
        title = chord_data.get('title', 'Untitled Chord')
        chord_json = json.dumps({
            'fingers': chord_data.get('fingers', []),
            'barres': chord_data.get('barres', []),
            'tuning': chord_data.get('tuning', 'EADGBE'),
            'capo': chord_data.get('capo', 0),
            'startingFret': chord_data.get('startingFret', 1),
            'numFrets': chord_data.get('numFrets', 5),
            'numStrings': chord_data.get('numStrings', 6),
            'openStrings': chord_data.get('openStrings', []),
            'mutedStrings': chord_data.get('mutedStrings', []),
            # Section metadata for chord organization
            'sectionId': chord_data.get('sectionId', None),
            'sectionLabel': chord_data.get('sectionLabel', ''),
            'sectionRepeatCount': chord_data.get('sectionRepeatCount', ''),
            # Line break functionality
            'hasLineBreakAfter': chord_data.get('hasLineBreakAfter', False)
        })
        
        # Create new record
        new_record = {
            'A': str(new_id),      # ChordID
            'B': item_ids_str,     # ItemID (comma-separated if shared)
            'C': title,            # Title
            'D': chord_json,       # ChordData
            'E': timestamp,        # CreatedAt
            'F': str(new_order)    # Order
        }
        
        # Add to records and save
        records.append(new_record)
        success = records_to_sheet(sheet, records, is_routine_worksheet=False)
        
        if success:
            invalidate_caches()
            return {
                'id': new_id,
                'itemId': item_id,
                'title': title,
                'createdAt': timestamp,
                'order': new_order,
                **json.loads(chord_json)
            }
            
        return None
        
    except Exception as e:
        logging.error(f"Error adding chord chart: {str(e)}")
        raise ValueError(f"Failed to add chord chart: {str(e)}")

def batch_add_chord_charts(item_id, chord_charts_data):
    """Add multiple chord charts for an item in a single operation to avoid rate limiting."""
    try:
        import json
        from datetime import datetime
        
        if not chord_charts_data:
            return []
            
        spread = get_spread()
        
        # Initialize sheet if it doesn't exist
        initialize_chordcharts_sheet()
        
        sheet = spread.worksheet('ChordCharts')
        records = sheet_to_records(sheet, is_routine_worksheet=False)
        
        # Generate new ChordIDs starting from max existing
        max_id = max([int(float(r.get('A', 0))) for r in records if r.get('A')], default=0)
        
        # Get all ItemIDs that should be included for this item
        item_id_str = str(item_id)
        all_item_ids = set([item_id_str])
        
        # Find all chord charts that include this item ID to preserve multi-item associations
        for record in records:
            record_item_ids = record.get('B', '').split(',')
            record_item_ids = [id.strip() for id in record_item_ids if id.strip()]
            if item_id_str in record_item_ids:
                all_item_ids.update(record_item_ids)
        
        item_ids_str = ', '.join(sorted(all_item_ids))
        
        # Get highest order for this item
        item_charts = [r for r in records if item_id_str in [id.strip() for id in r.get('B', '').split(',')]]
        
        # Safe max_order calculation that handles empty/invalid values
        valid_orders = []
        for r in item_charts:
            order_val = r.get('F', -1)
            if order_val and str(order_val).strip():
                try:
                    valid_orders.append(int(float(str(order_val))))
                except (ValueError, TypeError):
                    continue
        max_order = max(valid_orders, default=-1)
        
        # Create all new records
        new_records = []
        timestamp = datetime.now().strftime('%Y-%m-%d %I:%M%p PST')
        
        for i, chord_data in enumerate(chord_charts_data):
            new_id = max_id + i + 1
            new_order = max_order + i + 1
            
            title = chord_data.get('title', 'Untitled Chord')
            chord_json = json.dumps({
                'fingers': chord_data.get('fingers', []),
                'barres': chord_data.get('barres', []),
                'numFrets': chord_data.get('numFrets', 5),
                'numStrings': chord_data.get('numStrings', 6),
                'tuning': chord_data.get('tuning', 'EADGBE'),
                'capo': chord_data.get('capo', 0),
                'openStrings': chord_data.get('openStrings', []),
                'mutedStrings': chord_data.get('mutedStrings', []),
                'startingFret': chord_data.get('startingFret', 1),
                # Section metadata
                'sectionId': chord_data.get('sectionId', 'section-1'),
                'sectionLabel': chord_data.get('sectionLabel', ''),
                'sectionRepeatCount': chord_data.get('sectionRepeatCount', ''),
                # Line break functionality
                'hasLineBreakAfter': chord_data.get('hasLineBreakAfter', False)
            })
            
            new_record = {
                'A': str(new_id),      # ChordID
                'B': item_ids_str,     # ItemID (comma-separated if shared)
                'C': title,            # Title
                'D': chord_json,       # ChordData
                'E': timestamp,        # CreatedAt
                'F': str(new_order)    # Order
            }
            
            new_records.append(new_record)
        
        # Add all new records to the sheet in one operation
        records.extend(new_records)
        success = records_to_sheet(sheet, records, is_routine_worksheet=False)
        
        if success:
            invalidate_caches()
            # Return the created chord chart data
            created_charts = []
            for i, new_record in enumerate(new_records):
                created_charts.append({
                    'id': int(new_record['A']),
                    'itemId': item_id,
                    'title': new_record['C'],
                    'createdAt': new_record['E'],
                    'order': int(new_record['F']),
                    **json.loads(new_record['D'])
                })
            return created_charts
            
        return []
        
    except Exception as e:
        logging.error(f"Error batch adding chord charts: {str(e)}")
        raise ValueError(f"Failed to batch add chord charts: {str(e)}")

def delete_chord_chart(chord_id):
    """Delete a chord chart by ID."""
    try:
        spread = get_spread()
        sheet = spread.worksheet('ChordCharts')
        records = sheet_to_records(sheet, is_routine_worksheet=False)
        
        # Find and remove the chart
        chart_to_delete = next((r for r in records if r.get('A') == str(chord_id)), None)
        if not chart_to_delete:
            raise ValueError(f"Chord chart {chord_id} not found")
            
        # Get the item_id and order of deleted chart
        item_id = chart_to_delete.get('B')
        deleted_order = int(float(chart_to_delete.get('F', 0)))
        
        # Remove the chart
        records = [r for r in records if r.get('A') != str(chord_id)]
        
        # Update order for remaining charts of the same item
        for record in records:
            if record.get('B') == item_id:  # Same item
                current_order = int(float(record.get('F', 0)))
                if current_order > deleted_order:
                    record['F'] = str(current_order - 1)
        
        # Save updated records
        success = records_to_sheet(sheet, records, is_routine_worksheet=False)
        if success:
            invalidate_caches()
            
        return success
        
    except ValueError as e:
        # Re-raise ValueError so the route can handle it properly
        logging.warning(f"Chord chart not found: {str(e)}")
        raise
    except Exception as e:
        logging.error(f"Error deleting chord chart: {str(e)}")
        return False

def batch_delete_chord_charts(chord_ids):
    """Delete multiple chord charts by IDs in a single API transaction."""
    if not chord_ids:
        return {'success': True, 'deleted': [], 'not_found': [], 'failed': []}
    
    # Apply global throttling to prevent concurrent batch operations
    _throttle_batch_operation()
    
    def do_batch_delete():
        # Add small delay before starting to avoid back-to-back API calls
        time.sleep(0.2)
        spread = get_spread()
        sheet = spread.worksheet('ChordCharts')
        records = sheet_to_records(sheet, is_routine_worksheet=False)
        return spread, sheet, records
    
    try:
        # Apply retry logic to the entire operation, including initial data fetch
        _, sheet, records = retry_on_rate_limit(do_batch_delete, max_retries=2, base_delay=2)
        
        # Track results
        deleted_ids = []
        not_found_ids = []
        failed_ids = []
        
        # Find charts to delete and track by item for order updates
        charts_to_delete = []
        items_affected = {}
        
        for chord_id in chord_ids:
            chart_to_delete = next((r for r in records if r.get('A') == str(chord_id)), None)
            if not chart_to_delete:
                not_found_ids.append(chord_id)
                continue
                
            charts_to_delete.append(chart_to_delete)
            item_id = chart_to_delete.get('B')
            deleted_order = int(float(chart_to_delete.get('F', 0)))
            
            if item_id not in items_affected:
                items_affected[item_id] = []
            items_affected[item_id].append(deleted_order)
        
        # Remove all charts to delete
        records = [r for r in records if r.get('A') not in [str(cid) for cid in chord_ids]]
        
        # Update order for remaining charts in affected items
        for item_id, deleted_orders in items_affected.items():
            deleted_orders.sort()  # Sort to handle multiple deletions correctly
            
            for record in records:
                if record.get('B') == item_id:  # Same item
                    current_order = int(float(record.get('F', 0)))
                    # Count how many deleted orders were below current order
                    adjustments = sum(1 for deleted_order in deleted_orders if deleted_order < current_order)
                    if adjustments > 0:
                        record['F'] = str(current_order - adjustments)
        
        # Save updated records in one API call with retry logic
        def save_with_retry():
            # Add delay before save operation to space out API calls
            time.sleep(0.3)
            return records_to_sheet(sheet, records, is_routine_worksheet=False)
        
        success = retry_on_rate_limit(save_with_retry, max_retries=2, base_delay=2)
        
        if success:
            deleted_ids = [chart['A'] for chart in charts_to_delete]
            logging.info(f"Batch deleted {len(deleted_ids)} chord charts: {deleted_ids}")
            
            # Aggressive cache clearing - clear multiple times with delay
            invalidate_caches()
            time.sleep(0.1)  # Small delay to ensure writes are committed
            invalidate_caches()  # Clear again to be sure
        else:
            failed_ids = [chart['A'] for chart in charts_to_delete]
            logging.error(f"Failed to save after batch delete")
            
        return {
            'success': success,
            'deleted': deleted_ids,
            'not_found': not_found_ids,
            'failed': failed_ids
        }
        
    except Exception as e:
        logging.error(f"Error in batch delete chord charts: {str(e)}")
        return {
            'success': False,
            'deleted': [],
            'not_found': [],
            'failed': chord_ids,
            'error': str(e)
        }

def update_chord_chart(chord_id, chord_data):
    """Update a chord chart by ID."""
    try:
        spread = get_spread()
        sheet = spread.worksheet('ChordCharts')
        records = sheet_to_records(sheet, is_routine_worksheet=False)
        
        # Find the chart to update
        chart_to_update = next((r for r in records if r.get('A') == str(chord_id)), None)
        if not chart_to_update:
            raise ValueError(f"Chord chart {chord_id} not found")
        
        # Update the chord data (preserve existing fields not provided in update)
        if 'title' in chord_data:
            chart_to_update['C'] = chord_data['title']
        
        # Update the ChordData JSON field - merge with existing data
        import json
        try:
            existing_chord_data = json.loads(chart_to_update.get('D', '{}'))
        except json.JSONDecodeError:
            existing_chord_data = {}
        
        # Merge chord_data into existing_chord_data
        existing_chord_data.update(chord_data)
        chart_to_update['D'] = json.dumps(existing_chord_data)
        
        # Save updated records
        success = records_to_sheet(sheet, records, is_routine_worksheet=False)
        if success:
            invalidate_caches()
            # Return updated chart data (spread chord data to include hasLineBreakAfter)
            # Handle comma-separated ItemIDs properly - preserve all existing ItemIDs
            item_id_raw = str(chart_to_update['B']).strip()
            
            # For the return value, we need a single ItemID - use the first one
            if ',' in item_id_raw:
                # Comma-separated ItemIDs - use the first one for the return value
                first_item_id = item_id_raw.split(',')[0].strip()
            else:
                first_item_id = item_id_raw
                
            return {
                'id': int(chart_to_update['A']),
                'itemId': int(first_item_id),
                'title': chart_to_update['C'],
                'createdAt': chart_to_update['E'],
                'order': int(float(chart_to_update['F'])),
                **existing_chord_data  # Spread the chord data to include hasLineBreakAfter
            }
            
        return None
        
    except Exception as e:
        logging.error(f"Error updating chord chart: {str(e)}")
        raise ValueError(f"Failed to update chord chart: {str(e)}")

def update_chord_charts_order(item_id, chord_charts):
    """Update the order of chord charts for an item."""
    try:
        spread = get_spread()
        sheet = spread.worksheet('ChordCharts')
        records = sheet_to_records(sheet, is_routine_worksheet=False)
        
        # Create a map of chord IDs to new orders
        new_orders = {chart['id']: i for i, chart in enumerate(chord_charts)}
        
        # Update order for charts belonging to this item
        for record in records:
            chart_id = record.get('A')
            if record.get('B') == str(item_id) and chart_id in new_orders:
                record['F'] = str(new_orders[chart_id])
        
        # Save updated records
        success = records_to_sheet(sheet, records, is_routine_worksheet=False)
        if success:
            invalidate_caches()
            return True
            
        return False
        
    except Exception as e:
        logging.error(f"Error updating chord charts order: {str(e)}")
        return False

def get_common_chord_charts():
    """Get all common chord charts from the CommonChords sheet."""
    try:
        spread = get_spread()
        
        # Try to get the CommonChords sheet, create if it doesn't exist
        try:
            sheet = spread.worksheet('CommonChords')
        except gspread.WorksheetNotFound:
            logging.info("CommonChords sheet not found, creating it...")
            # Create the sheet with headers
            sheet = spread.add_worksheet(title='CommonChords', rows=100, cols=6)
            # Add headers (same as ChordCharts)
            sheet.update('A1:F1', [['ChordID', 'ItemID', 'Title', 'ChordData', 'CreatedAt', 'Order']])
            return []  # Return empty list for now
        
        # Get all records
        records = sheet_to_records(sheet, is_routine_worksheet=False)
        
        # Convert to the same format as regular chord charts
        common_chords = []
        for record in records:
            try:
                chord_data_str = record.get('D', '{}')
                chord_data = json.loads(chord_data_str) if chord_data_str else {}
                
                chord_chart = {
                    'id': record.get('A'),
                    'itemId': record.get('B', 'common'),  # Mark as common chord
                    'title': record.get('C'),
                    'createdAt': record.get('E'),
                    'order': record.get('F', '0'),
                    # Chord data fields
                    'fingers': chord_data.get('fingers', []),
                    'barres': chord_data.get('barres', []),
                    'openStrings': chord_data.get('openStrings', []),
                    'mutedStrings': chord_data.get('mutedStrings', []),
                    'startingFret': chord_data.get('startingFret', 1),
                    'numFrets': chord_data.get('numFrets', 5),
                    'numStrings': chord_data.get('numStrings', 6),
                    'tuning': chord_data.get('tuning', 'EADGBE'),
                    'capo': chord_data.get('capo', 0)
                }
                common_chords.append(chord_chart)
                
            except (json.JSONDecodeError, ValueError) as e:
                logging.warning(f"Error parsing chord data for common chord {record.get('A')}: {str(e)}")
                continue
        
        logging.info(f"Retrieved {len(common_chords)} common chord charts")
        return common_chords
        
    except Exception as e:
        logging.error(f"Error getting common chord charts: {str(e)}")
        return []

def search_common_chord_charts(chord_name):
    """Search for common chord charts by name using case-insensitive matching."""
    try:
        spread = get_spread()
        
        # Try to get the CommonChords sheet
        try:
            sheet = spread.worksheet('CommonChords')
        except gspread.WorksheetNotFound:
            logging.info("CommonChords sheet not found")
            return []
        
        # Use find_all to search for chord names in the title column (Column C)
        # Note: gspread's find is case-sensitive, so we'll need to get a few rows and filter
        try:
            # Get all values in the title column to search through
            title_values = sheet.col_values(3)  # Column C (Title)
            
            # Find matching row indices (1-based) - prioritize exact matches
            exact_matches = []
            partial_matches = []
            chord_name_lower = chord_name.lower()
            
            for i, title in enumerate(title_values[1:], start=2):  # Skip header row
                if title:
                    title_lower = title.lower()
                    if chord_name_lower == title_lower:
                        # Exact match - highest priority
                        exact_matches.append(i)
                    elif chord_name_lower in title_lower:
                        # Substring match - lower priority
                        partial_matches.append(i)
            
            # Combine matches with exact matches first
            matching_indices = exact_matches + partial_matches
            
            if not matching_indices:
                logging.info(f"No common chords found matching '{chord_name}'")
                return []
            
            # Batch get the matching rows
            ranges = [f'A{i}:F{i}' for i in matching_indices[:10]]  # Limit to 10 matches
            if len(ranges) == 1:
                batch_data = [sheet.get(ranges[0])]
            else:
                batch_data = sheet.batch_get(ranges)
            
            # Convert to chord chart format
            matching_chords = []
            for row_data in batch_data:
                if not row_data or not row_data[0]:  # Skip empty results
                    continue
                    
                row = row_data[0]
                if len(row) < 4:  # Need at least ChordID, ItemID, Title, ChordData
                    continue
                
                try:
                    chord_data_str = row[3] if len(row) > 3 else '{}'
                    chord_data = json.loads(chord_data_str) if chord_data_str else {}
                    
                    # Normalize finger data format - handle both object and array formats
                    raw_fingers = chord_data.get('fingers', [])
                    normalized_fingers = []
                    
                    for finger in raw_fingers:
                        if isinstance(finger, dict):
                            # Object format: {"string": 3, "fret": 2, "finger": 1}
                            string_num = finger.get('string')
                            fret_num = finger.get('fret') 
                            finger_num = finger.get('finger')
                            if string_num is not None and fret_num is not None:
                                if finger_num is not None:
                                    normalized_fingers.append([string_num, fret_num, finger_num])
                                else:
                                    normalized_fingers.append([string_num, fret_num])
                        elif isinstance(finger, list) and len(finger) >= 2:
                            # Array format: [3, 2] or [3, 2, 1]
                            normalized_fingers.append(finger)
                        else:
                            logging.warning(f"Skipping invalid finger data: {finger}")
                    
                    chord_chart = {
                        'id': row[0],
                        'itemId': row[1] if len(row) > 1 else 'common',
                        'title': row[2] if len(row) > 2 else chord_name,
                        'createdAt': row[4] if len(row) > 4 else '',
                        'order': int(float(row[5])) if len(row) > 5 and row[5] else 0,
                        'fingers': normalized_fingers,
                        'barres': chord_data.get('barres', []),
                        'numFrets': chord_data.get('numFrets', 5),
                        'numStrings': chord_data.get('numStrings', 6),
                        'tuning': chord_data.get('tuning', 'EADGBE'),
                        'capo': chord_data.get('capo', 0),
                        'openStrings': chord_data.get('openStrings', []),
                        'mutedStrings': chord_data.get('mutedStrings', []),
                        'startingFret': chord_data.get('startingFret', 1)
                    }
                    matching_chords.append(chord_chart)
                    
                except (json.JSONDecodeError, ValueError, IndexError) as e:
                    logging.warning(f"Error parsing search result for chord '{chord_name}': {str(e)}")
                    continue
            
            logging.info(f"Found {len(matching_chords)} common chords matching '{chord_name}'")
            return matching_chords
            
        except Exception as e:
            logging.warning(f"Error searching common chords, falling back to full search: {str(e)}")
            # Fallback: get all and filter (not ideal but better than failing)
            all_chords = get_common_chord_charts()
            matches = [chord for chord in all_chords 
                      if chord_name.lower() in chord.get('title', '').lower()]
            return matches[:10]  # Limit results
        
    except Exception as e:
        logging.error(f"Error searching common chord charts: {str(e)}")
        return []

def seed_common_chord_charts():
    """Seed the CommonChords sheet with essential guitar chords."""
    try:
        spread = get_spread()
        
        # Get or create the CommonChords sheet
        try:
            sheet = spread.worksheet('CommonChords')
        except gspread.WorksheetNotFound:
            logging.info("CommonChords sheet not found, creating it...")
            sheet = spread.add_worksheet(title='CommonChords', rows=100, cols=6)
            sheet.update('A1:F1', [['ChordID', 'ItemID', 'Title', 'ChordData', 'CreatedAt', 'Order']])
        
        # Get existing records to avoid duplicates
        records = sheet_to_records(sheet, is_routine_worksheet=False)
        existing_titles = {record.get('C', '').lower() for record in records}
        
        # Essential chord fingerings - starting with basic open chords
        essential_chords = [
            {
                'title': 'E',
                'fingers': [
                    {'string': 3, 'fret': 1, 'finger': 1},  # G string (SVGuitar string 3), 1st fret, index finger
                    {'string': 4, 'fret': 2, 'finger': 2},  # D string (SVGuitar string 4), 2nd fret, middle finger
                    {'string': 5, 'fret': 2, 'finger': 3}   # A string (SVGuitar string 5), 2nd fret, ring finger
                ],
                'openStrings': [1, 2, 6],  # High E (1), B (2), low E (6) strings open
                'mutedStrings': [],
                'barres': []
            },
            {
                'title': 'Am',
                'fingers': [
                    {'string': 2, 'fret': 1, 'finger': 1},  # B string (SVGuitar string 2), 1st fret, index finger
                    {'string': 3, 'fret': 2, 'finger': 2},  # G string (SVGuitar string 3), 2nd fret, middle finger
                    {'string': 4, 'fret': 2, 'finger': 3}   # D string (SVGuitar string 4), 2nd fret, ring finger
                ],
                'openStrings': [1, 5],     # High E (1), A (5) strings open
                'mutedStrings': [6],       # Low E (6) string muted
                'barres': []
            },
            {
                'title': 'C',
                'fingers': [
                    {'string': 2, 'fret': 1, 'finger': 1},  # B string (SVGuitar string 2), 1st fret, index finger
                    {'string': 4, 'fret': 2, 'finger': 2},  # D string (SVGuitar string 4), 2nd fret, middle finger
                    {'string': 5, 'fret': 3, 'finger': 3}   # A string (SVGuitar string 5), 3rd fret, ring finger
                ],
                'openStrings': [1, 3],     # High E (1), G (3) strings open
                'mutedStrings': [6],       # Low E (6) string muted
                'barres': []
            },
            {
                'title': 'G',
                'fingers': [
                    {'string': 1, 'fret': 3, 'finger': 3},  # High E string (SVGuitar string 1), 3rd fret, ring finger
                    {'string': 6, 'fret': 3, 'finger': 2}   # Low E string (SVGuitar string 6), 3rd fret, middle finger
                ],
                'openStrings': [2, 3, 4, 5],  # B (2), G (3), D (4), A (5) strings open
                'mutedStrings': [],
                'barres': []
            },
            {
                'title': 'A',
                'fingers': [
                    {'string': 4, 'fret': 2, 'finger': 1},  # D string (SVGuitar string 4), 2nd fret, index finger
                    {'string': 3, 'fret': 2, 'finger': 2},  # G string (SVGuitar string 3), 2nd fret, middle finger
                    {'string': 2, 'fret': 2, 'finger': 3}   # B string (SVGuitar string 2), 2nd fret, ring finger
                ],
                'openStrings': [1, 5],     # High E (1), A (5) strings open
                'mutedStrings': [6],       # Low E (6) string muted
                'barres': []
            },
            {
                'title': 'D',
                'fingers': [
                    {'string': 3, 'fret': 2, 'finger': 1},  # G string (SVGuitar string 3), 2nd fret, index finger
                    {'string': 2, 'fret': 3, 'finger': 3},  # B string (SVGuitar string 2), 3rd fret, ring finger
                    {'string': 1, 'fret': 2, 'finger': 2}   # High E string (SVGuitar string 1), 2nd fret, middle finger
                ],
                'openStrings': [4],        # D (4) string open
                'mutedStrings': [5, 6],    # A (5), Low E (6) strings muted
                'barres': []
            }
        ]
        
        # Add chords that don't already exist
        chords_to_add = []
        for i, chord in enumerate(essential_chords):
            if chord['title'].lower() not in existing_titles:
                chord_data = {
                    'fingers': chord['fingers'],
                    'barres': chord['barres'],
                    'openStrings': chord['openStrings'],
                    'mutedStrings': chord['mutedStrings'],
                    'startingFret': 1,
                    'numFrets': 5,
                    'numStrings': 6,
                    'tuning': 'EADGBE',
                    'capo': 0
                }
                
                new_record = {
                    'A': str(i + 1),                    # ChordID
                    'B': 'common',                      # ItemID (mark as common)
                    'C': chord['title'],                # Title
                    'D': json.dumps(chord_data),        # ChordData (JSON)
                    'E': datetime.now().isoformat(),    # CreatedAt
                    'F': str(i)                         # Order
                }
                chords_to_add.append(new_record)
        
        if chords_to_add:
            # Add new records to existing ones
            all_records = records + chords_to_add
            success = records_to_sheet(sheet, all_records, is_routine_worksheet=False)
            
            if success:
                logging.info(f"Seeded {len(chords_to_add)} common chords: {[c['C'] for c in chords_to_add]}")
                return True
            else:
                logging.error("Failed to save seeded common chords")
                return False
        else:
            logging.info("All essential chords already exist in CommonChords sheet")
            return True
            
    except Exception as e:
        logging.error(f"Error seeding common chord charts: {str(e)}")
        return False

def convert_fret_positions_to_svguitar(positions_array, fingerings_array=None):
    """
    Convert TormodKv chord format to SVGuitar format.
    
    Args:
        positions_array: List like ["x","3","2","0","1","0"] representing strings 6→1
        fingerings_array: Optional fingerings (we'll use positions if not provided)
        
    Returns:
        Dict with SVGuitar format: {fingers: [[string, fret]], openStrings: [], mutedStrings: []}
    """
    try:
        if not positions_array or len(positions_array) != 6:
            raise ValueError("positions_array must be a list of 6 string positions")
            
        fingers = []
        open_strings = []
        muted_strings = []
        
        # Convert positions - TormodKv uses strings 6→1 (low E to high E)
        # SVGuitar uses strings 1→6 (high E to low E), so we need to reverse the mapping
        for i, position in enumerate(positions_array):
            string_number = 6 - i  # Convert: index 0 (string 6) → SVGuitar string 6
                                   #          index 5 (string 1) → SVGuitar string 1
            
            if position == "x":
                muted_strings.append(string_number)
            elif position == "0":
                open_strings.append(string_number)
            else:
                try:
                    fret_number = int(position)
                    if fret_number > 0:
                        fingers.append([string_number, fret_number])
                except ValueError:
                    logging.warning(f"Invalid fret position: {position}, skipping")
                    continue
        
        return {
            'fingers': fingers,
            'openStrings': open_strings,
            'mutedStrings': muted_strings,
            'tuning': 'EADGBE',  # Standard tuning
            'capo': 0,
            'startingFret': 1,
            'numFrets': 5,
            'numStrings': 6,
            'barres': []  # TormodKv format doesn't specify barres, leave empty
        }
        
    except Exception as e:
        logging.error(f"Error converting fret positions: {str(e)}")
        raise ValueError(f"Failed to convert chord format: {str(e)}")

def bulk_import_chords_from_tormodkv(chord_names=None):
    """
    Import chords from TormodKv's SVGuitar-ChordCollection repository.
    
    Args:
        chord_names: List of chord names to import, or None to import all available
        
    Returns:
        Dict with results: {'imported': [], 'skipped': [], 'failed': []}
    """
    try:
        import requests
        import json
        
        # Fetch the complete chords JSON from TormodKv's repository
        url = "https://raw.githubusercontent.com/TormodKv/SVGuitar-ChordCollection/master/completeChords.json"
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        chord_data = response.json()
        results = {'imported': [], 'skipped': [], 'failed': []}
        
        # Get or create CommonChords sheet
        spread = get_spread()
        try:
            sheet = spread.worksheet('CommonChords')
        except gspread.WorksheetNotFound:
            sheet = spread.add_worksheet(title='CommonChords', rows=1000, cols=6)
            sheet.update('A1:F1', [['ChordID', 'ItemID', 'Title', 'ChordData', 'CreatedAt', 'Order']])
        
        # Get existing records to avoid duplicates
        records = sheet_to_records(sheet, is_routine_worksheet=False)
        existing_titles = {record.get('C', '').lower() for record in records}
        
        # Generate next available ID
        next_id = max([int(float(r.get('A', 0))) for r in records if r.get('A')], default=0) + 1
        next_order = len(records)
        
        # Filter chord names if specified
        chords_to_import = chord_names if chord_names else list(chord_data.keys())
        
        # Process each requested chord
        for chord_name in chords_to_import:
            if chord_name not in chord_data:
                results['failed'].append(f"{chord_name} (not found in TormodKv collection)")
                continue
                
            # Check if chord already exists (case-insensitive)
            if chord_name.lower() in existing_titles:
                results['skipped'].append(f"{chord_name} (already exists)")
                continue
            
            try:
                # Get the first variation of the chord
                chord_variations = chord_data[chord_name]
                if not chord_variations or not isinstance(chord_variations, list):
                    results['failed'].append(f"{chord_name} (invalid data format)")
                    continue
                    
                first_variation = chord_variations[0]
                positions = first_variation.get('positions', [])
                
                if len(positions) != 6:
                    results['failed'].append(f"{chord_name} (invalid positions array)")
                    continue
                
                # Convert to SVGuitar format
                svguitar_data = convert_fret_positions_to_svguitar(positions)
                
                # Format timestamp
                now = datetime.now()
                timestamp = now.strftime('%Y-%m-%d %I:%M%p PST')
                
                # Create chord data JSON
                chord_json = json.dumps(svguitar_data)
                
                # Create new record
                new_record = {
                    'A': str(next_id),           # ChordID
                    'B': '',                     # ItemID (empty for common chords)
                    'C': chord_name,             # Title
                    'D': chord_json,             # ChordData
                    'E': timestamp,              # CreatedAt
                    'F': str(next_order)         # Order
                }
                
                records.append(new_record)
                existing_titles.add(chord_name.lower())
                results['imported'].append(chord_name)
                
                next_id += 1
                next_order += 1
                
                # Rate limiting - small delay between chords
                time.sleep(0.1)
                
            except Exception as e:
                logging.error(f"Error processing chord {chord_name}: {str(e)}")
                results['failed'].append(f"{chord_name} (processing error: {str(e)})")
                continue
        
        # Save all new records to sheet if any were imported
        if results['imported']:
            success = records_to_sheet(sheet, records, is_routine_worksheet=False)
            if success:
                invalidate_caches()
                logging.info(f"Successfully imported {len(results['imported'])} chords to CommonChords sheet")
            else:
                # If save failed, move imported chords to failed list
                for chord_name in results['imported']:
                    results['failed'].append(f"{chord_name} (save failed)")
                results['imported'] = []
        
        return results
        
    except requests.RequestException as e:
        logging.error(f"Error fetching chords from TormodKv repository: {str(e)}")
        raise ValueError(f"Failed to fetch chord data: {str(e)}")
    except Exception as e:
        logging.error(f"Error in bulk import: {str(e)}")
        raise ValueError(f"Bulk import failed: {str(e)}")

def bulk_import_chords_from_local_file(chord_names=None, local_file_path=None):
    """
    Import chords from local TormodKv chord collection file.
    
    Args:
        chord_names: List of chord names to import, or None to import all available
        local_file_path: Path to local completeChords.json file
        
    Returns:
        Dict with results: {'imported': [], 'skipped': [], 'failed': []}
    """
    try:
        import json
        import os
        
        # Default to the expected location if no path provided
        if local_file_path is None:
            local_file_path = '/home/steven/webdev/guitar/practice/gpr/chords/completeChords.json'
        
        # Check if file exists
        if not os.path.exists(local_file_path):
            raise ValueError(f"Local chord file not found: {local_file_path}")
        
        # Load chord data from local file
        with open(local_file_path, 'r') as f:
            chord_data = json.load(f)
        
        results = {'imported': [], 'skipped': [], 'failed': []}
        
        # Get or create CommonChords sheet
        spread = get_spread()
        try:
            sheet = spread.worksheet('CommonChords')
        except gspread.WorksheetNotFound:
            sheet = spread.add_worksheet(title='CommonChords', rows=1000, cols=6)
            sheet.update('A1:F1', [['ChordID', 'ItemID', 'Title', 'ChordData', 'CreatedAt', 'Order']])
        
        # Get existing records to avoid duplicates
        records = sheet_to_records(sheet, is_routine_worksheet=False)
        existing_titles = {record.get('C', '').lower() for record in records}
        
        # Generate next available ID
        next_id = max([int(float(r.get('A', 0))) for r in records if r.get('A')], default=0) + 1
        next_order = len(records)
        
        # Filter chord names if specified
        chords_to_import = chord_names if chord_names else list(chord_data.keys())
        
        logging.info(f"Starting local bulk import of {len(chords_to_import)} chords")
        
        # Process each requested chord
        for chord_name in chords_to_import:
            if chord_name not in chord_data:
                results['failed'].append(f"{chord_name} (not found in local collection)")
                continue
                
            # Check if chord already exists (case-insensitive)
            if chord_name.lower() in existing_titles:
                results['skipped'].append(f"{chord_name} (already exists)")
                continue
            
            try:
                # Get the first variation of the chord
                chord_variations = chord_data[chord_name]
                if not chord_variations or not isinstance(chord_variations, list):
                    results['failed'].append(f"{chord_name} (invalid data format)")
                    continue
                    
                first_variation = chord_variations[0]
                positions = first_variation.get('positions', [])
                
                if len(positions) != 6:
                    results['failed'].append(f"{chord_name} (invalid positions array)")
                    continue
                
                # Convert to SVGuitar format
                svguitar_data = convert_fret_positions_to_svguitar(positions)
                
                # Format timestamp
                now = datetime.now()
                timestamp = now.strftime('%Y-%m-%d %I:%M%p PST')
                
                # Create chord data JSON
                chord_json = json.dumps(svguitar_data)
                
                # Create new record
                new_record = {
                    'A': str(next_id),           # ChordID
                    'B': '',                     # ItemID (empty for common chords)
                    'C': chord_name,             # Title
                    'D': chord_json,             # ChordData
                    'E': timestamp,              # CreatedAt
                    'F': str(next_order)         # Order
                }
                
                records.append(new_record)
                existing_titles.add(chord_name.lower())
                results['imported'].append(chord_name)
                
                next_id += 1
                next_order += 1
                
            except Exception as e:
                logging.error(f"Error processing chord {chord_name}: {str(e)}")
                results['failed'].append(f"{chord_name} (processing error: {str(e)})")
                continue
        
        # Save all new records to sheet if any were imported
        if results['imported']:
            success = records_to_sheet(sheet, records, is_routine_worksheet=False)
            if success:
                invalidate_caches()
                logging.info(f"Successfully imported {len(results['imported'])} chords from local file to CommonChords sheet")
            else:
                # If save failed, move imported chords to failed list
                for chord_name in results['imported']:
                    results['failed'].append(f"{chord_name} (save failed)")
                results['imported'] = []
        
        return results
        
    except Exception as e:
        logging.error(f"Error in local bulk import: {str(e)}")
        raise ValueError(f"Local bulk import failed: {str(e)}")

def get_chart_section_data(chart_record):
    """Extract section metadata from a chord chart record."""
    try:
        chord_data_json = chart_record.get('D', '{}')
        if isinstance(chord_data_json, str):
            chord_data = json.loads(chord_data_json)
        else:
            chord_data = chord_data_json
        
        return {
            'sectionId': chord_data.get('sectionId', 'section-1'),
            'sectionLabel': chord_data.get('sectionLabel', 'Verse'),
            'sectionRepeatCount': chord_data.get('sectionRepeatCount', '')
        }
    except (json.JSONDecodeError, KeyError, AttributeError):
        # Fallback for malformed or missing section data
        return {
            'sectionId': 'section-1',
            'sectionLabel': 'Verse', 
            'sectionRepeatCount': ''
        }

def copy_chord_charts_to_items(source_item_id, target_item_ids):
    """Copy chord charts from one song to multiple other songs using sharing model with conflict resolution.
    
    Steps:
    1. Find source charts 
    2. For each target: remove any existing chord charts (source wins)
    3. Add target ItemIDs to source charts (sharing model)
    """
    try:
        spread = get_spread()
        sheet = spread.worksheet('ChordCharts')
        records = sheet_to_records(sheet, is_routine_worksheet=False)
        
        source_item_id_str = str(source_item_id)
        target_item_ids_str = [str(tid) for tid in target_item_ids]
        
        # Find all chord charts that belong to the source item
        source_charts = []
        for record in records:
            item_ids = record.get('B', '').split(',')
            item_ids = [id.strip() for id in item_ids]
            if source_item_id_str in item_ids:
                source_charts.append(record)
        
        if not source_charts:
            logging.warning(f"No chord charts found for source item {source_item_id}")
            return {'updated': 0, 'removed': 0, 'charts_found': 0}
        
        updated_count = 0
        removed_count = 0
        
        # Step 1: Remove existing chord charts from target items (source wins)
        for target_id in target_item_ids_str:
            logging.info(f"Removing existing chord charts for target item {target_id} before copying")
            
            # Find charts that belong ONLY to this target item
            charts_to_remove = []
            charts_to_update = []
            
            for record in records:
                item_ids = record.get('B', '').split(',')
                item_ids = [id.strip() for id in item_ids if id.strip()]
                
                if target_id in item_ids:
                    if len(item_ids) == 1:
                        # Chart belongs only to target - remove entirely
                        charts_to_remove.append(record)
                    else:
                        # Chart is shared - remove target from the list
                        item_ids.remove(target_id)
                        record['B'] = ', '.join(item_ids)
                        charts_to_update.append(record)
            
            # Remove charts that belonged only to target
            for chart in charts_to_remove:
                records.remove(chart)
                removed_count += 1
                logging.info(f"Removed chart '{chart.get('C', '')}' that belonged only to item {target_id}")
            
            # Log updated shared charts
            for chart in charts_to_update:
                logging.info(f"Removed item {target_id} from shared chart '{chart.get('C', '')}'")
        
        # Step 2: Add target item IDs to source charts (sharing model)
        for record in source_charts:
            current_item_ids = record.get('B', '').split(',')
            current_item_ids = [id.strip() for id in current_item_ids if id.strip()]
            
            # Add target item IDs if they're not already present
            for target_id in target_item_ids_str:
                if target_id not in current_item_ids:
                    current_item_ids.append(target_id)
                    logging.info(f"Added item {target_id} to chart '{record.get('C', '')}'")
            
            # Update the ItemID column with comma-separated list
            record['B'] = ', '.join(current_item_ids)
            updated_count += 1
        
        # Save updated records
        success = records_to_sheet(sheet, records, is_routine_worksheet=False)
        if success:
            invalidate_caches()
            logging.info(f"Successfully copied {len(source_charts)} chord charts from item {source_item_id} to {len(target_item_ids)} items: {updated_count} charts updated, {removed_count} existing charts removed")
            return {
                'updated': updated_count,
                'removed': removed_count,
                'charts_found': len(source_charts),
                'target_items': target_item_ids
            }
        else:
            raise Exception("Failed to save updated chord charts")
            
    except Exception as e:
        logging.error(f"Error copying chord charts: {str(e)}")
        raise ValueError(f"Failed to copy chord charts: {str(e)}")

def get_common_chords_efficiently():
    """Get all common chord charts efficiently using fixed range (12,710 total rows)."""
    try:
        spread = get_spread()
        
        # Try to get the CommonChords sheet
        try:
            sheet = spread.worksheet('CommonChords')
        except gspread.WorksheetNotFound:
            logging.info("CommonChords sheet not found")
            return []
        
        # Use fixed range since CommonChords sheet has exactly 12,710 rows (header + 12,709 data rows)
        range_str = 'A2:F12710'
        logging.info(f"Loading CommonChords fixed range {range_str} (12,709 chord records)")
        data_range = sheet.get(range_str, value_render_option='FORMATTED_VALUE')
        
        if not data_range:
            return []
        
        # Convert to normalized format for autocreate
        all_common_chords = []
        for row in data_range:
            # Ensure row has all 6 columns
            padded_row = row + [''] * (6 - len(row))
            
            # Skip if title (column C, index 2) is empty
            if not padded_row[2] or not padded_row[2].strip():
                continue
                
            try:
                chord_data_str = padded_row[3] if len(padded_row) > 3 else '{}'
                chord_data = json.loads(chord_data_str) if chord_data_str else {}
                
                # Normalize finger data (same as autocreate logic)
                raw_fingers = chord_data.get('fingers', [])
                normalized_fingers = []
                
                for finger in raw_fingers:
                    if isinstance(finger, dict):
                        string_num = finger.get('string')
                        fret_num = finger.get('fret') 
                        finger_num = finger.get('finger')
                        if string_num is not None and fret_num is not None:
                            if finger_num is not None:
                                normalized_fingers.append([string_num, fret_num, finger_num])
                            else:
                                normalized_fingers.append([string_num, fret_num])
                    elif isinstance(finger, list) and len(finger) >= 2:
                        normalized_fingers.append(finger)
                
                all_common_chords.append({
                    'title': padded_row[2],  # Column C
                    'fingers': normalized_fingers,
                    'barres': chord_data.get('barres', []),
                    'numFrets': chord_data.get('numFrets', 5),
                    'numStrings': chord_data.get('numStrings', 6),
                    'tuning': chord_data.get('tuning', 'EADGBE'),
                    'capo': chord_data.get('capo', 0),
                    'openStrings': chord_data.get('openStrings', []),
                    'mutedStrings': chord_data.get('mutedStrings', []),
                    'startingFret': chord_data.get('startingFret', 1)
                })
                
            except Exception as e:
                logging.warning(f"Failed to parse common chord {padded_row[2] if len(padded_row) > 2 else 'unknown'}: {str(e)}")
                continue
        
        logging.info(f"Efficiently loaded {len(all_common_chords)} common chords using fixed range A2:F12710")
        return all_common_chords
        
    except Exception as e:
        logging.error(f"Error in get_common_chords_efficiently: {str(e)}")
        return []