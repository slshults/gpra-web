from flask import render_template, request, jsonify, redirect, session, url_for
from app import app # type: ignore
from app.sheets import ( # type: ignore
    get_all_items, add_item, update_item, delete_item,
    add_to_routine, get_all_routines,
    test_sheets_connection, get_credentials, update_items_order,
    create_routine, update_routine_item,
    remove_from_routine, delete_routine, get_active_routine, set_routine_active,
    get_spread, sheet_to_records,
    records_to_sheet, delete_chord_chart, update_chord_chart, update_chord_charts_order,
    get_common_chord_charts, search_common_chord_charts, seed_common_chord_charts, 
    bulk_import_chords_from_tormodkv, bulk_import_chords_from_local_file,
    copy_chord_charts_to_items, get_common_chords_efficiently
)
from app.data_layer import DataLayer
from app.utils.llm_analytics import llm_analytics
from app import billing
from google_auth_oauthlib.flow import Flow
import os
import logging
import time  # Add at the top with other imports
import math
from typing import List, Dict
from datetime import datetime
import subprocess
import re
import base64
import json
from werkzeug.utils import secure_filename
import anthropic

logging.basicConfig(level=logging.DEBUG)

# Main route
@app.route('/')
def index():
    posthog_key = os.getenv('POSTHOG_API_KEY', '')
    return render_template('index.html.jinja', posthog_key=posthog_key)

# Item routes
@app.route('/api/items', methods=['GET', 'POST'])
def items():
    """Handle GET (list) and POST (create) for items"""
    if request.method == 'GET':
        return jsonify(get_all_items())
    elif request.method == 'POST':
        app.logger.debug("Received POST request to create item")
        app.logger.debug(f"Request Content-Type: {request.headers.get('Content-Type')}")
        app.logger.debug(f"Request body: {request.get_data(as_text=True)}")
        
        if not request.is_json:
            app.logger.error("Request is not JSON")
            return jsonify({"error": "Request must be JSON"}), 400
            
        new_item = request.json
        app.logger.debug(f"Creating new item with data: {new_item}")
        result = add_item(new_item)
        app.logger.debug(f"Item creation result: {result}")
        return jsonify(result)

@app.route('/api/items/lightweight', methods=['GET'])
def items_lightweight():
    """Get items with minimal data - only ID and Title for the list view"""
    try:
        spread = get_spread()
        
        # Get only columns A (ID) and C (Title) from Items sheet
        batch_data = spread.values_batch_get([
            "Items!A2:D"  # Get ID, Item ID, Title columns
        ])
        
        items_data = batch_data['valueRanges'][0].get('values', [])
        items = [
            {
                'A': r[0] if len(r) > 0 else '',  # ID (column A)
                'C': r[2] if len(r) > 2 else ''   # Title (column C)
            }
            for r in items_data
        ]
        
        return jsonify(items)
        
    except Exception as e:
        app.logger.error(f"Error getting lightweight items: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/items/order', methods=['PUT'])
def order_items():
    """Update the order of items"""
    items = request.json
    return jsonify(update_items_order(items))

@app.route('/api/items/<item_id>', methods=['GET', 'PUT', 'DELETE'])
def item(item_id):
    """Handle GET (fetch), PUT (update) and DELETE for individual items"""
    try:
        item_id = int(float(item_id))
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid item ID"}), 400
        
    if request.method == 'GET':
        # Get all items and find the requested one
        all_items = get_all_items()
        item = next((item for item in all_items if int(float(item['A'])) == item_id), None)
        if item:
            return jsonify(item)
        return jsonify({"error": "Item not found"}), 404
    elif request.method == 'PUT':
        updated_item = request.json
        logging.debug(f"Received PUT request for item {item_id}")
        logging.debug(f"Request data: {updated_item}")
        return jsonify(update_item(item_id, updated_item))
    elif request.method == 'DELETE':
        delete_item(item_id)
        return '', 204

@app.route('/api/routines', methods=['GET', 'POST'])
def routines():
    """Handle GET (list) and POST (create) for routines"""
    if request.method == 'GET':
        return jsonify(get_all_routines())
    elif request.method == 'POST':
        try:
            app.logger.debug(f"Received POST request to create routine")
            app.logger.debug(f"Request Content-Type: {request.headers.get('Content-Type')}")
            app.logger.debug(f"Request body: {request.get_data(as_text=True)}")
            
            if not request.is_json:
                app.logger.error("Request is not JSON")
                return jsonify({"error": "Request must be JSON"}), 400
                
            routine_name = request.json.get('routineName')
            app.logger.debug(f"Extracted routine name: {routine_name}")
            
            if not routine_name:
                app.logger.error("No routine name provided")
                return jsonify({"error": "Routine name is required"}), 400
            
            # Log before creation attempt    
            app.logger.debug(f"Attempting to create routine: {routine_name}")
            
            try:
                result = create_routine(routine_name)
                if result:
                    # Add a small delay to ensure sheet is ready
                    time.sleep(2)
                app.logger.debug(f"Routine creation result: {result}")
                return jsonify({"success": result}), 201
            except ValueError as ve:
                app.logger.error(f"ValueError in create_routine: {str(ve)}")
                return jsonify({"error": str(ve)}), 400
            except Exception as e:
                app.logger.error(f"Unexpected error in create_routine: {str(e)}")
                return jsonify({"error": "Internal server error"}), 500
                
        except Exception as e:
            app.logger.error(f"Error processing routine creation request: {str(e)}")
            return jsonify({"error": str(e)}), 500

@app.route('/api/routines/<int:routine_id>', methods=['GET', 'DELETE'])
def routine_operations(routine_id):
    """Handle GET (details) and DELETE for individual routines"""
    try:
        if request.method == 'GET':
            # Get the worksheet using routine ID as sheet name
            spread = get_spread()
            worksheet = spread.worksheet(str(routine_id))
            routine_data = sheet_to_records(worksheet, is_routine_worksheet=True)
            return jsonify(routine_data)
        elif request.method == 'DELETE':
            result = delete_routine(str(routine_id))
            if result:
                return '', 204
            return jsonify({"error": "Failed to delete routine"}), 500
    except Exception as e:
        app.logger.error(f"Error in routine_operations: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/routines/<int:routine_id>/details', methods=['GET'])
def get_routine_with_details(routine_id):
    """Get a routine with all item details and metadata."""
    try:
        spread = get_spread()
        
        # Batch get all required data
        batch_data = spread.values_batch_get([
            f"Routines!A2:D",  # Get routine metadata
            f"{routine_id}!A2:D",  # Get routine items
            "Items!A2:H"  # Get items data
        ])
        
        # Process routine metadata
        routines_data = batch_data['valueRanges'][0].get('values', [])
        routine_meta = next((
            {'A': r[0], 'B': r[1], 'C': r[2], 'D': r[3]} 
            for r in routines_data 
            if r[0] == str(routine_id)
        ), None)
        
        if not routine_meta:
            return jsonify({"error": "Routine not found"}), 404

        # Process routine items
        routine_items_data = batch_data['valueRanges'][1].get('values', [])
        routine_items = [
            {
                'A': r[0],  # ID
                'B': r[1],  # Item ID
                'C': r[2],  # Order
                'D': r[3] if len(r) > 3 and r[3] == 'TRUE' else ''  # Completed
            }
            for r in routine_items_data
        ]

        # Process items data
        items_data = batch_data['valueRanges'][2].get('values', [])
        items_by_id = {
            r[1]: {  # Index by Item ID (column B)
                'A': r[0],  # ID
                'B': r[1],  # Item ID
                'C': r[2],  # Title
                'D': r[3],  # Notes
                'E': r[4],  # Duration
                'F': r[5],  # Description
                'G': r[6],  # Order
                'H': r[7] if len(r) > 7 else ''  # Tuning
            }
            for r in items_data
        }

        # Combine routine items with their details
        items_with_details = []
        for routine_item in routine_items:
            item_id = routine_item['B']  # Item ID from routine's column B
            item_details = items_by_id.get(item_id, {})
            items_with_details.append({
                "routineEntry": routine_item,
                "itemDetails": item_details
            })

        return jsonify({
            "id": routine_meta['A'],
            "name": routine_meta['B'],
            "created": routine_meta['C'],
            "order": routine_meta['D'],
            "items": items_with_details
        })

    except Exception as e:
        app.logger.error(f"Error getting routine with details: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/routines/<int:routine_id>/order', methods=['PUT'])
def update_routine_order_route(routine_id):
    """Update the order of items in a routine"""
    try:
        app.logger.debug(f"Received order update request for routine: {routine_id}")
        items = request.json
        app.logger.debug(f"Items to reorder: {items}")

        # Use DataLayer for unified data access
        data_layer = DataLayer()
        success = data_layer.update_routine_items_order(routine_id, items)

        if success:
            app.logger.debug(f"Successfully updated order for routine: {routine_id}")
            # Get updated routine items to return
            updated_items = data_layer.get_routine_items(routine_id)
            return jsonify(updated_items)
        else:
            app.logger.error(f"Failed to update routine items order for routine: {routine_id}")
            return jsonify({"error": "Failed to update routine items order"}), 500

    except Exception as e:
        app.logger.error(f"Error updating routine order: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/routines/<int:routine_id>/items/<item_id>', methods=['PUT', 'DELETE'])
def routine_item(routine_id, item_id):
    """Handle updates and deletions of routine items"""
    try:
        if request.method == 'DELETE':
            # Use DataLayer for PostgreSQL compatibility
            from app.data_layer import DataLayer
            data_layer = DataLayer()

            success = data_layer.remove_routine_item_by_id(routine_id, int(item_id))
            if success:
                return jsonify({"success": True})
            return jsonify({"error": "Failed to remove item"}), 500
        elif request.method == 'PUT':
            if not request.is_json:
                return jsonify({"error": "Request must be JSON"}), 400

            item = request.json

            # Use DataLayer for PostgreSQL compatibility
            from app.data_layer import DataLayer
            data_layer = DataLayer()

            result = data_layer.update_routine_item(routine_id, item_id, item)
            if result:
                return jsonify(result)
            return jsonify({"error": "Failed to update item"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/routines/<int:routine_id>/items', methods=['POST'])
def add_routine_item(routine_id):
    """Add an item to a routine"""
    try:
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400
            
        item_id = request.json.get('itemId')
        if not item_id:
            return jsonify({"error": "Item ID is required"}), 400
            
        result = add_to_routine(routine_id, item_id)
        if result:
            return jsonify(result), 201
        return jsonify({"error": "Failed to add item"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# OAuth and testing routes
# NOTE: Logout route moved to routes_v2.py for PostgreSQL/Flask-AppBuilder auth
# @app.route('/logout')
# def logout_and_redirect():
#     """Handle logout and redirect to home"""
#     try:
#         if os.path.exists('token.json'):
#             os.remove('token.json')
#         get_credentials.cache_clear()  # Clear the credentials cache
#         return redirect(url_for('index'))
#     except Exception as e:
#         logging.error(f"Error during logout: {str(e)}")
#         return redirect(url_for('index'))  # Redirect even if there's an error

@app.route('/api/auth/status')
def auth_status():
    """Check if we have valid credentials and spreadsheet access"""
    try:
        creds, _ = get_credentials()
        if not creds or not creds.valid:
            return jsonify({"authenticated": False})

        # Test spreadsheet access
        test_result = test_sheets_connection()
        return jsonify({
            "authenticated": True,
            "hasSpreadsheetAccess": test_result.get("success", False)
        })
    except Exception as e:
        logging.error(f"Error checking auth status: {str(e)}")
        return jsonify({
            "authenticated": False,
            "error": str(e)
        })

@app.route('/authorize')
def authorize():
    """Initiate OAuth flow"""
    creds, flow = get_credentials()
    if creds and creds.valid:
        logging.debug("Valid credentials found, redirecting to index")
        return redirect(url_for('index'))
    flow.redirect_uri = url_for('oauth2callback', _external=True)
    authorization_url, state = flow.authorization_url(prompt='consent')
    session['state'] = state
    logging.debug(f"Authorization URL: {authorization_url}")
    return f'<a href="{authorization_url}">Click here to authorize</a>'

@app.route('/oauth2callback')
def oauth2callback():
    """Handle OAuth callback"""
    logging.debug("Entered oauth2callback")
    try:
        _, flow = get_credentials()
        flow.redirect_uri = url_for('oauth2callback', _external=True)

        logging.debug(f"Request URL: {request.url}")
        flow.fetch_token(authorization_response=request.url)

        creds = flow.credentials
        with open('token.json', 'w') as token:
            token.write(creds.to_json())
        logging.debug("Credentials saved to token.json")
        
        # Clear the credentials cache
        get_credentials.cache_clear()
        
        # Verify credentials work by testing connection
        test_sheets_connection()
        
        return redirect(url_for('index'))
    except Exception as e:
        logging.error(f"Error in oauth2callback: {str(e)}")
        return jsonify({"error": str(e)}), 500
    
@app.route('/api/routines/active', methods=['GET'])
def get_active_routine_route():
    """Get the ID of the currently active routine"""
    try:
        app.logger.debug("Fetching active routine ID")
        active_id = get_active_routine()
        app.logger.debug(f"Active routine ID: {active_id}")
        return jsonify({"active_id": active_id})
    except Exception as e:
        app.logger.error(f"Error getting active routine: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/routines/<int:routine_id>/active', methods=['PUT'])
def set_routine_active_route(routine_id):
    """Set a routine as active or inactive"""
    try:
        # Add debug logging
        app.logger.debug(f"Received activate request for routine ID: {routine_id}")
        app.logger.debug(f"Request JSON: {request.json}")
        
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400
            
        active = request.json.get('active', True)  # Default to activating
        app.logger.debug(f"Setting active status to: {active}")
        
        success = set_routine_active(str(routine_id), active)
        if success:
            return jsonify({"success": True, "active": active})
        return jsonify({"error": "Failed to update routine status"}), 500
    except Exception as e:
        app.logger.error(f"Error in set_routine_active_route: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/test_sheets')
def test_sheets():
    """Test connection to Google Sheets"""
    logging.debug("Entered test_sheets")
    creds, _ = get_credentials()
    if not creds:
        logging.debug("No credentials found, returning error")
        return jsonify({"success": False, "error": "No credentials. Please authorize."}), 401
    try:
        result = test_sheets_connection()
        logging.debug(f"Test result: {result}")
        return jsonify({"success": True, "result": result})
    except Exception as e:
        logging.error(f"Error in test_sheets: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/items/<int:item_id>/notes', methods=['GET', 'POST'])
def save_item_notes(item_id):
    if request.method == 'GET':
        # Get the worksheet for the Items sheet
        spread = get_spread()
        worksheet = spread.worksheet('Items')
        
        # Find the row with this item_id
        items = sheet_to_records(worksheet, is_routine_worksheet=False)
        for item in items:
            if item['A'] == str(item_id):  # Just convert route param to string once
                return jsonify({'notes': item.get('D', '')})  # Column D is Notes
        
        app.logger.debug(f"DEBUG:get_notes:Item {item_id} not found!")
        return jsonify({'error': 'Item not found'}), 404

    # POST method
    data = request.get_json()
    note_text = data.get('notes', '')
    app.logger.debug(f"DEBUG:save_notes:Received note text: {note_text}")
    
    # Get the worksheet for the Items sheet
    spread = get_spread()
    worksheet = spread.worksheet('Items')
    
    # Convert to records for ID-based lookup
    items = sheet_to_records(worksheet, is_routine_worksheet=False)
    
    # Find the item with matching ID
    target_item = None
    target_row_idx = None
    for idx, item in enumerate(items):
        if item['A'] == str(item_id):  # Just convert route param to string once
            target_item = item
            target_row_idx = idx + 2  # +2 for 1-based index and header row
            app.logger.debug(f"DEBUG:save_notes:Found item {item_id} at row {target_row_idx}")
            break
    
    if target_item is None:
        app.logger.debug(f"DEBUG:save_notes:Item {item_id} not found!")
        return jsonify({'error': 'Item not found'}), 404
        
    # Update the Notes column (column D)
    app.logger.debug(f"DEBUG:save_notes:Updating cell at row {target_row_idx}, col D with text: {note_text}")
    try:
        worksheet.update(f'D{target_row_idx}', note_text)
        app.logger.debug("DEBUG:save_notes:Update successful")
    except Exception as e:
        app.logger.error(f"DEBUG:save_notes:Error updating cell: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
    return jsonify({'success': True})

@app.route('/items')
def items_page():
    """Render the items page"""
    items = get_all_items()
    return render_template('items.html.jinja', items=items)

@app.route('/api/routines/<int:routine_id>/items/<int:item_id>/complete', methods=['PUT'])
def toggle_item_complete(routine_id, item_id):
    """Toggle completion state of an item in a routine"""
    try:
        app.logger.debug(f"Toggling completion for item {item_id} in routine {routine_id}")
        try:
            # Use routine_id directly as sheet name
            spread = get_spread()
            worksheet = spread.worksheet(str(routine_id))  # Sheet name is the routine ID
            app.logger.debug(f"Got worksheet for routine {routine_id}")
        except Exception as sheet_error:
            app.logger.error(f"Failed to get worksheet: {str(sheet_error)}")
            return jsonify({'error': f"Failed to get worksheet: {str(sheet_error)}"}), 500
        
        # Find the row with this routine entry ID (column A)
        items = sheet_to_records(worksheet, is_routine_worksheet=True)
        app.logger.debug(f"Converted sheet to records, got {len(items)} items")
        
        row_idx = None
        for idx, item in enumerate(items):
            app.logger.debug(f"Checking item: {item}")  # Debug log
            if item['A'] == str(item_id):  # Look for routine entry ID in column A
                row_idx = idx + 2  # +2 because sheets is 1-based and has header row
                app.logger.debug(f"Found item at row {row_idx}")
                break
        
        if row_idx is None:
            app.logger.error(f"Item {item_id} not found in routine {routine_id}")
            return jsonify({'error': 'Item not found'}), 404

        # Get the current completed state
        completed = request.json.get('completed', False)
        app.logger.debug(f"Setting completed state to: {completed}")
        
        # Use 'TRUE' for completed, empty string for not completed
        completed_value = 'TRUE' if completed else ' '  # Use a space instead of empty string
        app.logger.debug(f"About to update cell D{row_idx} to {completed_value}")
        try:
            # Get current value before update
            current_value = worksheet.acell(f'D{row_idx}').value
            app.logger.debug(f"Current value in D{row_idx}: {current_value}")
            
            # Use batch_update to clear the cell if needed
            if completed:
                worksheet.update(f'D{row_idx}', completed_value)
            else:
                worksheet.batch_clear([f'D{row_idx}'])
            
            # Verify the update
            new_value = worksheet.acell(f'D{row_idx}').value
            app.logger.debug(f"New value in D{row_idx}: {new_value}")
            
            # For uncompleted items, None or empty string is success
            if completed and new_value == completed_value or not completed and (new_value is None or new_value == ''):
                app.logger.debug(f"Successfully updated cell D{row_idx}")
            else:
                app.logger.error(f"Update failed - value is still {new_value}")
                return jsonify({'error': f"Update failed - value is still {new_value}"}), 500
                
        except Exception as update_error:
            app.logger.error(f"Failed to update cell: {str(update_error)}")
            app.logger.error(f"Error type: {type(update_error)}")
            app.logger.error(f"Error details: {update_error.__dict__}")
            return jsonify({'error': f"Failed to update cell: {str(update_error)}"}), 500
        
        return jsonify({'success': True, 'completed': completed})
    except Exception as e:
        app.logger.error(f"Error toggling item completion: {str(e)}")
        app.logger.error(f"Error type: {type(e)}")
        app.logger.error(f"Error details: {e.__dict__ if hasattr(e, '__dict__') else 'No details'}")
        return jsonify({'error': f"Error toggling item completion: {str(e)}"}), 500

@app.route('/api/routines/<int:routine_id>/reset', methods=['POST'])
def reset_routine_progress(routine_id):
    """Reset all items' completion state in a routine"""
    try:
        app.logger.debug(f"Resetting progress for routine: {routine_id}")
        spread = get_spread()
        worksheet = spread.worksheet(str(routine_id))  # Use ID as sheet name
        
        # Get all items
        items = sheet_to_records(worksheet, is_routine_worksheet=True)
        
        # Create a list of empty strings for all data rows
        if items:  # Only update if there are rows to update
            empty_values = [[''] for _ in range(len(items))]
            # Update all cells in column D starting from D2
            range_end = f'D{len(items) + 1}'  # +1 because items doesn't include header row
            worksheet.update(f'D2:{range_end}', empty_values)
        
        app.logger.debug("Reset complete")
        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"Error resetting routine progress: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/practice/active-routine', methods=['GET'])
def get_active_routine_with_details():
    """Get the active routine with all item details for the Practice page."""
    try:
        # Get active routine ID
        active_id = get_active_routine()
        if not active_id:
            return jsonify({"active_id": None, "items": []})

        spread = get_spread()
        
        # Batch get all required data
        batch_data = spread.values_batch_get([
            f"Routines!A2:D",  # Get routine metadata
            f"{active_id}!A2:D",  # Get routine items
            "Items!A2:H"  # Get items data
        ])
        
        # Process routine metadata
        routines_data = batch_data['valueRanges'][0].get('values', [])
        routine_meta = next((
            {'A': r[0], 'B': r[1], 'C': r[2], 'D': r[3]} 
            for r in routines_data 
            if r[0] == str(active_id)
        ), None)
        
        if not routine_meta:
            return jsonify({"error": "Active routine not found in Routines sheet"}), 404

        # Process routine items
        routine_items_data = batch_data['valueRanges'][1].get('values', [])
        routine_items = [
            {
                'A': r[0],  # ID
                'B': r[1],  # Item ID
                'C': r[2],  # Order
                'D': r[3] if len(r) > 3 and r[3] == 'TRUE' else ''  # Completed
            }
            for r in routine_items_data
        ]

        # Process items data
        items_data = batch_data['valueRanges'][2].get('values', [])
        items_by_id = {
            r[0]: {  # Index by ID (column A)
                'A': r[0],  # ID
                'B': r[1],  # Item ID
                'C': r[2],  # Title
                'D': r[3],  # Notes
                'E': r[4],  # Duration
                'F': r[5],  # Description
                'G': r[6],  # Order
                'H': r[7] if len(r) > 7 else ''  # Tuning
            }
            for r in items_data
        }

        # Combine routine items with their details
        items_with_details = []
        for routine_item in routine_items:
            item_id = routine_item['B']  # Item ID from routine's column B
            item_details = items_by_id.get(item_id, {})
            items_with_details.append({
                "routineEntry": routine_item,
                "itemDetails": item_details
            })
        
        # Sort items by order (Column C)
        items_with_details.sort(key=lambda x: int(x['routineEntry']['C']) if x['routineEntry']['C'] else 0)

        return jsonify({
            "active_id": active_id,
            "name": routine_meta['B'],  # Column B contains the routine name
            "items": items_with_details
        })

    except Exception as e:
        app.logger.error(f"Error getting active routine with details: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/practice/active-routine/lightweight', methods=['GET'])
def get_active_routine_lightweight():
    """Get the active routine with minimal data - only titles and basic info for collapsed view."""
    try:
        # Get active routine ID
        active_id = get_active_routine()
        if not active_id:
            return jsonify({"active_id": None, "items": []})

        spread = get_spread()
        
        # Batch get only essential data - no full item details
        batch_data = spread.values_batch_get([
            f"Routines!A2:D",  # Get routine metadata
            f"{active_id}!A2:D",  # Get routine items
            "Items!A2:D"  # Get ID, Item ID, and Title (columns A, B, C)
        ])
        
        # Process routine metadata
        routines_data = batch_data['valueRanges'][0].get('values', [])
        routine_meta = next((
            {'A': r[0], 'B': r[1], 'C': r[2], 'D': r[3]} 
            for r in routines_data 
            if r[0] == str(active_id)
        ), None)
        
        if not routine_meta:
            return jsonify({"error": "Active routine not found in Routines sheet"}), 404

        # Process routine items
        routine_items_data = batch_data['valueRanges'][1].get('values', [])
        routine_items = [
            {
                'A': r[0],  # ID
                'B': r[1],  # Item ID
                'C': r[2],  # Order
                'D': r[3] if len(r) > 3 and r[3] == 'TRUE' else ''  # Completed
            }
            for r in routine_items_data
        ]

        # Process minimal items data (only ID and Title)
        items_data = batch_data['valueRanges'][2].get('values', [])
        items_by_id = {
            r[1]: {  # Index by Item ID (column B) - this is what routine items reference
                'A': r[0],  # ID (column A)
                'C': r[2] if len(r) > 2 else '',  # Title (column C)
            }
            for r in items_data
        }

        # Combine routine items with minimal details
        items_with_minimal_details = []
        for routine_item in routine_items:
            item_id = routine_item['B']  # Item ID from routine's column B
            item_minimal = items_by_id.get(item_id, {})
            items_with_minimal_details.append({
                "routineEntry": routine_item,
                "itemMinimal": item_minimal
            })
        
        # Sort items by order (Column C)
        items_with_minimal_details.sort(key=lambda x: int(x['routineEntry']['C']) if x['routineEntry']['C'] else 0)

        return jsonify({
            "active_id": active_id,
            "name": routine_meta['B'],  # Column B contains the routine name
            "items": items_with_minimal_details
        })

    except Exception as e:
        app.logger.error(f"Error getting lightweight active routine: {str(e)}")
        return jsonify({"error": str(e)}), 500

def batch_items(items: List[Dict], batch_size: int = 5) -> List[List[Dict]]:
    """Split items into batches of 5"""
    return [items[i:i + batch_size] for i in range(0, len(items), batch_size)]

def exponential_backoff(attempt: int) -> None:
    """Wait with exponential backoff, starting with a longer base delay"""
    base_delay = 5  # Start with 5 seconds
    delay = min(base_delay * math.pow(2, attempt), 30)  # Cap at 30 seconds
    time.sleep(delay)

@app.route('/api/items/bulk', methods=['POST'])
def bulk_import_items():
    """Handle bulk import of items by appending them to the Items sheet"""
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    items = request.json
    if not isinstance(items, list):
        return jsonify({"error": "Request body must be an array"}), 400

    try:
        # Get the Items sheet
        spread = get_spread()
        items_sheet = spread.worksheet('Items')
        
        # Find first empty row (row 1 is header)
        first_empty_row = len(items_sheet.col_values(1)) + 1
        next_id = first_empty_row - 1  # Row number minus header row
        
        # Convert items to rows
        rows = []
        for idx, item in enumerate(items):
            row_id = str(next_id + idx)
            rows.append([
                row_id,              # A: ID
                row_id,              # B: Item ID
                item['title'],       # C: Title
                '',                  # D: Notes
                item['duration'],    # E: Duration
                '',                  # F: Description
                row_id,              # G: Order
                ''                   # H: Tuning
            ])
        
        if rows:
            # Append the rows
            items_sheet.append_rows(rows, value_input_option='USER_ENTERED')
        
        return jsonify({
            "success": True,
            "imported": len(rows)
        })

    except Exception as e:
        app.logger.error(f"Error in bulk import: {str(e)}")
        return jsonify({
            "error": str(e)
        }), 500

def records_to_sheet(worksheet, records, is_routine_worksheet=False):
    """Write records back to sheet, handling all columns at once"""
    if not records:
        return True
        
    # Determine range based on worksheet type
    num_cols = 4 if is_routine_worksheet else 8
    col_end = 'D' if is_routine_worksheet else 'H'
    
    # Convert records to rows, preserving all columns
    rows = []
    for record in records:
        app.logger.debug(f"Processing record: {record}")
        row = []
        for col in 'ABCDEFGH'[:num_cols]:  # Only process columns we need
            row.append(record.get(col, ''))
        rows.append(row)
    
    # Calculate range
    range_start = f'A2'
    range_end = f'{col_end}{len(rows) + 1}'  # +1 because we start at row 2
    range_str = f'{range_start}:{range_end}'
    app.logger.debug(f"Writing to range: {range_str}")
    app.logger.debug(f"Data rows to write: {rows}")
    
    # Clear the range first
    worksheet.batch_clear([f'A2:{col_end}'])
    app.logger.debug(f"Clearing sheet range before write: A2:{col_end}")
    
    # Write all data at once
    worksheet.update(range_str, rows, value_input_option='USER_ENTERED')
    app.logger.debug(f"Sheet update completed")
    app.logger.debug(f"Updated sheet with {len(rows)} records")
    
    return True

@app.route('/api/routines/bulk', methods=['POST'])
def bulk_import_routines():
    """Handle bulk import of routine definitions (Phase 1)"""
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    routines = request.json
    if not isinstance(routines, list):
        return jsonify({"error": "Request body must be an array"}), 400

    try:
        # Validate all routines first
        for routine in routines:
            if not isinstance(routine, dict):
                return jsonify({"error": "Each routine must be an object"}), 400
            if 'name' not in routine:
                return jsonify({"error": "Each routine must have a name"}), 400

        # Get current routines once at the start
        spread = get_spread()
        routines_sheet = spread.worksheet('Routines')
        current_records = sheet_to_records(routines_sheet, is_routine_worksheet=True)
        
        # Get the next available ID and order
        next_id = str(max([int(r['A']) for r in current_records], default=0) + 1)
        next_order = str(max([int(r['D']) for r in current_records], default=0) + 1)
        
        # Generate timestamp in our format
        now = datetime.now()
        timestamp = now.strftime('%Y-%m-%d %H:%M:%S')
        
        # Process all routines first, accumulating them in memory
        imported_routines = []
        for routine in routines:
            new_routine = {
                'A': next_id,      # ID
                'B': routine['name'],  # Name
                'C': timestamp,    # Created
                'D': next_order    # Order
            }
            current_records.append(new_routine)
            imported_routines.append(new_routine)
            
            # Create the routine's worksheet using ID as name
            worksheet = spread.add_worksheet(str(next_id), rows=1000, cols=20)
            # Add header row
            header_row = ['ID', 'Item ID', 'order', 'completed']
            worksheet.update('A1:D1', [header_row])
            
            next_id = str(int(next_id) + 1)
            next_order = str(int(next_order) + 1)

        # Write all records in one batch with exponential backoff
        max_attempts = 5
        attempt = 0
        while attempt < max_attempts:
            try:
                records_to_sheet(routines_sheet, current_records, is_routine_worksheet=True)
                break
            except Exception as e:
                app.logger.error(f"Error in batch write, attempt {attempt}: {str(e)}")
                if "quota" in str(e).lower() and attempt < max_attempts - 1:
                    exponential_backoff(attempt)
                    attempt += 1
                else:
                    raise

        return jsonify({
            "success": True,
            "imported": len(imported_routines),
            "routines": imported_routines
        })

    except Exception as e:
        app.logger.error(f"Error in bulk routine import: {str(e)}")
        return jsonify({
            "error": str(e),
            "imported": len(imported_routines) if 'imported_routines' in locals() else 0,
            "routines": imported_routines if 'imported_routines' in locals() else []
        }), 500

@app.route('/api/routines/<int:routine_id>/items/bulk', methods=['POST'])
def bulk_import_routine_items(routine_id):
    """Import multiple items into a routine by matching titles."""
    try:
        app.logger.debug(f"Received bulk import request for routine {routine_id}")
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400

        items_to_import = request.json
        app.logger.debug(f"Items to import: {items_to_import}")

        # Get all existing items to match against
        all_items = get_all_items()
        items_by_title = {item['C'].lower(): item for item in all_items}  # Case-insensitive lookup

        # Get the worksheet for this routine
        spread = get_spread()
        worksheet = spread.worksheet(str(routine_id))
        existing_routine_items = sheet_to_records(worksheet, is_routine_worksheet=True)
        
        # Track which items are already in the routine
        existing_item_ids = {item['B'] for item in existing_routine_items}  # Set of item IDs
        
        # Get next available ID for column A
        next_id = 1
        if existing_routine_items:
            next_id = max(int(item['A']) for item in existing_routine_items if item['A'].isdigit()) + 1
        
        # Process each item to import
        items_to_add = []
        not_found_titles = []
        
        for idx, item in enumerate(items_to_import):
            title = item.get('title', '')
            if not title:
                continue
            
            # Look for exact match first (case-insensitive)
            matching_item = items_by_title.get(title.lower())
            
            if matching_item:
                # Only add if not already in routine
                if matching_item['B'] not in existing_item_ids:
                    items_to_add.append({
                        'A': str(next_id + idx),  # Simple incrementing ID
                        'B': matching_item['B'],  # Item ID from Items sheet
                        'C': str(idx),  # Order based on position in import list
                        'D': ''  # Empty string for completed column
                    })
            else:
                # Item not found - add to not_found list
                not_found_titles.append(title)
                # Still add to routine but without an Item ID
                items_to_add.append({
                    'A': str(next_id + idx),  # Simple incrementing ID
                    'B': '',  # No Item ID yet
                    'C': str(idx),  # Order based on position in import list
                    'D': ''  # Empty string for completed column
                })

        if not items_to_add:
            return jsonify({
                "error": "No items were processed",
                "not_found": not_found_titles
            }), 400

        # Add all new items to the worksheet
        all_items = existing_routine_items + items_to_add
        success = records_to_sheet(worksheet, all_items, is_routine_worksheet=True)

        response_data = {
            "imported": len(items_to_add),
            "not_found": not_found_titles
        }

        if not_found_titles:
            response_data["message"] = f"These items were not found, you'll need to create them, and add the Item IDs to the routine sheet: {', '.join(not_found_titles)}"

        if success:
            return jsonify(response_data)
        else:
            return jsonify({"error": "Failed to import items"}), 500

    except Exception as e:
        app.logger.error(f"Error importing routine items: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/routines/order', methods=['PUT'])
def update_routines_order():
    """Update the order of routines in the Routines sheet"""
    try:
        app.logger.debug("Received routines order update request")
        updates = request.json
        app.logger.debug(f"Updates to apply: {updates}")

        # Use DataLayer for PostgreSQL compatibility
        from app.data_layer import DataLayer
        data_layer = DataLayer()

        success = data_layer.update_routines_order(updates)

        if success:
            app.logger.debug("Successfully updated routines order")
            return jsonify({"success": True})
        else:
            raise Exception("Failed to update routines order")

    except Exception as e:
        app.logger.error(f"Error updating routines order: {str(e)}")
        error_str = str(e).lower()
        # Check if it's a rate limit error to provide better feedback
        if any(phrase in error_str for phrase in ['quota', 'rate limit', '429', 'too many']):
            return jsonify({"error": "Google Sheets rate limit reached. Please wait a moment and try again."}), 429
        return jsonify({"error": str(e)}), 500

@app.route('/api/open-folder', methods=['POST'])
def open_folder():
    try:
        folder_path = request.json.get('path')
        if not folder_path:
            return jsonify({'error': 'No path provided'}), 400

        app.logger.debug(f"Opening folder: {folder_path}")

        # Keep Windows path format but ensure proper escaping
        windows_path = folder_path.replace('/', '\\')
        
        # In WSL, we'll use explorer.exe to open Windows File Explorer
        try:
            # Use the Windows path directly with explorer.exe
            subprocess.run(['explorer.exe', windows_path], check=True)
            return jsonify({'success': True})
        except subprocess.CalledProcessError as e:
            app.logger.error(f"Failed to open folder: {str(e)}")
            return jsonify({'error': f'Failed to open folder: {str(e)}'}), 500

    except Exception as e:
        app.logger.error(f"Error in open_folder: {str(e)}")
        return jsonify({'error': str(e)}), 500

# Chord Charts API endpoints
@app.route('/api/chord-charts/batch', methods=['POST'])
def batch_chord_charts():
    """Get chord charts for multiple items in a single request"""
    try:
        data = request.get_json()
        item_ids = data.get('item_ids', [])
        
        if not item_ids:
            return jsonify([])
        
        # Get all chord charts from the sheet once
        from app.sheets import get_spread, sheet_to_records, initialize_chordcharts_sheet
        import json
        
        spread = get_spread()
        initialize_chordcharts_sheet()
        sheet = spread.worksheet('ChordCharts')
        all_records = sheet_to_records(sheet, is_routine_worksheet=False)
        
        # Build result dict for all requested items
        result = {}
        
        for item_id in item_ids:
            item_id_str = str(item_id)
            item_charts = []
            
            # Filter records for this item
            for r in all_records:
                item_ids_in_record = r.get('B', '').split(',')
                item_ids_in_record = [id.strip() for id in item_ids_in_record]
                if item_id_str in item_ids_in_record:
                    item_charts.append(r)
            
            # Sort by Order (column F)
            item_charts.sort(key=lambda x: int(float(x.get('F', 0))))
            
            # Parse ChordData JSON for each chart
            parsed_charts = []
            for chart in item_charts:
                try:
                    chord_data_raw = chart.get('D', '{}')
                    if not chord_data_raw or chord_data_raw.strip() in ['', '{}']:
                        # Skip empty or corrupted chord data
                        app.logger.warning(f"Skipping chord chart {chart.get('A', 'unknown')} with empty/corrupted data")
                        continue
                        
                    chart_data = json.loads(chord_data_raw)
                    
                    # Validate essential chord data exists
                    if not chart_data or not isinstance(chart_data, dict):
                        app.logger.warning(f"Skipping chord chart {chart.get('A', 'unknown')} with invalid data structure")
                        continue
                    
                    parsed_chart = {
                        'id': int(chart.get('A', 0)),
                        'itemId': item_id,
                        'title': chart.get('C', ''),
                        'createdAt': chart.get('E', ''),
                        'order': int(float(chart.get('F', 0))),
                        **chart_data
                    }
                    parsed_charts.append(parsed_chart)
                except (json.JSONDecodeError, ValueError, TypeError) as e:
                    app.logger.error(f"Error parsing chord chart data for chart {chart.get('A', 'unknown')}: {str(e)}")
                    continue
            
            result[str(item_id)] = parsed_charts
        
        return jsonify(result)
        
    except Exception as e:
        app.logger.error(f"Error in batch chord charts: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/items/<int:item_id>/chord-charts', methods=['GET', 'POST'])
def chord_charts_for_item(item_id):
    """Get or create chord charts for an item."""
    if request.method == 'GET':
        try:
            data_layer = DataLayer()
            charts = data_layer.get_chord_charts_for_item(item_id)
            response = jsonify(charts)
            # Add anti-caching headers to prevent stale data
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
            return response
        except Exception as e:
            app.logger.error(f"Error getting chord charts for item {item_id}: {str(e)}")
            return jsonify({'error': str(e)}), 500
    
    elif request.method == 'POST':
        try:
            if not request.is_json:
                return jsonify({"error": "Request must be JSON"}), 400
            
            chord_data = request.json
            app.logger.debug(f"Creating chord chart for item {item_id} with data: {chord_data}")
            
            data_layer = DataLayer()
            result = data_layer.add_chord_chart(item_id, chord_data)
            if result:
                return jsonify(result)
            else:
                return jsonify({"error": "Failed to create chord chart"}), 500
                
        except Exception as e:
            app.logger.error(f"Error creating chord chart: {str(e)}")
            return jsonify({'error': str(e)}), 500

@app.route('/api/chord-charts/<int:chord_id>', methods=['DELETE'])
def delete_chord_chart_route(chord_id):
    """Delete a chord chart by ID."""
    try:
        success = delete_chord_chart(chord_id)
        if success:
            return jsonify({'success': True})
        else:
            return jsonify({'error': 'Failed to delete chord chart'}), 500
    except ValueError as e:
        error_msg = str(e).lower()
        # Handle case where chord chart doesn't exist
        if "not found" in error_msg:
            app.logger.warning(f"Chord chart {chord_id} not found: {str(e)}")
            return jsonify({'error': 'Chord chart not found'}), 404
        # Handle rate limit errors specifically
        elif "quota exceeded" in error_msg or "rate_limit_exceeded" in error_msg:
            app.logger.warning(f"Rate limit exceeded deleting chord chart {chord_id}: {str(e)}")
            return jsonify({
                'error': 'Rate limit exceeded. Please try again in a moment.',
                'retry_after': 60  # Suggest waiting 60 seconds
            }), 429
        else:
            app.logger.error(f"ValueError deleting chord chart {chord_id}: {str(e)}")
            return jsonify({'error': str(e)}), 400
    except Exception as e:
        app.logger.error(f"Error deleting chord chart {chord_id}: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/chord-charts/batch-delete', methods=['POST'])
def batch_delete_chord_charts_route():
    """Delete multiple chord charts by IDs in a single transaction."""
    try:
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400
        
        data = request.json
        chord_ids = data.get('chord_ids', [])
        
        if not chord_ids:
            return jsonify({"error": "No chord IDs provided"}), 400
        
        if not isinstance(chord_ids, list):
            return jsonify({"error": "chord_ids must be an array"}), 400
        
        app.logger.info(f"Batch deleting chord charts: {chord_ids}")
        
        # Import the function from sheets module
        from app.sheets import batch_delete_chord_charts
        
        result = batch_delete_chord_charts(chord_ids)
        
        if result['success']:
            app.logger.info(f"Successfully batch deleted {len(result['deleted'])} chord charts")
            return jsonify(result)
        else:
            app.logger.error(f"Batch delete failed: {result.get('error', 'Unknown error')}")
            return jsonify(result), 500
            
    except Exception as e:
        app.logger.error(f"Error in batch delete chord charts: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/chord-charts/common/search', methods=['GET'])
def search_common_chord_charts_route():
    """Search for specific common chord charts by name."""
    try:
        chord_name = request.args.get('name', '').strip()
        if not chord_name:
            return jsonify({'error': 'Chord name parameter required'}), 400
            
        app.logger.info(f"Searching common chord charts for: {chord_name}")
        matching_chords = search_common_chord_charts(chord_name)
        
        # Cache search results for longer since they're specific
        response = jsonify(matching_chords)
        response.headers['Cache-Control'] = 'public, max-age=1800'  # Cache for 30 minutes
        
        app.logger.info(f"Found {len(matching_chords)} matching chord charts for '{chord_name}'")
        return response
        
    except Exception as e:
        app.logger.error(f"Error searching common chord charts: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/chord-charts/common', methods=['GET'])
def get_common_chord_charts_route():
    """Get all common chord charts from the CommonChords sheet."""
    try:
        app.logger.info("Fetching common chord charts")
        common_chords = get_common_chord_charts()
        
        # Add cache control headers to allow caching but ensure freshness
        response = jsonify(common_chords)
        response.headers['Cache-Control'] = 'public, max-age=300'  # Cache for 5 minutes
        
        app.logger.info(f"Returning {len(common_chords)} common chord charts")
        return response
        
    except Exception as e:
        app.logger.error(f"Error fetching common chord charts: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/chord-charts/seed', methods=['POST'])
def seed_common_chord_charts_route():
    """Seed the CommonChords sheet with essential chords."""
    try:
        app.logger.info("Seeding common chord charts")
        success = seed_common_chord_charts()
        
        if success:
            app.logger.info("Successfully seeded common chord charts")
            return jsonify({'success': True, 'message': 'Common chords seeded successfully'})
        else:
            app.logger.error("Failed to seed common chord charts")
            return jsonify({'success': False, 'error': 'Failed to seed common chords'}), 500
            
    except Exception as e:
        app.logger.error(f"Error seeding common chord charts: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/chord-charts/<int:chord_id>', methods=['PUT'])
def update_chord_chart_route(chord_id):
    """Update a chord chart by ID."""
    try:
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400
        
        chord_data = request.json
        app.logger.debug(f"Updating chord chart {chord_id} with data: {chord_data}")
        
        result = update_chord_chart(chord_id, chord_data)
        if result:
            return jsonify(result)
        else:
            return jsonify({'error': 'Failed to update chord chart'}), 500
    except Exception as e:
        app.logger.error(f"Error updating chord chart {chord_id}: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/items/<int:item_id>/chord-charts/order', methods=['PUT'])
def update_chord_charts_order_route(item_id):
    """Update the order of chord charts for an item."""
    try:
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400
        
        chord_charts = request.json
        app.logger.debug(f"Updating chord chart order for item {item_id}: {chord_charts}")
        
        success = update_chord_charts_order(item_id, chord_charts)
        if success:
            return jsonify({'success': True})
        else:
            return jsonify({'error': 'Failed to update chord chart order'}), 500
            
    except Exception as e:
        app.logger.error(f"Error updating chord chart order: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/chord-charts/bulk-import', methods=['POST'])
def bulk_import_chords_route():
    """Import chords from TormodKv's SVGuitar-ChordCollection repository."""
    try:
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400
        
        data = request.json
        chord_names = data.get('chord_names', None)  # None means import all available
        
        app.logger.info(f"Starting bulk import of chords: {chord_names or 'all available'}")
        
        # Import chords using our bulk import function
        results = bulk_import_chords_from_tormodkv(chord_names)
        
        # Log results
        imported_count = len(results.get('imported', []))
        skipped_count = len(results.get('skipped', []))
        failed_count = len(results.get('failed', []))
        
        app.logger.info(f"Bulk import completed: {imported_count} imported, {skipped_count} skipped, {failed_count} failed")
        
        # Return success response with detailed results
        return jsonify({
            'success': True,
            'results': results,
            'summary': {
                'imported': imported_count,
                'skipped': skipped_count,
                'failed': failed_count
            }
        })
        
    except Exception as e:
        app.logger.error(f"Error in bulk import: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/chord-charts/bulk-import-local', methods=['POST'])
def bulk_import_chords_local_route():
    """Import chords from local TormodKv chord collection file."""
    try:
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400
        
        data = request.json
        chord_names = data.get('chord_names', None)  # None means import all available
        
        app.logger.info(f"Starting local bulk import of chords: {chord_names or 'all available'}")
        
        # Import chords using our local bulk import function
        results = bulk_import_chords_from_local_file(chord_names)
        
        # Log results
        imported_count = len(results.get('imported', []))
        skipped_count = len(results.get('skipped', []))
        failed_count = len(results.get('failed', []))
        
        app.logger.info(f"Local bulk import completed: {imported_count} imported, {skipped_count} skipped, {failed_count} failed")
        
        return jsonify({
            'success': True, 
            'results': results,
            'summary': {
                'imported': imported_count,
                'skipped': skipped_count,
                'failed': failed_count
            }
        })
        
    except Exception as e:
        app.logger.error(f"Error in local bulk import: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/chord-charts/copy', methods=['POST'])
def copy_chord_charts_route():
    """Copy chord charts from one song to multiple other songs."""
    try:
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400
        
        data = request.json
        source_item_id = data.get('source_item_id')
        target_item_ids = data.get('target_item_ids', [])
        
        if not source_item_id:
            return jsonify({"error": "source_item_id is required"}), 400
            
        if not target_item_ids or not isinstance(target_item_ids, list):
            return jsonify({"error": "target_item_ids must be a non-empty array"}), 400
        
        app.logger.info(f"Copying chord charts from item {source_item_id} to items {target_item_ids}")
        
        result = copy_chord_charts_to_items(source_item_id, target_item_ids)
        
        app.logger.info(f"Successfully copied {result['charts_found']} chord charts to {len(result['target_items'])} items")
        
        return jsonify({
            'success': True,
            'message': f"Copied {result['charts_found']} chord charts to {len(result['target_items'])} songs",
            'result': result
        })
        
    except Exception as e:
        app.logger.error(f"Error copying chord charts: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/debug/log', methods=['POST'])
def debug_log_route():
    """Endpoint for frontend to send debug logs to backend."""
    try:
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400
        
        data = request.json
        message = data.get('message', '')
        level = data.get('level', 'DEBUG')
        context = data.get('context', {})
        
        # Format the message with context if provided
        if context:
            formatted_message = f"[FRONTEND {level}] {message} | Context: {context}"
        else:
            formatted_message = f"[FRONTEND {level}] {message}"
        
        # Log at appropriate level
        if level.upper() == 'ERROR':
            app.logger.error(formatted_message)
        elif level.upper() == 'WARNING':
            app.logger.warning(formatted_message)
        else:
            app.logger.info(formatted_message)
        
        return jsonify({'success': True}), 200
        
    except Exception as e:
        app.logger.error(f"Error in debug log endpoint: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/autocreate-chord-charts', methods=['POST'])
def autocreate_chord_charts():
    """Autocreate chord charts from uploaded PDF/image files using Claude"""
    try:
        app.logger.debug("Starting autocreate chord charts process")
        
        # Check if files were uploaded
        if not request.files:
            return jsonify({'error': 'No files uploaded'}), 400
            
        item_id = request.form.get('itemId')
        if not item_id:
            return jsonify({'error': 'No itemId provided'}), 400
            
        app.logger.debug(f"Processing files for item ID: {item_id}")
        
        # Process uploaded files - simplified single collection
        uploaded_files = []
        
        def process_file(file):
            """Helper function to process a single file"""
            if file.filename == '':
                return None
                
            # Validate file type and size
            filename = secure_filename(file.filename)
            if not filename:
                return None
                
            # Check file size (5MB limit)
            file.seek(0, os.SEEK_END)
            file_size = file.tell()
            file.seek(0)

            if file_size > 5 * 1024 * 1024:  # 5MB
                return {'error': f'File {filename} is too large (max 5MB)'}
                
            # Read file content
            file_data = file.read()
            
            # Determine file type
            file_ext = filename.lower().split('.')[-1] if '.' in filename else ''
            
            if file_ext == 'pdf':
                # For PDFs, we'll send the raw bytes and let Claude handle it
                return {
                    'name': filename,
                    'type': 'pdf',
                    'data': base64.b64encode(file_data).decode('utf-8')
                }
            elif file_ext in ['png', 'jpg', 'jpeg']:
                # For images, encode as base64
                return {
                    'name': filename,
                    'type': 'image',
                    'data': base64.b64encode(file_data).decode('utf-8'),
                    'media_type': f'image/{file_ext if file_ext != "jpg" else "jpeg"}'
                }
            else:
                return {'error': f'Unsupported file type: {file_ext}'}
        
        # Process single uploaded file only (simplified approach)
        files_list = list(request.files.values())
        if len(files_list) > 1:
            return jsonify({'error': 'Please upload only one file at a time for autocreate'}), 400
        
        if len(files_list) == 0:
            return jsonify({'error': 'No file uploaded'}), 400
            
        # Process the single file
        file = files_list[0]
        result = process_file(file)
        if result:
            if 'error' in result:
                return jsonify(result), 400
            uploaded_files.append(result)
        
        app.logger.info(f"Processed 1 file for analysis: {result.get('name', 'unknown')}")
                
        if not uploaded_files:
            return jsonify({'error': 'No valid file found'}), 400
            
        # Check if user provided a choice for mixed content
        user_choice = request.form.get('userChoice')
        if user_choice:
            app.logger.info(f"[AUTOCREATE] User chose to process files as: {user_choice}")
            app.logger.info(f"[AUTOCREATE] Processing {len(uploaded_files)} files with user choice override")
            # Override file type detection with user choice
            for file_data in uploaded_files:
                file_data['forced_type'] = user_choice
        else:
            app.logger.info(f"[AUTOCREATE] No user choice provided, will use automatic detection")
            
        # Get Anthropic API key from environment
        api_key = os.getenv('ANTHROPIC_API_KEY')
        if not api_key:
            return jsonify({'error': 'Anthropic API key not configured'}), 500
            
        # Initialize Anthropic client
        client = anthropic.Anthropic(api_key=api_key)
        app.logger.info(f"[AUTOCREATE] Anthropic client initialized successfully")
        
        # Prepare the Claude analysis request
        app.logger.info(f"[AUTOCREATE] Starting Claude analysis for item {item_id}")
        app.logger.debug("Sending files to Claude for analysis")
        
        # Create the analysis prompt
        analysis_result = analyze_files_with_claude(client, uploaded_files, item_id)
        app.logger.info(f"[AUTOCREATE] Claude analysis completed, result type: {type(analysis_result)}")
        
        app.logger.debug("Claude analysis complete, creating chord charts")
        
        return jsonify(analysis_result)
        
    except Exception as e:
        app.logger.error(f"Error in autocreate chord charts: {str(e)}")
        return jsonify({'error': str(e)}), 500

def analyze_reference_diagrams_only(client, reference_files):
    """Step 1: Pure visual analysis of chord diagrams with focused prompt"""
    try:
        # Create focused visual analysis prompt for chord diagrams
        message_content = [
            {
                "type": "text", 
                "text": f"""🎸 **CHORD DIAGRAM VISUAL ANALYSIS WITH LAYOUT STRUCTURE**

You are analyzing {len(reference_files)} reference chord diagram files.

**FUNDAMENTAL RULE**: If the file contains chord charts, that's the user's way of asking you to use exactly the chord chart fingerings/shapes and chord chart names seen in the reference image. DO NOT substitute standard tuning patterns - use only what you actually see in the chord charts in the uploaded file.

**OVERRIDE INSTRUCTION**: If the uploaded file contains only Chord Charts (no lyrics), then even if you recognize these as "standard" chord names like E, A, G, etc., you MUST read the actual marker positions shown in THIS specific diagram. These may not be standard tuning - read only what you see, not what you expect these chords to look like.

**TASK:**
- Find all chord diagrams in the file
- Extract fret positions from markers in chord charts shown
- Preserve chord charts, order, and any section groupings

**⚠️ ANTI-KNOWLEDGE WARNING:** Please DO NOT use your knowledge of what guitar chords "should" look like. ONLY extract what you visually observe in the diagrams. If you see a marker at fret 3, extract fret 3 - even if you think that chord "should" be at fret 2.

**PATTERN EXTRACTION RULES - CRITICAL VISUAL ANALYSIS:**

1. **Fret Counting Rules (CRITICAL):**
   - The TOP horizontal line is the "nut" (fret 0)
   - **Fret 1** = The space BETWEEN the nut (top line) and the 2nd horizontal line
   - **Fret 2** = The space BETWEEN the 2nd and 3rd horizontal lines
   - **Fret 3** = The space BETWEEN the 3rd and 4th horizontal lines
   - Count spaces, NOT lines!

2. **String Order (CRITICAL):**
   - String 6 = Leftmost vertical line (lowest pitch)
   - String 5 = Second from left
   - String 4 = Third from left  
   - String 3 = Fourth from left
   - String 2 = Second from right
   - String 1 = Rightmost vertical line (highest pitch)

3. **Marker Types:**
   - Dots, circles, numbered circles (1,2,3,4), lettered circles (T) = finger positions (NOTE: Numbers inside of circles denote which finger is to be used. Do not confuse numbers in the image for marker positions.)
   - "O" above nut = open string (fret 0)
   - "X" above nut = muted string (fret -1)

4. **IGNORE COMPLETELY:**
   - Position markers like "3fr", "5fr", "7fr" - these are irrelevant for now.
   - Any chord knowledge you have - extract only what you see instead. We want to copy it exactly.
   - Chord name expectations - read diagrams, not labels

5. **STEP-BY-STEP PROCESS:**
   For EACH chord diagram:
   - **Identify the chord name** from the label above the diagram
   - **Examine each string (left to right, strings 6 through 1):**
     - Look above the nut: O = open (0), X = muted (-1)
     - Look for markers: count which fret space they occupy
     - If no marker and no O/X, assume open (0)
   - **Double-check your work:** Re-examine the diagram and verify each position
   - **Create detailed description:** Describe exactly what you see

**LAYOUT STRUCTURE RULES**:
1. Match the layout of chords exactly as seen in the uploaded file
2. **Section Preservation**: When you see sections labeled `Intro`, `Verse 1`, `Chorus`, `Solo`, `Bridge`, `Outro`, etc, replicate those sections, and fill with the same chords seen in the uploaded chord chart file
3. **Line Breaks Within Sections**: Mark where new rows begin, match the uploaded file



**OUTPUT FORMAT**: JSON with layout structure and detailed visual descriptions:
```json
{{
  "chords": [
    {{ 
      "name": "Eadd9", 
      "pattern": [0, 2, 1, 0, 0, 0], 
      "row": 1, 
      "position": 1,
      "visualDescription": "DEBUG: String 6 (leftmost): O above nut (open, fret 0), String 5: numbered circle '2' in fret space 2 (fret 2), String 4: numbered circle '1' in fret space 1 (fret 1), String 3: O above nut (open, fret 0), String 2: O above nut (open, fret 0), String 1: O above nut (open, fret 0). Final pattern: [0,2,1,0,0,0]"
    }},
    {{ 
      "name": "E6sus", 
      "pattern": [0, 2, 4, 4, 0, 0], 
      "row": 1, 
      "position": 2,
      "visualDescription": "DEBUG: String 6 (leftmost): O above nut (open, fret 0), String 5: numbered circle '2' in fret space 2 (fret 2), String 4: numbered circle '4' in fret space 4 (fret 4), String 3: numbered circle '4' in fret space 4 (fret 4), String 2: O above nut (open, fret 0), String 1: O above nut (open, fret 0). Final pattern: [0,2,4,4,0,0]"
    }}
  ],
  "totalRows": 3
}}
```

"""
            }
        ]
        
        # Add reference chord files (process both images and PDFs)
        for ref_file in reference_files:
            if ref_file.get('type') == 'image':
                message_content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": ref_file['media_type'],
                        "data": ref_file['data']
                    }
                })
            elif ref_file.get('type') == 'pdf':
                message_content.append({
                    "type": "document", 
                    "source": {
                        "type": "base64",
                        "media_type": ref_file['media_type'],
                        "data": ref_file['data']
                    }
                })
            else:
                # Log unsupported file types but continue processing
                print(f"INFO: Unsupported reference file type for '{ref_file.get('name')}', skipping")
        
        # Use Sonnet 4.5 for visual analysis
        llm_start_time = time.time()
        response = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=4000,
            messages=[{
                "role": "user",
                "content": message_content
            }]
        )
        llm_end_time = time.time()

        # Track LLM generation with PostHog Analytics
        llm_analytics.track_generation(
            model="claude-sonnet-4-5-20250929",
            input_messages=[{"role": "user", "content": "Visual chord diagram analysis"}],
            output_choices=[{"message": {"content": response.content[0].text}}],
            usage={
                "input_tokens": response.usage.input_tokens if hasattr(response, 'usage') else None,
                "output_tokens": response.usage.output_tokens if hasattr(response, 'usage') else None
            },
            latency_seconds=llm_end_time - llm_start_time,
            custom_properties={
                "function": "analyze_reference_diagrams_only",
                "file_count": len(reference_files),
                "analysis_type": "visual_chord_diagrams"
            }
        )

        return response.content[0].text
        
    except Exception as e:
        raise Exception(f"Visual analysis failed: {str(e)}")

def detect_file_types_with_sonnet(client, uploaded_files):
    """Detect file types using Sonnet 4 model"""
    try:
        app.logger.info("Using Sonnet 4 to detect file types and content")
        
        # Build message content with files for analysis
        prompt_text = """🎸 **FILE TYPE DETECTION FOR GUITAR CONTENT**

Analyze the uploaded files and determine their content types. You need to categorize each file as either:

1. **"chord_charts"** - Files containing visual chord diagrams that can be imported directly
   - Hand-drawn chord charts
   - Printed chord reference sheets  
   - Digital chord diagrams
   - Any files showing finger positions on fretboards

2. **"chord_names"** - Files with chord symbols above lyrics for CommonChords lookup
   - Lyrics with chord names above them (G, C, Am, etc.)
   - Song sheets with chord symbols
   - Lead sheets with chord progressions over text

3. **"tablature"** - Files containing actual guitar tablature notation
   - Text-based tablature with fret numbers on horizontal string lines (e.g. E|--0--3--0--|)
   - Tab files showing fingering patterns with numbers indicating frets
   
4. **"sheet_music"** - Files containing standard music notation
   - Traditional music notation with notes on staff lines
   - PDF files with musical scores and notation

**RESPONSE FORMAT:**
Return JSON with this exact structure:
```json
{
  "primary_type": "chord_charts",
  "has_mixed_content": false,
  "content_types": ["chord_charts"],
  "analysis": {
    "file_breakdown": [
      {
        "filename": "example.pdf",
        "type": "chord_charts",
        "confidence": "high",
        "reason": "Contains visual chord diagrams with finger positions"
      }
    ]
  }
}
```

**RULES:**
- Set "has_mixed_content": true only if files contain BOTH chord charts AND lyrics
- "primary_type" should be the most common content type found
- Use "high", "medium", or "low" for confidence levels
- Provide clear reasoning for each file classification

Analyze the files below:"""

        message_content = [{
            "type": "text",
            "text": prompt_text
        }]

        # Add all files for analysis
        for file_content in uploaded_files:
            name = file_content['name']
            
            # Add file label
            message_content.append({
                "type": "text",
                "text": f"\n\n**FILE: {name}**"
            })
            
            if file_content['type'] == 'pdf':
                message_content.append({
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": file_content['data']
                    }
                })
            elif file_content['type'] == 'image':
                message_content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": file_content['media_type'],
                        "data": file_content['data']
                    }
                })

        # Use Sonnet 4 for file type detection
        response = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=3000,
            messages=[{
                "role": "user",
                "content": message_content
            }]
        )
        
        response_text = response.content[0].text
        
        # Parse JSON response
        import re
        json_match = re.search(r'```json\s*(.*?)\s*```', response_text, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
        else:
            # Try to find JSON without markdown wrapper
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if json_match:
                json_str = json_match.group(0)
            else:
                # Fallback to chord_names if no JSON found
                app.logger.warning("Could not parse file type detection response, defaulting to chord_names")
                return {
                    "primary_type": "chord_names",
                    "has_mixed_content": True,
                    "content_types": ["chord_names."],
                    "analysis": {"error": "Could not parse detection response"}
                }
        
        result = json.loads(json_str)
        app.logger.info(f"File type detection result: {result.get('primary_type', 'unknown')} (mixed: {result.get('has_mixed_content', True)})")
        return result
        
    except Exception as e:
        app.logger.error(f"File type detection failed: {str(e)}")
        # Default to chord_names processing on error
        return {
            "primary_type": "chord_names", 
            "has_mixed_content": True,
            "content_types": ["tablature"],
            "analysis": {"error": str(e)}
        }

def analyze_files_with_claude(client, uploaded_files, item_id):
    """Simplified analysis: detect file type and process accordingly"""
    try:
        app.logger.info(f"[AUTOCREATE] analyze_files_with_claude called with {len(uploaded_files)} files for item {item_id}")
        
        # Check if user forced a type choice
        forced_type = None
        for file_data in uploaded_files:
            if 'forced_type' in file_data:
                forced_type = file_data['forced_type']
                break
                
        if forced_type:
            app.logger.info(f"[AUTOCREATE] User forced processing as: {forced_type}")
            # Skip detection, go straight to processing
            if forced_type == 'chord_charts':
                app.logger.info(f"[AUTOCREATE] Processing as chord charts (user choice)")
                return process_chord_charts_directly(client, uploaded_files, item_id)
            elif forced_type == 'chord_names':
                app.logger.info(f"[AUTOCREATE] Processing as chord names (user choice)")
                return process_chord_names_with_lyrics(client, uploaded_files, item_id)
            else:
                app.logger.warning(f"[AUTOCREATE] Unknown forced type: {forced_type}, falling back to chord names")
                return process_chord_names_with_lyrics(client, uploaded_files, item_id)
        
        # Step 1: File type detection using Sonnet 4
        app.logger.info(f"[AUTOCREATE] Step 1: Analyzing {len(uploaded_files)} files to detect content type using Sonnet 4")
        file_type_result = detect_file_types_with_sonnet(client, uploaded_files)
        
        # Step 2: Process based on detected content type
        if file_type_result.get('has_mixed_content'):
            # TODO: Return data for mixed content modal (Steven's requirement #2)
            return {
                'needs_user_choice': True,
                'mixed_content_options': file_type_result.get('content_types', []),
                'files': uploaded_files
            }
        
        # Process based on primary content type
        primary_type = file_type_result.get('primary_type', 'chord_names')
        app.logger.info(f"Processing files as: {primary_type}")
        
        # Step 3: Process files based on detected type
        if primary_type == 'chord_charts':
            return process_chord_charts_directly(client, uploaded_files, item_id)
        elif primary_type == 'chord_names':
            return process_chord_names_with_lyrics(client, uploaded_files, item_id)
        elif primary_type == 'tablature':
            return {
                'error': 'unsupported_format',
                'message': 'Sorry, we can only build chord charts. We can\'t process tablature here.',
                'title': 'Tablature Not Supported'
            }
        elif primary_type == 'sheet_music':
            return {
                'error': 'unsupported_format', 
                'message': 'Sorry, we can only build chord charts. We can\'t process sheet music here.',
                'title': 'Sheet Music Not Supported'
            }
        else:
            # Fallback to chord names processing (most common case)
            app.logger.warning(f"Unknown primary_type '{primary_type}', falling back to chord names processing")
            return process_chord_names_with_lyrics(client, uploaded_files, item_id)
        
    except TimeoutError as e:
        app.logger.error(f"Claude API timeout: {str(e)}")
        return {'error': 'Analysis timed out. Please try with fewer or smaller files.'}
    except Exception as e:
        app.logger.error(f"Error in Claude analysis: {str(e)}")
        # Check if it's an API error with more specific message
        error_msg = str(e)
        if 'rate_limit' in error_msg.lower() or '429' in error_msg:
            return {'error': 'Error code: 429 - API rate limit reached. Please wait a moment and try again.'}
        elif 'overloaded' in error_msg.lower() or '529' in error_msg:
            return {'error': 'Error code: 529 - API servers are temporarily overloaded. Please try again in a moment.'}
        elif '500' in error_msg or 'internal server error' in error_msg.lower():
            return {'error': 'Error code: 500 - Server error occurred. Please try again shortly.'}
        elif '502' in error_msg or 'bad gateway' in error_msg.lower():
            return {'error': 'Error code: 502 - Service temporarily unavailable. Please try again.'}
        elif '503' in error_msg or 'service unavailable' in error_msg.lower():
            return {'error': 'Error code: 503 - Service temporarily unavailable. Please try again.'}
        elif 'timeout' in error_msg.lower():
            return {'error': 'Request timed out. Please try with fewer or smaller files.'}
        else:
            return {'error': f'Analysis failed: {str(e)}'}

def process_chord_charts_directly(client, uploaded_files, item_id):
    """Process files containing chord charts for direct import"""
    try:
        app.logger.info("Processing chord chart files for direct import")
        
        prompt_text = """🎸 **Hey Claude! Visual Chord Diagram Analysis**

Hey there! I need your help with something really important. I'm asking you to look at guitar chord diagrams and extract the exact finger positions you see. This is tricky because I need you to be like a perfect camera - just tell me what's there, don't "correct" anything based on what you think it should be.

**🚨 REALLY IMPORTANT:** Here's the thing - please don't use any of your guitar knowledge here. I know you know what an "Em9" or "C7/G" chord typically looks like, but I need you to completely ignore that knowledge. Think of yourself as someone who's never seen a guitar chord before - you're just looking at dots and lines and telling me where the dots are positioned.

Why? Because people create their own chord variations and fingerings, and we want to capture THEIR version, not the "standard" version you might know.

**Here's how to read these diagrams:**

**Fret Counting** (this trips people up a lot):
- That thick line at the top? That's the "nut" - call it fret 0
- **Fret 1** is the space between the nut and the next horizontal line down
- **Fret 2** is the space between the 2nd and 3rd horizontal lines  
- **Fret 3** is the space between the 3rd and 4th horizontal lines
- You're counting the *spaces between lines*, not the lines themselves!

**String Order** (left to right):
- String 6 = Leftmost vertical line (lowest pitch)
- String 5 = Second from left
- String 4 = Third from left  
- String 3 = Fourth from left
- String 2 = Second from right
- String 1 = Rightmost vertical line (highest pitch)

**What the symbols mean:**
- Dots, circles, numbers (1,2,3,4), even letters like "T" = finger goes here
- "O" above the nut = play this string open (fret 0)
- "X" above the nut = don't play this string (muted, fret -1)

**Please ignore these completely:**
- Any "3fr", "5fr" position markers - those are just reference, not part of the pattern
- What you think the chord "should" be - just tell me what you see!

**CRITICAL: Layout and Structure Rules:**
- Read left-to-right, top-to-bottom - exactly as they appear in the file
- Identify line breaks - when chord diagrams start a new row
- Use EXACT chord names from diagrams, remove capo suffixes like "(capoOn2)"
- Group chords that appear on the same horizontal level
- Preserve the exact order - number chords 1, 2, 3... in reading order

**Your process for each chord:**
1. Spot the chord name (Em9, C7/G, etc.)
2. Go string by string from left to right (strings 6-1)
3. For each string: check above the nut first (O or X?), then look for any dots/markers in the fret spaces
4. Tell me exactly what you see in detail - this helps me debug if something goes wrong
5. Double-check your work before moving on

**Example 1:** If you see a chord with:
- String 6: "O" above nut
- String 5: dot in the space between 2nd and 3rd horizontal lines  
- String 4: dot in the space between 3rd and 4th horizontal lines
- String 3: "O" above nut
- String 2: "O" above nut  
- String 1: "O" above nut

You'd report: [0, 2, 3, 0, 0, 0] and describe it like: "String 6 open, string 5 has dot in fret 2, string 4 has dot in fret 3, strings 3-1 are open"

**Example 2:** If you see:
- String 6: "X" above nut
- String 5: dot in first fret space (between nut and 2nd line)
- Strings 4,3,2,1: "O" above nut

You'd report: [-1, 1, 0, 0, 0, 0] and describe: "String 6 muted, string 5 dot at fret 1, strings 4-1 open"

Make sense? You're being my eyes here, and I really appreciate the help!

**OUTPUT FORMAT:**
```json
{
  "tuning": "DETECT_FROM_FILE",
  "capo": 0,
  "analysis": {
    "referenceChordDescriptions": [
      {
        "name": "Em9",
        "visualDescription": "DEBUG: String 6: O (open, fret 0), String 5: O (open, fret 0), String 4: O (open, fret 0), String 3: numbered circle '1' in fret space 2 (fret 2), String 2: numbered circle '4' in fret space 4 (fret 4), String 1: O (open, fret 0). Final pattern: [0,0,0,2,4,0]",
        "extractedPattern": [0, 0, 0, 2, 4, 0]
      }
    ]
  },
  "sections": [
    {
      "label": "Main",
      "chords": [
        {
          "name": "Em9",
          "frets": [0, 0, 0, 2, 4, 0],
          "sourceType": "chord_chart_direct",
          "lineBreakAfter": false
        }
      ]
    }
  ]
}
```

**A couple more things that really help me out:**
- Please include that detailed visualDescription for each chord - it's like showing your work in math class, and it helps me figure out if something went wrong
- If you see something confusing or contradictory, just tell me about it - I'd rather know you're uncertain than guess wrong
- Remember the frets array goes [string 6, string 5, string 4, string 3, string 2, string 1] (low to high pitch)
- Use -1 for muted (X), 0 for open (O), and 1, 2, 3, etc. for fretted positions

Thanks so much for being thorough with this, you rock Claude! 🤘🎸🚀"""

        message_content = [{
            "type": "text", 
            "text": prompt_text
        }]
        
        # Add all uploaded files
        for file_content in uploaded_files:
            name = file_content['name']
            message_content.append({
                "type": "text",
                "text": f"\n\n**FILE: {name}**"
            })
            
            if file_content['type'] == 'pdf':
                message_content.append({
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf", 
                        "data": file_content['data']
                    }
                })
            elif file_content['type'] == 'image':
                message_content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": file_content['media_type'],
                        "data": file_content['data'] 
                    }
                })
        
        # Use Sonnet 4.5 for visual analysis of chord diagrams
        app.logger.info("Using Sonnet 4.5 for chord chart visual analysis")
        llm_start_time = time.time()
        response = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=6000,
            messages=[{
                "role": "user",
                "content": message_content
            }]
        )
        llm_end_time = time.time()

        response_text = response.content[0].text

        # Track LLM generation with PostHog Analytics
        llm_analytics.track_generation(
            model="claude-sonnet-4-5-20250929",
            input_messages=[{"role": "user", "content": "Chord chart processing and analysis"}],
            output_choices=[{"message": {"content": response_text}}],
            usage={
                "input_tokens": response.usage.input_tokens if hasattr(response, 'usage') else None,
                "output_tokens": response.usage.output_tokens if hasattr(response, 'usage') else None
            },
            latency_seconds=llm_end_time - llm_start_time,
            custom_properties={
                "function": "process_chord_charts_directly",
                "file_count": len(uploaded_files),
                "analysis_type": "chord_chart_processing",
                "item_id": str(item_id)
            }
        )
        
        # Parse JSON response
        chord_data = parse_json_response(response_text)
        if chord_data is None:
            return {'error': 'Failed to parse chord chart data from analysis response'}
        
        # Create chord charts from the structured data  
        created_charts = create_chord_charts_from_data(chord_data, item_id)
        
        return {
            'success': True,
            'message': f'Imported {len(created_charts)} chord charts',
            'charts': created_charts,
            'analysis': chord_data
        }
        
    except Exception as e:
        app.logger.error(f"Error processing chord charts: {str(e)}")
        return {'error': f'Failed to process chord charts: {str(e)}'}

def process_chord_names_with_lyrics(client, uploaded_files, item_id):
    """Process files with chord names above lyrics using CommonChords lookup"""
    try:
        app.logger.info(f"[AUTOCREATE] process_chord_names_with_lyrics called with {len(uploaded_files)} files for item {item_id}")
        app.logger.info("Processing chord names above lyrics with CommonChords lookup")
        
        prompt_text = """🎸 **Hey Claude! Chord Names from Lyrics Processing**

Hi there! This time I need your help with a different type of file - these are lyrics sheets with chord names written above the words (like "G" or "Am" or "F7" above the lyrics), NOT chord diagrams with dots and lines.

**What you're looking for:**
- Chord symbols like G, C, Am, F, D7, etc. positioned above lyrics
- Song sections marked like [Verse], [Chorus], [Bridge], [Intro], etc.
- The order that chords appear within each section
- Sometimes there might be repeat markers like "x2" or chord timing

**Your job:**
- Extract all the chord names exactly as written (don't "correct" them)
- Group them by song sections 
- Keep them in the order they appear
- Preserve the song structure the songwriter intended

**OUTPUT FORMAT:**
```json
{
  "tuning": "EADGBE",
  "capo": 0,
  "sections": [
    {
      "label": "Verse",
      "chords": [
        {
          "name": "G",
          "sourceType": "chord_names",
          "lineBreakAfter": false
        },
        {
          "name": "C", 
          "sourceType": "chord_names",
          "lineBreakAfter": true
        }
      ]
    }
  ]
}
```

**Key difference from chord diagrams:** Here you're just reading text/chord symbols, not analyzing visual finger positions. So if you see "Am7" written above some lyrics, just extract "Am7" - don't worry about what frets that chord uses.

**A few helpful tips:**
- Sometimes chords repeat in a progression like "G - C - G - C" - capture each occurrence
- Watch for timing info like "Em (hold)" or "F x4" 
- Section names can vary: Verse, Verse 1, Chorus, Bridge, Outro, etc.
- If you're not sure which section a chord belongs to, your best guess is fine
- Use EXACT chord names from document (G, C, Am, F7, etc.)
- Preserve section structure and progression order

Thanks for helping me extract these chord progressions! This saves me tons of time.

**One last technical note:** Please set lineBreakAfter: true for chords at the end of lines/phrases, and return only the JSON format shown above (no extra explanatory text). Thanks!"""

        message_content = [{
            "type": "text",
            "text": prompt_text
        }]
        
        # Add all uploaded files
        for file_content in uploaded_files:
            name = file_content['name']
            message_content.append({
                "type": "text", 
                "text": f"\n\n**FILE: {name}**"
            })
            
            if file_content['type'] == 'pdf':
                message_content.append({
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf", 
                        "data": file_content['data']
                    }
                })
            elif file_content['type'] == 'image':
                message_content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": file_content['media_type'],
                        "data": file_content['data']
                    }
                })
        
        # Use Sonnet 4 for chord names analysis (cost-efficient)
        app.logger.info(f"[AUTOCREATE] Using Sonnet 4 for chord names analysis")
        app.logger.info(f"[AUTOCREATE] Making API call with {len(message_content)} content items")
        app.logger.info(f"[AUTOCREATE] Message content types: {[item.get('type', 'unknown') for item in message_content]}")
        
        try:
            app.logger.info(f"[AUTOCREATE] Starting Anthropic API call to claude-sonnet-4-5-20250929")
            response = client.messages.create(
                model="claude-sonnet-4-5-20250929",
                max_tokens=8000,  # Increased for complex songs with multiple sections
                temperature=0.1,
                messages=[{"role": "user", "content": message_content}]
            )
            app.logger.info(f"[AUTOCREATE] API call successful, response received with {len(response.content)} content items")
            if response.content:
                app.logger.info(f"[AUTOCREATE] Response content length: {len(response.content[0].text) if response.content[0].text else 0} characters")
        except Exception as api_error:
            app.logger.error(f"[AUTOCREATE] API call failed: {str(api_error)}")
            app.logger.error(f"[AUTOCREATE] API error type: {type(api_error)}")
            return {'error': f'Claude API call failed: {str(api_error)}'}
        
        # Parse Claude's response
        response_text = response.content[0].text.strip()
        app.logger.info(f"[AUTOCREATE] Parsing Claude response for chord names")
        app.logger.info(f"[AUTOCREATE] Claude response preview: {response_text[:500]}...")
        
        if not response_text:
            app.logger.error("Empty response from Claude API")
            return {'error': 'Empty response from Claude API'}
            
        # Try to extract JSON from response (might be wrapped in markdown)
        try:
            # Look for JSON block in markdown
            if '```json' in response_text:
                json_start = response_text.find('```json') + 7
                json_end = response_text.find('```', json_start)
                json_text = response_text[json_start:json_end].strip()
            else:
                json_text = response_text
                
            chord_data = json.loads(json_text)
        except json.JSONDecodeError as parse_error:
            app.logger.error(f"[AUTOCREATE] Failed to parse JSON response: {parse_error}")
            app.logger.error(f"[AUTOCREATE] Parse error location: line {getattr(parse_error, 'lineno', 'unknown')} column {getattr(parse_error, 'colno', 'unknown')}")
            app.logger.error(f"[AUTOCREATE] Response length: {len(response_text)} characters")
            app.logger.error(f"[AUTOCREATE] Response preview (first 1000 chars): {response_text[:1000]}")
            app.logger.error(f"[AUTOCREATE] Response end (last 500 chars): {response_text[-500:]}")
            
            # Try to extract JSON from markdown code blocks if present
            import re
            json_match = re.search(r'```json\s*(.*?)\s*```', response_text, re.DOTALL)
            if json_match:
                try:
                    clean_json = json_match.group(1)
                    app.logger.info(f"[AUTOCREATE] Found JSON in markdown, attempting to parse {len(clean_json)} chars")
                    chord_data = json.loads(clean_json)
                    app.logger.info(f"[AUTOCREATE] Successfully parsed JSON from markdown!")
                except json.JSONDecodeError as clean_parse_error:
                    app.logger.error(f"[AUTOCREATE] Even markdown-extracted JSON failed to parse: {clean_parse_error}")
                    return {'error': f'Failed to parse chord chart data - JSON truncated or malformed. Error: {str(parse_error)}'}
            else:
                app.logger.error(f"[AUTOCREATE] No markdown JSON blocks found in response")
                return {'error': f'Failed to parse chord chart data from analysis response: {str(parse_error)}'}
        
        # Create chord charts from the structured data using CommonChords lookup
        created_charts = create_chord_charts_from_data(chord_data, item_id)
        
        return {
            'success': True,
            'message': f'Imported {len(created_charts)} chord charts',
            'charts': created_charts,
            'analysis': chord_data
        }
        
    except Exception as e:
        app.logger.error(f"Error processing chord names: {str(e)}")
        return {'error': f'Failed to process chord names: {str(e)}'}


def parse_json_response(response_text):
    """Helper function to parse JSON from Claude's response"""
    try:
        import re
        # Find JSON in the response (Claude might wrap it in markdown)
        json_match = re.search(r'```json\s*(.*?)\s*```', response_text, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
        else:
            # Try to find JSON without markdown wrapper
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if json_match:
                json_str = json_match.group(0)
            else:
                app.logger.error("No valid JSON found in Claude's response")
                app.logger.error(f"Response was: {response_text}")
                return None
        
        chord_data = json.loads(json_str)
        return chord_data
        
    except (json.JSONDecodeError, ValueError) as e:
        app.logger.error(f"Failed to parse Claude's response as JSON: {e}")
        app.logger.error(f"Response was: {response_text}")
        return None

def create_chord_charts_from_data(chord_data, item_id):
    """Create chord charts in Google Sheets from parsed chord data using batch operations"""
    try:
        created_charts = []
        
        # Extract tuning and capo from the analysis
        tuning = chord_data.get('tuning', 'EADGBE')
        capo = chord_data.get('capo', 0)
        
        # Pre-load all common chords efficiently to reduce API calls
        try:
            app.logger.info(f"[AUTOCREATE] Starting CommonChords lookup - getting all common chords efficiently")
            all_common_chords = get_common_chords_efficiently()
            app.logger.info(f"[AUTOCREATE] Successfully loaded {len(all_common_chords)} common chords for autocreate")
        except Exception as e:
            app.logger.error(f"[AUTOCREATE] Failed to load common chords: {str(e)}")
            app.logger.error(f"[AUTOCREATE] CommonChords error type: {type(e)}")
            all_common_chords = []
        
        # Log Claude's visual analysis for debugging
        try:
            if 'analysis' in chord_data:
                analysis = chord_data.get('analysis', {})
                if 'referenceChordDescriptions' in analysis:
                    app.logger.info("=== Claude's Visual Analysis of Reference Chord Diagrams ===")
                    for ref_chord in analysis['referenceChordDescriptions']:
                        app.logger.info(f"Chord: {ref_chord.get('name', 'Unknown')}")
                        app.logger.info(f"Visual Description: {ref_chord.get('visualDescription', 'No description')}")
                        app.logger.info(f"Extracted Pattern: {ref_chord.get('extractedPattern', 'No pattern')}")
                        # Add position marker debugging info if present in description
                        description = ref_chord.get('visualDescription', '')
                        if 'fr' in description.lower():
                            app.logger.info(f"🎯 Position marker detected in description: {description}")
                    app.logger.info("=== End Visual Analysis ===")
                else:
                    app.logger.info("No reference chord descriptions found in analysis")
            else:
                app.logger.info("No analysis field found in Claude response (using older prompt format)")
        except Exception as e:
            app.logger.warning(f"Error logging Claude visual analysis: {str(e)}")
        
        # REFERENCE-FIRST APPROACH: When reference files are present, use them directly
        reference_chord_shapes = []  # Reference chord shapes in order of appearance
        reference_chord_by_name = {}  # Map: chord_name -> reference_chord_data
        
        # Extract reference chord shapes in order of appearance
        if 'analysis' in chord_data:
            analysis = chord_data.get('analysis', {})
            if 'referenceChordDescriptions' in analysis:
                app.logger.info("=== REFERENCE-FIRST: Using Reference Chord Patterns Directly ===")
                for ref_chord in analysis['referenceChordDescriptions']:
                    chord_name = ref_chord.get('name', '').strip()
                    extracted_pattern = ref_chord.get('extractedPattern', [])
                    
                    if chord_name and extracted_pattern:
                        # Clean chord name (remove capo suffix)
                        clean_name = chord_name.replace('(capoOn2)', '').replace('(capoon2)', '').strip()
                        
                        reference_chord_data = {
                            'name': clean_name,
                            'frets': extracted_pattern,
                            'source': 'reference_diagram'
                        }
                        
                        reference_chord_shapes.append(reference_chord_data)
                        # Also create name-based lookup for intelligent matching
                        reference_chord_by_name[clean_name.lower()] = reference_chord_data
                        
                        app.logger.info(f"Reference chord #{len(reference_chord_shapes)}: {clean_name} → {extracted_pattern}")
                
                app.logger.info(f"✅ Loaded {len(reference_chord_shapes)} reference chords for direct use")
            else:
                app.logger.info("No reference chord descriptions found - will use chord names approach")
        else:
            app.logger.info("No analysis field found - will use chord names approach")
        
        # When no reference chords, we'll fall back to CommonChords lookup for chord names
        if not reference_chord_shapes:
            app.logger.info("=== NO REFERENCE DIAGRAMS: Will use CommonChords lookup for chord names ===")
        
        # Collect all chord charts to create in one batch
        all_chord_charts = []
        chart_order = 0
        
        # INTELLIGENT MISMATCH HANDLING: When reference has more chords than chord data
        if reference_chord_shapes:
            app.logger.info("=== INTELLIGENT REFERENCE-CHORD DATA INTEGRATION ===")
            
            # Count chords in chord data sections  
            total_chord_instances = sum(len(section.get('chords', [])) for section in chord_data.get('sections', []))
            app.logger.info(f"Chord data has {total_chord_instances} chord instances across all sections")
            app.logger.info(f"Reference file has {len(reference_chord_shapes)} unique chord shapes")
            
            if len(reference_chord_shapes) > total_chord_instances:
                app.logger.info(f"📊 MISMATCH DETECTED: Reference file contains MORE chords than chord data")
                app.logger.info(f"📊 SOLUTION: Will include ALL reference chords, organized by chord data structure")
                
                # Add extra reference chords to the last section to ensure they're all included
                sections = chord_data.get('sections', [])
                if sections:
                    last_section = sections[-1]
                    existing_chord_names = {chord.get('name', '').lower() for section in sections for chord in section.get('chords', [])}
                    
                    # Add any reference chords not found in chord data to the last section
                    for ref_chord in reference_chord_shapes:
                        ref_name = ref_chord['name'].lower()
                        if ref_name not in existing_chord_names:
                            app.logger.info(f"🔍 Adding missing reference chord to last section: {ref_chord['name']}")
                            last_section.setdefault('chords', []).append({
                                'name': ref_chord['name'],
                                'frets': ref_chord['frets'],
                                'sourceType': 'reference_only'
                            })
        
        # Use sections as provided by Claude analysis (preserve section structure)
        sections = chord_data.get('sections', [])
        if not sections:
            sections = [{'label': 'Chords', 'chords': []}]
        
        for section in sections:
            section_label = section.get('label', 'Chords')
            section_repeat = section.get('repeatCount', '')
            
            # Generate a unique section ID
            import time
            section_id = f"section-{int(time.time() * 1000)}"
            
            for chord in section.get('chords', []):
                chord_name = chord.get('name', 'Unknown')
                chord_frets = chord.get('frets', [])
                chord_fingers = chord.get('fingers', [])
                source_type = chord.get('sourceType', 'chord_names')  # Default to chord_names if not specified
                
                # REFERENCE-FIRST APPROACH: Check for reference chord by name
                reference_match = None
                if reference_chord_shapes and chord_name.lower() != 'unknown':
                    reference_match = reference_chord_by_name.get(chord_name.lower())
                    
                    if reference_match:
                        # Use reference chord shape and name directly
                        original_chord_data = f"{chord_name}: {chord_frets}" if chord_frets else f"{chord_name}: no frets"
                        chord_frets = reference_match['frets']
                        chord_name = reference_match['name']
                        source_type = 'reference_direct'
                        app.logger.info(f"✅ REFERENCE-FIRST: {original_chord_data} → {chord_name} {chord_frets}")
                    else:
                        app.logger.debug(f"No reference match found for chord name '{chord_name}'")
                
                # Simplified processing: reference patterns or direct chord data
                use_reference_pattern = (source_type in ['reference', 'reference_direct', 'reference_only'] and chord_frets)
                use_direct_pattern = (source_type == 'chord_names' and chord_frets and tuning != 'EADGBE')
                
                if use_reference_pattern:
                    app.logger.info(f"✅ Using reference diagram: {chord_name} = {chord_frets} in {tuning}")
                elif use_direct_pattern:
                    app.logger.info(f"✅ Using direct chord pattern: {chord_name} = {chord_frets} in {tuning}")
                
                # Find the chord in pre-loaded common chords (case-insensitive)  
                common_chord = None
                chord_name_lower = chord_name.lower()
                
                # Only lookup in CommonChords for standard tuning when not using direct patterns
                is_standard_tuning = tuning.upper() in ['EADGBE', 'STANDARD']
                if not (use_reference_pattern or use_direct_pattern):
                    if not is_standard_tuning:
                        app.logger.warning(f"⚠️  FALLBACK: Skipping CommonChords lookup for alternate tuning: {tuning}. CommonChords only contains EADGBE patterns.")
                    elif chord_name_lower != 'unknown':
                        for common in all_common_chords:
                            if common.get('title', '').lower() == chord_name_lower:
                                common_chord = common
                                app.logger.info(f"📚 FALLBACK: Found {chord_name} in pre-loaded CommonChords by name")
                                break
                    
                    # If not found by name and we have fret data, try to find by fret pattern (standard tuning only)
                    if not common_chord and chord_frets and is_standard_tuning:
                        # Try to match fret pattern in CommonChords (for transposed patterns)
                        for common in all_common_chords:
                            common_frets = common.get('frets', [])
                            if common_frets == chord_frets:
                                common_chord = common
                                chord_name = common.get('title', chord_name)  # Use the chord name from CommonChords
                                app.logger.info(f"📚 FALLBACK: Found chord by fret pattern match: {chord_name}")
                                break
                
                # Create chord chart data (unified processing for reference patterns or direct patterns)
                if use_reference_pattern or use_direct_pattern:
                    frets = chord_frets
                    
                    # Build SVGuitar-compatible data from chord pattern
                    open_strings = []
                    muted_strings = []
                    svguitar_fingers = []
                    
                    if frets:
                        finger_number = 1  # Auto-assign finger numbers
                        for i, fret_val in enumerate(frets):
                            # Convert AI array format to SVGuitar format
                            # AI: [low E, A, D, G, B, high E] → SVGuitar: string 1=high E, string 6=low E
                            string_num = 6 - i
                            if fret_val == 0:
                                open_strings.append(string_num)
                            elif fret_val == -1:
                                muted_strings.append(string_num)
                            elif fret_val > 0:
                                svguitar_fingers.append([string_num, fret_val, str(finger_number)])
                                finger_number += 1
                    
                    # 🔧 SVGuitar Debug Logging (Reference Pattern Path)
                    app.logger.info(f"🔧 SVGuitar Conversion Debug for {chord_name} (Reference Pattern):")
                    app.logger.info(f"   Input frets: {frets}")
                    app.logger.info(f"   SVGuitar fingers: {svguitar_fingers}")
                    app.logger.info(f"   Open strings: {open_strings}")
                    app.logger.info(f"   Muted strings: {muted_strings}")
                    app.logger.info(f"   Tuning: {tuning}")
                    
                    chord_chart_data = {
                        'title': chord_name,
                        'tuning': tuning,
                        'capo': capo,
                        'numFrets': 5,
                        'numStrings': len(frets) if frets else 6,
                        'fingers': svguitar_fingers,
                        'barres': [],
                        'openStrings': open_strings,
                        'mutedStrings': muted_strings,
                        'sectionId': section_id,
                        'sectionLabel': section_label,
                        'sectionRepeatCount': section_repeat
                    }
                    
                    source_desc = "reference diagram" if use_reference_pattern else "chord pattern"
                    app.logger.info(f"✅ Created chord chart from {source_desc}: {chord_name} = {frets} in {tuning}")
                
                elif common_chord:
                    # Use the chord from CommonChords (standard tuning path)
                    chord_chart_data = {
                        'title': chord_name,
                        'tuning': common_chord.get('tuning', tuning),
                        'capo': common_chord.get('capo', capo), 
                        'startingFret': common_chord.get('startingFret', 1),
                        'numFrets': common_chord.get('numFrets', 5),
                        'numStrings': common_chord.get('numStrings', 6),
                        'fingers': common_chord.get('fingers', []),
                        'frets': common_chord.get('frets', []),
                        'barres': common_chord.get('barres', []),
                        'openStrings': common_chord.get('openStrings', []),
                        'mutedStrings': common_chord.get('mutedStrings', []),
                        'sectionId': section_id,
                        'sectionLabel': section_label,
                        'sectionRepeatCount': section_repeat
                    }
                else:
                    # Fallback: use raw data from Claude/chord analysis (chord not found in CommonChords)
                    # Prioritize fret data from chord analysis over generic fallback
                    frets = chord_frets if chord_frets else chord.get('frets', [])
                    fingers = chord_fingers if chord_fingers else chord.get('fingers', [])
                    starting_fret = chord.get('startingFret', 1)
                    
                    # Calculate starting fret from fret pattern if not specified
                    if frets and starting_fret == 1:
                        non_zero_frets = [f for f in frets if f > 0]
                        if non_zero_frets:
                            starting_fret = min(non_zero_frets)
                    
                    # Convert frets to SVGuitar fingers format if fingers are empty but frets exist
                    svguitar_fingers = fingers if fingers else []
                    open_strings = []
                    muted_strings = []
                    
                    if frets and not svguitar_fingers:
                        app.logger.info(f"Converting frets to SVGuitar format for {chord_name}: {frets}")
                        finger_number = 1  # Auto-assign finger numbers
                        for i, fret_val in enumerate(frets):
                            # Fix string numbering: AI arrays are [low E, A, D, G, B, high E] (index 0-5)
                            # SVGuitar expects: string 1=high E, string 6=low E
                            string_num = 6 - i  # Convert: index 0 (low E) → SVGuitar string 6
                                                 #          index 5 (high E) → SVGuitar string 1
                            if fret_val == 0:
                                open_strings.append(string_num)
                            elif fret_val == -1:  # Sometimes muted strings are marked as -1
                                muted_strings.append(string_num)
                            elif fret_val > 0:  # Fretted note
                                svguitar_fingers.append([string_num, fret_val, str(finger_number)])
                                finger_number += 1
                    
                    # 🔧 SVGuitar Debug Logging (Fallback Pattern Path)
                    app.logger.info(f"🔧 SVGuitar Conversion Debug for {chord_name} (Fallback Pattern):")
                    app.logger.info(f"   Input frets: {frets}")
                    app.logger.info(f"   SVGuitar fingers: {svguitar_fingers}")
                    app.logger.info(f"   Open strings: {open_strings}")
                    app.logger.info(f"   Muted strings: {muted_strings}")
                    app.logger.info(f"   Tuning: {tuning}")
                    
                    chord_chart_data = {
                        'title': chord_name,
                        'tuning': tuning,
                        'capo': capo,
                        'numFrets': 5,  # Default to 5 frets
                        'numStrings': len(frets) if frets else 6,
                        'fingers': svguitar_fingers,  # Use converted SVGuitar format
                        'openStrings': open_strings,   # Derive from fret pattern
                        'mutedStrings': muted_strings, # Derive from fret pattern
                        'frets': frets,
                        'barres': [],  # Could be enhanced to detect barres
                        'sectionId': section_id,
                        'sectionLabel': section_label,
                        'sectionRepeatCount': section_repeat
                    }
                    
                    app.logger.debug(f"Using chord fret data for {chord_name}: frets={frets}, fingers={fingers}")
                
                # Include the order in the chord data itself
                chord_chart_data['order'] = chart_order
                all_chord_charts.append((chord_name, section_label, chord_chart_data))
                chart_order += 1
        
        # Batch create all chord charts in one API call
        if all_chord_charts:
            chord_data_list = [chart_data for _, _, chart_data in all_chord_charts]
            
            app.logger.info(f"[AUTOCREATE] Batch creating {len(chord_data_list)} chord charts for item {item_id}")
            app.logger.info(f"[AUTOCREATE] Starting batch_add_chord_charts API call to Google Sheets")
            
            try:
                data_layer = DataLayer()
                batch_results = data_layer.batch_add_chord_charts(item_id, chord_data_list)
                app.logger.info(f"[AUTOCREATE] Batch creation completed, got {len(batch_results)} results")
            except Exception as batch_error:
                app.logger.error(f"[AUTOCREATE] Batch creation failed: {str(batch_error)}")
                app.logger.error(f"[AUTOCREATE] Batch error type: {type(batch_error)}")
                raise
            
            # Build response with chord names and sections
            for (chord_name, section_label, _), result in zip(all_chord_charts, batch_results):
                created_charts.append({
                    'name': chord_name,
                    'section': section_label,
                    'id': result.get('id') if result else None
                })
        
        return created_charts
        
    except Exception as e:
        app.logger.error(f"Error creating chord charts: {str(e)}")
        raise

def add_chord_chart_with_backoff(item_id, chord_chart_data, max_retries=3):
    """Add chord chart with exponential backoff for rate limiting"""
    import time
    from app.sheets import add_chord_chart
    
    for attempt in range(max_retries):
        try:
            return add_chord_chart(item_id, chord_chart_data)
        except Exception as e:
            error_str = str(e).lower()
            if 'rate' in error_str or '429' in error_str or 'quota' in error_str:
                if attempt < max_retries - 1:
                    # Exponential backoff: 2, 4, 8 seconds
                    wait_time = 2 ** (attempt + 1)
                    app.logger.warning(f"Rate limited, waiting {wait_time}s before retry {attempt + 1}/{max_retries}")
                    time.sleep(wait_time)
                    continue
                else:
                    app.logger.error(f"Max retries reached for rate limiting: {str(e)}")
                    raise
            else:
                # Non-rate limit error, don't retry
                raise
    
    return None

# ============================================================================
# Billing & Subscription Routes (Stripe Integration)
# ============================================================================

@app.route('/api/billing/create-checkout-session', methods=['POST'])
def create_checkout_session():
    """Create Stripe Checkout Session for subscription purchase"""
    from app.database import get_db
    db = get_db()
    try:
        return billing.create_checkout_session(db)
    finally:
        db.close()


@app.route('/api/billing/create-portal-session', methods=['POST'])
def create_portal_session():
    """Create Stripe Customer Portal Session for subscription management"""
    from app.database import get_db
    db = get_db()
    try:
        return billing.create_portal_session(db)
    finally:
        db.close()


@app.route('/api/billing/test', methods=['GET'])
def test_route():
    """Test route"""
    return jsonify({'message': 'Test route works'})


@app.route('/api/billing/update-subscription', methods=['POST'])
def update_subscription_route():
    """Update existing subscription (upgrades/downgrades for existing customers)"""
    from app.database import get_db
    db = get_db()
    try:
        return billing.update_existing_subscription(db)
    finally:
        db.close()


@app.route('/api/billing/resume-subscription', methods=['POST'])
def resume_subscription_route():
    """Resume lapsed subscription by updating payment method"""
    from app.database import get_db
    db = get_db()
    try:
        return billing.resume_subscription(db)
    finally:
        db.close()


@app.route('/api/billing/set-unplugged', methods=['POST'])
def set_unplugged_route():
    """Set user to unplugged mode (free tier with limited access)"""
    from app.database import get_db
    db = get_db()
    try:
        return billing.set_unplugged_mode(db)
    finally:
        db.close()


@app.route('/api/webhooks/stripe', methods=['POST'])
def stripe_webhook():
    """Handle Stripe webhook events"""
    from app.database import get_db
    db = get_db()
    try:
        return billing.handle_stripe_webhook(db)
    finally:
        db.close()
