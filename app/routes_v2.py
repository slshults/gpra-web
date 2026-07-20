"""
Updated routes using the data layer abstraction.
Drop-in replacement for existing routes.py during migration.
"""
from flask import render_template, request, jsonify, redirect, session, url_for, send_from_directory, abort
from flask_login import current_user
from app import app, billing, limiter, csrf
from app.data_layer import data_layer
from app.database import DatabaseTransaction
from app.middleware.rls import require_user_context
from app.subscription_tiers import get_tier_limits
from sqlalchemy import text
from datetime import datetime, timedelta
import logging
import os
import base64
import anthropic
import json
import stripe

# Module-level config for templates
posthog_key = os.getenv('POSTHOG_API_KEY', '')

# Main route
@app.route('/')
def index():
    """
    Main app route - requires authentication.

    If user is not logged in, redirect to custom login page.
    Uses a client-side redirect to preserve URL hash fragments (e.g., /#Account).
    """
    # Check if user is authenticated via Flask-AppBuilder
    if not current_user.is_authenticated:
        app.logger.info("User not authenticated, redirecting to login via client-side redirect")
        # Use client-side redirect to preserve URL hash (hash is not sent to server)
        # The login_redirect template saves the hash to sessionStorage before redirecting
        return render_template('landing.html.jinja', posthog_key=posthog_key)

    app.logger.info(f"Authenticated user accessing main app: {current_user.username}")

    return render_template('index.html.jinja',
                         posthog_key=posthog_key,
                         debug=app.debug)

# Custom auth page routes (serve React pages)
@app.route('/login')
def login_page():
    """Custom React login page"""
    # If already authenticated, redirect to main app
    if current_user.is_authenticated:
        return redirect('/')
    return render_template('auth.html.jinja', page='login', posthog_key=posthog_key, debug=app.debug)

@app.route('/signup')
def signup_page():
    """Custom React signup page"""
    # If already authenticated, redirect to main app
    if current_user.is_authenticated:
        return redirect('/')
    return render_template('auth.html.jinja', page='register', posthog_key=posthog_key, debug=app.debug)

@app.route('/register')
def register_redirect():
    return redirect('/signup', code=301)

@app.route('/forgot-password')
def forgot_password_page():
    """Custom React forgot password page"""
    # If already authenticated, redirect to main app
    if current_user.is_authenticated:
        return redirect('/')
    return render_template('auth.html.jinja', page='forgot-password', posthog_key=posthog_key, debug=app.debug)

@app.route('/reset-password')
def reset_password_page():
    """Custom React reset password page"""
    # If already authenticated, redirect to main app
    if current_user.is_authenticated:
        return redirect('/')
    return render_template('auth.html.jinja', page='reset-password', posthog_key=posthog_key, debug=app.debug)

@app.route('/privacy')
def privacy_page():
    """Privacy policy page - accessible to everyone"""
    return render_template('privacy.html.jinja', posthog_key=posthog_key)

@app.route('/terms')
def terms_page():
    """Terms of service page - accessible to everyone"""
    return render_template('terms.html.jinja', posthog_key=posthog_key)

@app.route('/faq')
def faq_page():
    """FAQ page - accessible to everyone"""
    return render_template('faq.html.jinja', posthog_key=posthog_key)

@app.route('/about')
def about_page():
    """About page - accessible to everyone"""
    return render_template('about.html.jinja', posthog_key=posthog_key)

@app.route('/why')
def why_page():
    """Why structured practice page - accessible to everyone"""
    return render_template('why.html.jinja', posthog_key=posthog_key)

@app.route('/find-a-chord-chart')
def find_a_chord_chart():
    """Public chord chart lookup page - accessible to everyone, no auth required.

    Supports deep-link query params for the Chord of the Day social posts:
      ?id=N      -> precise voicing (preferred, used by the daily-post bot)
      ?chord=X   -> fall-back name search (the page picks the first match)
    When either param resolves to a real chord, dynamic OG/title tags reflect
    the chord name so social-feed link cards aren't all identical.
    """
    chord_id = request.args.get('id', type=int)
    chord_param = (request.args.get('chord') or '').strip()
    chord_name = None

    if chord_id:
        with DatabaseTransaction() as db:
            row = db.execute(
                text("SELECT name FROM common_chords WHERE id = :id LIMIT 1"),
                {"id": chord_id}
            ).fetchone()
            chord_name = row[0] if row else None
    elif chord_param:
        # Only use a DB-resolved name for OG tags so we don't echo arbitrary
        # user input back to social crawlers. Page UX still works either way.
        with DatabaseTransaction() as db:
            row = db.execute(
                text("""
                    SELECT name FROM common_chords
                    WHERE LOWER(name) = LOWER(:name)
                    ORDER BY order_col NULLS LAST, id
                    LIMIT 1
                """),
                {"name": chord_param}
            ).fetchone()
            chord_name = row[0] if row else None

    # Canonical share URL reflects the param actually used (None for the bare page)
    if chord_id:
        share_url = url_for('find_a_chord_chart', id=chord_id, _external=True)
    elif chord_param and chord_name:
        share_url = url_for('find_a_chord_chart', chord=chord_name, _external=True)
    else:
        share_url = url_for('find_a_chord_chart', _external=True)

    return render_template(
        'find_a_chord_chart.html.jinja',
        posthog_key=posthog_key,
        chord_name=chord_name,
        share_url=share_url,
    )

@app.route('/pricing')
def pricing_page():
    """Pricing page - accessible to everyone"""
    return render_template('pricing.html.jinja', posthog_key=posthog_key)

def _error_page(template, code):
    return render_template(template, posthog_key=posthog_key), code

@app.errorhandler(404)
def page_not_found(e):
    return _error_page('404.html.jinja', 404)

@app.errorhandler(500)
def internal_server_error(e):
    try:
        from app.utils.posthog_client import posthog_client, get_posthog_distinct_id
        if posthog_client:
            distinct_id = None
            if current_user and current_user.is_authenticated:
                distinct_id = get_posthog_distinct_id(current_user.id)
            posthog_client.capture_exception(e, distinct_id=distinct_id)
    except Exception:
        logging.getLogger(__name__).exception('Failed to send 500 to PostHog')
    return _error_page('500.html.jinja', 500)

@app.errorhandler(429)
def too_many_requests(e):
    return _error_page('429.html.jinja', 429)

@app.errorhandler(403)
def forbidden(e):
    return _error_page('403.html.jinja', 403)

@app.errorhandler(401)
def unauthorized(e):
    if 'text/html' in request.headers.get('Accept', ''):
        return _error_page('401.html.jinja', 401)
    return jsonify({'error': 'Authentication required'}), 401

if app.debug:
    @app.route('/test-error/<int:code>')
    def test_error(code):
        """Debug-only route for testing custom error pages."""
        abort(code)

@app.route('/favicon.ico')
def favicon():
    """Serve favicon.ico from the site root for Google Search results"""
    return send_from_directory(app.static_folder, 'favicon.ico', mimetype='image/x-icon')

@app.route('/robots.txt')
def robots_txt():
    """Serve robots.txt for search engine crawlers"""
    return send_from_directory(app.static_folder, 'robots.txt', mimetype='text/plain')

@app.route('/sitemap.xml')
def sitemap_xml():
    """Serve sitemap.xml for search engine indexing"""
    return send_from_directory(app.static_folder, 'sitemap.xml', mimetype='application/xml')

@app.route('/unsubscribe/inactivity/<token>')
def unsubscribe_inactivity(token):
    """
    Unsubscribe from inactivity reminder emails via signed token.

    No login required - token contains user_id and is cryptographically signed.
    Users receive these links in inactivity emails (90-day no-activity reminders).
    """
    from app.unsubscribe_tokens import validate_unsubscribe_token
    from itsdangerous import SignatureExpired, BadSignature

    try:
        # Validate and decode the token
        payload = validate_unsubscribe_token(token)
        user_id = payload['user_id']

        # Update the user's subscription to opt them out
        with DatabaseTransaction() as tx:
            result = tx.execute(text("""
                UPDATE subscriptions
                SET inactivity_emails_opted_out = TRUE,
                    updated_at = NOW()
                WHERE user_id = :user_id
                RETURNING user_id
            """), {"user_id": user_id})

            row = result.fetchone()
            if not row:
                app.logger.warning(f"Unsubscribe attempt for non-existent subscription: user_id={user_id}")
                return render_template('unsubscribe.html.jinja',
                                       success=False,
                                       error='not_found',
                                       posthog_key=posthog_key)

        app.logger.info(f"User {user_id} unsubscribed from inactivity emails")
        return render_template('unsubscribe.html.jinja',
                               success=True,
                               token=token,
                               posthog_key=posthog_key)

    except SignatureExpired:
        app.logger.warning(f"Expired unsubscribe token: {token[:20]}...")
        return render_template('unsubscribe.html.jinja',
                               success=False,
                               error='expired',
                               posthog_key=posthog_key)

    except BadSignature:
        app.logger.warning(f"Invalid unsubscribe token: {token[:20]}...")
        return render_template('unsubscribe.html.jinja',
                               success=False,
                               error='invalid',
                               posthog_key=posthog_key)

    except Exception as e:
        app.logger.error(f"Unsubscribe error: {e}")
        return render_template('unsubscribe.html.jinja',
                               success=False,
                               error='unknown',
                               posthog_key=posthog_key)

@app.route('/resubscribe/inactivity/<token>')
def resubscribe_inactivity(token):
    """
    Resubscribe to inactivity reminder emails via signed token.

    No login required - uses the same token format as unsubscribe.
    This allows users who accidentally unsubscribed to easily resubscribe.
    """
    from app.unsubscribe_tokens import validate_unsubscribe_token
    from itsdangerous import SignatureExpired, BadSignature

    try:
        # Validate and decode the token
        payload = validate_unsubscribe_token(token)
        user_id = payload['user_id']

        # Update the user's subscription to opt them back in
        with DatabaseTransaction() as tx:
            result = tx.execute(text("""
                UPDATE subscriptions
                SET inactivity_emails_opted_out = FALSE
                WHERE user_id = :user_id
                RETURNING id
            """), {"user_id": user_id})

            row = result.fetchone()
            if not row:
                app.logger.warning(f"Resubscribe attempt for non-existent subscription: user_id={user_id}")
                return render_template('resubscribe.html.jinja',
                                       success=False,
                                       error='not_found',
                                       posthog_key=posthog_key)

        app.logger.info(f"User {user_id} resubscribed to inactivity emails")
        return render_template('resubscribe.html.jinja',
                               success=True,
                               posthog_key=posthog_key)

    except SignatureExpired:
        app.logger.warning(f"Expired resubscribe token: {token[:20]}...")
        return render_template('resubscribe.html.jinja',
                               success=False,
                               error='expired',
                               posthog_key=posthog_key)

    except BadSignature:
        app.logger.warning(f"Invalid resubscribe token: {token[:20]}...")
        return render_template('resubscribe.html.jinja',
                               success=False,
                               error='invalid',
                               posthog_key=posthog_key)

    except Exception as e:
        app.logger.error(f"Resubscribe error: {e}")
        return render_template('resubscribe.html.jinja',
                               success=False,
                               error='unknown',
                               posthog_key=posthog_key)

# Items API - Updated to use data layer
@app.route('/api/items', methods=['GET', 'POST'])
@require_user_context
def items():
    """Handle GET (list) and POST (create) for items"""
    if request.method == 'GET':
        return jsonify(data_layer.get_all_items())
    elif request.method == 'POST':
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400

        # Check subscription tier limits for item creation
        from app.database import SessionLocal
        db = SessionLocal()
        try:
            # Get user's subscription tier
            subscription = db.execute(text("""
                SELECT tier, is_complimentary FROM subscriptions WHERE user_id = :user_id
            """), {'user_id': current_user.id}).fetchone()

            # Default to 'free' tier if no subscription
            tier = subscription[0] if subscription else 'free'
            is_complimentary = subscription[1] if subscription else False
            app.logger.info(f"User {current_user.id} has subscription tier: {tier}")

            # Get tier limits
            tier_config = get_tier_limits(tier, is_complimentary)
            items_limit = tier_config['items_limit']

            # Count existing items for this user
            item_count = db.execute(text("""
                SELECT COUNT(*) FROM items WHERE user_id = :user_id
            """), {'user_id': current_user.id}).fetchone()[0]

            app.logger.info(f"User {current_user.id} has {item_count} items (tier '{tier}' limit: {items_limit})")

            # Check if limit reached
            if item_count >= items_limit:
                app.logger.warning(f"User {current_user.id} reached item limit: {item_count}/{items_limit}")
                return jsonify({
                    "error": "Item limit reached",
                    "message": f"You've reached the {items_limit} item limit for the {tier_config['display_name']} tier. Please upgrade to add more items.",
                    "tier": tier,
                    "limit": items_limit,
                    "current": item_count
                }), 403
        finally:
            db.close()
            # Remove scoped session from thread-local storage
            SessionLocal.remove()

        new_item = request.json
        result = data_layer.add_item(new_item)
        return jsonify(result)

@app.route('/api/items/<item_id>', methods=['GET', 'PUT', 'DELETE'])
@require_user_context
def item(item_id):
    """Handle GET (fetch), PUT (update) and DELETE for individual items"""
    try:
        item_id = int(float(item_id))
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid item ID"}), 400
        
    if request.method == 'GET':
        # Frontend passes ItemID (Column B), so match against Column B first
        # Column A is the DB primary key, Column B is the ItemID used by the frontend
        items = data_layer.get_all_items()
        item = next((i for i in items if i.get('B') and int(float(i['B'])) == item_id), None)
        if not item:
            # Fallback: try matching by Column A (DB primary key) for backward compatibility
            item = next((i for i in items if int(float(i['A'])) == item_id), None)
        return jsonify(item) if item else ('', 404)
        
    elif request.method == 'PUT':
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400

        app.logger.info(f"Attempting to update item with ID: {item_id}, data: {request.json}")
        updated_item = data_layer.update_item(item_id, request.json)
        if updated_item:
            app.logger.info(f"Successfully updated item {item_id}")
            return jsonify(updated_item)
        else:
            app.logger.warning(f"Failed to update item {item_id} - item not found or update failed")
            return jsonify({"error": f"Item {item_id} not found or update failed"}), 404
        
    elif request.method == 'DELETE':
        success = data_layer.delete_item(item_id)
        return jsonify({"success": success})

# Item ordering
@app.route('/api/items/order', methods=['PUT'])
@require_user_context
def update_items_order():
    """Update item ordering (drag-and-drop support)"""
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400
    
    success = data_layer.update_items_order(request.json)
    return jsonify({"success": success})

# Item notes
@app.route('/api/items/<int:item_id>/notes', methods=['GET', 'POST'])
@require_user_context
def item_notes(item_id):
    """Get or save notes for a specific item"""
    if request.method == 'GET':
        # Retrieve notes for the item
        result = data_layer.get_item_notes(item_id)
        if 'error' in result:
            return jsonify(result), 404
        return jsonify(result)
    
    elif request.method == 'POST':
        # Save notes for the item
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400
        
        data = request.json
        notes = data.get('notes', '')
        
        app.logger.debug(f"DEBUG:save_notes:Received note text: {notes}")
        
        result = data_layer.save_item_notes(item_id, notes)
        if 'error' in result:
            return jsonify(result), 500
        
        return jsonify(result)

# Chord Charts API - Updated to use data layer  
@app.route('/api/items/<int:item_id>/chord-charts', methods=['GET', 'POST'])
@require_user_context
def item_chord_charts(item_id):
    """Handle chord charts for an item"""
    if request.method == 'GET':
        chord_charts = data_layer.get_chord_charts_for_item(item_id)
        return jsonify(chord_charts)
        
    elif request.method == 'POST':
        try:
            if not request.is_json:
                return jsonify({"error": "Request must be JSON"}), 400
                
            chord_data = request.json
            app.logger.info(f"Creating chord chart for item {item_id}")
            result = data_layer.add_chord_chart(item_id, chord_data)
            app.logger.info(f"Successfully created chord chart")
            return jsonify(result)
        except Exception as e:
            app.logger.error(f"Error creating chord chart: {str(e)}", exc_info=True)
            return jsonify({"error": f"Failed to save chord chart: {str(e)}"}), 500

@app.route('/api/chord-charts/<int:chart_id>', methods=['PUT', 'DELETE'])
@require_user_context
def chord_chart(chart_id):
    """Handle individual chord chart operations"""
    if request.method == 'PUT':
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400

        # Debug logging for line break feature
        app.logger.debug(f"[LINE BREAK DEBUG] Received PUT for chart {chart_id}: hasLineBreakAfter={request.json.get('hasLineBreakAfter')}")
        updated_chart = data_layer.update_chord_chart(chart_id, request.json)
        if updated_chart:
            app.logger.debug(f"[LINE BREAK DEBUG] Returning updated chart: hasLineBreakAfter={updated_chart.get('hasLineBreakAfter')}")
        return jsonify(updated_chart) if updated_chart else ('', 404)
        
    elif request.method == 'DELETE':
        success = data_layer.delete_chord_chart(chart_id)
        return jsonify({"success": success})

# Chord chart ordering
@app.route('/api/items/<int:item_id>/chord-charts/order', methods=['PUT'])
@require_user_context
def update_chord_charts_order(item_id):
    """Update chord chart ordering for an item"""
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400
    
    success = data_layer.update_chord_charts_order(item_id, request.json)
    return jsonify({"success": success})

# Item-specific chord chart deletion (supports sharing)
@app.route('/api/items/<int:item_id>/chord-charts/<int:chart_id>', methods=['DELETE'])
@require_user_context
def delete_chord_chart_from_item(item_id, chart_id):
    """Delete a chord chart from a specific item (handles sharing properly)"""
    try:
        success = data_layer.delete_chord_chart_from_item(item_id, chart_id)
        return jsonify({"success": success})
    except Exception as e:
        app.logger.error(f"Error deleting chord chart {chart_id} from item {item_id}: {str(e)}")
        return jsonify({"error": str(e)}), 500

# Batch chord chart operations
@app.route('/api/items/<int:item_id>/chord-charts/batch', methods=['POST'])
@require_user_context
def batch_add_chord_charts(item_id):
    """Create multiple chord charts at once"""
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    chord_charts_data = request.json
    app.logger.info(f"[MANUAL] Batch add chord charts for item {item_id}, received {len(chord_charts_data) if isinstance(chord_charts_data, list) else 'invalid'} charts")
    app.logger.info(f"[MANUAL] Chord charts data: {chord_charts_data}")

    if not isinstance(chord_charts_data, list):
        return jsonify({"error": "Request must be a list of chord charts"}), 400

    results = data_layer.batch_add_chord_charts(item_id, chord_charts_data)
    app.logger.info(f"[MANUAL] Batch add results: {results}")
    return jsonify(results)

@app.route('/api/chord-charts/batch-delete', methods=['POST'])
@require_user_context
def batch_delete_chord_charts():
    """Delete multiple chord charts by IDs in a single transaction."""
    try:
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400
        
        data = request.json
        chord_ids = data.get('chord_ids', [])
        item_id = data.get('item_id')  # Optional item context for sharing-aware deletion

        app.logger.info(f"DEBUG: Received batch delete request - data: {data}")
        app.logger.info(f"DEBUG: chord_ids: {chord_ids}, item_id: {item_id}")

        if not chord_ids:
            return jsonify({"error": "No chord IDs provided"}), 400

        if not isinstance(chord_ids, list):
            return jsonify({"error": "chord_ids must be an array"}), 400

        if item_id:
            app.logger.info(f"Batch deleting chord charts {chord_ids} from item {item_id} (sharing-aware)")
        else:
            app.logger.info(f"Batch deleting chord charts: {chord_ids} (complete deletion)")

        result = data_layer.batch_delete_chord_charts(chord_ids, item_id)
        
        if result['success']:
            app.logger.info(f"Successfully batch deleted {result['deleted_count']} chord charts")
            return jsonify(result)
        else:
            app.logger.error(f"Batch delete failed: {result.get('error', 'Unknown error')}")
            return jsonify(result), 500
            
    except Exception as e:
        app.logger.error(f"Error in batch delete chord charts: {str(e)}", exc_info=True)
        return jsonify({"error": f"Failed to batch delete chord charts: {str(e)}"}), 500

@app.route('/api/chord-charts/batch', methods=['POST'])
@require_user_context
def batch_get_chord_charts():
    """Get chord charts for multiple items in a single request."""
    try:
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400
        
        data = request.json
        item_ids = data.get('item_ids', [])
        
        if not item_ids:
            return jsonify({"error": "No item IDs provided"}), 400
        
        if not isinstance(item_ids, list):
            return jsonify({"error": "item_ids must be an array"}), 400
        
        app.logger.info(f"Batch getting chord charts for items: {item_ids}")
        
        result = data_layer.batch_get_chord_charts(item_ids)
        
        app.logger.info(f"Successfully retrieved chord charts for {len(result)} items")
        return jsonify(result)
            
    except Exception as e:
        app.logger.error(f"Error in batch get chord charts: {str(e)}", exc_info=True)
        return jsonify({"error": f"Failed to batch get chord charts: {str(e)}"}), 500

# YouTube transcript checking
@app.route('/api/youtube/check-transcript', methods=['POST'])
def check_youtube_transcript():
    """Check if a YouTube video has transcripts available"""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        import re

        data = request.get_json()
        youtube_url = data.get('url')

        if not youtube_url:
            return jsonify({"error": "YouTube URL is required"}), 400

        app.logger.info(f"[YOUTUBE] Checking transcript for YouTube URL: {youtube_url}")

        # Extract video ID from YouTube URL
        video_id = extract_youtube_video_id(youtube_url)
        if not video_id:
            app.logger.error(f"[YOUTUBE] Invalid YouTube URL format: {youtube_url}")
            return jsonify({"error": "Invalid YouTube URL format"}), 400

        app.logger.info(f"[YOUTUBE] Extracted video ID: {video_id}")

        try:
            # Check if transcripts are available using 2025 API syntax
            app.logger.info(f"[YOUTUBE] Attempting to get transcript for video ID: {video_id}")
            ytt_api = YouTubeTranscriptApi()
            transcript_data = ytt_api.fetch(video_id)
            app.logger.info(f"[YOUTUBE] Successfully got transcript for video ID: {video_id}")

            # Extract text from transcript snippets
            snippets = transcript_data.snippets
            full_transcript = ' '.join([snippet.text for snippet in snippets])

            app.logger.info(f"[YOUTUBE] Successfully extracted transcript for video ID: {video_id}, length: {len(full_transcript)} characters, snippets: {len(snippets)}")

            return jsonify({
                "hasTranscript": True,
                "transcript": full_transcript
            })

        except Exception as transcript_error:
            app.logger.error(f"[YOUTUBE] No transcripts available for video ID {video_id}: {str(transcript_error)}")
            return jsonify({
                "hasTranscript": False,
                "transcript": None
            })

    except Exception as e:
        app.logger.error(f"Error checking YouTube transcript: {str(e)}", exc_info=True)
        return jsonify({"error": f"Failed to check YouTube transcript: {str(e)}"}), 500

def extract_youtube_video_id(url):
    """Extract video ID from various YouTube URL formats"""
    import re

    # Regular expression patterns for different YouTube URL formats
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})',
        r'youtube\.com\/watch\?.*?v=([a-zA-Z0-9_-]{11})',
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)

    return None

# Helper function for API key selection
def _get_autocreate_api_key():
    """
    Get the appropriate Anthropic API key for autocreate.

    Priority:
    1. User's own API key (if configured) - "Bring Your Own Claude"
    2. System API key (if user's tier includes autocreate)
    3. None (if neither available)

    Returns:
        tuple: (api_key, is_using_own_key, tier, is_complimentary)
        - api_key: str or None - API key to use
        - is_using_own_key: bool - True if using user's own key (byoClaude)
        - tier: str - User's subscription tier
        - is_complimentary: bool - Whether user has complimentary access
    """
    if not current_user.is_authenticated:
        return (None, False, 'free', False)

    tier = 'free'
    is_complimentary = False

    # First, get user's subscription info
    try:
        from app.database import SessionLocal
        from sqlalchemy import text

        db = SessionLocal()
        try:
            result = db.execute(text("""
                SELECT s.tier, s.is_complimentary
                FROM subscriptions s
                WHERE s.user_id = :user_id
                AND s.status = 'active'
            """), {'user_id': current_user.id}).fetchone()

            if result:
                tier = result[0]
                is_complimentary = result[1] if result else False
        finally:
            db.close()
    except Exception as e:
        app.logger.error(f"Error checking subscription tier: {e}")

    # Try to get user's own API key
    try:
        from app.database import SessionLocal
        from app.utils.encryption import decrypt_api_key
        from sqlalchemy import text

        db = SessionLocal()
        try:
            result = db.execute(text("""
                SELECT encrypted_anthropic_api_key
                FROM ab_user
                WHERE id = :user_id
            """), {'user_id': current_user.id}).fetchone()

            if result and result[0]:
                user_key = decrypt_api_key(result[0])
                if user_key:
                    app.logger.info(f"[AUTOCREATE] Using user's own API key (byoClaude)")
                    return (user_key, True, tier, is_complimentary)
        finally:
            db.close()
    except Exception as e:
        app.logger.error(f"Error retrieving user API key: {e}")

    # If no user key, check if user's subscription tier includes autocreate
    try:
        from app.subscription_tiers import is_feature_enabled

        if is_feature_enabled(tier, 'autocreate', is_complimentary):
            # Tier includes autocreate, use system key
            system_key = os.getenv('ANTHROPIC_API_KEY')
            if system_key:
                app.logger.info(f"[AUTOCREATE] Using system API key for {tier} tier user")
                return (system_key, False, tier, is_complimentary)
    except Exception as e:
        app.logger.error(f"Error checking feature availability: {e}")

    return (None, False, tier, is_complimentary)

# AI chord chart creation
@app.route('/api/autocreate-chord-charts', methods=['POST'])
def autocreate_chord_charts():
    """Autocreate chord charts from uploaded PDF/image files using Claude"""
    try:
        app.logger.debug("Starting autocreate chord charts process")
        
        # Check if files were uploaded (frontend sends as file0, file1, etc.)
        # Use request.files.values() to get all files regardless of key names
        files_list = list(request.files.values())
        if not files_list:
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
            from werkzeug.utils import secure_filename
            import magic

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

            # Determine file type from extension
            file_ext = filename.lower().split('.')[-1] if '.' in filename else ''

            # Reject suspiciously small files (likely corrupt) - but allow short text files for manual chord input
            is_text_file = file_ext in ['txt'] or filename in ['youtube_transcript.txt', 'manual-input.txt']
            if file_size < 50 and not is_text_file:  # Less than 50 bytes is suspicious for PDFs/images
                return {'error': f'File {filename} is too small to be valid'}

            # Verify file type with magic number (file signature) to prevent extension spoofing
            try:
                mime_type = magic.from_buffer(file_data, mime=True)
                app.logger.debug(f"File {filename} detected MIME type: {mime_type}")
            except Exception as e:
                app.logger.warning(f"Could not detect MIME type for {filename}: {e}")
                # Continue with extension-based detection as fallback
                mime_type = None

            # Validate file type matches extension
            if file_ext == 'pdf':
                if mime_type and mime_type != 'application/pdf':
                    return {'error': f'File {filename} claims to be PDF but appears to be {mime_type}'}
                return {
                    'name': filename,
                    'type': 'pdf',
                    'data': base64.b64encode(file_data).decode('utf-8')
                }
            elif file_ext in ['png', 'jpg', 'jpeg']:
                if mime_type and not mime_type.startswith('image/'):
                    return {'error': f'File {filename} claims to be image but appears to be {mime_type}'}
                return {
                    'name': filename,
                    'type': 'image',
                    'data': base64.b64encode(file_data).decode('utf-8'),
                    'media_type': f'image/{file_ext if file_ext != "jpg" else "jpeg"}'
                }
            elif file_ext in ['txt'] or filename == 'youtube_transcript.txt':
                if mime_type and not mime_type.startswith('text/'):
                    return {'error': f'File {filename} claims to be text but appears to be {mime_type}'}
                # Handle text files (including YouTube transcripts) as chord_names
                return {
                    'name': filename,
                    'type': 'chord_names',
                    'data': file_data.decode('utf-8')  # Store as text, not base64
                }
            else:
                return {'error': f'Unsupported file type: {file_ext}'}
        
        # Process single uploaded file only (simplified approach)
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
            
        # Read effort level for visual analysis (low/medium/high)
        effort_level = request.form.get('effortLevel', 'medium')
        if effort_level not in ('low', 'medium', 'high'):
            effort_level = 'medium'

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
            
        # Get Anthropic API key (user's key if available, otherwise system key)
        api_key, is_using_own_key, tier, is_complimentary = _get_autocreate_api_key()
        if not api_key:
            # Free/Dollar Store/Basic users need their own key, Standard+ can use system key
            if tier in ['free', 'dollarstore', 'basic']:
                return jsonify({
                    'error': 'Autocreate requires an API key. Please add your Anthropic API key in Account Settings.',
                    'requires_api_key': True
                }), 403
            else:
                return jsonify({'error': 'Anthropic API key not configured'}), 500

        # Get user_id for rate limiting and analytics
        user_id = current_user.id if current_user.is_authenticated else None

        # Check rate limits (byoClaude users are exempt)
        from app.utils.rate_limits import (
            check_autocreate_rate_limit,
            increment_autocreate_usage,
            get_autocreate_usage_info,
            AUTOCREATE_RATE_LIMITS
        )

        allowed, reason, remaining_daily, remaining_hourly, daily_resets_at, hourly_resets_at = \
            check_autocreate_rate_limit(user_id, tier, is_complimentary, is_using_own_key)

        if not allowed:
            app.logger.warning(f"[AUTOCREATE] Rate limit exceeded for user {user_id}: {reason}")
            # Get usage info for the response
            usage_info = get_autocreate_usage_info(user_id, tier, is_complimentary)
            return jsonify({
                'error': 'Rate limit exceeded',
                'message': reason,
                'limits': {
                    'daily_used': usage_info['daily_used'],
                    'daily_limit': usage_info['daily_limit'],
                    'hourly_used': usage_info['hourly_used'],
                    'hourly_limit': usage_info['hourly_limit'],
                    'daily_resets_at': daily_resets_at,
                    'hourly_resets_at': hourly_resets_at,
                }
            }), 429

        # Initialize Anthropic client; $ai_generation events are tracked
        # manually via llm_analytics (auto-instrumentation intentionally off)
        from app.utils.llm_analytics import track_llm_generation, track_llm_span
        from app.utils.posthog_client import create_anthropic_client

        client = create_anthropic_client(api_key, user_id=user_id)
        app.logger.info(f"[AUTOCREATE] Anthropic client initialized successfully")

        # Prepare the Claude analysis request
        app.logger.info(f"[AUTOCREATE] Starting Claude analysis for item {item_id}")
        app.logger.debug("Sending files to Claude for analysis")

        # Process with simplified autocreate logic
        analysis_result = analyze_files_with_claude(client, uploaded_files, item_id, user_id, effort_level=effort_level)
        app.logger.info(f"[AUTOCREATE] Claude analysis completed, result type: {type(analysis_result)}")

        # Increment usage counter after successful API call (only for non-byoClaude users)
        if not is_using_own_key:
            increment_autocreate_usage(user_id)
            app.logger.info(f"[AUTOCREATE] Usage counter incremented for user {user_id}")

        if 'error' in analysis_result:
            app.logger.info(f"[AUTOCREATE] Claude analysis returned error: {str(analysis_result.get('error', ''))[:100]}")
            return jsonify(analysis_result), 422
        else:
            app.logger.debug("Claude analysis complete, creating chord charts")

        return jsonify(analysis_result)

    except Exception as e:
        # Log full error details for debugging
        import traceback
        app.logger.error(f"Error in autocreate chord charts: {str(e)}")
        app.logger.error(f"Traceback: {traceback.format_exc()}")

        # Return user-friendly error message (avoid exposing internals)
        error_msg = "Failed to process chord charts. Please check the logs for details."

        # Provide more specific guidance for common errors
        if "Anthropic" in str(e) or "API" in str(e):
            error_msg = "API connection error. Please check your ANTHROPIC_API_KEY in .env file."
        elif "pdf2image" in str(e) or "pytesseract" in str(e):
            error_msg = "Failed to process file. The file may be corrupt or in an unsupported format."
        elif "rate_limit" in str(e).lower() or "429" in str(e):
            error_msg = "API rate limit exceeded. Please wait a moment and try again."

        return jsonify({'error': error_msg}), 500

# System status and migration utilities
@app.route('/api/system/status', methods=['GET'])
def system_status():
    """Get current system status and data layer information"""
    return jsonify({
        "data_layer": data_layer.get_mode_info(),
        "stats": data_layer.get_stats()
    })

@app.route('/api/migration/switch/<mode>', methods=['POST'])
def switch_mode(mode):
    """Switch data layer mode (for testing)"""
    if mode not in ['sheets', 'postgres']:
        return jsonify({"error": "Invalid mode. Use 'sheets' or 'postgres'"}), 400
    
    # This would require restarting the app or dynamic configuration
    # For now, just return current status
    return jsonify({
        "message": f"To switch to {mode} mode, set MIGRATION_MODE={mode} in .env and restart",
        "current_mode": data_layer.mode
    })

# Health check
@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        stats = data_layer.get_stats()
        return jsonify({
            "status": "healthy",
            "data_source": stats.get('data_source', 'unknown'),
            "total_items": stats.get('total_items', 0)
        })
    except Exception as e:
        return jsonify({
            "status": "unhealthy",
            "error": str(e)
        }), 500

# Cookie Consent routes (GDPR/CPRA compliance)
@app.route('/api/csrf-token', methods=['GET'])
@limiter.limit("20 per minute")  # Generous limit for token requests
def get_csrf_token():
    """
    Get CSRF token for protecting API requests.
    Returns: {'csrf_token': '<token>'}
    """
    from flask_wtf.csrf import generate_csrf
    return jsonify({'csrf_token': generate_csrf()})

@app.route('/api/consent', methods=['GET'])
@limiter.limit("30 per minute")  # Allow frequent consent checks
def get_consent():
    """
    Get user's cookie consent preference from server-side session.
    Returns: {'consent': 'all' | 'essential' | null}
    """
    consent = session.get('cookie_consent', None)
    return jsonify({'consent': consent})

@app.route('/api/consent', methods=['POST'])
@limiter.limit("10 per minute")  # Limit consent changes to prevent abuse
def set_consent():
    """
    Store user's cookie consent preference in server-side session.
    Expects: {'consent': 'all' | 'essential'}

    Session cookie is set with domain awareness for multi-domain support:
    - localhost/127.0.0.1: Works within same origin
    - Production: Set domain to TLD family (e.g., .guitarpracticeroutine.com)
    """
    csrf.protect()  # Explicitly require CSRF token for consent changes
    data = request.get_json()
    consent = data.get('consent')

    # Validate consent value
    if consent not in ['all', 'essential']:
        return jsonify({'error': 'Invalid consent value. Must be "all" or "essential"'}), 400

    # Store in session
    session['cookie_consent'] = consent
    session.permanent = True  # Make session persistent (24 hours from app config)

    # Configure session cookie domain for multi-domain support
    # Flask automatically handles domain based on SERVER_NAME config
    # No need to manually set domain here - Flask handles it

    return jsonify({'success': True, 'consent': consent})

# Authentication routes
@app.route('/api/auth/status', methods=['GET'])
def auth_status():
    """Check authentication status - now uses Flask-AppBuilder auth"""
    # Check if user is authenticated via Flask-AppBuilder
    if current_user.is_authenticated:
        # Get user's subscription tier and billing period
        tier = 'free'  # Default
        actual_tier = 'free'  # Actual tier before unplugged override
        billing_period = None  # Default for free tier
        is_lapsed = False
        unplugged_mode = False
        days_remaining = None
        days_until_90 = None  # Visible countdown (90 days)
        lapse_date = None
        deletion_scheduled_for = None
        deletion_type = None
        prorated_refund_amount = None

        try:
            from datetime import datetime, timedelta, timezone
            with DatabaseTransaction() as tx:
                result = tx.execute(text("""
                    SELECT tier, stripe_price_id, status, current_period_end,
                           lapse_date, unplugged_mode, data_deletion_date,
                           deletion_scheduled_for, deletion_type, prorated_refund_amount
                    FROM subscriptions
                    WHERE user_id = :user_id
                """), {"user_id": current_user.id})
                sub_row = result.fetchone()
                if sub_row:
                    tier = sub_row[0]
                    actual_tier = tier  # Store original tier before unplugged override
                    stripe_price_id = sub_row[1]
                    status = sub_row[2]
                    current_period_end = sub_row[3]
                    stored_lapse_date = sub_row[4]
                    unplugged_mode = sub_row[5] or False
                    data_deletion_date = sub_row[6]
                    deletion_scheduled_for = sub_row[7]
                    deletion_type = sub_row[8]
                    prorated_refund_amount = float(sub_row[9]) if sub_row[9] else None

                    # CRITICAL: If user is in unplugged mode, show them as Free tier
                    # They've canceled/paused, so they should see Free tier pricing
                    if unplugged_mode:
                        tier = 'free'
                        billing_period = None  # Free tier has no billing period

                    # Determine billing period from price ID (skip if unplugged)
                    if stripe_price_id and not unplugged_mode:
                        # Import here to avoid circular imports
                        from app.subscription_tiers import SUBSCRIPTION_TIERS
                        for tier_key, tier_config in SUBSCRIPTION_TIERS.items():
                            if stripe_price_id == tier_config.get('stripe_price_id_monthly'):
                                billing_period = 'monthly'
                                break
                            elif stripe_price_id == tier_config.get('stripe_price_id_yearly'):
                                billing_period = 'yearly'
                                break

                    # Check if subscription is lapsed
                    if status in ['canceled', 'past_due', 'unpaid']:
                        is_lapsed = True

                        # Set lapse_date if not already set
                        if not stored_lapse_date:
                            lapse_date = current_period_end or datetime.now(timezone.utc)
                            deletion_date = lapse_date + timedelta(days=120)

                            tx.execute(text("""
                                UPDATE subscriptions
                                SET lapse_date = :lapse_date,
                                    data_deletion_date = :deletion_date
                                WHERE user_id = :user_id
                            """), {
                                "user_id": current_user.id,
                                "lapse_date": lapse_date,
                                "deletion_date": deletion_date
                            })
                            tx.commit()
                        else:
                            lapse_date = stored_lapse_date

                        # Calculate days remaining until deletion (90 days from lapse_date - NO SECRET BUFFER)
                        if data_deletion_date:
                            days_remaining = (data_deletion_date - datetime.now(timezone.utc)).days

                            # If past deletion date, could trigger data deletion here
                            if days_remaining < 0:
                                app.logger.warning(f"User {current_user.id} subscription data deletion date passed ({days_remaining} days ago)")
                                # TODO: Trigger data deletion (create separate endpoint/task for this)

                        # Calculate days until 90-day deadline (user sees 90, gets 90)
                        # NO secret buffer - removed per user feedback
                        days_until_90 = None
                        if lapse_date:
                            ninety_day_mark = lapse_date + timedelta(days=90)
                            days_until_90 = max(0, (ninety_day_mark - datetime.now(timezone.utc)).days)

                    # ALSO calculate days for manually paused users (unplugged_mode = True)
                    # These users might still have status='active' but clicked "Pause subscription"
                    elif unplugged_mode and stored_lapse_date and data_deletion_date:
                        # User is in unplugged mode (paused manually or canceled via portal)
                        lapse_date = stored_lapse_date

                        # Calculate days remaining until deletion
                        days_remaining = max(0, (data_deletion_date - datetime.now(timezone.utc)).days)

                        # Calculate days until 90-day deadline (same as days_remaining for unplugged users)
                        ninety_day_mark = lapse_date + timedelta(days=90)
                        days_until_90 = max(0, (ninety_day_mark - datetime.now(timezone.utc)).days)

                        app.logger.info(f"User {current_user.id} in unplugged mode: {days_remaining} days remaining until deletion")

        except Exception as e:
            app.logger.error(f"Failed to fetch subscription tier: {e}")

        # Check if user has OAuth providers connected
        # Detection based on known patterns from security.py oauth_user_info()
        oauth_providers = []
        username = current_user.username or ''
        email = current_user.email or ''

        # Tidal OAuth: username pattern is 'tidal_{user_id}'
        if username.startswith('tidal_'):
            oauth_providers.append('tidal')

        # Google OAuth: user has password field as None or empty (OAuth-only account)
        # Since we can't easily check password hash, use heuristics:
        # - Email from real domain (not placeholder)
        # - Username doesn't match Tidal pattern
        # For better detection, check if user created_by matches OAuth pattern
        # Actually, for Google OAuth users we don't have a clear marker in the current schema
        # So we'll use a different approach: users who have a real email but no password set
        # are likely OAuth users. We can check this by looking at the password field.
        if not username.startswith('tidal_'):
            # Check if this user was created via Google OAuth
            # Google OAuth users don't have a local password set
            from app import appbuilder
            user_record = appbuilder.sm.find_user(username=current_user.username)
            if user_record:
                # If password is None or an empty hash, user is likely OAuth-only
                has_password = user_record.password and len(user_record.password) > 10
                # Also check email domain - Google users have Gmail or Google Workspace emails
                if not has_password:
                    oauth_providers.append('google')

        # Compute PostHog distinct_id (email or tidalNNNNN for Tidal users)
        from app.utils.posthog_client import get_posthog_distinct_id, get_posthog_identity_hash
        posthog_distinct_id = get_posthog_distinct_id(current_user.id, current_user.email)
        posthog_identity_hash = get_posthog_identity_hash(posthog_distinct_id)

        # Compute autocreate access: tier-gated OR user has their own API key (byoClaude)
        autocreate_enabled = False
        has_anthropic_api_key = False
        try:
            from app.subscription_tiers import SUBSCRIPTION_TIERS
            tier_config = SUBSCRIPTION_TIERS.get(tier, {})
            tier_has_autocreate = bool(tier_config.get('autocreate_enabled', False))

            with DatabaseTransaction() as tx_key:
                key_row = tx_key.execute(text("""
                    SELECT encrypted_anthropic_api_key IS NOT NULL AS has_key
                    FROM ab_user
                    WHERE id = :user_id
                """), {"user_id": current_user.id}).fetchone()
                has_anthropic_api_key = bool(key_row and key_row[0])

            autocreate_enabled = tier_has_autocreate or has_anthropic_api_key
        except Exception as e:
            app.logger.error(f"Error computing autocreate access for user {current_user.id}: {e}")

        # Check for active impersonation session
        is_impersonating = bool(session.get('original_admin_id'))
        original_admin_username = None
        if is_impersonating:
            try:
                from app import appbuilder
                admin_user = appbuilder.sm.get_user_by_id(session['original_admin_id'])
                original_admin_username = admin_user.username if admin_user else None
            except Exception as e:
                app.logger.error(f"Failed to look up original admin user: {e}")

        return jsonify({
            "authenticated": True,
            "hasSpreadsheetAccess": True,  # Always true for authenticated users
            "user": current_user.username,
            "user_id": current_user.id,  # Integer user ID for backend reference
            "email": current_user.email,
            "posthog_distinct_id": posthog_distinct_id,  # Coordinated distinct_id for PostHog
            "posthog_identity_hash": posthog_identity_hash,  # HMAC for support widget identity verification (None if not configured)
            "tier": tier,
            "actual_tier": actual_tier,  # Actual tier before unplugged override
            "billing_period": billing_period,
            "oauth_providers": oauth_providers,
            "is_lapsed": is_lapsed,
            "unplugged_mode": unplugged_mode,
            "days_remaining": days_remaining,  # Days until deletion (90 days - no secret buffer)
            "days_until_90": days_until_90,  # Days until 90-day deadline (same as days_remaining)
            "lapse_date": lapse_date.isoformat() if lapse_date else None,
            "deletion_scheduled_for": deletion_scheduled_for.isoformat() if deletion_scheduled_for else None,
            "deletion_type": deletion_type,
            "prorated_refund_amount": prorated_refund_amount,
            "impersonating": is_impersonating,
            "original_admin_username": original_admin_username,
            "autocreate_enabled": autocreate_enabled,
            "has_anthropic_api_key": has_anthropic_api_key,
            "mode": "flask-appbuilder"
        })
    else:
        return jsonify({
            "authenticated": False,
            "hasSpreadsheetAccess": False,
            "mode": "flask-appbuilder"
        })

# Admin impersonation routes
@app.route('/admin/impersonate/<int:user_id>')
@limiter.limit("10 per minute")
def admin_impersonate_start(user_id):
    """
    Start admin impersonation - generates a short-lived token and redirects to activation URL.

    Only accessible to authenticated users with the Admin role.
    Cannot impersonate yourself.

    Args:
        user_id: Target user's database ID to impersonate
    """
    if not current_user.is_authenticated:
        return redirect('/login')

    # Verify current user has Admin role
    admin_role_names = [role.name for role in current_user.roles]
    if 'Admin' not in admin_role_names:
        app.logger.warning(f"Non-admin user {current_user.username} (id={current_user.id}) attempted impersonation")
        return jsonify({"error": "Admin access required"}), 403

    # Cannot impersonate yourself
    if current_user.id == user_id:
        app.logger.warning(f"Admin {current_user.username} attempted to impersonate themselves")
        return redirect('/admin/users/list/')

    # Verify target user exists
    from app import appbuilder
    target_user = appbuilder.sm.get_user_by_id(user_id)
    if not target_user:
        app.logger.warning(f"Admin {current_user.username} tried to impersonate non-existent user_id={user_id}")
        return jsonify({"error": "User not found"}), 404

    # Generate short-lived impersonation token
    from app.impersonation import generate_impersonation_token
    token = generate_impersonation_token(current_user.id, user_id)

    app.logger.info(f"Admin {current_user.username} (id={current_user.id}) initiating impersonation of user {target_user.username} (id={user_id})")

    return redirect(url_for('admin_impersonate_activate', token=token))


@app.route('/admin/impersonate/activate/<token>')
@limiter.limit("10 per minute")
def admin_impersonate_activate(token):
    """
    Activate admin impersonation using a validated token.

    Validates the token, verifies admin still has Admin role, logs in as the target user,
    and stores impersonation state in the session.

    Args:
        token: Cryptographically signed impersonation token
    """
    from app.impersonation import validate_impersonation_token
    from itsdangerous import SignatureExpired, BadSignature
    from flask_login import login_user

    try:
        payload = validate_impersonation_token(token)
    except SignatureExpired:
        app.logger.warning(f"Expired impersonation token used")
        return redirect('/admin/users/list/')
    except BadSignature:
        app.logger.warning(f"Invalid impersonation token used")
        return redirect('/admin/users/list/')

    admin_user_id = payload['admin_user_id']
    target_user_id = payload['target_user_id']

    # Verify admin user still has Admin role
    from app import appbuilder
    admin_user = appbuilder.sm.get_user_by_id(admin_user_id)
    if not admin_user:
        app.logger.warning(f"Admin user_id={admin_user_id} not found during impersonation activation")
        return redirect('/admin/users/list/')

    admin_role_names = [role.name for role in admin_user.roles]
    if 'Admin' not in admin_role_names:
        app.logger.warning(f"User {admin_user.username} (id={admin_user_id}) no longer has Admin role during impersonation")
        return redirect('/admin/users/list/')

    # Look up target user
    target_user = appbuilder.sm.get_user_by_id(target_user_id)
    if not target_user:
        app.logger.warning(f"Target user_id={target_user_id} not found during impersonation activation")
        return redirect('/admin/users/list/')

    # Store impersonation state in session before switching users
    session['original_admin_id'] = admin_user_id
    session['impersonating_as'] = target_user.username

    # Log in as the target user (remember=False for security)
    login_user(target_user, remember=False)

    app.logger.info(f"Admin {admin_user.username} (id={admin_user_id}) now impersonating {target_user.username} (id={target_user_id})")

    # Track impersonation event in PostHog
    from app.utils.posthog_client import track_event, get_client_ip
    track_event(admin_user_id, 'admin_impersonation_started', {
        'admin_user_id': admin_user_id,
        'admin_username': admin_user.username,
        'target_user_id': target_user_id,
        'target_username': target_user.username
    }, ip=get_client_ip())

    return redirect('/')


@app.route('/admin/impersonate/stop')
@limiter.limit("10 per minute")
def admin_impersonate_stop():
    """
    Stop admin impersonation and return to the original admin session.

    Checks for impersonation state in the session, logs back in as the admin user,
    clears impersonation keys from session, and redirects to admin user list.
    """
    if not current_user.is_authenticated:
        return redirect('/login')

    original_admin_id = session.get('original_admin_id')
    if not original_admin_id:
        app.logger.warning(f"Stop impersonation called but no impersonation session found for user {current_user.username}")
        return redirect('/')

    # Look up the original admin user
    from app import appbuilder
    from flask_login import login_user

    admin_user = appbuilder.sm.get_user_by_id(original_admin_id)
    if not admin_user:
        app.logger.error(f"Original admin user_id={original_admin_id} not found when stopping impersonation")
        # Clear impersonation state and redirect to login as safety measure
        session.pop('original_admin_id', None)
        session.pop('impersonating_as', None)
        return redirect('/login')

    impersonated_username = session.get('impersonating_as', 'unknown')

    # Log back in as the admin user
    login_user(admin_user, remember=False)

    # Clear impersonation keys from session
    session.pop('original_admin_id', None)
    session.pop('impersonating_as', None)

    app.logger.info(f"Admin {admin_user.username} (id={original_admin_id}) stopped impersonating {impersonated_username}")

    # Track impersonation stop event in PostHog
    from app.utils.posthog_client import track_event, get_client_ip
    track_event(original_admin_id, 'admin_impersonation_stopped', {
        'admin_user_id': original_admin_id,
        'admin_username': admin_user.username,
        'impersonated_username': impersonated_username
    }, ip=get_client_ip())

    return redirect('/users/list/')


@app.route('/api/auth/login', methods=['POST'])
def api_login():
    """
    API login endpoint for custom React login page.

    Authenticates user with Flask-AppBuilder's security manager.

    Request body:
        {
            "emailOrUsername": "user@example.com or username",
            "password": "password123",
            "recaptcha_token": "token_string" (optional)
        }

    Returns:
        {
            "success": true,
            "message": "Login successful",
            "user": {
                "username": "username",
                "email": "user@example.com"
            }
        }
    """
    from flask_login import login_user
    from app import appbuilder

    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    data = request.json
    email_or_username = data.get('emailOrUsername', '').strip()
    password = data.get('password', '')

    if not email_or_username or not password:
        return jsonify({"error": "Email/username and password are required"}), 400

    # Verify reCAPTCHA if token provided
    recaptcha_token = data.get('recaptcha_token', '')
    if recaptcha_token:
        try:
            import requests as http_requests
            api_key = os.getenv('RECAPTCHA_API_KEY')

            if api_key:
                verify_url = f"https://recaptchaenterprise.googleapis.com/v1/projects/practiceroutineapp/assessments?key={api_key}"
                payload = {
                    "event": {
                        "token": recaptcha_token,
                        "expectedAction": "login",
                        "siteKey": "6LcaNhssAAAAABV70hE2Sw6_CwxBQf3sf-1_xiMl"
                    }
                }

                # Include Referer header to satisfy GCP API key restrictions
                headers = {'Referer': request.url_root}
                verify_response = http_requests.post(verify_url, json=payload, headers=headers, timeout=10)
                recaptcha_data = verify_response.json()

                token_valid = recaptcha_data.get('tokenProperties', {}).get('valid', False)
                action_match = recaptcha_data.get('tokenProperties', {}).get('action') == 'login'
                score = recaptcha_data.get('riskAnalysis', {}).get('score', 0)

                app.logger.info(f"Login reCAPTCHA - valid: {token_valid}, action: {action_match}, score: {score}")

                if token_valid and action_match and score < 0.3:
                    # Very suspicious - block
                    from app.utils.posthog_client import track_event, get_client_ip
                    track_event(None, 'recaptcha_failed', {
                        'action': 'login',
                        'score': score,
                        'reason': 'low_score'
                    }, ip=get_client_ip())
                    return jsonify({"error": "Security verification failed. Please try again."}), 403
        except Exception as e:
            app.logger.warning(f"reCAPTCHA verification error (non-blocking): {e}")
            # Don't block login on reCAPTCHA errors - fail open for availability

    # Try to find user by email first, then by username
    user = appbuilder.sm.find_user(email=email_or_username)

    if not user:
        # Try finding by username
        user = appbuilder.sm.find_user(username=email_or_username)

    if not user:
        app.logger.warning(f"Login attempt for non-existent user: {email_or_username}")
        # Note: This event will be skipped by track_event() since there's no user_id
        # Failed logins for non-existent users are logged server-side only
        from app.utils.posthog_client import track_event, get_client_ip
        track_event(None, 'user_login_failed', {
            'login_method': 'email',
            'failure_reason': 'user_not_found'
        }, ip=get_client_ip())
        return jsonify({
            "error": "No account found for that email or username.",
            "reason": "no_account",
            "signup_url": "/signup"
        }), 401

    # OAuth-only users have password=NULL — direct them to the right OAuth flow
    # rather than failing as "invalid password"
    if user.password is None:
        provider = 'tidal' if (user.username or '').startswith('tidal_') else 'google'
        app.logger.info(f"Password login attempted on OAuth-only account: {user.username} (provider={provider})")
        from app.utils.posthog_client import track_event, get_client_ip
        track_event(user.id, 'user_login_failed', {
            'login_method': 'email',
            'failure_reason': 'oauth_only',
            'oauth_provider': provider
        }, ip=get_client_ip())
        return jsonify({
            "error": f"This account uses {provider.capitalize()} sign-in.",
            "reason": "oauth_only",
            "provider": provider,
            "oauth_url": f"/login/{provider}"
        }), 401

    # Check password using Flask-AppBuilder's security manager
    # check_password expects (hashed_password, plaintext_password)
    from werkzeug.security import check_password_hash
    if not check_password_hash(user.password, password):
        app.logger.warning(f"Invalid password for user: {email_or_username}")
        # Track failed login
        from app.utils.posthog_client import track_event, get_client_ip
        track_event(user.id, 'user_login_failed', {
            'login_method': 'email',
            'failure_reason': 'invalid_password'
        }, ip=get_client_ip())
        return jsonify({"error": "Invalid email/username or password"}), 401

    # Login successful - create Flask-Login session
    login_user(user, remember=False)
    app.logger.info(f"User logged in via API: {user.username} ({user.email})")

    # Track login event
    from app.utils.posthog_client import track_event, get_client_ip
    client_ip = get_client_ip()
    track_event(user.id, 'user_logged_in', {
        'login_method': 'email',
        'oauth_provider': None,
        # Backfill identity person properties for pre-existing users and keep
        # them fresh after email/username changes.
        '$set': {'email': user.email, 'username': user.username}
    }, ip=client_ip)

    # Track reCAPTCHA event if token was provided
    if recaptcha_token:
        recaptcha_score = recaptcha_data.get('riskAnalysis', {}).get('score', 0) if 'recaptcha_data' in locals() else None
        track_event(user.id, 'recaptcha_passed', {
            'action': 'login',
            'score': recaptcha_score
        }, ip=client_ip)

    return jsonify({
        "success": True,
        "message": "Login successful",
        "user": {
            "username": user.username,
            "email": user.email
        }
    })

@app.route('/api/auth/register', methods=['POST'])
def api_register():
    """
    API registration endpoint for custom React register page.

    Creates new user with Flask-AppBuilder's security manager and automatically logs them in.

    Request body:
        {
            "username": "johndoe",
            "email": "john@example.com",
            "password": "SecurePass123!"
        }

    Returns:
        {
            "success": true,
            "message": "User registered successfully"
        }
    """
    from app import appbuilder
    from flask_login import login_user

    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    data = request.json
    username = data.get('username', '').strip()
    email = data.get('email', '').strip()
    password = data.get('password', '')
    recaptcha_token = data.get('recaptcha_token', '')

    # Verify reCAPTCHA
    if not recaptcha_token:
        return jsonify({"error": "reCAPTCHA verification required"}), 400

    try:
        import requests
        recaptcha_api_key = os.getenv('RECAPTCHA_API_KEY')

        if not recaptcha_api_key:
            app.logger.error("RECAPTCHA_API_KEY not configured")
            return jsonify({"error": "Registration not available"}), 500

        # Verify token with reCAPTCHA Enterprise API
        # Note: No expectedAction for checkbox widgets (they don't use actions like execute() does)
        verify_url = f"https://recaptchaenterprise.googleapis.com/v1/projects/practiceroutineapp/assessments?key={recaptcha_api_key}"
        verify_payload = {
            "event": {
                "token": recaptcha_token,
                "siteKey": "6LcjIvQrAAAAAM4psu6wJT3NlL8RIwH4tNiiAJ6C"
            }
        }

        # Include Referer header to satisfy GCP API key restrictions
        referer_value = request.url_root
        if app.debug:
            app.logger.info(f"reCAPTCHA verification using Referer: {referer_value}")
        headers = {'Referer': referer_value}
        verify_response = requests.post(
            verify_url,
            json=verify_payload,
            headers=headers,
            timeout=10
        )

        verify_data = verify_response.json()

        # Check for API errors
        if 'error' in verify_data:
            app.logger.error(f"reCAPTCHA API error: {verify_data.get('error')}")
            return jsonify({"error": "reCAPTCHA verification failed. Please try again."}), 500

        # Validate token properties
        token_props = verify_data.get('tokenProperties', {})
        if not token_props.get('valid'):
            app.logger.warning(f"reCAPTCHA token invalid: {verify_data}")
            return jsonify({"error": "reCAPTCHA verification failed. Please try again."}), 400

        # Log the action (checkbox widgets may return different actions than execute() calls)
        action = token_props.get('action', 'unknown')
        app.logger.info(f"reCAPTCHA action: {action}")

        # Check risk score (0.0-1.0, higher = more likely human)
        risk_score = verify_data.get('riskAnalysis', {}).get('score', 0.0)
        app.logger.info(f"reCAPTCHA verification successful - score: {risk_score}")

        # Reject if score is too low (likely bot)
        if risk_score < 0.5:
            app.logger.warning(f"reCAPTCHA score too low: {risk_score} (threshold: 0.5)")
            from app.utils.posthog_client import track_event, get_client_ip
            track_event(None, 'recaptcha_failed', {
                'action': 'register',
                'score': risk_score,
                'reason': 'low_score'
            }, ip=get_client_ip())
            return jsonify({"error": "reCAPTCHA verification failed. Please try again."}), 400

    except Exception as e:
        app.logger.error(f"reCAPTCHA verification error: {e}")
        from app.utils.posthog_client import track_event, get_client_ip
        track_event(None, 'recaptcha_failed', {
            'action': 'register',
            'score': None,
            'reason': 'api_error'
        }, ip=get_client_ip())
        return jsonify({"error": "Unable to verify reCAPTCHA. Please try again."}), 500

    # Validate inputs
    if not username or not email or not password:
        return jsonify({"error": "Username, email, and password are required"}), 400

    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters long"}), 400

    # Check if user already exists
    if appbuilder.sm.find_user(username=username):
        return jsonify({"error": "Username already exists"}), 409

    if appbuilder.sm.find_user(email=email):
        return jsonify({"error": "Email already registered"}), 409

    # Get the Public role for new users
    role = appbuilder.sm.find_role(appbuilder.sm.auth_user_registration_role)

    if not role:
        app.logger.error("Public role not found - cannot register user")
        return jsonify({"error": "Registration not available"}), 500

    # Create user with Flask-AppBuilder
    try:
        user = appbuilder.sm.add_user(
            username=username,
            first_name=username,  # Use username as first name if not provided
            last_name='',
            email=email,
            role=role,
            password=password  # Will be hashed by add_user()
        )

        if not user:
            app.logger.error(f"Failed to create user: {username}")
            return jsonify({"error": "Registration failed"}), 500

        app.logger.info(f"User registered via API: {user.username} ({user.email}, id={user.id})")

        # Create free subscription for new user
        try:
            from sqlalchemy import text
            from app.database import SessionLocal

            db = SessionLocal()
            try:
                db.execute(text("""
                    INSERT INTO subscriptions (user_id, tier, status, mrr, created_at, updated_at)
                    VALUES (:user_id, 'free', 'active', 0.00, NOW(), NOW())
                """), {'user_id': user.id})
                db.commit()
                app.logger.info(f"Created free subscription for user {user.id}")
            finally:
                db.close()
        except Exception as e:
            app.logger.error(f"Failed to create subscription for user {user.id}: {e}")
            # Don't fail registration if subscription creation fails

        # Create demo data for first-run experience
        appbuilder.sm.create_demo_data_for_user(user)

        # Automatically log the user in
        login_user(user)
        app.logger.info(f"User automatically logged in after registration: {user.username}")

        # Track registration event
        from app.utils.posthog_client import track_event, get_client_ip
        client_ip = get_client_ip()
        track_event(user.id, 'user_registered', {
            'registration_method': 'email',
            'oauth_provider': None,
            # Set identity person properties so backend-only users (who never
            # accept frontend cookies) are still identifiable in PostHog.
            '$set': {'email': user.email, 'username': user.username}
        }, ip=client_ip)

        # Track reCAPTCHA success
        track_event(user.id, 'recaptcha_passed', {
            'action': 'register',
            'score': risk_score
        }, ip=client_ip)

        return jsonify({
            "success": True,
            "message": "User registered successfully"
        })

    except Exception as e:
        app.logger.error(f"Error during registration: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        return jsonify({"error": f"Registration failed: {str(e)}"}), 500

# Password Reset Routes
@app.route('/api/auth/forgot-password', methods=['POST'])
def forgot_password():
    """
    Request password reset link via email.

    Accepts:
        {
            "email": "user@example.com"
        }

    Returns:
        Success case:
        {
            "success": true,
            "message": "If an account exists, password reset instructions have been sent to your email."
        }

        OAuth user case:
        {
            "success": false,
            "oauth_account": true,
            "message": "It looks like you signed up with Google, so you don't have a password to reset. Use this button instead:"
        }

        Rate limit case:
        {
            "success": false,
            "rate_limited": true,
            "message": "Rate limit error message"
        }

    Security Note:
        - Returns success even if email doesn't exist (prevents user enumeration)
        - Token expires after PASSWORD_RESET_TOKEN_EXPIRY seconds (default: 3600 = 1 hour)
        - Email lookup is case-insensitive
        - Rate limiting on both email and IP address
    """
    from app import appbuilder
    from app.password_reset import generate_password_reset_token
    from app.mailgun_service import send_password_reset_email
    from app.rate_limiter import get_rate_limiter

    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    data = request.json
    email = data.get('email', '').strip().lower()

    if not email:
        return jsonify({"error": "Email is required"}), 400

    # Verify reCAPTCHA
    recaptcha_token = data.get('recaptcha_token', '')
    if not recaptcha_token:
        return jsonify({"error": "reCAPTCHA verification required"}), 400

    try:
        import requests as http_requests
        recaptcha_api_key = os.getenv('RECAPTCHA_API_KEY')
        if not recaptcha_api_key:
            app.logger.error("RECAPTCHA_API_KEY not configured")
            return jsonify({"error": "Service unavailable"}), 500

        verify_url = f"https://recaptchaenterprise.googleapis.com/v1/projects/practiceroutineapp/assessments?key={recaptcha_api_key}"
        verify_payload = {
            "event": {
                "token": recaptcha_token,
                "siteKey": "6LcjIvQrAAAAAM4psu6wJT3NlL8RIwH4tNiiAJ6C"
            }
        }
        headers = {'Referer': request.url_root}
        verify_response = http_requests.post(verify_url, json=verify_payload, headers=headers, timeout=10)
        recaptcha_data = verify_response.json()

        token_valid = recaptcha_data.get('tokenProperties', {}).get('valid', False)
        risk_score = recaptcha_data.get('riskAnalysis', {}).get('score', 0)
        app.logger.info(f"Forgot-password reCAPTCHA - valid: {token_valid}, score: {risk_score}")

        if not token_valid or risk_score < 0.5:
            app.logger.warning(f"reCAPTCHA failed for forgot-password: valid={token_valid}, score={risk_score}")
            from app.utils.posthog_client import track_event, get_client_ip
            track_event(None, 'recaptcha_failed', {
                'action': 'forgot_password',
                'score': risk_score,
                'reason': 'low_score' if token_valid else 'invalid_token'
            }, ip=get_client_ip())
            return jsonify({"error": "reCAPTCHA verification failed. Please try again."}), 400

    except Exception as e:
        app.logger.error(f"reCAPTCHA verification error for forgot-password: {e}")
        return jsonify({"error": "Unable to verify reCAPTCHA. Please try again."}), 500

    # Get client IP address
    client_ip = request.remote_addr
    if request.headers.get('X-Forwarded-For'):
        # Use the first IP in X-Forwarded-For (client IP)
        client_ip = request.headers.get('X-Forwarded-For').split(',')[0].strip()

    # Check rate limits
    rate_limiter = get_rate_limiter()

    # Check email-based rate limit
    email_allowed, email_error = rate_limiter.check_email_rate_limit(email)
    if not email_allowed:
        app.logger.warning(f"Email rate limit exceeded for {email}")
        return jsonify({
            "success": False,
            "rate_limited": True,
            "message": email_error
        }), 429

    # Check IP-based rate limit
    ip_allowed, ip_error = rate_limiter.check_ip_rate_limit(client_ip, email)
    if not ip_allowed:
        app.logger.warning(f"IP rate limit exceeded for {client_ip}")
        return jsonify({
            "success": False,
            "rate_limited": True,
            "message": ip_error
        }), 429

    # Generic success message (always return this to prevent email enumeration)
    success_message = "If an account exists, password reset instructions have been sent to your email."

    try:
        # Find user by email (case-insensitive)
        user = appbuilder.sm.find_user(email=email)

        if user:
            app.logger.info(f"Password reset requested for email: {email}")

            # Check if user signed up via OAuth (no password set)
            # OAuth users have null/empty password field
            if not user.password:
                app.logger.info(f"OAuth account detected for {email}, showing Google sign-in prompt")
                return jsonify({
                    "success": False,
                    "oauth_account": True,
                    "message": "It looks like you signed up with Google, so you don't have a password to reset. Use this button instead:"
                }), 200

            # Generate password reset token
            reset_token = generate_password_reset_token(user.id, user.email)

            # Send password reset email
            email_sent = send_password_reset_email(user.email, reset_token)

            if email_sent:
                app.logger.info(f"Password reset email sent to {user.email}")
            else:
                # Log error but still return success to user (don't leak email existence)
                app.logger.error(f"Failed to send password reset email to {user.email}")
        else:
            # User doesn't exist - log it but return success message
            app.logger.info(f"Password reset requested for non-existent email: {email}")

        # Always return success (security: don't leak if email exists)
        return jsonify({
            "success": True,
            "message": success_message
        })

    except Exception as e:
        app.logger.error(f"Error processing password reset request: {e}")
        import traceback
        app.logger.error(traceback.format_exc())

        # Still return success message (don't leak errors)
        return jsonify({
            "success": True,
            "message": success_message
        })


@app.route('/api/auth/reset-password', methods=['POST'])
def reset_password():
    """
    Reset password using valid token.

    Accepts:
        {
            "token": "valid-reset-token",
            "password": "newpassword123"
        }

    Returns:
        {
            "success": true,
            "message": "Password reset successfully"
        }

    Errors:
        - 400: Invalid request format or missing fields
        - 401: Token expired or invalid
        - 404: User not found
        - 500: Server error

    Password Requirements:
        - At least 12 characters
        - At least one uppercase letter
        - At least one lowercase letter
        - At least one number
        - At least one symbol/punctuation
    """
    from app import appbuilder
    from app.password_reset import validate_password_reset_token
    from itsdangerous import SignatureExpired, BadSignature
    from werkzeug.security import generate_password_hash

    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    data = request.json
    token = data.get('token', '')
    new_password = data.get('password', '')

    # Validate inputs
    if not token:
        return jsonify({"error": "Reset token is required"}), 400

    if not new_password:
        return jsonify({"error": "New password is required"}), 400

    # Verify reCAPTCHA
    recaptcha_token = data.get('recaptcha_token', '')
    if not recaptcha_token:
        return jsonify({"error": "reCAPTCHA verification required"}), 400

    try:
        import requests as http_requests
        recaptcha_api_key = os.getenv('RECAPTCHA_API_KEY')
        if not recaptcha_api_key:
            app.logger.error("RECAPTCHA_API_KEY not configured")
            return jsonify({"error": "Service unavailable"}), 500

        verify_url = f"https://recaptchaenterprise.googleapis.com/v1/projects/practiceroutineapp/assessments?key={recaptcha_api_key}"
        verify_payload = {
            "event": {
                "token": recaptcha_token,
                "siteKey": "6LcjIvQrAAAAAM4psu6wJT3NlL8RIwH4tNiiAJ6C"
            }
        }
        headers = {'Referer': request.url_root}
        verify_response = http_requests.post(verify_url, json=verify_payload, headers=headers, timeout=10)
        recaptcha_data = verify_response.json()

        token_valid = recaptcha_data.get('tokenProperties', {}).get('valid', False)
        risk_score = recaptcha_data.get('riskAnalysis', {}).get('score', 0)
        app.logger.info(f"Reset-password reCAPTCHA - valid: {token_valid}, score: {risk_score}")

        if not token_valid or risk_score < 0.5:
            app.logger.warning(f"reCAPTCHA failed for reset-password: valid={token_valid}, score={risk_score}")
            from app.utils.posthog_client import track_event, get_client_ip
            track_event(None, 'recaptcha_failed', {
                'action': 'reset_password',
                'score': risk_score,
                'reason': 'low_score' if token_valid else 'invalid_token'
            }, ip=get_client_ip())
            return jsonify({"error": "reCAPTCHA verification failed. Please try again."}), 400

    except Exception as e:
        app.logger.error(f"reCAPTCHA verification error for reset-password: {e}")
        return jsonify({"error": "Unable to verify reCAPTCHA. Please try again."}), 500

    # Validate password strength (same rules as password change)
    if len(new_password) < 12:
        return jsonify({"error": "Password must be at least 12 characters"}), 400

    import re
    if not re.search(r'[A-Z]', new_password):
        return jsonify({"error": "Password must contain at least one uppercase letter"}), 400

    if not re.search(r'[a-z]', new_password):
        return jsonify({"error": "Password must contain at least one lowercase letter"}), 400

    if not re.search(r'[0-9]', new_password):
        return jsonify({"error": "Password must contain at least one number"}), 400

    if not re.search(r'[!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>\/?]', new_password):
        return jsonify({"error": "Password must contain at least one symbol or punctuation character"}), 400

    try:
        # Validate token
        payload = validate_password_reset_token(token)
        user_id = payload['user_id']
        token_email = payload['email']

        app.logger.info(f"Valid password reset token for user_id={user_id}, email={token_email}")

        # Find user by ID
        user = appbuilder.sm.get_user_by_id(user_id)

        if not user:
            app.logger.error(f"User not found for password reset: user_id={user_id}")
            return jsonify({"error": "User not found"}), 404

        # Verify email matches (security: ensure token is for this user)
        if user.email.lower() != token_email.lower():
            app.logger.error(f"Email mismatch for password reset: user={user.email}, token={token_email}")
            return jsonify({"error": "Invalid reset token"}), 401

        # Update password
        user.password = generate_password_hash(
            new_password,
            method="scrypt",
            salt_length=16
        )

        appbuilder.session.commit()
        app.logger.info(f"Password reset successfully for user: {user.username} ({user.email})")

        return jsonify({
            "success": True,
            "message": "Password reset successfully"
        })

    except SignatureExpired:
        app.logger.warning(f"Expired password reset token")
        return jsonify({"error": "Reset link has expired. Please request a new one."}), 401

    except BadSignature:
        app.logger.warning(f"Invalid password reset token signature")
        return jsonify({"error": "Invalid reset link. Please request a new one."}), 401

    except Exception as e:
        app.logger.error(f"Error resetting password: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        appbuilder.session.rollback()
        return jsonify({"error": "Failed to reset password"}), 500


# API Key Management Routes
@app.route('/api/user/api-key', methods=['GET'])
def get_user_api_key():
    """
    Get user's API key status (doesn't return the actual key for security).

    Returns whether user has an API key configured and when it was last updated.
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    try:
        from app.database import SessionLocal
        from sqlalchemy import text

        db = SessionLocal()
        try:
            result = db.execute(text("""
                SELECT
                    encrypted_anthropic_api_key IS NOT NULL as has_key,
                    api_key_updated_at
                FROM ab_user
                WHERE id = :user_id
            """), {'user_id': current_user.id}).fetchone()

            if result:
                return jsonify({
                    "has_key": result[0],
                    "updated_at": result[1].isoformat() if result[1] else None
                })
            else:
                return jsonify({"error": "User not found"}), 404
        finally:
            db.close()
    except Exception as e:
        app.logger.error(f"Error fetching API key status: {e}")
        return jsonify({"error": "Failed to fetch API key status"}), 500

@app.route('/api/user/api-key', methods=['POST'])
def save_user_api_key():
    """
    Save or update user's Anthropic API key (encrypted).

    Validates the API key before saving.

    Request body:
        {
            "api_key": "sk-ant-..."
        }

    Returns:
        {
            "success": true,
            "message": "API key saved successfully"
        }
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    data = request.json
    api_key = data.get('api_key', '').strip()

    if not api_key:
        return jsonify({"error": "API key is required"}), 400

    # Validate the API key
    from app.utils.encryption import validate_anthropic_api_key, encrypt_api_key

    is_valid, error_message = validate_anthropic_api_key(api_key)
    if not is_valid:
        app.logger.warning(f"Invalid API key provided by user {current_user.id}: {error_message}")
        return jsonify({"error": error_message}), 400

    # Encrypt and save the key
    try:
        encrypted_key = encrypt_api_key(api_key)

        from app.database import SessionLocal
        from sqlalchemy import text
        from datetime import datetime

        db = SessionLocal()
        try:
            db.execute(text("""
                UPDATE ab_user
                SET encrypted_anthropic_api_key = :encrypted_key,
                    api_key_updated_at = :updated_at
                WHERE id = :user_id
            """), {
                'encrypted_key': encrypted_key,
                'updated_at': datetime.utcnow(),
                'user_id': current_user.id
            })
            db.commit()

            app.logger.info(f"API key saved successfully for user {current_user.id}")

            # Track API key added event
            from app.utils.posthog_client import track_event, get_client_ip
            track_event(current_user.id, 'api_key_added', {}, ip=get_client_ip())

            return jsonify({
                "success": True,
                "message": "API key saved successfully"
            })
        finally:
            db.close()
    except Exception as e:
        app.logger.error(f"Error saving API key for user {current_user.id}: {e}")
        return jsonify({"error": "Failed to save API key"}), 500

@app.route('/api/user/api-key', methods=['DELETE'])
def delete_user_api_key():
    """
    Delete user's stored API key.

    Returns:
        {
            "success": true,
            "message": "API key deleted successfully"
        }
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    try:
        from app.database import SessionLocal
        from sqlalchemy import text

        db = SessionLocal()
        try:
            db.execute(text("""
                UPDATE ab_user
                SET encrypted_anthropic_api_key = NULL,
                    api_key_updated_at = NULL
                WHERE id = :user_id
            """), {'user_id': current_user.id})
            db.commit()

            app.logger.info(f"API key deleted for user {current_user.id}")

            # Track API key removed event
            from app.utils.posthog_client import track_event, get_client_ip
            track_event(current_user.id, 'api_key_removed', {}, ip=get_client_ip())

            return jsonify({
                "success": True,
                "message": "API key deleted successfully"
            })
        finally:
            db.close()
    except Exception as e:
        app.logger.error(f"Error deleting API key for user {current_user.id}: {e}")
        return jsonify({"error": "Failed to delete API key"}), 500

@app.route('/api/user/api-key/validate', methods=['POST'])
def validate_user_api_key():
    """
    Validate an API key without saving it.

    Request body:
        {
            "api_key": "sk-ant-..."
        }

    Returns:
        {
            "valid": true
        }
        or
        {
            "valid": false,
            "error": "error message"
        }
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    data = request.json
    api_key = data.get('api_key', '').strip()

    if not api_key:
        return jsonify({"valid": False, "error": "API key is required"}), 400

    from app.utils.encryption import validate_anthropic_api_key

    is_valid, error_message = validate_anthropic_api_key(api_key)

    from app.utils.posthog_client import track_event, get_client_ip
    client_ip = get_client_ip()

    if is_valid:
        # Track successful validation
        track_event(current_user.id, 'api_key_validated', {
            'validation_result': True
        }, ip=client_ip)
        return jsonify({"valid": True})
    else:
        # Track failed validation
        track_event(current_user.id, 'api_key_validation_failed', {
            'reason': error_message
        }, ip=client_ip)
        return jsonify({"valid": False, "error": error_message})

# Practice Data Download Routes
@app.route('/api/user/practice-events', methods=['POST'])
def log_practice_event():
    """
    Log a practice event to database for later download.

    Request body:
        {
            "event_type": "timer_started|timer_stopped|marked_done|practice_page_visited",
            "item_name": "...",
            "routine_name": "...",
            "duration_seconds": 123,  // Optional
            "additional_data": {...}  // Optional
        }

    Returns:
        {"success": true}
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    data = request.json
    event_type = data.get('event_type')

    if not event_type:
        return jsonify({"error": "event_type is required"}), 400

    try:
        from app import appbuilder
        from app.models import PracticeEvent

        db = appbuilder.session
        user_id = current_user.id

        # Create new practice event
        event = PracticeEvent(
            user_id=user_id,
            event_type=event_type,
            item_name=data.get('item_name'),
            routine_name=data.get('routine_name'),
            duration_seconds=data.get('duration_seconds'),
            additional_data=data.get('additional_data')
        )
        db.add(event)
        db.commit()

        return jsonify({"success": True})

    except Exception as e:
        app.logger.error(f"Error logging practice event for user {current_user.id}: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        db.rollback()
        return jsonify({"error": "Failed to log practice event"}), 500

@app.route('/api/user/practice-data/download', methods=['GET'])
def download_practice_data():
    """
    Download user's practice data as CSV or JSON.

    Query params:
        format: 'csv' or 'json' (default: csv)

    Returns: File download with Content-Disposition header
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    try:
        from app import appbuilder
        from app.models import PracticeEvent, UserPreferences
        from datetime import datetime
        import csv
        from io import StringIO

        db = appbuilder.session
        user_id = current_user.id
        format_type = request.args.get('format', 'csv').lower()

        # Fetch all practice events for user (last 90 days enforced by trigger)
        events = db.query(PracticeEvent).filter_by(user_id=user_id).order_by(PracticeEvent.created_at.desc()).all()

        if format_type == 'json':
            # Format as JSON
            events_data = [{
                'event_type': event.event_type,
                'item_name': event.item_name,
                'routine_name': event.routine_name,
                'duration_seconds': event.duration_seconds,
                'additional_data': event.additional_data,
                'created_at': event.created_at.isoformat()
            } for event in events]

            # Update last download timestamp
            preferences = db.query(UserPreferences).filter_by(user_id=user_id).first()
            if preferences:
                preferences.last_data_download_at = datetime.utcnow()
                db.commit()

            response = jsonify(events_data)
            response.headers['Content-Disposition'] = f'attachment; filename=practice-data-{datetime.utcnow().date()}.json'
            return response

        else:  # CSV (default)
            # Create CSV in memory
            si = StringIO()
            writer = csv.writer(si)

            # Write header
            writer.writerow(['Event Type', 'Item Name', 'Routine Name', 'Duration (seconds)', 'Created At'])

            # Write data rows
            for event in events:
                writer.writerow([
                    event.event_type,
                    event.item_name or '',
                    event.routine_name or '',
                    event.duration_seconds or '',
                    event.created_at.isoformat()
                ])

            # Update last download timestamp
            preferences = db.query(UserPreferences).filter_by(user_id=user_id).first()
            if preferences:
                preferences.last_data_download_at = datetime.utcnow()
                db.commit()

            output = si.getvalue()
            response = app.response_class(
                response=output,
                mimetype='text/csv'
            )
            response.headers['Content-Disposition'] = f'attachment; filename=practice-data-{datetime.utcnow().date()}.csv'
            return response

    except Exception as e:
        app.logger.error(f"Error downloading practice data for user {current_user.id}: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        return jsonify({"error": "Failed to download practice data"}), 500

@app.route('/api/user/practice-data/expiration-warning', methods=['GET'])
def get_expiration_warning():
    """
    Check if user has data that will expire soon.

    Returns:
        {
            "has_expiring_data": boolean,
            "days_until_expiration": integer,
            "oldest_event_date": ISO timestamp,
            "reminder_dismissed_until": ISO timestamp or null
        }
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    try:
        from app import appbuilder
        from app.models import PracticeEvent, UserPreferences
        from datetime import datetime, timedelta, timezone

        db = appbuilder.session
        user_id = current_user.id

        # Get oldest event
        oldest_event = db.query(PracticeEvent).filter_by(user_id=user_id).order_by(PracticeEvent.created_at.asc()).first()

        if not oldest_event:
            return jsonify({
                "has_expiring_data": False,
                "days_until_expiration": 0,
                "oldest_event_date": None,
                "reminder_dismissed_until": None
            })

        # Calculate days until expiration (90 days from creation)
        event_age = datetime.utcnow() - oldest_event.created_at.replace(tzinfo=None)
        days_until_expiration = 90 - event_age.days

        # Check if reminder dismissed
        preferences = db.query(UserPreferences).filter_by(user_id=user_id).first()
        reminder_dismissed = None
        if preferences and preferences.data_expiration_reminder_dismissed_until:
            dismissed_until = preferences.data_expiration_reminder_dismissed_until
            reminder_dismissed = dismissed_until.isoformat()
            # The column is timezone-aware, so normalize to aware UTC before
            # comparing against an aware "now" to avoid naive/aware TypeErrors.
            if dismissed_until.tzinfo is None:
                dismissed_until = dismissed_until.replace(tzinfo=timezone.utc)
            # Only show warning if dismissed_until has passed
            if dismissed_until > datetime.now(timezone.utc):
                return jsonify({
                    "has_expiring_data": False,
                    "days_until_expiration": days_until_expiration,
                    "oldest_event_date": oldest_event.created_at.isoformat(),
                    "reminder_dismissed_until": reminder_dismissed
                })

        return jsonify({
            "has_expiring_data": days_until_expiration <= 7,  # Show warning if 7 days or less
            "days_until_expiration": days_until_expiration,
            "oldest_event_date": oldest_event.created_at.isoformat(),
            "reminder_dismissed_until": reminder_dismissed
        })

    except Exception as e:
        app.logger.error(f"Error checking expiration warning for user {current_user.id}: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        return jsonify({"error": "Failed to check expiration warning"}), 500

@app.route('/api/user/practice-data/dismiss-reminder', methods=['POST'])
def dismiss_expiration_reminder():
    """
    Dismiss expiration reminder.

    Request body:
        {
            "dismiss_duration_days": 1 (tomorrow) or 90 (don't care)
        }

    Returns:
        {"success": true}
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    data = request.json
    duration_days = data.get('dismiss_duration_days', 1)

    try:
        from app import appbuilder
        from app.models import UserPreferences
        from datetime import datetime, timedelta

        db = appbuilder.session
        user_id = current_user.id

        # Find or create preferences
        preferences = db.query(UserPreferences).filter_by(user_id=user_id).first()
        if not preferences:
            preferences = UserPreferences(user_id=user_id, tour_completed=False)
            db.add(preferences)

        # Set dismissal expiration
        preferences.data_expiration_reminder_dismissed_until = datetime.utcnow() + timedelta(days=duration_days)
        db.commit()

        return jsonify({"success": True})

    except Exception as e:
        app.logger.error(f"Error dismissing expiration reminder for user {current_user.id}: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        db.rollback()
        return jsonify({"error": "Failed to dismiss reminder"}), 500

# Tour Status Routes
@app.route('/api/user/preferences/tour-status', methods=['GET'])
def get_tour_status():
    """
    Get user's tour completion status.

    Returns:
        {
            "tour_completed": boolean,
            "show_tour": boolean  # Should tour be shown now?
        }
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    try:
        from app import appbuilder
        from app.models import UserPreferences

        db = appbuilder.session
        user_id = current_user.id

        # Try to find existing preferences
        preferences = db.query(UserPreferences).filter_by(user_id=user_id).first()

        if preferences:
            tour_completed = preferences.tour_completed
        else:
            # User has no preferences record yet - tour not completed
            tour_completed = False

        return jsonify({
            "tour_completed": tour_completed,
            "show_tour": not tour_completed  # Show tour if not completed
        })

    except Exception as e:
        app.logger.error(f"Error fetching tour status for user {current_user.id}: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        return jsonify({"error": "Failed to fetch tour status"}), 500

@app.route('/api/user/preferences/tour-complete', methods=['POST'])
def complete_tour():
    """
    Mark tour as completed for the current user.

    Creates or updates user_preferences record to set tour_completed = true.

    Returns:
        {
            "success": true,
            "message": "Tour marked as completed"
        }
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    try:
        from app import appbuilder
        from app.models import UserPreferences
        from sqlalchemy import text

        db = appbuilder.session
        user_id = current_user.id

        # Try to find existing preferences
        preferences = db.query(UserPreferences).filter_by(user_id=user_id).first()

        if preferences:
            # Update existing record
            preferences.tour_completed = True
            app.logger.info(f"Updated tour status for user {user_id} to completed")
        else:
            # Create new record
            preferences = UserPreferences(
                user_id=user_id,
                tour_completed=True
            )
            db.add(preferences)
            app.logger.info(f"Created tour status for user {user_id} as completed")

        db.commit()

        return jsonify({
            "success": True,
            "message": "Tour marked as completed"
        })

    except Exception as e:
        app.logger.error(f"Error completing tour for user {current_user.id}: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        db.rollback()
        return jsonify({"error": "Failed to mark tour as completed"}), 500

@app.route('/api/user/preferences/tour-reset', methods=['POST'])
def reset_tour():
    """
    Reset tour status so user can take it again.

    Sets tour_completed = false for the current user.

    Returns:
        {
            "success": true,
            "message": "Tour reset successfully"
        }
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    try:
        from app import appbuilder
        from app.models import UserPreferences

        db = appbuilder.session
        user_id = current_user.id

        # Try to find existing preferences
        preferences = db.query(UserPreferences).filter_by(user_id=user_id).first()

        if preferences:
            # Update existing record
            preferences.tour_completed = False
            app.logger.info(f"Reset tour status for user {user_id}")
        else:
            # Create new record with tour not completed
            preferences = UserPreferences(
                user_id=user_id,
                tour_completed=False
            )
            db.add(preferences)
            app.logger.info(f"Created tour status for user {user_id} as not completed")

        db.commit()

        return jsonify({
            "success": True,
            "message": "Tour reset successfully"
        })

    except Exception as e:
        app.logger.error(f"Error resetting tour for user {current_user.id}: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        db.rollback()
        return jsonify({"error": "Failed to reset tour"}), 500

# First Item Guidance Routes
@app.route('/api/user/preferences/first-item-guidance-status', methods=['GET'])
def get_first_item_guidance_status():
    """
    Get whether the first-item guidance modal has been shown to this user.

    Returns:
        {
            "shown": boolean
        }
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    try:
        from app import appbuilder
        from app.models import UserPreferences

        db = appbuilder.session
        user_id = current_user.id

        preferences = db.query(UserPreferences).filter_by(user_id=user_id).first()

        if preferences:
            shown = preferences.first_item_guidance_shown
        else:
            shown = False

        return jsonify({"shown": shown})

    except Exception as e:
        app.logger.error(f"Error fetching first item guidance status for user {current_user.id}: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        return jsonify({"error": "Failed to fetch first item guidance status"}), 500

@app.route('/api/user/preferences/first-item-guidance-complete', methods=['POST'])
def complete_first_item_guidance():
    """
    Mark first-item guidance as shown for the current user.

    Creates or updates user_preferences record to set first_item_guidance_shown = true.

    Returns:
        {
            "success": true,
            "message": "First item guidance marked as shown"
        }
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    try:
        from app import appbuilder
        from app.models import UserPreferences

        db = appbuilder.session
        user_id = current_user.id

        preferences = db.query(UserPreferences).filter_by(user_id=user_id).first()

        if preferences:
            preferences.first_item_guidance_shown = True
            app.logger.info(f"Updated first item guidance for user {user_id} to shown")
        else:
            preferences = UserPreferences(
                user_id=user_id,
                first_item_guidance_shown=True
            )
            db.add(preferences)
            app.logger.info(f"Created first item guidance for user {user_id} as shown")

        db.commit()

        return jsonify({
            "success": True,
            "message": "First item guidance marked as shown"
        })

    except Exception as e:
        app.logger.error(f"Error completing first item guidance for user {current_user.id}: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        db.rollback()
        return jsonify({"error": "Failed to mark first item guidance as shown"}), 500

# Chord Density Routes
@app.route('/api/user/preferences/chord-density', methods=['GET'])
def get_chord_density():
    """
    Get the user's mobile chord-density preference (3 or 4 charts across).

    Returns:
        {
            "chord_density": 3 | 4  # defaults to 4 when no record exists
        }
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    try:
        from app import appbuilder
        from app.models import UserPreferences

        db = appbuilder.session
        user_id = current_user.id

        preferences = db.query(UserPreferences).filter_by(user_id=user_id).first()

        if preferences:
            chord_density = preferences.chord_density
        else:
            chord_density = 4

        return jsonify({"chord_density": chord_density})

    except Exception as e:
        app.logger.error(f"Error fetching chord density for user {current_user.id}: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        return jsonify({"error": "Failed to fetch chord density"}), 500

@app.route('/api/user/preferences/chord-density', methods=['POST'])
def set_chord_density():
    """
    Set the user's mobile chord-density preference.

    Creates or updates the user_preferences record. Only 3 or 4 are valid.

    Request body:
        {
            "chord_density": 3 | 4
        }

    Returns:
        {
            "success": true,
            "chord_density": 3 | 4
        }
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    data = request.get_json(silent=True) or {}
    density = data.get('chord_density')
    if density not in (3, 4):
        return jsonify({"error": "chord_density must be 3 or 4"}), 400

    try:
        from app import appbuilder
        from app.models import UserPreferences

        db = appbuilder.session
        user_id = current_user.id

        preferences = db.query(UserPreferences).filter_by(user_id=user_id).first()

        if preferences:
            preferences.chord_density = density
            app.logger.info(f"Updated chord density for user {user_id} to {density}")
        else:
            preferences = UserPreferences(user_id=user_id, chord_density=density)
            db.add(preferences)
            app.logger.info(f"Created chord density for user {user_id} as {density}")

        db.commit()

        return jsonify({"success": True, "chord_density": density})

    except Exception as e:
        app.logger.error(f"Error setting chord density for user {current_user.id}: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        db.rollback()
        return jsonify({"error": "Failed to set chord density"}), 500

@app.route('/api/user/password-change', methods=['POST'])
def change_password():
    """
    Change user's password.

    Request body:
        {
            "current_password": "oldpass123",
            "new_password": "newpass456",
            "confirm_password": "newpass456"
        }

    Returns:
        {
            "success": true,
            "message": "Password changed successfully"
        }
    """
    from werkzeug.security import check_password_hash, generate_password_hash
    from app import appbuilder

    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    data = request.json
    current_password = data.get('current_password', '')
    new_password = data.get('new_password', '')
    confirm_password = data.get('confirm_password', '')

    # Validate inputs
    if not all([current_password, new_password, confirm_password]):
        return jsonify({"error": "All fields required"}), 400

    if new_password != confirm_password:
        return jsonify({"error": "New passwords do not match"}), 400

    # Validate password strength (12 chars, upper, lower, number, symbol)
    if len(new_password) < 12:
        return jsonify({"error": "Password must be at least 12 characters"}), 400

    import re
    if not re.search(r'[A-Z]', new_password):
        return jsonify({"error": "Password must contain at least one uppercase letter"}), 400

    if not re.search(r'[a-z]', new_password):
        return jsonify({"error": "Password must contain at least one lowercase letter"}), 400

    if not re.search(r'[0-9]', new_password):
        return jsonify({"error": "Password must contain at least one number"}), 400

    if not re.search(r'[!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>\/?]', new_password):
        return jsonify({"error": "Password must contain at least one symbol or punctuation character"}), 400

    # Get current user from database (FAB session)
    user = appbuilder.sm.find_user(username=current_user.username)

    if not user:
        return jsonify({"error": "User not found"}), 404

    # Verify current password
    if not check_password_hash(user.password, current_password):
        app.logger.warning(f"Invalid current password for user: {current_user.username}")
        return jsonify({"error": "Current password is incorrect"}), 401

    try:
        # Hash new password and update
        user.password = generate_password_hash(
            new_password,
            method="scrypt",
            salt_length=16
        )

        appbuilder.session.commit()
        app.logger.info(f"Password changed for user: {current_user.username}")

        # Track password change event
        from app.utils.posthog_client import track_event, get_client_ip
        track_event(current_user.id, 'password_changed', {}, ip=get_client_ip())

        return jsonify({
            "success": True,
            "message": "Password changed successfully"
        })
    except Exception as e:
        app.logger.error(f"Error changing password: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        appbuilder.session.rollback()
        return jsonify({"error": "Failed to change password"}), 500


@app.route('/api/user/username', methods=['PUT'])
def update_username():
    """
    Update user's username.

    Request body:
        {
            "username": "newusername"
        }

    Returns:
        {
            "success": true,
            "message": "Username updated successfully",
            "username": "newusername"
        }

    Note: Tidal OAuth users cannot change their username (it's derived from their Tidal user ID).
    """
    from app import appbuilder

    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    data = request.json
    new_username = data.get('username', '').strip()

    # Validation
    if not new_username:
        return jsonify({"error": "Username is required"}), 400

    if len(new_username) < 3:
        return jsonify({"error": "Username must be at least 3 characters"}), 400

    if len(new_username) > 50:
        return jsonify({"error": "Username must be at most 50 characters"}), 400

    # Check if user is a Tidal OAuth user (cannot change username)
    if current_user.username and current_user.username.startswith('tidal_'):
        return jsonify({"error": "Tidal OAuth users cannot change their username"}), 403

    # Check if username is already taken
    existing_user = appbuilder.sm.find_user(username=new_username)
    if existing_user and existing_user.id != current_user.id:
        return jsonify({"error": "Username is already taken"}), 409

    # Get current user from database (FAB session)
    user = appbuilder.sm.find_user(username=current_user.username)

    if not user:
        return jsonify({"error": "User not found"}), 404

    try:
        old_username = user.username
        user.username = new_username
        appbuilder.session.commit()
        app.logger.info(f"Username changed from '{old_username}' to '{new_username}' for user id: {current_user.id}")

        # Track username change event
        from app.utils.posthog_client import track_event, get_client_ip
        track_event(current_user.id, 'username_changed', {'old_username': old_username, 'new_username': new_username}, ip=get_client_ip())

        return jsonify({
            "success": True,
            "message": "Username updated successfully",
            "username": new_username
        })
    except Exception as e:
        app.logger.error(f"Error updating username: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        appbuilder.session.rollback()
        return jsonify({"error": "Failed to update username"}), 500


@app.route('/api/user/email', methods=['PUT'])
def update_email():
    """
    Update user's email address.

    Request body:
        {
            "email": "newemail@example.com"
        }

    Returns:
        {
            "success": true,
            "message": "Email updated successfully",
            "email": "newemail@example.com"
        }

    Note: Google OAuth users cannot change their email (it's tied to their Google account).
    """
    import re
    import stripe
    from app import appbuilder

    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    data = request.json
    new_email = data.get('email', '').strip().lower()

    # Validation
    if not new_email:
        return jsonify({"error": "Email is required"}), 400

    # Basic email format validation
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(email_pattern, new_email):
        return jsonify({"error": "Invalid email format"}), 400

    # Check if user is a Google OAuth user (cannot change email)
    user_record = appbuilder.sm.find_user(username=current_user.username)
    if user_record:
        has_password = user_record.password and len(user_record.password) > 10
        is_tidal_user = current_user.username and current_user.username.startswith('tidal_')
        if not has_password and not is_tidal_user:
            # This is a Google OAuth user
            return jsonify({"error": "Google OAuth users cannot change their email address"}), 403

    # Check if email is already taken
    existing_user = appbuilder.sm.find_user(email=new_email)
    if existing_user and existing_user.id != current_user.id:
        return jsonify({"error": "Email is already in use by another account"}), 409

    # Get current user from database (FAB session)
    user = appbuilder.sm.find_user(username=current_user.username)

    if not user:
        return jsonify({"error": "User not found"}), 404

    try:
        old_email = user.email
        user.email = new_email
        appbuilder.session.commit()
        app.logger.info(f"Email changed from '{old_email}' to '{new_email}' for user id: {current_user.id}")

        # Update Stripe customer email if user has a subscription
        try:
            with DatabaseTransaction() as tx:
                db = tx.session
                subscription = db.query(Subscription).filter_by(user_id=current_user.id).first()
                if subscription and subscription.stripe_customer_id:
                    stripe.api_key = os.getenv('STRIPE_SECRET_KEY')
                    stripe.Customer.modify(
                        subscription.stripe_customer_id,
                        email=new_email
                    )
                    app.logger.info(f"Updated Stripe customer email for customer {subscription.stripe_customer_id}")
        except Exception as stripe_error:
            # Log but don't fail - Stripe email update is best-effort
            app.logger.warning(f"Failed to update Stripe customer email: {stripe_error}")

        # Track email change event
        from app.utils.posthog_client import track_event, get_client_ip
        track_event(current_user.id, 'email_changed', {'old_email': old_email, 'new_email': new_email}, ip=get_client_ip())

        return jsonify({
            "success": True,
            "message": "Email updated successfully",
            "email": new_email
        })
    except Exception as e:
        app.logger.error(f"Error updating email: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        appbuilder.session.rollback()
        return jsonify({"error": "Failed to update email"}), 500


@app.route('/authorize')
def authorize():
    """Initiate OAuth flow for Google Sheets (fallback for Sheets mode)"""
    if data_layer.mode == 'postgres':
        # No authentication needed for PostgreSQL mode
        return redirect('/')
    else:
        # Import OAuth logic from original routes
        try:
            from app.sheets import get_credentials
            from google_auth_oauthlib.flow import Flow
            
            flow = Flow.from_client_config(
                {
                    "web": {
                        "client_id": os.getenv('GOOGLE_CLIENT_ID'),
                        "client_secret": os.getenv('GOOGLE_CLIENT_SECRET'),
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": "https://oauth2.googleapis.com/token",
                        "redirect_uris": [request.url_root + 'oauth2callback']
                    }
                },
                scopes=['https://www.googleapis.com/auth/spreadsheets']
            )
            flow.redirect_uri = request.url_root + 'oauth2callback'
            
            authorization_url, state = flow.authorization_url(
                access_type='offline',
                include_granted_scopes='true'
            )
            
            session['state'] = state
            return redirect(authorization_url)
        except Exception as e:
            return f"OAuth setup error: {str(e)}", 500

@app.route('/oauth2callback')
def oauth2callback():
    """Handle OAuth callback for Google Sheets"""
    if data_layer.mode == 'postgres':
        # No authentication needed for PostgreSQL mode
        return redirect('/')
    else:
        try:
            from google_auth_oauthlib.flow import Flow
            
            state = session.get('state')
            if not state:
                return "Invalid state parameter", 400
            
            flow = Flow.from_client_config(
                {
                    "web": {
                        "client_id": os.getenv('GOOGLE_CLIENT_ID'),
                        "client_secret": os.getenv('GOOGLE_CLIENT_SECRET'),
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": "https://oauth2.googleapis.com/token",
                        "redirect_uris": [request.url_root + 'oauth2callback']
                    }
                },
                scopes=['https://www.googleapis.com/auth/spreadsheets'],
                state=state
            )
            flow.redirect_uri = request.url_root + 'oauth2callback'
            
            # Get tokens
            flow.fetch_token(authorization_response=request.url)
            
            # Save credentials to file
            credentials = flow.credentials
            with open('token.json', 'w') as token_file:
                token_file.write(credentials.to_json())
            
            return redirect('/')
        except Exception as e:
            return f"OAuth callback error: {str(e)}", 500

@app.route('/logout')
def logout_route():
    """Logout endpoint - logs out user and redirects to login page"""
    logging.info("[LOGOUT] Logout route called")
    if data_layer.mode == 'postgres':
        # For PostgreSQL mode with Flask-AppBuilder auth
        from flask_login import logout_user
        from flask import session

        logging.info(f"[LOGOUT] Logging out user, mode={data_layer.mode}")

        # Clear Flask-Login session
        logout_user()

        # Clear Flask session completely
        session.clear()

        logging.info("[LOGOUT] User logged out, redirecting to /login")
        return redirect('/login')
    else:
        # For Sheets mode, remove token file
        try:
            import os
            if os.path.exists('token.json'):
                os.remove('token.json')
        except Exception:
            pass
        return redirect('/authorize')

# Debug and logging routes
@app.route('/api/debug/log', methods=['POST'])
@limiter.exempt  # Exempt from rate limiting - this is just logging, not a security concern
def debug_log():
    """Handle frontend debug logging"""
    if request.is_json:
        message = request.json.get('message', 'No message')
        level = request.json.get('level', 'info')
        app.logger.info(f"[FRONTEND {level.upper()}] {message}")
    return jsonify({"success": True})

# Lightweight item endpoint
@app.route('/api/items/lightweight', methods=['GET'])
@require_user_context
def items_lightweight():
    """Get lightweight item data"""
    items = data_layer.get_all_items()
    # Return just ID and title for performance
    lightweight = [{"A": item["A"], "C": item["C"]} for item in items]
    return jsonify(lightweight)

def _check_routine_limit(user_id):
    """Routine-limit status for a user: (allowed, tier, limit, count, tier_config).

    Shared by POST /api/routines (enforcement) and GET /api/routines/limits
    (pre-check) so the two can't drift.

    IMPORTANT: Uses SessionLocal with explicit cleanup to avoid scoped session
    conflicts. Scoped sessions are thread-local, so we must properly clean up
    after the tier check — otherwise a following transaction (e.g. routine
    creation) would get a corrupted session.
    """
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        # Get user's subscription tier (default to 'free' if no subscription)
        subscription = db.execute(text("""
            SELECT tier, is_complimentary FROM subscriptions WHERE user_id = :user_id
        """), {'user_id': user_id}).fetchone()
        tier = subscription[0] if subscription else 'free'
        is_complimentary = subscription[1] if subscription else False

        tier_config = get_tier_limits(tier, is_complimentary)
        routines_limit = tier_config['routines_limit']

        # Count existing routines for this user
        routine_count = db.execute(text("""
            SELECT COUNT(*) FROM routines WHERE user_id = :user_id
        """), {'user_id': user_id}).fetchone()[0]

        app.logger.info(f"User {user_id} has {routine_count} routines (tier '{tier}' limit: {routines_limit})")
        return routine_count < routines_limit, tier, routines_limit, routine_count, tier_config
    finally:
        db.close()
        # CRITICAL: Remove scoped session from thread-local storage
        # This ensures the next SessionLocal() call creates a fresh session
        # instead of reusing the closed session, which prevents commit issues
        SessionLocal.remove()

@app.route('/api/routines/limits', methods=['GET'])
@require_user_context
def routine_limits():
    """Pre-check whether the current user can create another routine.

    Used by the Routines page to redirect at-limit users toward adding an
    item instead of showing the create-routine flow.
    """
    allowed, tier, routines_limit, routine_count, _ = _check_routine_limit(current_user.id)
    return jsonify({
        "allowed": allowed,
        "tier": tier,
        "limit": routines_limit,
        "current": routine_count
    })

# Routines API - Now using data layer
@app.route('/api/routines', methods=['GET', 'POST'])
@require_user_context
def routines():
    """Handle GET (list) and POST (create) for routines"""
    if request.method == 'GET':
        return jsonify(data_layer.get_all_routines())
    elif request.method == 'POST':
        try:
            if not request.is_json:
                return jsonify({"error": "Request must be JSON"}), 400

            # Extract routine name from frontend format
            routine_name = request.json.get('routineName')
            if not routine_name:
                return jsonify({"error": "Routine name is required"}), 400

            app.logger.info(f"Creating routine with name: {routine_name}")

            # Check subscription tier limits
            allowed, tier, routines_limit, routine_count, tier_config = _check_routine_limit(current_user.id)
            if not allowed:
                app.logger.warning(f"User {current_user.id} reached routine limit: {routine_count}/{routines_limit}")
                return jsonify({
                    "error": "Routine limit reached",
                    "message": f"You've reached the {routines_limit} routine limit for the {tier_config['display_name']} tier. Please upgrade to create more routines.",
                    "tier": tier,
                    "limit": routines_limit,
                    "current": routine_count
                }), 403

            # Transform to sheets format for data layer
            # Note: No 'A' field (ID) for new routines - let database auto-generate
            sheets_format = {
                'B': routine_name,  # Column B = Routine Name
                'D': 0              # Column D = order (start at 0 for new routines)
            }

            app.logger.info(f"Calling data_layer.create_routine with: {sheets_format}")
            result = data_layer.create_routine(sheets_format)
            app.logger.info(f"Routine created successfully: {result}")
            return jsonify(result)
        except Exception as e:
            app.logger.error(f"Error creating routine: {str(e)}", exc_info=True)
            return jsonify({"error": str(e)}), 500

@app.route('/api/routines/<int:routine_id>', methods=['GET', 'PUT', 'DELETE'])
@require_user_context
def routine(routine_id):
    """Handle GET (fetch), PUT (update) and DELETE for individual routines"""
    if request.method == 'GET':
        # Get routine with items
        routine_data = data_layer.get_routine_with_items(routine_id)
        return jsonify(routine_data) if routine_data else ('', 404)
        
    elif request.method == 'PUT':
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400
            
        updated_routine = data_layer.update_routine(routine_id, request.json)
        return jsonify(updated_routine) if updated_routine else ('', 404)
        
    elif request.method == 'DELETE':
        success = data_layer.delete_routine(routine_id)
        return jsonify({"success": success})

@app.route('/api/routines/<int:routine_id>/details', methods=['GET'])
@require_user_context
def get_routine_with_details(routine_id):
    """Get a routine with all item details and metadata."""
    try:
        # Use existing DataLayer method that already provides detailed routine info
        routine_data = data_layer.get_routine_with_items(routine_id)
        if not routine_data:
            return jsonify({"error": "Routine not found"}), 404
        
        return jsonify(routine_data)
    except Exception as e:
        app.logger.error(f"Error getting routine with details: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/routines/<int:routine_id>/items', methods=['GET', 'POST'])
@require_user_context
def routine_items(routine_id):
    """Handle routine items"""
    if request.method == 'GET':
        items = data_layer.get_routine_items(routine_id)
        return jsonify(items)
        
    elif request.method == 'POST':
        try:
            if not request.is_json:
                return jsonify({"error": "Request must be JSON"}), 400
                
            item_data = request.json
            # Accept both camelCase (itemId) and snake_case (item_id) for compatibility
            item_id = item_data.get('itemId') or item_data.get('item_id')
            order = int(item_data['order']) if item_data.get('order') is not None else None
            
            if not item_id:
                return jsonify({"error": "itemId is required"}), 400
                
            app.logger.info(f"Adding item {item_id} to routine {routine_id}")
            result = data_layer.add_item_to_routine(routine_id, int(item_id), order)
            app.logger.info(f"Successfully added item to routine")
            return jsonify(result)
        except Exception as e:
            app.logger.error(f"Error adding item to routine: {str(e)}", exc_info=True)
            return jsonify({"error": f"Failed to add item to routine: {str(e)}"}), 500

@app.route('/api/routines/<int:routine_id>/items/<item_id>', methods=['PUT', 'DELETE'])
@require_user_context
def routine_item(routine_id, item_id):
    """Handle PUT (update) and DELETE for routine items"""
    routine_item_id = int(item_id)

    if request.method == 'PUT':
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400

        update_data = request.json
        app.logger.info(f"Updating routine item {routine_item_id} in routine {routine_id} with data: {update_data}")

        try:
            updated_item = data_layer.update_routine_item(routine_id, routine_item_id, update_data)
            if updated_item:
                app.logger.info(f"Successfully updated routine item {routine_item_id}")
                return jsonify(updated_item)
            else:
                app.logger.warning(f"Routine item {routine_item_id} not found")
                return jsonify({"error": "Routine item not found"}), 404
        except Exception as e:
            app.logger.error(f"Error updating routine item: {str(e)}")
            return jsonify({"error": str(e)}), 500

    elif request.method == 'DELETE':
        """Remove an item from a routine by routine item ID (matches sheets version)"""
        success = data_layer.remove_routine_item_by_id(routine_id, routine_item_id)
        return jsonify({"success": success})

# Routine ordering (for main routines list drag-and-drop)
@app.route('/api/routines/order', methods=['PUT'])
@require_user_context
def update_routines_order():
    """Update the order of routines in the main routines list"""
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    try:
        updates = request.json
        app.logger.info(f"Updating routines order with: {updates}")
        success = data_layer.update_routines_order(updates)
        return jsonify({"success": success})
    except Exception as e:
        app.logger.error(f"Error updating routines order: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/routines/<int:routine_id>/items/order', methods=['PUT'])
@require_user_context
def update_routine_items_order(routine_id):
    """Update routine item ordering"""
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    app.logger.info(f"Updating routine {routine_id} items order with data: {request.json}")
    try:
        success = data_layer.update_routine_items_order(routine_id, request.json)
        app.logger.info(f"DataLayer returned success: {success}")
        return jsonify({"success": success})
    except Exception as e:
        app.logger.error(f"Error in routine items order endpoint: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/routines/<int:routine_id>/order', methods=['PUT'])
@require_user_context
def update_routine_order_route(routine_id):
    """Update routine item ordering (alternative endpoint to match sheets version)"""
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    success = data_layer.update_routine_items_order(routine_id, request.json)
    if success:
        # Match sheets version: return updated items array
        updated_items = data_layer.get_routine_items(routine_id)
        return jsonify(updated_items)
    else:
        return jsonify({"error": "Failed to update order"}), 500

@app.route('/api/routines/<int:routine_id>/items/<int:routine_item_id>/complete', methods=['PUT'])
@require_user_context
def mark_routine_item_complete(routine_id, routine_item_id):
    """Mark a routine item as completed or not"""
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    completed = request.json.get('completed', True)
    success = data_layer.mark_item_complete(routine_id, routine_item_id, completed)
    return jsonify({"success": success})

@app.route('/api/routines/<int:routine_id>/reset', methods=['POST'])
@require_user_context
def reset_routine_progress(routine_id):
    """Reset all items in a routine to not completed"""
    success = data_layer.reset_routine_progress(routine_id)
    return jsonify({"success": success})

# Active routine management
@app.route('/api/practice/active-routine', methods=['GET', 'POST', 'DELETE'])
@require_user_context
def active_routine():
    """Handle active routine operations"""
    if request.method == 'GET':
        active = data_layer.get_active_routine()
        return jsonify(active) if active else jsonify(None)
        
    elif request.method == 'POST':
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400

        routine_id = request.json.get('routine_id')
        if not routine_id:
            return jsonify({"error": "routine_id is required"}), 400

        success = data_layer.set_active_routine(int(routine_id))

        # Track routine activated event
        if success and current_user.is_authenticated:
            from app.utils.posthog_client import track_event, get_client_ip
            routine = data_layer.get_routine(int(routine_id))
            track_event(current_user.id, 'routine_activated', {
                'routine_name': routine.get('name') if routine else 'Unknown',
                'source': 'user'
            }, ip=get_client_ip())

        return jsonify({"success": success})

    elif request.method == 'DELETE':
        # Get active routine before clearing it for tracking
        active = None
        if current_user.is_authenticated:
            active = data_layer.get_active_routine()

        success = data_layer.clear_active_routine()

        # Track routine deactivated event
        if success and current_user.is_authenticated and active:
            from app.utils.posthog_client import track_event, get_client_ip
            track_event(current_user.id, 'routine_deactivated', {
                'routine_name': active.get('routine', {}).get('name', 'Unknown'),
                'source': 'user'
            }, ip=get_client_ip())

        return jsonify({"success": success})

@app.route('/api/practice/active-routine/lightweight', methods=['GET'])
@require_user_context
def get_active_routine_lightweight():
    """Get lightweight active routine data - supports unplugged mode"""
    from flask_login import current_user
    from app.database import DatabaseTransaction
    from sqlalchemy import text

    # Check if user is in unplugged mode
    routine_id = None
    with DatabaseTransaction() as tx:
        result = tx.execute(text("""
            SELECT unplugged_mode, last_active_routine_id
            FROM subscriptions
            WHERE user_id = :user_id
        """), {"user_id": current_user.id})
        sub_row = result.fetchone()

        if sub_row:
            unplugged_mode, last_active_routine_id = sub_row

            if unplugged_mode and last_active_routine_id:
                # Unplugged mode: use saved routine from subscription
                routine_id = last_active_routine_id
                app.logger.info(f"Unplugged user {current_user.id} using saved routine {routine_id}")
            else:
                # Normal mode: get from active_routine table
                active = data_layer.get_active_routine()
                if active:
                    routine_id = int(active.get("A"))

    if not routine_id:
        return jsonify({"active_id": None, "items": []})

    # Get routine with items
    routine_with_items = data_layer.get_routine_with_items(routine_id)

    if not routine_with_items:
        return jsonify({"active_id": None, "items": []})

    # Format the response to match what the frontend expects
    items_with_minimal_details = []
    for item in routine_with_items.get("items", []):
        # CRITICAL: item structure is {routineEntry: {...}, itemDetails: {...}}
        # Need to access nested properties correctly
        routine_entry = item.get("routineEntry", {})
        item_details = item.get("itemDetails", {})

        items_with_minimal_details.append({
            "routineEntry": {
                "A": routine_entry.get("A"),  # Routine item ID
                "B": routine_entry.get("B"),  # Item ID (Google Sheets ItemID like "67")
                "C": routine_entry.get("C"),  # Order
                "D": routine_entry.get("D")   # Completed status (already "TRUE"/"FALSE")
            },
            "itemMinimal": {
                "A": item_details.get("A", ""),  # Item ID
                "C": item_details.get("C", "")   # Item title
            }
        })

    return jsonify({
        "active_id": str(routine_id),
        "name": routine_with_items.get("B", ""),  # Column B contains routine name
        "items": items_with_minimal_details
    })

@app.route('/api/routines/<int:routine_id>/active', methods=['PUT'])
@require_user_context
def set_routine_active_status(routine_id):
    """Set a routine as active or inactive"""
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400
    
    active = request.json.get('active', True)
    
    if active:
        # Set this routine as active
        success = data_layer.set_active_routine(routine_id)
    else:
        # Clear active routine (deactivate)
        success = data_layer.clear_active_routine()
    
    return jsonify({"success": success})

@app.route('/api/routines/active', methods=['GET'])
@require_user_context
def get_active_routine_alt():
    """Alternative active routine endpoint"""
    return active_routine()

# Development and testing routes
@app.route('/api/dev/clear-cache', methods=['POST'])
def clear_cache():
    """Clear any caches (useful during development)"""
    # For now, just return success
    return jsonify({"success": True, "message": "Cache cleared"})

@app.route('/api/dev/migrate-test', methods=['POST'])
def migrate_test():
    """Test data migration between systems"""
    return jsonify({
        "message": "Migration test not implemented yet",
        "current_mode": data_layer.mode
    })

@app.route('/api/chord-charts/common', methods=['GET'])
def get_common_chord_charts():
    """Get all common chord charts from the PostgreSQL database."""
    try:
        app.logger.info("Fetching all common chord charts from PostgreSQL")
        
        with DatabaseTransaction() as session:
            # Get all common chords from PostgreSQL
            result = session.execute(text("""
                SELECT id, title, chord_data, created_at, "order"
                FROM common_chords 
                ORDER BY "order" ASC, title ASC
            """))
            
            common_chords = []
            for row in result:
                chord_id, title, chord_data_str, created_at, order = row
                
                # Parse chord data JSON
                try:
                    import json
                    chord_data = json.loads(chord_data_str) if chord_data_str else {}
                except json.JSONDecodeError:
                    chord_data = {}
                
                common_chords.append({
                    'id': str(chord_id),
                    'title': title,
                    'chord_data': chord_data,
                    'created_at': created_at.isoformat() if created_at else None,
                    'order': order
                })
        
        # Add cache control headers to allow caching but ensure freshness
        response = jsonify(common_chords)
        response.headers['Cache-Control'] = 'public, max-age=300'  # Cache for 5 minutes
        
        app.logger.info(f"Returning {len(common_chords)} common chord charts from PostgreSQL")
        return response
        
    except Exception as e:
        app.logger.error(f"Error fetching common chord charts from PostgreSQL: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/chord-charts/common/search', methods=['GET'])
def search_common_chords():
    """Search CommonChords by chord name"""
    chord_name = request.args.get('name', '').strip()
    if not chord_name:
        return jsonify({"error": "name parameter is required"}), 400
    
    try:
        # Search for exact matches first, then partial matches
        with DatabaseTransaction() as db:
            # Exact match first (case-insensitive)
            exact_results = db.execute(
                text("""
                    SELECT id, type, name, chord_data, created_at, order_col
                    FROM common_chords 
                    WHERE LOWER(name) = LOWER(:name)
                    ORDER BY order_col, id
                    LIMIT 10
                """),
                {"name": chord_name}
            ).fetchall()
            
            if exact_results:
                # Convert to format expected by frontend
                chords = []
                for row in exact_results:
                    # Parse the chord_data JSON and flatten it to top level
                    import json
                    chord_data = json.loads(row[3]) if isinstance(row[3], str) else row[3]

                    # Normalize finger data from objects to arrays (same as sheets version)
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

                    # Flatten chord data to top level for frontend compatibility
                    chord_obj = {
                        "id": row[0],
                        "type": row[1],
                        "title": row[2],  # Frontend expects 'title' not 'name'
                        "created_at": row[4],
                        "order": row[5],
                        # Use normalized finger data instead of raw
                        "fingers": normalized_fingers,
                        "barres": chord_data.get("barres", []),
                        "openStrings": chord_data.get("openStrings", []),
                        "mutedStrings": chord_data.get("mutedStrings", []),
                        "startingFret": chord_data.get("startingFret", 1),
                        "numFrets": chord_data.get("numFrets", 5),
                        "numStrings": chord_data.get("numStrings", 6),
                        "tuning": chord_data.get("tuning", "EADGBE"),
                        "capo": chord_data.get("capo", 0)
                    }
                    chords.append(chord_obj)
                return jsonify(chords)
            
            # If no exact matches, try partial matches
            partial_results = db.execute(
                text("""
                    SELECT id, type, name, chord_data, created_at, order_col
                    FROM common_chords 
                    WHERE LOWER(name) LIKE LOWER(:pattern)
                    ORDER BY order_col, id
                    LIMIT 10
                """),
                {"pattern": f"%{chord_name}%"}
            ).fetchall()
            
            chords = []
            for row in partial_results:
                # Parse the chord_data JSON and flatten it to top level
                import json
                chord_data = json.loads(row[3]) if isinstance(row[3], str) else row[3]

                # Normalize finger data from objects to arrays (same as sheets version)
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

                # Flatten chord data to top level for frontend compatibility
                chord_obj = {
                    "id": row[0],
                    "type": row[1],
                    "title": row[2],  # Frontend expects 'title' not 'name'
                    "created_at": row[4],
                    "order": row[5],
                    # Use normalized finger data instead of raw
                    "fingers": normalized_fingers,
                    "barres": chord_data.get("barres", []),
                    "openStrings": chord_data.get("openStrings", []),
                    "mutedStrings": chord_data.get("mutedStrings", []),
                    "startingFret": chord_data.get("startingFret", 1),
                    "numFrets": chord_data.get("numFrets", 5),
                    "numStrings": chord_data.get("numStrings", 6),
                    "tuning": chord_data.get("tuning", "EADGBE"),
                    "capo": chord_data.get("capo", 0)
                }
                chords.append(chord_obj)
            
            return jsonify(chords)
            
    except Exception as e:
        app.logger.error(f"Error searching CommonChords: {str(e)}")
        return jsonify({"error": "Failed to search CommonChords"}), 500


@app.route('/api/chord-charts/common/<int:chord_id>', methods=['GET'])
def get_common_chord_by_id(chord_id):
    """Public — return a single common_chords row by id, normalized like the search endpoint.

    Used by the find-a-chord-chart page to deep-link to a specific voicing via
    ?id=N (e.g., from Chord of the Day social posts). 404 if id not found.
    """
    try:
        with DatabaseTransaction() as db:
            row = db.execute(
                text("""
                    SELECT id, type, name, chord_data, created_at, order_col
                    FROM common_chords
                    WHERE id = :id
                    LIMIT 1
                """),
                {"id": chord_id}
            ).fetchone()

            if not row:
                return jsonify({"error": "Chord not found"}), 404

            import json
            chord_data = json.loads(row[3]) if isinstance(row[3], str) else (row[3] or {})

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

            return jsonify({
                "id": row[0],
                "type": row[1],
                "title": row[2],
                "created_at": row[4].isoformat() if row[4] else None,
                "order": row[5],
                "fingers": normalized_fingers,
                "barres": chord_data.get("barres", []),
                "openStrings": chord_data.get("openStrings", []),
                "mutedStrings": chord_data.get("mutedStrings", []),
                "startingFret": chord_data.get("startingFret", 1),
                "numFrets": chord_data.get("numFrets", 5),
                "numStrings": chord_data.get("numStrings", 6),
                "tuning": chord_data.get("tuning", "EADGBE"),
                "capo": chord_data.get("capo", 0),
            })

    except Exception as e:
        app.logger.error(f"Error fetching common chord by id={chord_id}: {str(e)}")
        return jsonify({"error": "Failed to fetch chord"}), 500


# Autocreate helper functions

def detect_file_types_with_sonnet(client, uploaded_files, user_id=None):
    """Detect file types using Sonnet 4.6 model (ported from sheets version)"""
    import time
    import json

    try:
        app.logger.info("Using Sonnet 4.6 to detect file types and content")

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
- Set "has_mixed_content": true ONLY if files contain BOTH visual chord diagrams AND chord names above lyrics
- Files with only chord names above lyrics (no visual diagrams) should be "chord_names" with has_mixed_content: false
- Files with only visual chord diagrams (no lyrics/chord names) should be "chord_charts" with has_mixed_content: false
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

        # Use Sonnet 4.6 for file type detection (simple 3-way classification)
        llm_start_time = time.time()
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=3000,
            messages=[{
                "role": "user",
                "content": message_content
            }]
        )
        llm_end_time = time.time()

        # Track LLM Analytics for file type detection
        from app.utils.llm_analytics import llm_analytics
        llm_analytics.track_generation(
            model="claude-sonnet-4-6",
            input_messages=[{"role": "user", "content": "File type detection for guitar content"}],
            output_choices=[{"message": {"content": response.content[0].text}}],
            usage={
                "input_tokens": response.usage.input_tokens if hasattr(response, 'usage') else None,
                "output_tokens": response.usage.output_tokens if hasattr(response, 'usage') else None
            },
            latency_seconds=llm_end_time - llm_start_time,
            custom_properties={
                "function": "detect_file_types_with_sonnet",
                "file_count": len(uploaded_files),
                "analysis_type": "file_type_detection"
            },
            user_id=user_id
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
                # For YouTube transcripts, don't trigger mixed content modal
                is_youtube_transcript = any(file_data.get('name') == 'youtube_transcript.txt' for file_data in uploaded_files)
                return {
                    "primary_type": "chord_names",
                    "has_mixed_content": not is_youtube_transcript,  # YouTube transcripts skip mixed content modal
                    "content_types": ["chord_names"] if is_youtube_transcript else ["chord_names"],
                    "analysis": {"error": "Could not parse detection response"}
                }

        result = json.loads(json_str)
        app.logger.info(f"File type detection result: {result.get('primary_type', 'unknown')} (mixed: {result.get('has_mixed_content', True)})")
        return result

    except Exception as e:
        app.logger.error(f"File type detection failed: {str(e)}")
        # Default to chord_names processing on error
        # For YouTube transcripts, don't trigger mixed content modal
        is_youtube_transcript = any(file_data.get('name') == 'youtube_transcript.txt' for file_data in uploaded_files)
        return {
            "primary_type": "chord_names",
            "has_mixed_content": not is_youtube_transcript,  # YouTube transcripts skip mixed content modal
            "content_types": ["chord_names"] if is_youtube_transcript else ["tablature"],
            "analysis": {"error": str(e)}
        }

def analyze_files_with_claude(client, uploaded_files, item_id, user_id=None, effort_level='medium'):
    """Analyze files and route to appropriate processing function (complete sheets version)"""
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
                return process_chord_charts_directly(client, uploaded_files, item_id, user_id=user_id, effort_level=effort_level)
            elif forced_type == 'chord_names':
                app.logger.info(f"[AUTOCREATE] Processing as chord names (user choice)")
                return process_chord_names_with_lyrics(client, uploaded_files, item_id, user_id=user_id)
            else:
                app.logger.warning(f"[AUTOCREATE] Unknown forced type: {forced_type}, falling back to chord names")
                return process_chord_names_with_lyrics(client, uploaded_files, item_id, user_id=user_id)

        # Step 1: File type detection using Sonnet 4.6
        app.logger.info(f"[AUTOCREATE] Step 1: Analyzing {len(uploaded_files)} files to detect content type using Sonnet 4.6")
        file_type_result = detect_file_types_with_sonnet(client, uploaded_files, user_id=user_id)

        # Step 2: Process based on detected content type
        if file_type_result.get('has_mixed_content'):
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
            return process_chord_charts_directly(client, uploaded_files, item_id, user_id=user_id, effort_level=effort_level)
        elif primary_type == 'chord_names':
            # Check if this is a YouTube transcript
            is_youtube_transcript = any(file_data.get('name') == 'youtube_transcript.txt' for file_data in uploaded_files)
            if is_youtube_transcript:
                return process_chord_names_from_youtube_transcript(client, uploaded_files, item_id, user_id=user_id)
            else:
                return process_chord_names_with_lyrics(client, uploaded_files, item_id, user_id=user_id)
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
            return process_chord_names_with_lyrics(client, uploaded_files, item_id, user_id=user_id)

    except Exception as e:
        app.logger.error(f"Error in Claude analysis: {str(e)}")
        return {'error': f'Analysis failed: {str(e)}'}

def simple_analyze_files(client, uploaded_files, item_id):
    """Simplified file analysis that processes chord names by default"""
    import time
    from app.utils.llm_analytics import track_llm_generation, track_llm_span

    # Start timing for analytics
    start_time = time.time()
    generation_id = None

    try:
        app.logger.info(f"[AUTOCREATE] Processing {len(uploaded_files)} files as chord names")

        # Track span for file processing
        processing_span_id = track_llm_span(
            name="file_processing",
            span_type="preprocessing",
            start_time=start_time,
            custom_properties={
                "file_count": len(uploaded_files),
                "item_id": item_id,
                "file_types": [f.get("type") for f in uploaded_files]
            }
        )

        # For now, process everything as chord names (most common case)
        # This is a simplified version - the full implementation has more sophisticated detection
        
        # Create message content with cacheable instructions first, then variable files
        message_content = []

        # Add the static analysis prompt first with caching enabled
        message_content.append({
            "type": "text",
            "text": """Extract chord names from this file. Look for chord symbols like G, C, Am, F7, etc.

Return a JSON array of chord objects with this format:
{
  "chords": [
    {"name": "G", "section": "Verse"},
    {"name": "C", "section": "Verse"},
    {"name": "Am", "section": "Chorus"},
    {"name": "F", "section": "Chorus"}
  ]
}

If you can't determine sections, use "Main" as the section name.""",
            "cache_control": {"type": "ephemeral"}
        })

        # Then add the variable file content
        for i, file_data in enumerate(uploaded_files):
            if file_data['type'] == 'pdf':
                message_content.append({
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": file_data['data']
                    }
                })
            elif file_data['type'] == 'image':
                message_content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": file_data['media_type'],
                        "data": file_data['data']
                    }
                })

        # Call Claude API with prompt caching enabled (Sonnet 4.6 for simple text extraction)
        llm_start_time = time.time()
        try:
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=8000,
                messages=[{
                    "role": "user",
                    "content": message_content
                }],
                extra_headers={"anthropic-beta": "prompt-caching-2024-07-31"}
            )
            llm_end_time = time.time()
            llm_latency = (llm_end_time - llm_start_time) * 1000  # Convert to milliseconds

            app.logger.info(f"[AUTOCREATE] Received response from Claude")

            # Extract usage information for analytics
            usage_dict = {}
            if hasattr(response, 'usage') and response.usage:
                usage = response.usage
                usage_dict = {
                    "input_tokens": getattr(usage, 'input_tokens', 0),
                    "output_tokens": getattr(usage, 'output_tokens', 0),
                    "cache_creation_input_tokens": getattr(usage, 'cache_creation_input_tokens', 0),
                    "cache_read_input_tokens": getattr(usage, 'cache_read_input_tokens', 0)
                }

                # Log cache usage
                if usage_dict.get('cache_creation_input_tokens'):
                    app.logger.info(f"[CACHE] Cache creation tokens: {usage_dict['cache_creation_input_tokens']}")
                if usage_dict.get('cache_read_input_tokens'):
                    app.logger.info(f"[CACHE] Cache read tokens: {usage_dict['cache_read_input_tokens']}")
                app.logger.info(f"[USAGE] Input tokens: {usage_dict['input_tokens']}, Output tokens: {usage_dict['output_tokens']}")

            # Track the LLM generation with PostHog LLM Analytics
            # CRITICAL: Pass user_id from autocreate route
            # Note: user_id comes from simple_analyze_files caller, need to add to function signature
            generation_id = track_llm_generation(
                model="claude-sonnet-4-6",
                input_messages=[{
                    "role": "user",
                    "content": "Extract chord names from uploaded guitar files"  # Simplified for privacy
                }],
                output_choices=[{
                    "role": "assistant",
                    "content": response.content[0].text[:200] + "..." if len(response.content[0].text) > 200 else response.content[0].text
                }],
                usage=usage_dict,
                latency_seconds=llm_latency / 1000,  # Will be converted back to ms in track_llm_generation
                status="success",
                custom_properties={
                    "feature": "autocreate_chord_charts",
                    "item_id": item_id,
                    "file_count": len(uploaded_files),
                    "file_types": [f.get("type") for f in uploaded_files],
                    "prompt_caching_enabled": True,
                    "cache_hit": bool(usage_dict.get('cache_read_input_tokens', 0) > 0)
                },
                privacy_mode=False,  # Set to True to exclude actual input/output
                user_id=current_user.id if current_user.is_authenticated else None
            )

        except Exception as api_error:
            llm_end_time = time.time()
            llm_latency = (llm_end_time - llm_start_time) * 1000

            # Track failed generation
            generation_id = track_llm_generation(
                model="claude-sonnet-4-6",
                input_messages=[{"role": "user", "content": "Extract chord names from uploaded guitar files"}],
                output_choices=[],
                latency_seconds=llm_latency / 1000,  # Will be converted back to ms in track_llm_generation
                status="error",
                error=str(api_error),
                custom_properties={
                    "feature": "autocreate_chord_charts",
                    "item_id": item_id,
                    "file_count": len(uploaded_files),
                    "error_type": type(api_error).__name__
                },
                user_id=current_user.id if current_user.is_authenticated else None
            )
            raise api_error

        # Parse response
        response_text = response.content[0].text

        # Extract JSON from response
        import json, re

        # Try to find JSON in the response
        json_match = re.search(r'\{[\s\S]*\}', response_text)
        if json_match:
            try:
                chord_data = json.loads(json_match.group())

                # Handle both legacy and modern formats (matching sheets version behavior)
                chords = []

                # Check for modern sections-based format first (preferred)
                sections = chord_data.get('sections', [])
                if sections:
                    app.logger.info(f"[AUTOCREATE] Processing modern sections format with {len(sections)} sections")
                    for section in sections:
                        section_chords = section.get('chords', [])
                        section_label = section.get('label', 'Main')
                        for chord in section_chords:
                            # Add section info to chord for processing
                            chord['section'] = section_label
                            chords.append(chord)
                else:
                    # Fall back to legacy format (chord_data.chords with row/position)
                    chords = chord_data.get('chords', [])
                    app.logger.info(f"[AUTOCREATE] Processing legacy chords format")

                app.logger.info(f"[AUTOCREATE] Extracted {len(chords)} total chords")
                
                # Create chord charts using the data layer
                if chords:
                    # Load CommonChords for lookup
                    app.logger.info("[AUTOCREATE] Loading CommonChords for chord shape lookup")
                    common_chords = data_layer.get_common_chords_efficiently()
                    
                    # Create lookup dictionary by chord name
                    chord_lookup = {}
                    for common_chord in common_chords:
                        chord_name = common_chord['title'].strip().upper()
                        chord_lookup[chord_name] = common_chord
                    
                    app.logger.info(f"[AUTOCREATE] Loaded {len(common_chords)} common chords for lookup")
                    
                    # Convert to the format expected by batch_add_chord_charts
                    chord_charts_data = []

                    def process_single_chord(chord, chord_lookup, chord_charts_data, order):
                        chord_name = chord['name'].strip().upper()

                        # Look up chord shape in CommonChords
                        if chord_name in chord_lookup:
                            common_chord = chord_lookup[chord_name]
                            app.logger.info(f"[AUTOCREATE] Found shape for {chord_name}")

                            # Filter CommonChords fingers to only include fretted positions (fret > 0)
                            # This matches the visual analysis filtering and prevents blank chord displays
                            raw_fingers = common_chord['fingers']
                            filtered_fingers = []
                            if raw_fingers:
                                for finger in raw_fingers:
                                    if isinstance(finger, list) and len(finger) >= 2 and finger[1] > 0:
                                        filtered_fingers.append(finger)

                            chord_data = {
                                'fingers': filtered_fingers,
                                'barres': common_chord['barres'],
                                'tuning': common_chord['tuning'] if isinstance(common_chord['tuning'], list) else ['E', 'A', 'D', 'G', 'B', 'E'],
                                'numFrets': common_chord['numFrets'],
                                'numStrings': common_chord['numStrings'],
                                'capo': common_chord['capo'],
                                'openStrings': common_chord['openStrings'],
                                'mutedStrings': common_chord['mutedStrings'],
                                'startingFret': common_chord['startingFret'],
                                'sectionId': f"section-{hash(chord.get('section', 'Main')) % 10000}",
                                'sectionLabel': chord.get('section', 'Main'),
                                'sectionRepeatCount': '',
                                'lineBreakAfter': chord.get('lineBreakAfter', False)
                            }
                        else:
                            app.logger.warning(f"[AUTOCREATE] No shape found for {chord_name}, using empty chord")
                            chord_data = {
                                'fingers': [],
                                'barres': [],
                                'tuning': ['E', 'A', 'D', 'G', 'B', 'E'],
                                'sectionId': f"section-{hash(chord.get('section', 'Main')) % 10000}",
                                'sectionLabel': chord.get('section', 'Main'),
                                'sectionRepeatCount': '',
                                'lineBreakAfter': chord.get('lineBreakAfter', False)
                            }

                        chord_charts_data.append({
                            'title': chord['name'],
                            'chord_data': chord_data,
                            'order': order
                        })

                    # Handle both legacy row/position format and modern sections format for layout preservation
                    if chords and ('row' in chords[0] or any('row' in chord for chord in chords)):
                        app.logger.info("[AUTOCREATE] Processing format with row/position layout preservation")
                        # Group chords by section, then by row and position for layout preservation
                        sections_with_rows = {}
                        for chord in chords:
                            section = chord.get('section', 'Main')
                            row = chord.get('row', 1)
                            position = chord.get('position', 1)

                            if section not in sections_with_rows:
                                sections_with_rows[section] = {}
                            if row not in sections_with_rows[section]:
                                sections_with_rows[section][row] = {}
                            sections_with_rows[section][row][position] = chord

                        # Process chords maintaining section and row structure
                        for section_name in sections_with_rows:
                            rows = sections_with_rows[section_name]
                            for row_num in sorted(rows.keys()):
                                row_positions = rows[row_num]
                                max_position = max(row_positions.keys())
                                for pos_num in sorted(row_positions.keys()):
                                    chord = row_positions[pos_num]
                                    chord['section'] = section_name

                                    # Set lineBreakAfter for last chord in row to preserve layout
                                    chord['lineBreakAfter'] = (pos_num == max_position)

                                    # Process this chord
                                    process_single_chord(chord, chord_lookup, chord_charts_data, len(chord_charts_data))
                    else:
                        # Handle modern format without row/position or simple list
                        for i, chord in enumerate(chords):
                            # Check if lineBreakAfter is explicitly set from Claude's response
                            if 'lineBreakAfter' not in chord:
                                chord['lineBreakAfter'] = False  # Default to false
                            process_single_chord(chord, chord_lookup, chord_charts_data, i)
                    
                    # Track span for database operations
                    db_start_time = time.time()
                    db_span_id = track_llm_span(
                        name="database_chord_creation",
                        span_type="database",
                        start_time=db_start_time,
                        generation_id=generation_id,
                        custom_properties={
                            "chord_count": len(chord_charts_data),
                            "item_id": item_id
                        }
                    )

                    # Use data layer to create chord charts
                    app.logger.info(f"[AUTOCREATE] Creating {len(chord_charts_data)} chord charts in database")
                    results = data_layer.batch_add_chord_charts(item_id, chord_charts_data)

                    # Complete database span
                    db_end_time = time.time()
                    track_llm_span(
                        name="database_chord_creation",
                        span_type="database",
                        start_time=db_start_time,
                        end_time=db_end_time,
                        generation_id=generation_id,
                        custom_properties={
                            "chord_count": len(chord_charts_data),
                            "item_id": item_id,
                            "success": True
                        },
                        status="success"
                    )

                    # Complete processing span
                    processing_end_time = time.time()
                    track_llm_span(
                        name="file_processing",
                        span_type="preprocessing",
                        start_time=start_time,
                        end_time=processing_end_time,
                        generation_id=generation_id,
                        custom_properties={
                            "file_count": len(uploaded_files),
                            "item_id": item_id,
                            "chords_extracted": len(chords),
                            "chords_created": len(chord_charts_data)
                        },
                        status="success"
                    )

                    return {
                        'success': True,
                        'message': f'Successfully created {len(chord_charts_data)} chord charts',
                        'chord_charts_created': len(chord_charts_data),
                        'analysis': f'Found chord progression: {", ".join([c["name"] for c in chords])}',
                        'generation_id': generation_id  # For analytics correlation
                    }
                else:
                    return {'error': 'No chords found in the uploaded file'}
                    
            except json.JSONDecodeError as e:
                app.logger.error(f"Failed to parse JSON from Claude response: {e}")
                return {'error': 'Failed to parse chord data from file'}
        else:
            return {'error': 'No chord data found in file'}
            
    except Exception as e:
        # Track error span if we have a generation_id
        if generation_id:
            error_end_time = time.time()
            track_llm_span(
                name="file_processing",
                span_type="preprocessing",
                start_time=start_time,
                end_time=error_end_time,
                generation_id=generation_id,
                custom_properties={
                    "file_count": len(uploaded_files),
                    "item_id": item_id,
                    "error_type": type(e).__name__
                },
                status="error",
                error=str(e)
            )

        app.logger.error(f"Error in simple_analyze_files: {str(e)}")
        return {'error': f'Analysis failed: {str(e)}'}

# NOTE: An earlier iteration of autocreate used an agentic tool-use loop with a
# crop_image tool (CROP_TOOL) and MAX_CROP_ITERATIONS guard. The current architecture
# calls handle_crop() directly from Python after pixel-based bbox detection, so the
# tool definition is no longer needed. If reintroducing agentic cropping, add the
# tool schema back here.


def handle_crop(image, x1, y1, x2, y2, upscale=1):
    """Crop the image using normalized 0-1 coordinates and return as base64 PNG content blocks.

    upscale: integer multiplier applied to the cropped region BEFORE encoding (LANCZOS).
        Use 2-3x to help the model count fret lines on small per-chord crops.
        The result is clamped to a max long edge of 2576px (Opus 4.8 max).
    """
    import io as _io
    from PIL import Image as _PILImage

    x1 = max(0.0, min(1.0, x1))
    y1 = max(0.0, min(1.0, y1))
    x2 = max(0.0, min(1.0, x2))
    y2 = max(0.0, min(1.0, y2))

    if x2 <= x1 or y2 <= y1:
        return [{"type": "text", "text": "Error: Invalid crop coordinates. x2 must be > x1 and y2 must be > y1."}]

    width, height = image.size
    left = int(x1 * width)
    top = int(y1 * height)
    right = int(x2 * width)
    bottom = int(y2 * height)

    if (right - left) < 20 or (bottom - top) < 20:
        return [{"type": "text", "text": "Error: Crop region too small. Please specify a larger area."}]

    cropped = image.crop((left, top, right, bottom))
    if cropped.mode in ("RGBA", "P"):
        cropped = cropped.convert("RGB")

    if upscale and upscale > 1:
        cw, ch = cropped.size
        target_w = cw * upscale
        target_h = ch * upscale
        # Clamp to API max long edge to avoid rejection.
        api_max_edge = 2576
        long_edge = max(target_w, target_h)
        if long_edge > api_max_edge:
            scale = api_max_edge / long_edge
            target_w = max(1, int(target_w * scale))
            target_h = max(1, int(target_h * scale))
        cropped = cropped.resize((target_w, target_h), _PILImage.LANCZOS)

    final_w, final_h = cropped.size
    buffer = _io.BytesIO()
    cropped.save(buffer, format='PNG')
    buffer.seek(0)
    cropped_base64 = base64.b64encode(buffer.read()).decode('utf-8')

    return [
        {"type": "text", "text": f"Cropped region ({final_w}x{final_h}px):"},
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": cropped_base64
            }
        }
    ]


# Default thresholds used by _detect_diagram_rows_and_bboxes. Exposed at module scope so
# callers can override per-call (via `overrides` kwarg) without editing the function.
# All fractions are relative to image width/height. If a real PDF triggers a layout
# misdetection, tuning these is the first thing to try.
DIAGRAM_DETECTION_DEFAULTS = {
    'dark_threshold': 200,       # grayscale value below which a pixel counts as ink
    'row_min_height_frac': 0.03, # ignore ink bands shorter than this (filters page numbers/noise)
    'row_gap_min_frac': 0.012,   # minimum quiet gap between rows
    'row_pad_frac': 0.01,        # padding added above/below detected row bands
    'col_pad_frac': 0.005,       # padding added left/right of detected per-panel bboxes
    # Light-bg per-panel detection (column projection):
    'col_min_width_frac': 0.02,  # ignore ink columns narrower than this (filters specks)
    'col_gap_min_frac': 0.003,   # minimum quiet gap between diagrams within a row.
                                 # Some real-world charts pack diagrams as close as ~9px;
                                 # others use ~75px gaps. 0.003 covers both. Internal grid
                                 # columns always have ≥1 dark pixel from horizontal fret
                                 # lines so a low threshold doesn't fragment a single panel.
    # Dark-bg per-panel detection (string counting):
    'string_dark_threshold': 100, # pixel grayscale < this counts as "dark" for string detection
                                  # (independent of dark_threshold which controls ink-mask polarity)
    'string_max_width_frac': 0.005, # max width of a stripe to count as a string (relative to image width)
                                    # 0.005 = 5px on a 1000px image; fits typical 1-3px string lines
                                    # plus a margin for anti-aliasing.
    'strings_per_panel': 6,         # guitar (and most chord charts) have 6 strings per diagram
    # Inverted-panels path (light page, dark panels — e.g. dark-mode Word exports
    # where panel SVGs were inverted to dark fill but the page bg stayed white):
    'inverted_center_frac': 0.4,    # central rectangle (W×H fraction) sampled to detect
                                    # "dark panels on light page" via median grayscale
    'inverted_row_gap_min_frac': 0.01,  # row gap threshold for inverted path. Lower than
                                        # default 0.012 because dark-panel rows in this
                                        # layout commonly separate by only ~37px white at
                                        # 300dpi — too narrow for the default to register.
    'inverted_string_light_threshold': 50,  # pixel grayscale > this counts as a "light"
                                            # string stripe on a dark panel. Lower than
                                            # 255-string_dark_threshold (=155) because
                                            # SVG-rendered strings on dark panels can peak
                                            # as low as gray~99, but panel interiors render
                                            # essentially black (gray=0), so any threshold
                                            # above noise reliably distinguishes the two.
}


def _detect_diagram_rows_and_bboxes(pil_image, overrides=None, **kwargs):
    """Detect rows of chord diagrams and per-diagram bounding boxes from pixels.

    Returns: list of rows, each row a list of (x1, y1, x2, y2) tuples in NORMALIZED
    (0.0-1.0) coordinates, in reading order (top-to-bottom, then left-to-right).

    Strategy:
      1. Detect layout polarity from BOTH corner pixels and a central content sample:
         - 'light':    light corners + light center  → light page, light panels
         - 'dark':     dark corners                  → dark page, white panels (inverted)
         - 'inverted': light corners + dark center   → light page, DARK panels (the
                       "dark-mode Word export where panel SVGs were inverted to dark fill
                       but the page bg stayed white" case)
      2. Build an ink mask (panel area for dark/inverted, content for light). Project
         onto Y axis to find horizontal row bands separated by quiet gaps.
      3. Per-panel detection branches on polarity:
         - 'light':    project ink onto X axis within each row, find vertical bands
                       separated by whitespace gaps. Reliable when inter-panel gaps
                       are clean.
         - 'dark':     scan for narrow DARK vertical stripes (strings on white panels)
                       and group every N=6 into a panel. Handles touching panels.
         - 'inverted': scan for narrow LIGHT vertical stripes (strings on dark panels)
                       and group every N=6 into a panel. Same touching-panels logic
                       as 'dark' but with inverted stripe polarity.

    The string-counting paths exist because adjacent panels can touch with no clean
    pixel gap (Word/SVG paste-ups). On light-on-light layouts column projection is
    more robust because chord-name text glyphs would otherwise look like stripes.

    Thresholds are taken from DIAGRAM_DETECTION_DEFAULTS and can be overridden by
    passing an `overrides` dict or individual kwargs.
    """
    import numpy as np
    from collections import Counter

    params = dict(DIAGRAM_DETECTION_DEFAULTS)
    if overrides:
        params.update(overrides)
    params.update(kwargs)

    dark_threshold = params['dark_threshold']
    row_min_height_frac = params['row_min_height_frac']
    row_gap_min_frac = params['row_gap_min_frac']
    row_pad_frac = params['row_pad_frac']
    col_pad_frac = params['col_pad_frac']
    col_min_width_frac = params['col_min_width_frac']
    col_gap_min_frac = params['col_gap_min_frac']
    string_dark_threshold = params['string_dark_threshold']
    string_max_width_frac = params['string_max_width_frac']
    strings_per_panel = params['strings_per_panel']
    inverted_center_frac = params['inverted_center_frac']
    inverted_row_gap_min_frac = params['inverted_row_gap_min_frac']
    inverted_string_light_threshold = params['inverted_string_light_threshold']

    w, h = pil_image.size
    gray = np.array(pil_image.convert('L'))

    # ---- Background polarity detection ----
    # Corner pixels are almost always page background; the central rectangle is almost
    # always content. Three layouts to distinguish:
    #   'dark':     dark corners                       → dark page, white panels.
    #   'inverted': light corners + dark center        → light page, DARK panels (a
    #               dark-mode export pattern where panel SVG fills got inverted but the
    #               page bg stayed white). Treat panel interior as ink and scan for
    #               LIGHT strings within rows.
    #   'light':    light corners + light/mixed center → conventional light-on-light layout.
    corner_samples = [gray[0, 0], gray[0, -1], gray[-1, 0], gray[-1, -1]]
    corner_median = float(np.median(corner_samples))
    cy1 = int(h * (1 - inverted_center_frac) / 2)
    cy2 = int(h * (1 + inverted_center_frac) / 2)
    cx1 = int(w * (1 - inverted_center_frac) / 2)
    cx2 = int(w * (1 + inverted_center_frac) / 2)
    center_median = float(np.median(gray[cy1:cy2, cx1:cx2]))

    if corner_median < 128:
        polarity = 'dark'
    elif center_median < 128:
        polarity = 'inverted'
    else:
        polarity = 'light'

    if polarity == 'dark':
        # Page bg is dark, so the page surface itself is "ink-free"; panel area is light
        # and shows up when we invert the threshold.
        ink = gray > (255 - dark_threshold)
        app.logger.info(
            "[AUTOCREATE-CROP] Dark background detected (corner_median=%.0f); inverting ink mask",
            corner_median,
        )
    elif polarity == 'inverted':
        # Page bg is light but panels are filled dark → standard `gray < threshold` mask
        # already makes panels project as ink. Use a tighter row-gap threshold because
        # adjacent dark-panel rows can be separated by white slivers as narrow as ~37px
        # at 300dpi, which the default 0.012 frac would merge.
        ink = gray < dark_threshold
        row_gap_min_frac = inverted_row_gap_min_frac
        app.logger.info(
            "[AUTOCREATE-CROP] Inverted-panel layout detected "
            "(corner_median=%.0f, center_median=%.0f); using string-counting on light stripes",
            corner_median, center_median,
        )
    else:
        ink = gray < dark_threshold

    # ---- Step 1: row detection ----
    row_ink = ink.sum(axis=1)
    row_noise_floor = max(2, int(w * 0.01))
    row_has_ink = row_ink > row_noise_floor

    row_gap_min_px = max(2, int(h * row_gap_min_frac))
    row_min_height_px = max(2, int(h * row_min_height_frac))
    row_pad_px = max(1, int(h * row_pad_frac))

    row_bands = []
    in_band = False
    band_start = 0
    gap_run = 0
    for y in range(h):
        if row_has_ink[y]:
            if not in_band:
                in_band = True
                band_start = y
            gap_run = 0
        else:
            if in_band:
                gap_run += 1
                if gap_run >= row_gap_min_px:
                    band_end = y - gap_run
                    if (band_end - band_start) >= row_min_height_px:
                        row_bands.append((band_start, band_end))
                    in_band = False
                    gap_run = 0
    if in_band:
        band_end = h - 1
        if (band_end - band_start) >= row_min_height_px:
            row_bands.append((band_start, band_end))

    padded_rows = []
    for (y1_px, y2_px) in row_bands:
        py1 = max(0, y1_px - row_pad_px)
        py2 = min(h, y2_px + row_pad_px + 1)
        padded_rows.append((py1, py2))

    # ---- Step 2: per-panel detection ----
    col_pad_px = max(1, int(w * col_pad_frac))

    if polarity == 'light':
        # Light bg: column projection within each row. Inter-panel gaps are clean
        # whitespace; string counting gets confused by chord-name text glyphs.
        col_gap_min_px = max(2, int(w * col_gap_min_frac))
        col_min_width_px = max(2, int(w * col_min_width_frac))
        col_noise_floor = max(2, int(h * 0.005))

        detected_rows = []
        for (y1_px, y2_px) in padded_rows:
            row_slice = ink[y1_px:y2_px, :]
            col_ink = row_slice.sum(axis=0)
            col_has_ink = col_ink > col_noise_floor

            col_bands = []
            in_band = False
            band_start = 0
            gap_run = 0
            for x in range(w):
                if col_has_ink[x]:
                    if not in_band:
                        in_band = True
                        band_start = x
                    gap_run = 0
                else:
                    if in_band:
                        gap_run += 1
                        if gap_run >= col_gap_min_px:
                            band_end = x - gap_run
                            if (band_end - band_start) >= col_min_width_px:
                                col_bands.append((band_start, band_end))
                            in_band = False
                            gap_run = 0
            if in_band:
                band_end = w - 1
                if (band_end - band_start) >= col_min_width_px:
                    col_bands.append((band_start, band_end))

            row_bboxes = []
            for (x1_px, x2_px) in col_bands:
                px1 = max(0, x1_px - col_pad_px)
                px2 = min(w, x2_px + col_pad_px + 1)
                row_bboxes.append((
                    px1 / w,
                    y1_px / h,
                    px2 / w,
                    y2_px / h,
                ))
            detected_rows.append(row_bboxes)

        return detected_rows

    # Dark or inverted: count narrow vertical stripes (strings) and group every N into
    # a panel. This handles the touching-panels case where projection-based detection
    # would merge adjacent panels into one band.
    #
    # For polarity == 'dark'     (white panels on dark page) → strings are DARK lines.
    # For polarity == 'inverted' (dark panels on light page) → strings are LIGHT lines.
    string_max_width_px = max(3, int(w * string_max_width_frac))
    looking_for_dark = (polarity == 'dark')

    def _group_into_panels(stripes):
        """Group string positions into panels of `strings_per_panel`. Try every candidate
        threshold (midpoint of consecutive sorted gaps) and pick the one that maximises
        the count of exactly-N-string groups. Falls back to splitting at the largest gap
        when no threshold yields a clean grouping. Returns a list of stripe lists."""
        if len(stripes) < strings_per_panel:
            return []
        centers = [(a + b) / 2.0 for (a, b) in stripes]
        gaps = [centers[i + 1] - centers[i] for i in range(len(centers) - 1)]
        if not gaps:
            return [list(stripes)]

        sorted_g = sorted(gaps)
        candidates = sorted({(sorted_g[i] + sorted_g[i + 1]) / 2
                             for i in range(len(sorted_g) - 1)
                             if sorted_g[i + 1] > sorted_g[i]})
        if not candidates:
            return [list(stripes)]

        def split(threshold):
            out = []
            cur = [stripes[0]]
            for i, gap in enumerate(gaps):
                if gap > threshold:
                    out.append(cur)
                    cur = [stripes[i + 1]]
                else:
                    cur.append(stripes[i + 1])
            out.append(cur)
            return out

        best_key = None
        best_groups = None
        for t in candidates:
            gs = split(t)
            score = sum(1 for g in gs if len(g) == strings_per_panel)
            # Prefer more N-sized groups; tiebreak by more groups (finer split);
            # second tiebreak by smaller threshold (preserves real boundaries).
            key = (score, len(gs), -t)
            if best_key is None or key > best_key:
                best_key = key
                best_groups = gs
        return best_groups or []

    def _detect_string_stripes(y1_px, y2_px):
        """Find a horizontal scanline within [y1, y2) whose narrow stripes group most
        cleanly into N-string panels. Returns list of (x_start, x_end) for each stripe.

        Strings span the full panel height, so most scanlines through the fret grid
        cross every string. But near the band edges (chord-name labels at top, finger-
        number labels at bottom) we get extra narrow stripes from text glyphs that
        ruin the grouping. Two scanlines can have the same total stripe count yet
        very different groupability — so rank by (#N-sized groups, total stripes)
        rather than total stripes alone."""
        # Margin trims band edges where labels / fingering numbers can produce extra
        # narrow stripes. Inverted layouts pack panels tightly with bottom labels (e.g.
        # "x 3 2 1 -") that appear in the same band as the next row's top labels when
        # rows touch — pull margin in to inner 50% to stay inside the fret grid.
        margin_frac = 4 if polarity == 'inverted' else 10
        margin = max(2, (y2_px - y1_px) // margin_frac)
        step = max(1, min(3, (y2_px - y1_px) // 8))
        best_key = (-1, -1)  # (n_size_N_groups, total_stripes)
        best_stripes = []
        for y in range(y1_px + margin, y2_px - margin, step):
            scan = gray[y, :]
            if looking_for_dark:
                is_stripe = scan < string_dark_threshold
            else:
                # Inverted path: light stripes on dark panels. Use a dedicated threshold
                # because some SVG renderings produce dim string lines (peaks well below
                # the symmetric 255-string_dark_threshold = 155 cutoff).
                is_stripe = scan > inverted_string_light_threshold
            stripes = []
            in_run = False
            sx = 0
            for x in range(w):
                if is_stripe[x]:
                    if not in_run:
                        in_run = True
                        sx = x
                else:
                    if in_run:
                        if 1 <= (x - sx) <= string_max_width_px:
                            stripes.append((sx, x))
                        in_run = False
            if in_run and 1 <= (w - sx) <= string_max_width_px:
                stripes.append((sx, w))
            if len(stripes) < strings_per_panel:
                continue
            groups = _group_into_panels(stripes)
            n_groups_n = sum(1 for g in groups if len(g) == strings_per_panel)
            key = (n_groups_n, len(stripes))
            if key > best_key:
                best_key = key
                best_stripes = stripes
        return best_stripes

    detected_rows = []
    for (y1_px, y2_px) in padded_rows:
        stripes = _detect_string_stripes(y1_px, y2_px)
        if len(stripes) < strings_per_panel:
            # Not enough strings to form even one panel — title rows, decorative bands, etc.
            continue
        groups = _group_into_panels(stripes)
        if not groups:
            continue

        # Reject bands where the dominant group size isn't N. This filters out title
        # rows and decorative bands whose letter strokes look like narrow dark stripes
        # but cluster into 1-2-string "panels" rather than 6-string chord diagrams.
        sizes = [len(g) for g in groups]
        mode_size, _ = Counter(sizes).most_common(1)[0]
        if mode_size != strings_per_panel:
            continue

        # Reject bands with only one N-sized group: a lone 6-stripe cluster is more
        # often a coincidence (title-row letter strokes happening to align) than a
        # real chord-chart row, which has ≥2 panels in practice.
        # Trade-off: this also rejects legitimate single-panel rows. We accept that
        # because the false-positive rate from title text was worse, and single-panel
        # rows are rare in real chord-chart layouts.
        n_size_groups = sum(1 for g in groups if len(g) == strings_per_panel)
        if n_size_groups < 2:
            continue

        row_bboxes = []
        for grp in groups:
            # Skip groups outside [N-1, N+1] — usually 1-2-string clusters of label
            # noise sandwiched between real panels. Real chord diagrams are always
            # 6 strings; ±1 absorbs single false-positive or single missed-detection.
            if not (strings_per_panel - 1 <= len(grp) <= strings_per_panel + 1):
                continue
            x_first = grp[0][0]
            x_last = grp[-1][1]
            px1 = max(0, x_first - col_pad_px)
            px2 = min(w, x_last + col_pad_px + 1)
            row_bboxes.append((
                px1 / w,
                y1_px / h,
                px2 / w,
                y2_px / h,
            ))
        if row_bboxes:
            detected_rows.append(row_bboxes)

    return detected_rows


def _extract_json_text(response):
    """Extract the first text block from a structured-output response and parse as JSON.

    Returns the parsed object, or None if no text block was found / JSON failed to parse.
    """
    for block in response.content:
        if getattr(block, 'type', None) == 'text':
            try:
                return json.loads(block.text)
            except json.JSONDecodeError as e:
                app.logger.warning(f"[AUTOCREATE-CROP] JSON parse failed on text block ({len(block.text)} chars): {e}")
                return None
    return None


def _read_one_chord(per_chord_client, source_image, survey_chord, read_prompt, read_schema,
                    effort_level, effort_config, crop_debug_dir, chord_index, total_chords):
    """Read a single chord diagram via Phase 2 API call.

    Returns: (chord_record | None, input_tokens, output_tokens, was_transient_api_failure)
      - chord_record is a dict with keys: name, frets, visualDescription, section, row_idx
      - None is returned on any failure (crop failed, API error, bad JSON, wrong fret count)
      - token counts are returned even on failure so callers can still aggregate usage
      - was_transient_api_failure is True only when the API itself failed transiently
        (overload, rate limit, timeout, connection, 5xx) — used by the caller to surface
        a "try again" hint to the user. Other failures (bad JSON, wrong fret count, crop
        problems) do NOT set this flag — those are bugs we want to investigate, not
        transient issues to retry.
    """
    import re

    section = survey_chord.get('section', 'Chords')
    chord_name = survey_chord.get('name', '')
    bbox = survey_chord.get('bbox') or {}
    x1 = bbox.get('x1', 0)
    y1 = bbox.get('y1', 0)
    x2 = bbox.get('x2', 1)
    y2 = bbox.get('y2', 1)

    app.logger.info(
        f"[AUTOCREATE-CROP] Reading chord {chord_index+1}/{total_chords} '{chord_name}' "
        f"({section}): bbox=({x1:.3f}, {y1:.3f}, {x2:.3f}, {y2:.3f})"
    )

    # Crop the chord. Upscale 3x so the model can clearly count thin fret lines —
    # tight per-diagram crops are often only ~120-180px tall on a 300dpi page,
    # which is right at the model's discrimination threshold for fret-line counting.
    crop_result = handle_crop(source_image, x1, y1, x2, y2, upscale=3)
    crop_image_block = None
    for block in crop_result:
        if isinstance(block, dict) and block.get('type') == 'image':
            crop_image_block = block
            break

    if not crop_image_block:
        app.logger.warning(f"[AUTOCREATE-CROP] Failed to crop chord {chord_index+1} '{chord_name}', skipping")
        return None, 0, 0, False

    # Diagnostic: save the actual crop sent to the API so we can visually verify
    if crop_debug_dir:
        try:
            safe_name = re.sub(r'[^A-Za-z0-9#♭_-]', '_', chord_name)[:32] or 'chord'
            crop_path = os.path.join(crop_debug_dir, f"{chord_index+1:02d}_{safe_name}_{section[:16]}.png")
            with open(crop_path, 'wb') as f:
                f.write(base64.b64decode(crop_image_block['source']['data']))
        except Exception as save_err:
            app.logger.debug(f"[AUTOCREATE-CROP] Could not save crop {chord_index+1}: {save_err}")

    # Stateless call — sends just this one chord crop + the read prompt.
    # Effort/max_tokens come from effort_config (set per the user's tier above).
    api_kwargs = dict(
        model="claude-opus-4-8",
        max_tokens=effort_config['max_tokens'],
        thinking=effort_config['thinking'],
        output_config={
            **effort_config['output_config'],
            "format": {"type": "json_schema", "schema": read_schema},
        },
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": read_prompt, "cache_control": {"type": "ephemeral"}},
                crop_image_block
            ]
        }]
    )

    try:
        if effort_level == 'high':
            with per_chord_client.messages.stream(**api_kwargs) as stream:
                chord_response = stream.get_final_message()
        else:
            chord_response = per_chord_client.messages.create(**api_kwargs)
    except Exception as chord_error:
        # Detect transient API-side failures (overload, rate limit, timeout, connection,
        # 5xx). These are worth surfacing to the user as "try again" since they're not
        # caused by the user's input. Other errors (BadRequest, etc.) are bugs we'd rather
        # see in logs than in the UI.
        is_transient_api_failure = isinstance(chord_error, (
            anthropic.APIStatusError,        # covers overloaded_error, rate_limit_error, 5xx
            anthropic.APITimeoutError,
            anthropic.APIConnectionError,
        )) and not isinstance(chord_error, (
            anthropic.BadRequestError,
            anthropic.AuthenticationError,
            anthropic.PermissionDeniedError,
            anthropic.NotFoundError,
        ))
        app.logger.warning(
            f"[AUTOCREATE-CROP] Chord {chord_index+1} '{chord_name}': API call failed "
            f"({type(chord_error).__name__}: {chord_error}). Skipping. "
            f"transient_api_failure={is_transient_api_failure}"
        )
        return None, 0, 0, is_transient_api_failure

    input_tokens = 0
    output_tokens = 0
    if hasattr(chord_response, 'usage'):
        input_tokens = chord_response.usage.input_tokens
        output_tokens = chord_response.usage.output_tokens
        cache_read = getattr(chord_response.usage, 'cache_read_input_tokens', 0) or 0
        cache_create = getattr(chord_response.usage, 'cache_creation_input_tokens', 0) or 0
        if cache_read or cache_create:
            app.logger.info(f"[AUTOCREATE-CROP] Chord {chord_index+1} cache: read={cache_read}, create={cache_create}")

    # Extract thinking summary for logging (truncated)
    thinking_summary = ""
    for block in chord_response.content:
        if getattr(block, 'type', None) == "thinking":
            thinking_summary = getattr(block, "thinking", "") or ""
            break

    app.logger.info(
        f"[AUTOCREATE-CROP] Chord {chord_index+1} '{chord_name}' response: "
        f"{chord_response.usage.output_tokens} output tokens"
    )
    if thinking_summary:
        app.logger.info(
            f"[AUTOCREATE-CROP] Chord {chord_index+1} thinking ({len(thinking_summary)} chars): "
            f"{thinking_summary[:400]}{'...' if len(thinking_summary) > 400 else ''}"
        )

    chord_json = _extract_json_text(chord_response)
    if not isinstance(chord_json, dict):
        app.logger.warning(f"[AUTOCREATE-CROP] Chord {chord_index+1} '{chord_name}': no usable JSON extracted")
        return None, input_tokens, output_tokens, False

    frets = chord_json.get('frets')
    if not (isinstance(frets, list) and len(frets) == 6):
        app.logger.warning(
            f"[AUTOCREATE-CROP] Chord {chord_index+1} '{chord_name}': dropping — "
            f"frets has {len(frets) if isinstance(frets, list) else 'no'} entries (need exactly 6)"
        )
        return None, input_tokens, output_tokens, False

    # Synthesize a chord record matching the downstream-expected shape.
    # row_idx (from pixel detection) lets the assembly step insert lineBreakAfter
    # when the visual row changes within the same section.
    chord_record = {
        'name': chord_name,
        'frets': frets,
        'visualDescription': chord_json.get('visualDescription', ''),
        'section': section,
        'row_idx': survey_chord.get('row_idx', 0),
    }
    app.logger.info(
        f"[AUTOCREATE-CROP] Chord {chord_index+1} '{chord_name}': read [{','.join(str(f) for f in frets)}]"
    )
    return chord_record, input_tokens, output_tokens, False


def process_chord_charts_directly(client, uploaded_files, item_id, user_id=None, effort_level='medium'):
    """Process files containing chord charts for direct import using crop tool for precision"""
    import time
    import io
    from pdf2image import convert_from_bytes
    from PIL import Image

    try:
        app.logger.info("Processing chord chart files for direct import (crop tool approach)")

        # Phase 1: Survey — extract the SECTION layout + ORDERED chord names per section.
        # Row boundaries and per-diagram bounding boxes are detected from PIXELS downstream
        # (see _detect_diagram_rows_and_bboxes), then paired with the model's chord-name
        # lists by count per row. The model is no longer asked for any coordinates — we
        # just need it to read the labels in reading order, which it does reliably.
        survey_prompt = """Look at this chord chart image. List the chord NAMES, grouped by section, in reading order (top-to-bottom, left-to-right within each row).

**For each section on the page, return**:
- `name`: the section label (e.g. "Intro", "Verse", "Chorus", "Bridge"). If the page has no section labels at all, use "Chords" for everything.
- `chord_names`: every chord name belonging to this section, in reading order (left-to-right within each row, then top-to-bottom across rows), verbatim from the page labels (e.g. ["G", "F#m7", "Em7", "D", "Cadd9", "G/B"]).

**Tuning**: Note the tuning if it appears anywhere on the page (e.g. "Dropped C: C-G-C-F-A-D", "EADGBE", "DADGAD", "Drop D"). If no tuning is explicitly shown, return "EADGBE".

**No coordinates requested.** Pixel-based row and per-diagram detection is handled outside this call. Focus on reading the labels accurately and grouping them by section.

**Respond with JSON matching the response schema.** Example:
```json
{
  "tuning": "EADGBE",
  "sections": [
    {
      "name": "Intro",
      "chord_names": ["G", "F#m7", "Em7", "D"]
    },
    {
      "name": "Verse",
      "chord_names": ["Cadd9", "G/B", "B♭6", "D"]
    }
  ]
}
```"""

        # Convert uploaded files to PIL images
        page_images = []
        for file_content in uploaded_files:
            if file_content['type'] == 'pdf':
                pdf_bytes = base64.b64decode(file_content['data'])
                try:
                    pages = convert_from_bytes(pdf_bytes, dpi=300)
                    page_images.append(pages[0])
                    app.logger.info(f"[AUTOCREATE-CROP] Converted PDF to image: {pages[0].size[0]}x{pages[0].size[1]}px ({len(pages)} pages)")
                except Exception as e:
                    app.logger.error(f"[AUTOCREATE-CROP] Failed to convert PDF to image: {e}")
                    return {'error': f'Failed to convert PDF to image: {str(e)}'}
            elif file_content['type'] == 'image':
                image_bytes = base64.b64decode(file_content['data'])
                img = Image.open(io.BytesIO(image_bytes))
                page_images.append(img)
                app.logger.info(f"[AUTOCREATE-CROP] Loaded image: {img.size[0]}x{img.size[1]}px")

        if not page_images:
            return {'error': 'No valid images found in uploaded files'}

        source_image = page_images[0]

        # Cap image size
        max_dimension = 4000
        if source_image.width > max_dimension or source_image.height > max_dimension:
            source_image.thumbnail((max_dimension, max_dimension), Image.LANCZOS)
            app.logger.info(f"[AUTOCREATE-CROP] Resized to {source_image.size[0]}x{source_image.size[1]}px")

        # Encode full-page image as base64 PNG
        img_buffer = io.BytesIO()
        if source_image.mode in ("RGBA", "P"):
            source_image = source_image.convert("RGB")
        source_image.save(img_buffer, format='PNG')
        img_buffer.seek(0)
        full_page_base64 = base64.b64encode(img_buffer.read()).decode('utf-8')

        full_page_image_block = {
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": full_page_base64}
        }

        # JSON schemas for structured outputs (output_config.format).
        # Works with extended thinking; no tool_choice restriction. Server-enforced.
        # additionalProperties:false required on every object. Numerical/length constraints
        # (minimum/maximum/minItems/maxItems) are not supported in structured-output schemas.

        # Phase 1 (Survey): tuning + ordered chord names per section.
        # No coordinates — row boundaries and per-diagram bboxes are detected from pixels downstream.
        # We just need the model to read labels accurately and group them by section.
        survey_schema = {
            "type": "object",
            "properties": {
                "tuning": {"type": "string", "description": "The tuning shown on the page (e.g. 'EADGBE', 'DADGAD'), or 'EADGBE' if not specified"},
                "sections": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "description": "Section label (e.g. 'Intro', 'Verse', 'Chorus'). Use 'Chords' if no section labels appear on the page."},
                            "chord_names": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "All chord names in this section, in reading order (left-to-right within each row, then top-to-bottom across rows), verbatim from the page labels"
                            }
                        },
                        "required": ["name", "chord_names"],
                        "additionalProperties": False
                    }
                }
            },
            "required": ["tuning", "sections"],
            "additionalProperties": False
        }

        # Phase 2 (Read): one call per chord. Name is already known from Phase 1 and is NOT
        # passed back to the model — this is deliberate: the chord name triggers standard-voicing
        # substitution. Phase 2 sees only the cropped grid + dots and reports fret positions.
        read_schema = {
            "type": "object",
            "properties": {
                "frets": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": "EXACTLY 6 integers: [string 6, string 5, string 4, string 3, string 2, string 1] (low pitch to high). -1 = muted (X), 0 = open (O), 1+ = fretted at that fret number counted from the top of the grid"
                },
                "visualDescription": {
                    "type": "string",
                    "description": "Per-string observation of what is drawn. Describe markers above the nut and dot positions for all 6 strings."
                }
            },
            "required": ["frets", "visualDescription"],
            "additionalProperties": False
        }

        app.logger.info("[AUTOCREATE-CROP] Phase 1: Survey — identifying layout and row positions")
        llm_start_time = time.time()
        total_input_tokens = 0
        total_output_tokens = 0

        survey_response = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=4000,
            output_config={"format": {"type": "json_schema", "schema": survey_schema}},
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": survey_prompt, "cache_control": {"type": "ephemeral"}},
                    full_page_image_block
                ]
            }]
        )

        if hasattr(survey_response, 'usage'):
            total_input_tokens += survey_response.usage.input_tokens
            total_output_tokens += survey_response.usage.output_tokens
            cache_read = getattr(survey_response.usage, 'cache_read_input_tokens', 0) or 0
            cache_create = getattr(survey_response.usage, 'cache_creation_input_tokens', 0) or 0
            if cache_read or cache_create:
                app.logger.info(f"[AUTOCREATE-CROP] Phase 1 cache: read={cache_read}, create={cache_create}")

        app.logger.info(f"[AUTOCREATE-CROP] Phase 1 complete: {survey_response.usage.output_tokens} output tokens")

        survey_data = _extract_json_text(survey_response)
        if survey_data is None:
            return {'error': 'Failed to parse layout survey response'}

        survey_sections = survey_data.get('sections', [])
        detected_tuning = survey_data.get('tuning', 'EADGBE')

        # Flatten model's chord names into a single reading-order list, with the section
        # label preserved for each name. Pairing with pixel-detected bboxes happens below.
        named_chords = []  # list of (section, chord_name) in reading order
        for sec in survey_sections:
            sec_name = sec.get('name', 'Chords') or 'Chords'
            for cn in (sec.get('chord_names') or []):
                if cn:
                    named_chords.append((sec_name, cn))

        app.logger.info(f"[AUTOCREATE-CROP] Model named {len(named_chords)} chord names across {len(survey_sections)} sections, tuning: {detected_tuning}")

        if not named_chords:
            return {'error': 'No chord names returned by survey'}

        # Pixel-based row + per-diagram detection. Implementation lives at module scope
        # (_detect_diagram_rows_and_bboxes) — empirically far more reliable than asking
        # the model for coordinates, which it has historically hallucinated by copying
        # example numbers. See DIAGRAM_DETECTION_DEFAULTS for tunable thresholds; pass
        # `overrides={...}` if a real PDF triggers a layout misdetection.
        detected_rows = _detect_diagram_rows_and_bboxes(source_image)
        total_detected = sum(len(r) for r in detected_rows)
        app.logger.info(f"[AUTOCREATE-CROP] Pixel-detected {len(detected_rows)} rows, {total_detected} total diagrams")
        for idx, row_bboxes in enumerate(detected_rows):
            xs = ", ".join(f"({x1:.3f}-{x2:.3f})" for (x1, _y1, x2, _y2) in row_bboxes)
            if row_bboxes:
                y_top = row_bboxes[0][1]
                y_bot = row_bboxes[0][3]
                app.logger.info(f"[AUTOCREATE-CROP] Row {idx+1} (y={y_top:.3f}-{y_bot:.3f}): {len(row_bboxes)} diagrams at [{xs}]")
            else:
                app.logger.info(f"[AUTOCREATE-CROP] Row {idx+1}: 0 diagrams")

        if total_detected == 0:
            return {'error': 'No chord diagrams detected in image (pixel detection found 0 diagrams)'}

        # ---- Pair model's named chords with pixel-detected bboxes ----
        # Both lists are in reading order: pixel detection walks top-to-bottom then left-to-right;
        # the model returns chord names in reading order within each section.
        # Mismatch in total counts → halt (we can't safely guess which diagram each name belongs to).
        if total_detected != len(named_chords):
            app.logger.error(
                f"[AUTOCREATE-CROP] COUNT MISMATCH: pixel detection found {total_detected} diagrams "
                f"but model named {len(named_chords)} chords. Cannot safely pair them. "
                f"Per-row pixel counts: {[len(r) for r in detected_rows]}. "
                f"Section breakdown: {[(s.get('name'), len(s.get('chord_names') or [])) for s in survey_sections]}."
            )
            return {'error': (
                f'Diagram count mismatch: pixel detection found {total_detected} chord diagrams '
                f'but the model identified {len(named_chords)} chord names. '
                f'This usually means the model missed or duplicated a chord name. '
                f'Try cropping the image tighter, or process one section at a time.'
            )}

        # Walk diagrams in reading order, consuming chord names in the same order.
        survey_chords = []
        name_idx = 0
        for row_idx, row_bboxes in enumerate(detected_rows):
            for (x1, y1, x2, y2) in row_bboxes:
                section, chord_name = named_chords[name_idx]
                survey_chords.append({
                    'section': section,
                    'name': chord_name,
                    'bbox': {'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2},
                    'row_idx': row_idx,
                })
                name_idx += 1

        app.logger.info(f"[AUTOCREATE-CROP] Paired {len(survey_chords)} per-chord crops (pixel-detected bboxes)")

        # Diagnostic: save crops to disk under ~/.claude/testing/autocreate-crops/<run_id>/
        # so we can visually inspect what each Phase 2 call actually sees.
        crop_debug_dir = None
        try:
            run_id = time.strftime('%Y-%m-%d_%H-%M-%S')
            crop_debug_dir = os.path.expanduser(f'~/.claude/testing/autocreate-crops/{run_id}')
            os.makedirs(crop_debug_dir, exist_ok=True)
            app.logger.info(f"[AUTOCREATE-CROP] Saving diagnostic crops to {crop_debug_dir}")
        except Exception as dbg_err:
            app.logger.warning(f"[AUTOCREATE-CROP] Could not create crop debug dir: {dbg_err}")
            crop_debug_dir = None

        # Phase 2: Read each chord — one focused per-chord crop per API call.
        # The chord name is already known from Phase 1 and is intentionally NOT passed
        # to Phase 2 — naming the chord triggers standard-voicing substitution from
        # training memory. Without the name, the model has no choice but to read what's
        # actually drawn.
        app.logger.info("[AUTOCREATE-CROP] Phase 2: Reading dot positions for each chord (per-chord crops)")
        all_readings = []

        read_prompt = """**Read the dot positions in this chord diagram exactly as drawn.** This is a focused crop of a single chord diagram. Your job is to report which strings are fretted at which frets, plus which strings are muted (X) or open (O).

## ⚠️ FAILURE MODE — Standard Voicing Substitution (READ THIS FIRST)

The most common error on this task is **substituting a memorized standard-tuning chord shape** for what is actually drawn. You will sometimes recognize a partial dot pattern and "round it off" to a familiar voicing (e.g. seeing a couple of dots and outputting `[3, 2, 0, 0, 0, 3]` because that's the canonical G chord).

**DO NOT DO THIS.** This crop may be from any tuning (Drop C, DADGAD, open D, etc.) where the same chord name uses a completely different shape, OR it may be a non-standard voicing in standard tuning.

Rules:
- Read ONLY what is drawn. If the dots don't match any chord shape you know, that is a SIGNAL you read it correctly — do not "correct" it.
- Do not infer dots that aren't drawn. If a string's column is empty (no O, no X, no dot), it defaults to open (`0`).
- Do not move dots. The dot is in the fret-space it's drawn in, regardless of what would make the chord "sound right."
- The chord name is intentionally not given to you. Your only job is to report the visual content.

## Anatomy:
- The NUT is the THICK horizontal line at the TOP of the grid.
- Below the nut are THIN horizontal lines. Each thin line marks the end of a fret.
- FRETS are the SPACES between horizontal lines, counted TOP-DOWN:
  - Fret 1 = space between the nut (top) and the 1st thin line below it
  - Fret 2 = space between the 1st and 2nd thin lines
  - Fret 3 = space between the 2nd and 3rd thin lines
  - Fret 4 = space between the 3rd and 4th thin lines
  - Fret 5 = space between the 4th and 5th thin lines
  - …and so on, always counting downward from the nut.
- STRINGS are the 6 vertical lines, numbered LEFT-TO-RIGHT: string 6, 5, 4, 3, 2, 1 (low pitch to high).
- Markers ABOVE the nut (O or X) sit directly above the string column they refer to.
- A BARRE is drawn as a CURVED ARC spanning multiple strings at the same fret.

## ⚠️ Counting frets carefully (this is where errors happen)

To find a dot's fret, **count thin horizontal lines ABOVE the dot**. If N thin lines are above the dot, the dot is in fret (N+1).

Examples:
- 0 thin lines above the dot → fret 1
- 1 thin line above the dot → fret 2
- 4 thin lines above the dot → fret 5

Do not estimate from how "high up" the dot looks. Count lines.

## ⚠️ Ignore ALL numbers and text annotations on the diagram

The TOP of the grid is **ALWAYS** the nut. **No exceptions.** Do not "shift" the grid to start at any other fret, regardless of what text or numbers appear in or near the diagram.

Specifically, you MUST IGNORE:
- **Finger numbers** below the grid (e.g. "1", "2", "3", "1 2 3 1") — indicate which finger to press
- **Position-marker annotations** like `5fr`, `7fr`, `9fr`, `fr 5`, `5 fr`, `fr.5`, `(5fr)`, etc. — typically printed to the left or right of the grid. Treat these as labels with NO effect on your fret counting. Even though in some chord chart conventions these mean "the top of the grid is fret N," in THIS task you must IGNORE them and treat the top as the nut.
- **Tuning labels** (e.g. "EADGBE", "DADGAD") that may appear near a diagram
- **Performance annotations** like "x3", "x4", "repeat", "×2"
- **Any other text** that is not the chord name

The fret position of every dot is determined SOLELY by counting thin horizontal lines from the top of the grid downward. If the topmost fret-space (between the thick top line and the first thin line) contains a dot, that dot is at fret 1 — even if a "7fr" annotation appears next to the diagram.

This rule may produce readings that differ from how the chord would be physically played; that is intentional and correct for this task. Render exactly what is visually drawn from the top of the grid down.

## ⚠️ Curved lines (barres)

A curved arc spanning multiple strings indicates a barre. The barre's fret is determined by the DOTS under the arc, not the arc's exact position. If the dots are in fret 2's space, the barre is at fret 2.

If a curve appears but no extra dots are under it (the dots already drawn account for all the fretted strings), the curve is just a finger-position hint — do not add dots based on the curve alone.

## Procedure:

1. **Look at every string column** (left to right: string 6, 5, 4, 3, 2, 1).
2. For each column, observe:
   - Is there an O, X, or nothing above the nut?
   - Is there a solid dot on the grid? If so, count thin lines above it to determine the fret.
   - Is there a barre arc covering this string?
3. Write out your observations string-by-string into `visualDescription` (e.g. *"String 6: solid dot in fret 5 (4 thin lines above). String 5: X above nut. String 4-3-2: O above nut. String 1: X above nut. No barre."*).
4. From your observations, derive `frets` (6 integers, one per string, low to high):
   - `O` above nut, no dot → `0` (open)
   - `X` above nut, no dot → `-1` (muted)
   - Solid dot on grid → the fret number you counted
   - Under a barre at fret N → `N`
   - Nothing in that string's column → default to `0` (open)

The `frets` array MUST have EXACTLY 6 integers in order [string 6, string 5, string 4, string 3, string 2, string 1].

## Respond with JSON matching the response schema.

Example output for a diagram with one dot on string 6 at fret 5, with X on string 5 and 1, O on strings 4-3-2:
```json
{
  "frets": [5, -1, 0, 0, 0, -1],
  "visualDescription": "String 6: solid dot in fret 5 (4 thin lines above). String 5: X above nut. String 4: O above nut. String 3: O above nut. String 2: O above nut. String 1: X above nut. No barre."
}
```"""

        # Effort config: low=fast/rough, medium=balanced, high=thorough/slow.
        # xhigh was tested on the high tier and spiraled (consumed full 64K with no usable output
        # on complex Drop C images). API effort "high" is the new ceiling — still substantial
        # thinking budget, but doesn't rabbit-hole on music-theory tangents the way xhigh did.
        effort_configs = {
            'low':    {'max_tokens': 8000,  'thinking': {"type": "adaptive", "display": "summarized"}, 'output_config': {"effort": "low"}},
            'medium': {'max_tokens': 16000, 'thinking': {"type": "adaptive", "display": "summarized"}, 'output_config': {"effort": "medium"}},
            'high':   {'max_tokens': 32000, 'thinking': {"type": "adaptive", "display": "summarized"}, 'output_config': {"effort": "high"}},
        }
        effort_config = effort_configs[effort_level]
        api_effort = effort_config.get('output_config', {}).get('effort', 'unset')
        app.logger.info(f"[AUTOCREATE-CROP] Using tier={effort_level} (API effort={api_effort}), max_tokens={effort_config['max_tokens']}")

        per_chord_client = client.with_options(timeout=300.0)
        transient_api_failures = 0

        for i, sc in enumerate(survey_chords):
            chord_record, in_tokens, out_tokens, was_transient = _read_one_chord(
                per_chord_client=per_chord_client,
                source_image=source_image,
                survey_chord=sc,
                read_prompt=read_prompt,
                read_schema=read_schema,
                effort_level=effort_level,
                effort_config=effort_config,
                crop_debug_dir=crop_debug_dir,
                chord_index=i,
                total_chords=len(survey_chords),
            )
            total_input_tokens += in_tokens
            total_output_tokens += out_tokens
            if chord_record is not None:
                all_readings.append(chord_record)
            elif was_transient:
                transient_api_failures += 1

        llm_end_time = time.time()

        if not all_readings:
            return {'error': 'Failed to read any chord diagrams from the image'}

        app.logger.info(f"[AUTOCREATE-CROP] Phase 2 complete: read {len(all_readings)} total chords in {llm_end_time - llm_start_time:.1f}s")

        # Assemble into the expected output format.
        # Section labels come straight from the model (already deduped by the new survey schema —
        # one section entry per logical section, no "Verse (cont.)" or "Verse 2" cruft).
        # Line breaks are driven by the pixel-detected row_idx changing within a section.
        sections_dict = {}
        prev_section = None
        prev_row_idx = None
        for chord in all_readings:
            section_label = chord.get('section', 'Chords') or 'Chords'
            chord_name = chord.get('name', 'Unknown')
            chord_frets = chord.get('frets', [])
            row_idx = chord.get('row_idx', 0)

            if section_label not in sections_dict:
                sections_dict[section_label] = []

            # Within the same section: when the pixel-detected row changes, mark the previous
            # chord with lineBreakAfter so the UI renders a visual row break.
            if (prev_section == section_label
                and prev_row_idx is not None
                and row_idx != prev_row_idx
                and sections_dict[section_label]):
                sections_dict[section_label][-1]['lineBreakAfter'] = True
                app.logger.debug(
                    f"[AUTOCREATE-CROP] Line break after '{sections_dict[section_label][-1]['name']}' "
                    f"(row transition {prev_row_idx} → {row_idx} within '{section_label}')"
                )

            sections_dict[section_label].append({
                "name": chord_name,
                "frets": chord_frets,
                "sourceType": "chord_chart_direct",
                "row": len(sections_dict[section_label]),
                "position": len(sections_dict[section_label]),
                "lineBreakAfter": False,
            })
            prev_section = section_label
            prev_row_idx = row_idx

        # Mark last chord in each section with lineBreakAfter
        for section_chords in sections_dict.values():
            if section_chords:
                section_chords[-1]['lineBreakAfter'] = True

        sections_list = [{"label": label, "chords": chords} for label, chords in sections_dict.items()]

        # Build reference chord descriptions (deduplicated by name)
        seen_names = set()
        ref_descriptions = []
        for chord in all_readings:
            name = chord.get('name', '')
            if name and name.lower() not in seen_names:
                seen_names.add(name.lower())
                ref_descriptions.append({
                    "name": name,
                    "visualDescription": chord.get('visualDescription', ''),
                    "extractedPattern": chord.get('frets', [])
                })

        chord_data = {
            "tuning": detected_tuning,
            "capo": 0,
            "analysis": {"referenceChordDescriptions": ref_descriptions},
            "sections": sections_list,
            "totalRows": len(sections_list)
        }

        # Debug: log lineBreakAfter values for each chord
        for section in sections_list:
            breaks = [(c['name'], c['lineBreakAfter']) for c in section['chords']]
            app.logger.debug(f"[AUTOCREATE-CROP] Section '{section['label']}' lineBreaks: {breaks}")

        app.logger.info(f"[AUTOCREATE-CROP] Assembled {len(all_readings)} chords into {len(sections_list)} sections")

        # Track LLM generation with PostHog Analytics
        from app.utils.llm_analytics import llm_analytics
        llm_analytics.track_generation(
            model="claude-opus-4-8",
            input_messages=[{"role": "user", "content": "Chord chart processing with stateless crops"}],
            output_choices=[{"message": {"content": json.dumps(chord_data)[:500]}}],
            usage={
                "input_tokens": total_input_tokens,
                "output_tokens": total_output_tokens
            },
            latency_seconds=llm_end_time - llm_start_time,
            custom_properties={
                "function": "process_chord_charts_directly",
                "file_count": len(uploaded_files),
                "analysis_type": "chord_chart_stateless_crop",
                "item_id": str(item_id),
                "chords_surveyed": len(survey_chords),
                "chords_read": len(all_readings)
            },
            user_id=user_id
        )

        # chord_data already assembled from stateless crop readings above
        # Create chord charts from the structured data using sheets version logic
        created_charts = create_chord_charts_from_data(chord_data, item_id)

        # Extract filename for frontend display
        filename = uploaded_files[0]['name'] if uploaded_files else 'unknown'

        return {
            'success': True,
            'charts_created': len(created_charts),
            'analysis': f'Successfully processed chord charts',
            'uploaded_file_names': filename,
            # Number of chords that failed due to transient API issues (overload, rate limit,
            # etc.) — frontend uses this to surface a "try again" hint when > 0.
            'chord_load_failures': transient_api_failures,
        }

    except Exception as e:
        app.logger.error(f"Failed to process chord charts: {str(e)}")
        return {'error': f'Failed to process chord charts: {str(e)}'}

# NOTE: create_chord_charts_from_data is defined later in this file (around line 4574)
# It handles all autocreate paths including chord_chart_direct, reference patterns, and chord_names

# Chord chart copy functionality  
@app.route('/api/chord-charts/copy', methods=['POST'])
@require_user_context
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
        
        # Use the data layer for PostgreSQL compatibility
        result = data_layer.copy_chord_charts_to_items(source_item_id, target_item_ids)
        
        app.logger.info(f"Successfully copied {result['charts_found']} chord charts to {len(result['target_items'])} items")
        
        return jsonify({
            'success': True,
            'message': f"Copied {result['charts_found']} chord charts to {len(result['target_items'])} songs",
            'result': result
        })
        
    except Exception as e:
        app.logger.error(f"Error copying chord charts: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/chord-charts/from-names', methods=['POST'])
def create_chord_charts_from_names():
    """Claude-free chord chart creation: parse typed chord names and look them up in common_chords.

    No external API calls, no tier gating (gating is UI-side).
    Request body: {"itemId": <id>, "text": "<chord names, newlines for line breaks>"}
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    try:
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400

        data = request.json or {}
        item_id = data.get('itemId')
        text_input = data.get('text')

        if item_id is None or text_input is None:
            return jsonify({"error": "itemId and text are required"}), 400

        text_input = str(text_input)
        if not text_input.strip():
            return jsonify({"error": "Please enter at least one chord name"}), 400

        user_id = current_user.id
        app.logger.info(f"[FROM_NAMES] Request from user {user_id} for item {item_id}, text length {len(text_input)}")

        # Validation regex — must match frontend's per-token check
        import re
        chord_token_re = re.compile(r'^[A-Ga-g][A-Za-z0-9#b\u266d\u266f/]*$')

        # Normalize newlines, split into lines
        normalized = text_input.replace('\r\n', '\n').replace('\r', '\n')
        raw_lines = normalized.split('\n')

        # Parse: per line, split on whitespace + commas; mark last token with lineBreakAfter
        parsed_chords = []  # list of {'name': str, 'lineBreakAfter': bool, 'valid': bool}
        for line in raw_lines:
            line = line.strip()
            if not line:
                continue
            tokens = [t for t in re.split(r'[,\s]+', line) if t]
            if not tokens:
                continue
            for idx, tok in enumerate(tokens):
                is_last_in_line = (idx == len(tokens) - 1)
                parsed_chords.append({
                    'name': tok,
                    'lineBreakAfter': is_last_in_line,
                    'valid': bool(chord_token_re.match(tok)),
                })

        app.logger.info(f"[FROM_NAMES] Parsed {len(parsed_chords)} tokens ({sum(1 for c in parsed_chords if c['valid'])} valid-shaped, {sum(1 for c in parsed_chords if not c['valid'])} invalid-shaped)")

        if not parsed_chords:
            return jsonify({
                "error": "No chord names found. Type chord names separated by spaces, commas, or newlines (e.g., G C Am F)"
            }), 400

        # Load CommonChords for lookup
        common_chords = data_layer.get_common_chords_efficiently()
        chord_lookup = {}
        for cc in common_chords:
            key = cc['title'].strip().upper()
            chord_lookup[key] = cc
        app.logger.info(f"[FROM_NAMES] Loaded {len(common_chords)} common chords for lookup")

        chord_charts_data = []
        missing_chord_names = []

        # Process ALL parsed tokens uniformly: valid+found → shape; anything else → empty chart with typed name.
        # The frontend renders a "click to create manually" overlay on empty charts.
        for order, chord in enumerate(parsed_chords):
            typed_name = chord['name']
            lookup_key = typed_name.strip().upper() if chord['valid'] else None
            line_break_after = chord['lineBreakAfter']

            if lookup_key and lookup_key in chord_lookup:
                common_chord = chord_lookup[lookup_key]
                # Filter fingers to fret > 0 only (matches autocreate behavior)
                raw_fingers = common_chord.get('fingers') or []
                filtered_fingers = []
                for finger in raw_fingers:
                    if isinstance(finger, list) and len(finger) >= 2 and finger[1] > 0:
                        filtered_fingers.append(finger)

                tuning = common_chord.get('tuning')
                if not isinstance(tuning, list):
                    tuning = ['E', 'A', 'D', 'G', 'B', 'E']

                chord_data = {
                    'fingers': filtered_fingers,
                    'barres': common_chord.get('barres', []),
                    'tuning': tuning,
                    'numFrets': common_chord.get('numFrets', 5),
                    'numStrings': common_chord.get('numStrings', 6),
                    'capo': common_chord.get('capo', 0),
                    'openStrings': common_chord.get('openStrings', []),
                    'mutedStrings': common_chord.get('mutedStrings', []),
                    'startingFret': common_chord.get('startingFret', 1),
                    'sectionId': 'section-main',
                    'sectionLabel': 'Main',
                    'sectionRepeatCount': '',
                    'lineBreakAfter': line_break_after,
                }
            else:
                missing_chord_names.append(typed_name)
                chord_data = {
                    'fingers': [],
                    'barres': [],
                    'tuning': ['E', 'A', 'D', 'G', 'B', 'E'],
                    'sectionId': 'section-main',
                    'sectionLabel': 'Main',
                    'sectionRepeatCount': '',
                    'lineBreakAfter': line_break_after,
                }

            chord_charts_data.append({
                'title': typed_name,  # preserve user's exact casing
                'chord_data': chord_data,
                'order': order,
            })

        app.logger.info(f"[FROM_NAMES] Creating {len(chord_charts_data)} chord charts in database ({len(missing_chord_names)} missing: {missing_chord_names})")

        results = data_layer.batch_add_chord_charts(item_id, chord_charts_data)
        charts_created = len(results) if isinstance(results, list) else len(chord_charts_data)

        # PostHog tracking
        try:
            from app.utils.posthog_client import track_event, get_client_ip
            track_event(
                user_id=user_id,
                event_name='chord_charts_from_names_created',
                properties={
                    'item_id': item_id,
                    'chords_requested': len(parsed_chords),
                    'chords_created': charts_created,
                    'chords_missing': len(missing_chord_names),
                    'missing_chord_names': missing_chord_names,
                },
                ip=get_client_ip(),
            )
        except Exception as e:
            app.logger.warning(f"[FROM_NAMES] PostHog tracking failed: {e}")

        app.logger.info(f"[FROM_NAMES] Success: created {charts_created} charts for item {item_id}")

        return jsonify({
            'success': True,
            'message': f'Successfully created {charts_created} chord charts',
            'item_id': item_id,
            'charts_created': charts_created,
            'chord_charts_created': charts_created,  # alias matching autocreate response shape
            'missing_chords': missing_chord_names,
        })

    except Exception as e:
        app.logger.error(f"[FROM_NAMES] Error creating chord charts from names: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': f'Failed to create chord charts: {str(e)}'}), 500


def process_chord_names_from_youtube_transcript(client, uploaded_files, item_id, user_id=None):
    """Process YouTube transcript files to extract chord names from spoken dialogue"""
    try:
        app.logger.info(f"[AUTOCREATE] process_chord_names_from_youtube_transcript called with {len(uploaded_files)} files for item {item_id}")
        app.logger.info("Processing YouTube transcript for spoken chord names")

        prompt_text = """🎸 **Hey Claude! YouTube Transcript Chord Extraction**

Hi there! This time I need your help with a YouTube video transcript - this is spoken dialogue from a guitar lesson video. So, it's just a voice-to-text version of the words spoken in the video. We're going to create chord charts for the song taught in the video.

**Examples of what you're looking for:**
- Chord names mentioned in spoken dialogue (like "play a G chord", "then go to C", "Am7 sounds great here")
- References to chord progressions ("G to C to D", "the verse goes Am, F, C, G")
- Song sections mentioned in speech ("in the chorus we play...", "for the bridge use...")
- Spoken chord sequences ("so it's G, C, Am, F throughout")
- Nashville number system references ("the 1 chord", "the 4 chord", "the 5 chord", or Roman numerals like "I, IV, V")
- Chord quality descriptions with numbers ("a major seven chord", "dominant seventh", "minor chord on the 2")

**Nashville Number System / Numeric References:**
Guitar teachers often refer to chords by number instead of name. When you encounter this:
1. Look for the KEY of the song — teachers often say things like "we're in the key of E", "this is in A", "standard blues in G", "key of D", etc.
2. Once you know the key, convert the numbers to actual chord names using standard music theory:
   - In a major key: 1=major, 2=minor, 3=minor, 4=major, 5=major (or dominant 7), 6=minor, 7=diminished
   - Example: Key of E → 1=E, 4=A, 5=B7 (or B), 6=C#m
   - Example: Key of A → 1=A, 4=D, 5=E7 (or E), 2=Bm
3. Apply any mentioned chord qualities (e.g., "the 5 chord as a dominant 7" in key of E = B7, "major seven feel on the 1" in key of E = Emaj7)
4. If the teacher describes chord shapes or fret positions AND you can determine the chord name from context, include it

**What to IGNORE:**
- General guitar technique talk unrelated to chord progressions
- Equipment or setup discussions
- Scale discussions (unless they help identify the key for Nashville number conversion)

**Your job:**
- Listen for actual chord names AND numeric/Nashville references in the dialogue
- Determine the key of the song from context clues when possible
- Convert any numeric references to actual chord letter names
- Group them by song sections, if mentioned (e.g. Intro, Verse, Chorus, Bridge, etc.)
- Keep the chord charts in the order they're to be played in the song

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

Key difference from lyrics sheets: Here you're reading a transcript of spoken words about chords, from a teaching video. This differs from reading chord symbols positioned above lyrics, but the output is to be similar.

Important: Only respond with "No chord names found in this transcript." if you truly cannot determine ANY chord names — neither explicit names NOR Nashville numbers with enough key context to resolve them. The main scenario for "no chord names" would be video lessons focused purely on lead guitar lines or single-note melodies with no chord context at all.

Thanks for helping me extract chord progressions from this voice-to-text transcript of a guitar lesson video from youtube!"""

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
            elif file_content['type'] == 'chord_names':
                # Handle text files including YouTube transcripts
                message_content.append({
                    "type": "text",
                    "text": file_content['data']
                })

        # Use Sonnet 4.6 for chord names analysis
        app.logger.info(f"[AUTOCREATE] Using Sonnet 4.6 for YouTube transcript chord analysis")
        app.logger.info(f"[AUTOCREATE] Making API call with {len(message_content)} content items")
        app.logger.info(f"[AUTOCREATE] Message content types: {[item.get('type', 'unknown') for item in message_content]}")

        try:
            import time
            llm_start_time = time.time()
            app.logger.info(f"[AUTOCREATE] Starting Anthropic API call to claude-opus-4-8")
            response = client.messages.create(
                model="claude-opus-4-8",
                max_tokens=8000,  # Increased for complex songs with multiple sections
                messages=[{"role": "user", "content": message_content}]
            )
            llm_end_time = time.time()
            llm_latency = llm_end_time - llm_start_time

            app.logger.info(f"[AUTOCREATE] API call successful, response received with {len(response.content)} content items")
            if response.content:
                app.logger.info(f"[AUTOCREATE] Response content length: {len(response.content[0].text) if response.content[0].text else 0} characters")

            # Track LLM generation with PostHog LLM Analytics
            from app.utils.llm_analytics import track_llm_generation

            # Extract usage information
            usage_dict = {}
            if hasattr(response, 'usage') and response.usage:
                usage = response.usage
                usage_dict = {
                    "input_tokens": getattr(usage, 'input_tokens', 0),
                    "output_tokens": getattr(usage, 'output_tokens', 0)
                }

            track_llm_generation(
                model="claude-opus-4-8",
                input_messages=[{
                    "role": "user",
                    "content": "Extract chord names from YouTube transcript"
                }],
                output_choices=[{
                    "role": "assistant",
                    "content": response.content[0].text[:200] + "..." if len(response.content[0].text) > 200 else response.content[0].text
                }],
                usage=usage_dict,
                latency_seconds=llm_latency,
                status="success",
                custom_properties={
                    "feature": "autocreate_chord_charts",
                    "analysis_type": "youtube_transcript_chords",
                    "item_id": item_id,
                    "file_count": len(uploaded_files),
                    "content_type": "youtube_transcript"
                },
                user_id=user_id
            )

        except Exception as api_error:
            app.logger.error(f"[AUTOCREATE] API call failed: {str(api_error)}")
            app.logger.error(f"[AUTOCREATE] API error type: {type(api_error)}")

            # Track failed LLM generation
            from app.utils.llm_analytics import track_llm_generation
            if 'llm_start_time' in locals():
                llm_end_time = time.time()
                llm_latency = llm_end_time - llm_start_time
            else:
                llm_latency = 0

            track_llm_generation(
                model="claude-opus-4-8",
                input_messages=[{
                    "role": "user",
                    "content": "Extract chord names from YouTube transcript"
                }],
                output_choices=[],
                latency_seconds=llm_latency,
                status="error",
                error=str(api_error),
                custom_properties={
                    "feature": "autocreate_chord_charts",
                    "analysis_type": "youtube_transcript_chords",
                    "item_id": item_id,
                    "file_count": len(uploaded_files),
                    "error_type": type(api_error).__name__
                },
                user_id=user_id
            )

            return {'error': f'Claude API call failed: {str(api_error)}'}

        # Parse Claude's response
        response_text = response.content[0].text.strip()
        app.logger.info(f"[AUTOCREATE] Parsing Claude response for YouTube transcript chord names")
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
                app.logger.info(f"[AUTOCREATE] Found JSON in markdown, attempting to parse {len(json_text)} chars")
                chord_data = json.loads(json_text)
                app.logger.info(f"[AUTOCREATE] Successfully parsed JSON from markdown!")
            else:
                # Try to parse the entire response as JSON
                app.logger.info(f"[AUTOCREATE] No markdown wrapper found, trying direct JSON parse")
                chord_data = json.loads(response_text)
                app.logger.info(f"[AUTOCREATE] Successfully parsed response as direct JSON!")
        except json.JSONDecodeError as parse_error:
            app.logger.error(f"[AUTOCREATE] JSON parsing failed: {str(parse_error)}")
            app.logger.error(f"[AUTOCREATE] Failed response text: {response_text}")

            # Try to extract a clean JSON block if markdown parsing failed
            if '```json' in response_text:
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
                # Check if Claude's response indicates no chords were found
                if any(phrase in response_text.lower() for phrase in [
                    'no chord names', 'no chords', 'doesn\'t contain chord',
                    'if you have the actual chord', 'share that and i\'ll be happy',
                    'chord chart or lyrics sheet', 'no chord symbols',
                    'no chord names found in this transcript'
                ]):
                    return {'error': 'No chord names found in this transcript. This appears to be a guitar lesson or discussion about the song rather than lyrics with chord symbols above them. Please try a different video or upload a file with chord names above lyrics.'}
                else:
                    return {'error': f'Failed to parse chord chart data from analysis response: {str(parse_error)}'}

        # Create chord charts from the structured data using CommonChords lookup
        created_charts = create_chord_charts_from_data(chord_data, item_id)

        # Extract filename for frontend display
        filename = uploaded_files[0]['name'] if uploaded_files else 'unknown'

        return {
            'success': True,
            'message': f'Successfully created {len(created_charts)} chord charts from YouTube transcript',
            'chord_count': len(created_charts),
            'content_type': 'youtube_transcript',
            'uploaded_file_names': filename
        }

    except Exception as e:
        app.logger.error(f"Error processing YouTube transcript chord names: {str(e)}")
        return {'error': f'Failed to process YouTube transcript: {str(e)}'}



def process_chord_names_with_lyrics(client, uploaded_files, item_id, user_id=None):
    """Process files with chord names above lyrics using CommonChords lookup"""
    try:
        app.logger.info(f"[AUTOCREATE] process_chord_names_with_lyrics called with {len(uploaded_files)} files for item {item_id}")
        app.logger.info("Processing chord names above lyrics with CommonChords lookup")

        # ENERGY OPTIMIZATION: Try OCR extraction first for PDFs and images
        file_data = uploaded_files[0]  # Process single file
        if file_data.get('type') in ['pdf', 'image']:
            app.logger.info(f"[AUTOCREATE] Attempting OCR extraction for {file_data.get('type')} file: {file_data.get('name')}")

            try:
                from app.utils.chord_ocr import extract_chords_from_file, should_use_ocr_result

                # Extract chords using OCR
                if file_data.get('type') == 'pdf':
                    import base64
                    pdf_bytes = base64.b64decode(file_data['data'])
                    ocr_result = extract_chords_from_file(pdf_bytes, 'pdf', file_data['name'])
                elif file_data.get('type') == 'image':
                    ocr_result = extract_chords_from_file(file_data['data'], 'image', file_data['name'])

                # Check if OCR found enough chords to use lightweight processing
                if ocr_result and should_use_ocr_result(ocr_result, minimum_chords=2):
                    app.logger.info(f"[AUTOCREATE] 🚀 OCR SUCCESS! Found {len(ocr_result['chords'])} chords")

                    # Log the OCR raw text for debugging
                    app.logger.info(f"[AUTOCREATE] OCR Raw Text (first 500 chars): {ocr_result['raw_text'][:500]}...")
                    app.logger.info(f"[AUTOCREATE] OCR Found Chords: {ocr_result['chords']}")

                    # Assess OCR trustworthiness BEFORE mutating file_data, so an
                    # untrustworthy result can fall through to the normal LLM path on
                    # the ORIGINAL file (not stale OCR text or a half-mutated record).
                    ocr_assessment = assess_ocr_trustworthiness(client, ocr_result['raw_text'], file_data['name'], user_id=user_id)
                    if ocr_assessment['trustworthy']:
                        # Replace file content with OCR text — saves tokens vs. resending
                        # the original PDF, and preserves sectional structure for Claude.
                        file_data['data'] = ocr_result['raw_text']
                        file_data['type'] = 'chord_names'
                        app.logger.info(f"[AUTOCREATE] OCR text trustworthy, feeding OCR text to Claude")
                    else:
                        # Sonnet already classified this file as chord_names. Visual chord-CHART
                        # analysis is the wrong path; falling through here keeps the original PDF
                        # and lets the chord_names prompt below read it directly.
                        app.logger.info(f"[AUTOCREATE] OCR untrustworthy ({ocr_assessment['reason']}), sending original file to Claude with chord_names prompt")

                else:
                    chords_found = len(ocr_result.get('chords', [])) if ocr_result else 0
                    app.logger.info(f"[AUTOCREATE] OCR found {chords_found} chords (need 2+), falling back to LLM processing")

            except Exception as e:
                app.logger.warning(f"[AUTOCREATE] OCR extraction failed: {str(e)}, falling back to LLM processing")

        else:
            app.logger.info(f"[AUTOCREATE] Text file detected, skipping OCR and using LLM processing")

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
            elif file_content['type'] == 'chord_names':
                # Handle text files including YouTube transcripts
                message_content.append({
                    "type": "text",
                    "text": file_content['data']
                })

        # Use Opus 4.8 for chord names analysis (complex reasoning for non-standard tunings)
        app.logger.info(f"[AUTOCREATE] Using Opus 4.8 for chord names analysis")
        app.logger.info(f"[AUTOCREATE] Making API call with {len(message_content)} content items")
        app.logger.info(f"[AUTOCREATE] Message content types: {[item.get('type', 'unknown') for item in message_content]}")

        try:
            import time
            llm_start_time = time.time()
            app.logger.info(f"[AUTOCREATE] Starting Anthropic API call to claude-opus-4-8")
            response = client.messages.create(
                model="claude-opus-4-8",
                max_tokens=8000,  # Increased for complex songs with multiple sections
                messages=[{"role": "user", "content": message_content}]
            )
            llm_end_time = time.time()
            llm_latency = llm_end_time - llm_start_time

            app.logger.info(f"[AUTOCREATE] API call successful, response received with {len(response.content)} content items")
            if response.content:
                app.logger.info(f"[AUTOCREATE] Response content length: {len(response.content[0].text) if response.content[0].text else 0} characters")

            # Track LLM generation with PostHog LLM Analytics
            from app.utils.llm_analytics import track_llm_generation

            # Extract usage information
            usage_dict = {}
            if hasattr(response, 'usage') and response.usage:
                usage = response.usage
                usage_dict = {
                    "input_tokens": getattr(usage, 'input_tokens', 0),
                    "output_tokens": getattr(usage, 'output_tokens', 0)
                }

            track_llm_generation(
                model="claude-opus-4-8",
                input_messages=[{
                    "role": "user",
                    "content": "Extract chord names from lyrics sheet"
                }],
                output_choices=[{
                    "role": "assistant",
                    "content": response.content[0].text[:200] + "..." if len(response.content[0].text) > 200 else response.content[0].text
                }],
                usage=usage_dict,
                latency_seconds=llm_latency,
                status="success",
                custom_properties={
                    "feature": "autocreate_chord_charts",
                    "analysis_type": "chord_names_with_lyrics",
                    "item_id": item_id,
                    "file_count": len(uploaded_files)
                },
                user_id=user_id
            )

        except Exception as api_error:
            app.logger.error(f"[AUTOCREATE] API call failed: {str(api_error)}")
            app.logger.error(f"[AUTOCREATE] API error type: {type(api_error)}")

            # Track failed LLM generation
            from app.utils.llm_analytics import track_llm_generation
            if 'llm_start_time' in locals():
                llm_end_time = time.time()
                llm_latency = llm_end_time - llm_start_time
            else:
                llm_latency = 0

            track_llm_generation(
                model="claude-opus-4-8",
                input_messages=[{
                    "role": "user",
                    "content": "Extract chord names from lyrics sheet"
                }],
                output_choices=[],
                latency_seconds=llm_latency,
                status="error",
                error=str(api_error),
                custom_properties={
                    "feature": "autocreate_chord_charts",
                    "analysis_type": "chord_names_with_lyrics",
                    "item_id": item_id,
                    "file_count": len(uploaded_files),
                    "error_type": type(api_error).__name__
                },
                user_id=user_id
            )

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
                # Check if Claude's response indicates no chords were found
                if any(phrase in response_text.lower() for phrase in [
                    'no chord names', 'no chords', 'doesn\'t contain chord',
                    'if you have the actual chord', 'share that and i\'ll be happy',
                    'chord chart or lyrics sheet', 'no chord symbols'
                ]):
                    return {'error': 'No chord names found in this transcript. This appears to be a guitar lesson or discussion about the song rather than lyrics with chord symbols above them. Please try a different video or upload a file with chord names above lyrics.'}
                else:
                    return {'error': f'Failed to parse chord chart data from analysis response: {str(parse_error)}'}

        # Create chord charts from the structured data using CommonChords lookup
        created_charts = create_chord_charts_from_data(chord_data, item_id)

        # Extract filename for frontend display
        filename = uploaded_files[0]['name'] if uploaded_files else 'unknown'

        return {
            'success': True,
            'message': f'Imported {len(created_charts)} chord charts',
            'charts': created_charts,
            'analysis': chord_data,
            'uploaded_file_names': filename
        }

    except Exception as e:
        app.logger.error(f"Error processing chord names: {str(e)}")
        return {'error': f'Failed to process chord names: {str(e)}'}


def create_chord_charts_from_data(chord_data, item_id):
    """Create chord charts from parsed chord data using batch operations"""
    try:
        created_charts = []

        # Extract tuning and capo from the analysis
        tuning = chord_data.get('tuning', 'EADGBE')
        capo = chord_data.get('capo', 0)

        # Pre-load all common chords efficiently to reduce API calls
        try:
            app.logger.info(f"[AUTOCREATE] Starting CommonChords lookup - getting all common chords efficiently")
            all_common_chords = data_layer.get_common_chords_efficiently()
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

        for section_idx, section in enumerate(sections):
            section_label = section.get('label', 'Chords')
            section_repeat = section.get('repeatCount', '')

            # Generate a unique section ID (include index to avoid collisions in tight loops)
            import time
            section_id = f"section-{int(time.time() * 1000)}-{section_idx}"

            for chord in section.get('chords', []):
                chord_name = chord.get('name', 'Unknown')
                chord_frets = chord.get('frets', [])
                chord_fingers = chord.get('fingers', [])
                source_type = chord.get('sourceType', 'chord_names')  # Default to chord_names if not specified
                line_break_after = chord.get('lineBreakAfter', False)  # Get lineBreakAfter from Claude response

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
                # NOTE: 'chord_chart_direct' added to handle visual analysis from process_chord_charts_directly
                use_reference_pattern = (source_type in ['reference', 'reference_direct', 'reference_only', 'chord_chart_direct'] and chord_frets)
                use_direct_pattern = (source_type == 'chord_names' and chord_frets and tuning != 'EADGBE')

                if use_reference_pattern:
                    app.logger.info(f"✅ Using reference diagram: {chord_name} = {chord_frets} in {tuning}")
                elif use_direct_pattern:
                    app.logger.info(f"✅ Using direct chord pattern: {chord_name} = {chord_frets} in {tuning}")

                # Find the chord in pre-loaded common chords (case-insensitive)
                common_chord = None
                chord_name_lower = chord_name.lower()

                # Lookup in CommonChords for any tuning when not using direct patterns
                # NOTE: CommonChords contains EADGBE fingering patterns, but these patterns work for
                # any tuning - the finger positions are the same, only the resulting notes change.
                # So Em shape = Em shape whether tuned to EADGBE, DGCFAD, or Drop D.
                is_standard_tuning = tuning.upper() in ['EADGBE', 'STANDARD']
                if not (use_reference_pattern or use_direct_pattern):
                    if chord_name_lower != 'unknown':
                        for common in all_common_chords:
                            if common.get('title', '').lower() == chord_name_lower:
                                common_chord = common
                                tuning_note = f" (using standard fingering for {tuning} tuning)" if not is_standard_tuning else ""
                                app.logger.info(f"📚 Found {chord_name} in CommonChords{tuning_note}")
                                break

                    # If not found by name and we have fret data, try to find by fret pattern
                    if not common_chord and chord_frets:
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
                        for i, fret_val in enumerate(frets):
                            # Convert AI array format to SVGuitar format
                            # AI: [low E, A, D, G, B, high E] → SVGuitar: string 1=high E, string 6=low E
                            string_num = 6 - i
                            if fret_val == 0:
                                open_strings.append(string_num)
                            elif fret_val == -1:
                                muted_strings.append(string_num)
                            elif fret_val > 0:
                                svguitar_fingers.append([string_num, fret_val])  # No finger numbers - leave to user

                    # 🔧 SVGuitar Debug Logging (Reference Pattern Path)
                    app.logger.info(f"🔧 SVGuitar Conversion Debug for {chord_name} (Reference Pattern):")
                    app.logger.info(f"   Input frets: {frets}")
                    app.logger.info(f"   SVGuitar fingers: {svguitar_fingers}")
                    app.logger.info(f"   Open strings: {open_strings}")
                    app.logger.info(f"   Muted strings: {muted_strings}")
                    app.logger.info(f"   Tuning: {tuning}")

                    chord_chart_data = {
                        'title': chord_name,
                        'chord_data': {
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
                            'sectionRepeatCount': section_repeat,
                            'lineBreakAfter': line_break_after
                        },
                        'order': chart_order
                    }

                    source_desc = "reference diagram" if use_reference_pattern else "chord pattern"
                    app.logger.info(f"✅ Created chord chart from {source_desc}: {chord_name} = {frets} in {tuning}")

                elif common_chord:
                    # Use the chord fingering from CommonChords
                    # NOTE: Always use the tuning from Claude's analysis (not from CommonChords)
                    # because CommonChords only has EADGBE patterns but we're applying them to any tuning
                    # Filter fingers to only include fretted positions (fret > 0) to prevent blank chord displays
                    raw_fingers = common_chord.get('fingers', [])
                    filtered_fingers = []
                    if raw_fingers:
                        for finger in raw_fingers:
                            if isinstance(finger, list) and len(finger) >= 2 and finger[1] > 0:
                                filtered_fingers.append(finger)

                    chord_chart_data = {
                        'title': chord_name,
                        'chord_data': {
                            'tuning': tuning,  # Use tuning from analysis, not CommonChords
                            'capo': common_chord.get('capo', capo),
                            'startingFret': common_chord.get('startingFret', 1),
                            'numFrets': common_chord.get('numFrets', 5),
                            'numStrings': common_chord.get('numStrings', 6),
                            'fingers': filtered_fingers,
                            'frets': common_chord.get('frets', []),
                            'barres': common_chord.get('barres', []),
                            'openStrings': common_chord.get('openStrings', []),
                            'mutedStrings': common_chord.get('mutedStrings', []),
                            'sectionId': section_id,
                            'sectionLabel': section_label,
                            'sectionRepeatCount': section_repeat,
                            'lineBreakAfter': line_break_after
                        },
                        'order': chart_order
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
                                svguitar_fingers.append([string_num, fret_val])  # No finger numbers - leave to user

                    # 🔧 SVGuitar Debug Logging (Fallback Pattern Path)
                    if not svguitar_fingers and not open_strings:
                        app.logger.warning(f"⚠️ EMPTY CHORD: {chord_name} has no finger positions or open strings - chart will be blank!")
                        app.logger.warning(f"   This usually means: chord name not in CommonChords DB and no fret data from analysis")
                    app.logger.info(f"🔧 SVGuitar Conversion Debug for {chord_name} (Fallback Pattern):")
                    app.logger.info(f"   Input frets: {frets}")
                    app.logger.info(f"   SVGuitar fingers: {svguitar_fingers}")
                    app.logger.info(f"   Open strings: {open_strings}")
                    app.logger.info(f"   Muted strings: {muted_strings}")
                    app.logger.info(f"   Tuning: {tuning}")

                    chord_chart_data = {
                        'title': chord_name,
                        'chord_data': {
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
                            'sectionRepeatCount': section_repeat,
                            'lineBreakAfter': line_break_after
                        },
                        'order': chart_order
                    }

                    app.logger.debug(f"Using chord fret data for {chord_name}: frets={frets}, fingers={fingers}")

                # Include the order in the chord data itself
                all_chord_charts.append((chord_name, section_label, chord_chart_data))
                chart_order += 1

        # Batch create all chord charts in one API call
        if all_chord_charts:
            chord_data_list = [chart_data for _, _, chart_data in all_chord_charts]

            app.logger.info(f"[AUTOCREATE] Batch creating {len(chord_data_list)} chord charts for item {item_id}")
            app.logger.info(f"[AUTOCREATE] Starting batch_add_chord_charts API call")

            try:
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

def assess_ocr_trustworthiness(client, ocr_text, filename, user_id=None):
    """
    Use Claude assess if OCR text contains too much gibberish.
    Returns dict with 'trustworthy' bool and 'reason' string.
    """
    try:
        app.logger.info(f"[AUTOCREATE] Assessing OCR trustworthiness for {filename}")

        assessment_prompt = f"""**OCR Trustworthiness Assessment**

I need you to please assess whether this OCR-extracted text is trustworthy for chord chart processing, or if it contains too much gibberish to trust.

**Your Task:**
Look for OCR artifacts and gibberish strings that indicate corrupted data, such as:
- Random isolated characters mixed with symbols (like "oD t=" or "G =¥i")
- Fragmented text with unusual symbol combinations
- Text that looks like OCR recognition errors rather than real content

**OCR Text to Assess:**
```
{ocr_text[:1000]}{'...' if len(ocr_text) > 1000 else ''}
```

**Response Format:**
Respond with ONLY one of these two options:

TRUSTWORTHY - if the text appears clean and usable despite minor OCR imperfections
CORRUPTED - if there are significant gibberish patterns that indicate unreliable data

**Important:** Be conservative - if you see clear gibberish artifacts, mark as CORRUPTED even if some parts look good."""

        import time
        llm_start_time = time.time()
        response = client.messages.create(
            model="claude-sonnet-4-6",  # simple binary classification
            max_tokens=100,  # Short response needed
            temperature=0.1,
            messages=[{"role": "user", "content": assessment_prompt}]
        )
        llm_end_time = time.time()
        llm_latency = llm_end_time - llm_start_time

        assessment_result = response.content[0].text.strip().upper()
        trustworthy = "TRUSTWORTHY" in assessment_result

        # Track LLM generation with PostHog LLM Analytics
        from app.utils.llm_analytics import track_llm_generation

        # Extract usage information
        usage_dict = {}
        if hasattr(response, 'usage') and response.usage:
            usage = response.usage
            usage_dict = {
                "input_tokens": getattr(usage, 'input_tokens', 0),
                "output_tokens": getattr(usage, 'output_tokens', 0)
            }

        track_llm_generation(
            model="claude-sonnet-4-6",
            input_messages=[{
                "role": "user",
                "content": "Assess OCR text trustworthiness"
            }],
            output_choices=[{
                "role": "assistant",
                "content": assessment_result
            }],
            usage=usage_dict,
            latency_seconds=llm_latency,
            status="success",
            custom_properties={
                "feature": "autocreate_chord_charts",
                "analysis_type": "ocr_trustworthiness_check",
                "ocr_text_length": len(ocr_text),
                "trustworthy": trustworthy,
                "filename": filename
            },
            user_id=user_id
        )

        if "TRUSTWORTHY" in assessment_result:
            app.logger.info(f"[AUTOCREATE] OCR assessment: TRUSTWORTHY")
            return {'trustworthy': True, 'reason': 'Claude assessed OCR text as clean and usable'}
        elif "CORRUPTED" in assessment_result:
            app.logger.info(f"[AUTOCREATE] OCR assessment: CORRUPTED")
            return {'trustworthy': False, 'reason': 'Claude detected gibberish patterns in OCR text'}
        else:
            # Default to untrusted if unclear response
            app.logger.warning(f"[AUTOCREATE] OCR assessment unclear: {assessment_result}, defaulting to untrusted")
            return {'trustworthy': False, 'reason': 'OCR assessment response unclear, being conservative'}

    except Exception as e:
        app.logger.error(f"[AUTOCREATE] OCR trustworthiness assessment failed: {str(e)}")

        # Track failed LLM generation
        from app.utils.llm_analytics import track_llm_generation
        if 'llm_start_time' in locals():
            llm_end_time = time.time()
            llm_latency = llm_end_time - llm_start_time
        else:
            llm_latency = 0

        track_llm_generation(
            model="claude-sonnet-4-6",
            input_messages=[{
                "role": "user",
                "content": "Assess OCR text trustworthiness"
            }],
            output_choices=[],
            latency_seconds=llm_latency,
            status="error",
            error=str(e),
            custom_properties={
                "feature": "autocreate_chord_charts",
                "analysis_type": "ocr_trustworthiness_check",
                "ocr_text_length": len(ocr_text),
                "filename": filename,
                "error_type": type(e).__name__
            },
            user_id=user_id
        )

        # Default to untrusted on error - better safe than sorry
        return {'trustworthy': False, 'reason': f'Assessment error: {str(e)}'}
# ============================================================================
# Billing & Subscription Routes (Stripe Integration)
# ============================================================================

@app.route('/api/billing/create-checkout-session', methods=['POST'])
def create_checkout_session():
    """Create Stripe Checkout Session for subscription purchase"""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        return billing.create_checkout_session(db)
    finally:
        db.close()


@app.route('/api/billing/create-portal-session', methods=['POST'])
def create_portal_session():
    """Create Stripe Customer Portal Session for subscription management"""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        return billing.create_portal_session(db)
    finally:
        db.close()


@app.route('/api/billing/update-subscription', methods=['POST'])
def update_subscription_route():
    """Update existing subscription (upgrades/downgrades for existing customers)"""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        return billing.update_existing_subscription(db)
    finally:
        db.close()


@app.route('/api/billing/preview-upgrade', methods=['POST'])
def preview_upgrade_route():
    """Preview proration for a subscription upgrade/downgrade"""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        return billing.preview_upgrade(db)
    finally:
        db.close()


@app.route('/api/billing/validate-promo-code', methods=['POST'])
def validate_promo_code_route():
    """Validate a promotion code and return discount information"""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        return billing.validate_promo_code(db)
    finally:
        db.close()


@app.route('/api/billing/resume-subscription', methods=['POST'])
def resume_subscription_route():
    """Resume lapsed subscription by updating payment method"""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        return billing.resume_subscription(db)
    finally:
        db.close()


@app.route('/api/billing/set-unplugged', methods=['POST'])
def set_unplugged_route():
    """Set user to unplugged mode (free tier with limited access)"""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        return billing.set_unplugged_mode(db)
    finally:
        db.close()


@app.route('/api/billing/unpause-subscription', methods=['POST'])
def unpause_subscription_route():
    """Unpause subscription and restore full access"""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        return billing.unpause_subscription(db)
    finally:
        db.close()


@app.route('/api/billing/last-payment', methods=['GET'])
def last_payment_route():
    """Get the last successful payment amount and date"""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        return billing.get_last_payment(db)
    finally:
        db.close()


@app.route('/api/autocreate/usage', methods=['GET'])
def get_autocreate_usage():
    """Get current autocreate API usage and limits for the authenticated user.

    Returns usage information for the tier-based rate limiting system.
    byoClaude users (using their own API key) have unlimited access.
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Unauthorized"}), 401

    from app.database import SessionLocal
    from app.utils.rate_limits import get_autocreate_usage_info, get_tier_rate_limits
    from app.utils.encryption import decrypt_api_key

    db = SessionLocal()
    try:
        # Get user's subscription tier and check if they have their own API key
        result = db.execute(text("""
            SELECT s.tier, s.is_complimentary, u.encrypted_anthropic_api_key
            FROM subscriptions s
            JOIN ab_user u ON u.id = s.user_id
            WHERE s.user_id = :user_id
            AND s.status = 'active'
        """), {'user_id': current_user.id}).fetchone()

        if not result:
            return jsonify({
                'is_byo_claude': False,
                'daily_used': 0,
                'daily_limit': 0,
                'hourly_used': 0,
                'hourly_limit': 0,
                'daily_resets_at': None,
                'hourly_resets_at': None,
                'tier': 'free',
            })

        tier = result[0]
        is_complimentary = result[1] or False
        encrypted_key = result[2]

        # Check if user has their own API key
        is_byo_claude = False
        if encrypted_key:
            try:
                user_key = decrypt_api_key(encrypted_key)
                is_byo_claude = bool(user_key)
            except Exception:
                pass

        # Get usage info
        usage_info = get_autocreate_usage_info(current_user.id, tier, is_complimentary)
        daily_limit, hourly_limit = get_tier_rate_limits(tier, is_complimentary)

        return jsonify({
            'is_byo_claude': is_byo_claude,
            'daily_used': usage_info['daily_used'],
            'daily_limit': daily_limit if daily_limit is not None else 'unlimited',
            'hourly_used': usage_info['hourly_used'],
            'hourly_limit': hourly_limit if hourly_limit is not None else 'unlimited',
            'daily_resets_at': usage_info['daily_resets_at'],
            'hourly_resets_at': usage_info['hourly_resets_at'],
            'tier': tier,
            'is_complimentary': is_complimentary,
        })

    except Exception as e:
        app.logger.error(f"Error getting autocreate usage: {e}")
        return jsonify({"error": "Failed to retrieve usage information"}), 500
    finally:
        db.close()


# Account Deletion Endpoints

@app.route('/api/user/calculate-deletion-refund', methods=['GET'])
def calculate_deletion_refund():
    """Calculate prorated refund for scheduled account deletion"""
    if not current_user.is_authenticated:
        return jsonify({"error": "Unauthorized"}), 401

    from app.database import SessionLocal
    db = SessionLocal()
    try:
        # Get user's subscription
        result = db.execute(text("""
            SELECT stripe_customer_id, stripe_subscription_id, tier
            FROM subscriptions
            WHERE user_id = :user_id
        """), {"user_id": current_user.id})

        sub_row = result.fetchone()
        if not sub_row or not sub_row[1]:  # No stripe_subscription_id
            return jsonify({"error": "No active subscription found"}), 404

        stripe_customer_id, stripe_subscription_id, tier = sub_row

        # Fetch subscription details from Stripe
        stripe.api_key = os.getenv('STRIPE_SECRET_KEY')
        subscription = stripe.Subscription.retrieve(stripe_subscription_id)

        # Calculate refund
        # Period fields are in subscription items, not at root level
        subscription_item = subscription['items']['data'][0]
        current_period_end = subscription_item['current_period_end']
        current_period_start = subscription_item['current_period_start']
        now = datetime.now().timestamp()

        total_days = (current_period_end - current_period_start) / 86400  # Convert seconds to days
        days_remaining = (current_period_end - now) / 86400

        # Get the amount paid for this period
        # Use the subscription's plan amount
        amount_paid = subscription['plan']['amount'] / 100  # Convert from cents to dollars

        # Calculate prorated refund
        refund_amount = round((days_remaining / total_days) * amount_paid, 2)

        # Format renewal date
        renewal_date = datetime.fromtimestamp(current_period_end).strftime("%B %d, %Y")

        return jsonify({
            "renewal_date": renewal_date,
            "refund_amount": refund_amount,
            "days_remaining": int(days_remaining)
        })

    except Exception as e:
        app.logger.error(f"Error calculating deletion refund: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route('/api/user/delete-account-scheduled', methods=['POST'])
def delete_account_scheduled():
    """Schedule account deletion for renewal date (NO REFUND - they pay to use until renewal)"""
    if not current_user.is_authenticated:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json
    confirmation_phrase = data.get('confirmation_phrase', '')
    email = data.get('email', '')

    # Validate confirmation phrase (exact match)
    if confirmation_phrase != "If I delete it I cannot get it back":
        return jsonify({"error": "Confirmation phrase does not match"}), 400

    # Validate email matches current user
    if email.lower() != current_user.email.lower():
        return jsonify({"error": "Email does not match account email"}), 400

    from app.database import SessionLocal
    db = SessionLocal()
    try:
        # Check rate limiting (once per month)
        result = db.execute(text("""
            SELECT last_deletion_action
            FROM subscriptions
            WHERE user_id = :user_id
        """), {"user_id": current_user.id})

        rate_check = result.fetchone()
        if rate_check and rate_check[0]:
            from datetime import timedelta
            days_since_last = (datetime.now() - rate_check[0].replace(tzinfo=None)).days
            if days_since_last < 30:
                return jsonify({"error": f"You can only schedule/cancel deletion once per month. Please try again in {30 - days_since_last} days."}), 429

        # Get user's subscription
        result = db.execute(text("""
            SELECT stripe_customer_id, stripe_subscription_id, tier, current_period_end
            FROM subscriptions
            WHERE user_id = :user_id
        """), {"user_id": current_user.id})

        sub_row = result.fetchone()
        if not sub_row or not sub_row[1]:
            return jsonify({"error": "No active subscription found"}), 404

        stripe_customer_id, stripe_subscription_id, tier, current_period_end = sub_row

        # Cancel Stripe subscription at period end (NO immediate refund)
        stripe.api_key = os.getenv('STRIPE_SECRET_KEY')
        subscription = stripe.Subscription.modify(
            stripe_subscription_id,
            cancel_at_period_end=True
        )

        # Get actual period end from Stripe response
        deletion_date = datetime.fromtimestamp(subscription['current_period_end'])

        # Update database with deletion schedule (NO refund amount)
        db.execute(text("""
            UPDATE subscriptions
            SET deletion_scheduled_for = :deletion_date,
                deletion_type = 'scheduled',
                prorated_refund_amount = 0,
                last_deletion_action = :now
            WHERE user_id = :user_id
        """), {
            "deletion_date": deletion_date,
            "now": datetime.now(),
            "user_id": current_user.id
        })
        db.commit()

        # TODO: Send confirmation email

        return jsonify({
            "success": True,
            "deletion_date": deletion_date.strftime("%B %d, %Y")
        })

    except Exception as e:
        db.rollback()
        app.logger.error(f"Error scheduling account deletion: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route('/api/user/delete-account-immediate', methods=['POST'])
def delete_account_immediate():
    """Delete account immediately with no refund - ACTUALLY deletes the account"""
    if not current_user.is_authenticated:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json
    confirmation_phrase = data.get('confirmation_phrase', '')
    email = data.get('email', '')

    # Validate confirmation phrase (exact match)
    if confirmation_phrase != "If I delete now I cannot get my data or money back":
        return jsonify({"error": "Confirmation phrase does not match"}), 400

    # Validate email matches current user
    if email.lower() != current_user.email.lower():
        return jsonify({"error": "Email does not match account email"}), 400

    from app.database import SessionLocal
    from app.utils.account_deletion import delete_user_account
    from flask import session as flask_session

    db = SessionLocal()
    try:
        # Store user info before deletion
        user_id = current_user.id
        user_email = current_user.email

        # Get user's subscription for Stripe cancellation
        result = db.execute(text("""
            SELECT stripe_customer_id, stripe_subscription_id, tier
            FROM subscriptions
            WHERE user_id = :user_id
        """), {"user_id": user_id})

        sub_row = result.fetchone()

        # Create portal URL BEFORE deleting customer (if we have stripe_customer_id)
        # After deletion, customer won't exist in Stripe anymore
        portal_url = None
        if sub_row and sub_row[0]:  # Has stripe_customer_id
            try:
                stripe.api_key = os.getenv('STRIPE_SECRET_KEY')
                portal_session = stripe.billing_portal.Session.create(
                    customer=sub_row[0],
                    return_url=f"{request.host_url}login"
                )
                portal_url = portal_session.url
                app.logger.info(f"Created portal session for user {user_id} before deletion")
            except Exception as portal_error:
                app.logger.warning(f"Error creating portal session: {portal_error}")
                # Fallback to login page
                portal_url = f"{request.host_url}login"
        else:
            portal_url = f"{request.host_url}login"

        # Cancel Stripe subscription immediately (no refund)
        if sub_row and sub_row[1]:  # Has stripe_subscription_id
            stripe.api_key = os.getenv('STRIPE_SECRET_KEY')
            try:
                stripe.Subscription.delete(sub_row[1])
                app.logger.info(f"Canceled Stripe subscription {sub_row[1]} for user {user_id}")
            except Exception as stripe_error:
                app.logger.warning(f"Error canceling Stripe subscription: {stripe_error}")
                # Continue with deletion even if Stripe cancel fails

        # ACTUALLY DELETE THE ACCOUNT (not just mark for deletion)
        deletion_success = delete_user_account(db, user_id, user_email)

        if not deletion_success:
            raise Exception("Account deletion failed")

        # Clear Flask session to log user out
        flask_session.clear()

        # Return success with redirect URL (portal or login)
        return jsonify({
            "success": True,
            "message": "Account deleted successfully",
            "redirect_url": portal_url
        })

    except Exception as e:
        db.rollback()
        app.logger.error(f"Error deleting account immediately: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route('/api/user/cancel-deletion', methods=['POST'])
def cancel_deletion():
    """Cancel scheduled account deletion"""
    if not current_user.is_authenticated:
        return jsonify({"error": "Unauthorized"}), 401

    from app.database import SessionLocal
    db = SessionLocal()
    try:
        # Check rate limiting (once per month)
        result = db.execute(text("""
            SELECT last_deletion_action
            FROM subscriptions
            WHERE user_id = :user_id
        """), {"user_id": current_user.id})

        rate_check = result.fetchone()
        if rate_check and rate_check[0]:
            days_since_last = (datetime.now() - rate_check[0].replace(tzinfo=None)).days
            if days_since_last < 30:
                return jsonify({"error": f"You can only schedule/cancel deletion once per month. Please try again in {30 - days_since_last} days."}), 429

        # Get user's subscription
        result = db.execute(text("""
            SELECT stripe_subscription_id, deletion_scheduled_for
            FROM subscriptions
            WHERE user_id = :user_id
        """), {"user_id": current_user.id})

        sub_row = result.fetchone()
        if not sub_row or not sub_row[1]:
            return jsonify({"error": "No deletion scheduled"}), 404

        stripe_subscription_id, deletion_date = sub_row

        # Reactivate Stripe subscription (remove cancel_at_period_end)
        if stripe_subscription_id:
            stripe.api_key = os.getenv('STRIPE_SECRET_KEY')
            stripe.Subscription.modify(
                stripe_subscription_id,
                cancel_at_period_end=False
            )

        # Clear deletion fields
        db.execute(text("""
            UPDATE subscriptions
            SET deletion_scheduled_for = NULL,
                deletion_type = NULL,
                prorated_refund_amount = NULL,
                last_deletion_action = :now
            WHERE user_id = :user_id
        """), {
            "now": datetime.now(),
            "user_id": current_user.id
        })
        db.commit()

        # TODO: Send "Welcome back!" email

        return jsonify({
            "success": True,
            "message": "Deletion canceled successfully"
        })

    except Exception as e:
        db.rollback()
        app.logger.error(f"Error canceling deletion: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route('/api/user/delete-account-free', methods=['POST'])
def delete_account_free():
    """Delete account for free tier users (no Stripe subscription) - ACTUALLY deletes"""
    if not current_user.is_authenticated:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json
    confirmation_phrase = data.get('confirmation_phrase', '')
    email = data.get('email', '')

    # Validate confirmation phrase (exact match for immediate deletion)
    if confirmation_phrase != "If I delete now I cannot get my data or money back":
        return jsonify({"error": "Confirmation phrase does not match"}), 400

    # Validate email matches current user
    if email.lower() != current_user.email.lower():
        return jsonify({"error": "Email does not match account email"}), 400

    from app.database import SessionLocal
    from app.utils.account_deletion import delete_user_account
    from flask import session as flask_session

    db = SessionLocal()
    try:
        # Store user info before deletion
        user_id = current_user.id
        user_email = current_user.email

        # Verify user is on free tier OR in unplugged mode (canceled/paused)
        result = db.execute(text("""
            SELECT tier, stripe_subscription_id, unplugged_mode
            FROM subscriptions
            WHERE user_id = :user_id
        """), {"user_id": user_id})

        sub_row = result.fetchone()
        # Allow deletion if tier is free OR user is in unplugged mode
        if sub_row and sub_row[0] != 'free' and not sub_row[2]:
            return jsonify({"error": "This endpoint is only for free tier users"}), 400

        # ACTUALLY DELETE THE ACCOUNT (not just mark for deletion)
        deletion_success = delete_user_account(db, user_id, user_email)

        if not deletion_success:
            raise Exception("Account deletion failed")

        # Clear Flask session to log user out
        flask_session.clear()

        return jsonify({
            "success": True,
            "message": "Account deleted successfully"
        })

    except Exception as e:
        db.rollback()
        app.logger.error(f"Error deleting free tier account: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# =============================================================================
# EXPORT ENDPOINTS - "Download all the things!"
# =============================================================================

@app.route('/api/user/export/items', methods=['GET'])
def export_items():
    """
    Export user's practice items as CSV or JSON.

    Query params:
        format: 'csv' or 'json' (default: json)

    Returns: File download with Content-Disposition header
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    try:
        from datetime import datetime
        import csv
        from io import StringIO

        format_type = request.args.get('format', 'json').lower()

        # Get all items (RLS-filtered by user)
        items = data_layer.get_all_items()

        if format_type == 'csv':
            # Create CSV in memory
            si = StringIO()
            writer = csv.writer(si)

            # Write header
            writer.writerow(['ItemID', 'Title', 'Notes', 'Duration', 'Description', 'Order', 'Tuning', 'SongbookPath'])

            # Write data rows
            for item in items:
                writer.writerow([
                    item.get('B', ''),  # ItemID
                    item.get('C', ''),  # Title
                    item.get('D', ''),  # Notes
                    item.get('E', ''),  # Duration
                    item.get('F', ''),  # Description
                    item.get('G', ''),  # Order
                    item.get('H', ''),  # Tuning
                    item.get('I', '')   # SongbookPath
                ])

            output = si.getvalue()
            response = app.response_class(
                response=output,
                mimetype='text/csv'
            )
            response.headers['Content-Disposition'] = f'attachment; filename=items-{datetime.utcnow().date()}.csv'
            return response

        else:  # JSON (default)
            # Transform to cleaner format for export
            items_data = [{
                'item_id': item.get('B', ''),
                'title': item.get('C', ''),
                'notes': item.get('D', ''),
                'duration': item.get('E', ''),
                'description': item.get('F', ''),
                'order': item.get('G', ''),
                'tuning': item.get('H', ''),
                'songbook_path': item.get('I', '')
            } for item in items]

            response = jsonify(items_data)
            response.headers['Content-Disposition'] = f'attachment; filename=items-{datetime.utcnow().date()}.json'
            return response

    except Exception as e:
        app.logger.error(f"Error exporting items for user {current_user.id}: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        return jsonify({"error": "Failed to export items"}), 500


@app.route('/api/user/export/routines', methods=['GET'])
def export_routines():
    """
    Export user's routines as CSV or JSON.

    Query params:
        format: 'csv' or 'json' (default: json)

    Returns: File download with Content-Disposition header
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    try:
        from datetime import datetime
        import csv
        from io import StringIO

        format_type = request.args.get('format', 'json').lower()

        # Get all routines (RLS-filtered by user)
        routines = data_layer.get_all_routines()

        # For each routine, get the item IDs
        routines_with_items = []
        for routine in routines:
            routine_id = routine.get('ID')
            items = data_layer.get_routine_items(int(routine_id)) if routine_id else []
            # Extract ItemIDs from items (Column B is ItemID)
            item_ids = [item.get('B', '') for item in items if item.get('B')]

            routines_with_items.append({
                'routine_id': routine_id,
                'name': routine.get('name', ''),
                'order': routine.get('order', ''),
                'created': routine.get('created', ''),
                'item_ids': item_ids
            })

        if format_type == 'csv':
            # Create CSV in memory
            si = StringIO()
            writer = csv.writer(si)

            # Write header
            writer.writerow(['RoutineID', 'Name', 'Order', 'ItemIDs'])

            # Write data rows
            for routine in routines_with_items:
                writer.writerow([
                    routine['routine_id'],
                    routine['name'],
                    routine['order'],
                    ', '.join(routine['item_ids'])  # Comma-separated item IDs
                ])

            output = si.getvalue()
            response = app.response_class(
                response=output,
                mimetype='text/csv'
            )
            response.headers['Content-Disposition'] = f'attachment; filename=routines-{datetime.utcnow().date()}.csv'
            return response

        else:  # JSON (default)
            response = jsonify(routines_with_items)
            response.headers['Content-Disposition'] = f'attachment; filename=routines-{datetime.utcnow().date()}.json'
            return response

    except Exception as e:
        app.logger.error(f"Error exporting routines for user {current_user.id}: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        return jsonify({"error": "Failed to export routines"}), 500


@app.route('/api/user/export/chord-charts', methods=['GET'])
def export_chord_charts():
    """
    Export user's chord charts as JSON (needed for client-side PDF generation).

    Returns: JSON with structure { items: [{ item_id, item_title, charts: [...] }] }
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    try:
        from datetime import datetime

        # Get all items to iterate through
        items = data_layer.get_all_items()

        # Collect item IDs for batch fetch
        item_ids = [int(item.get('B')) for item in items if item.get('B')]

        # Get chord charts for all items
        charts_by_item = data_layer.batch_get_chord_charts(item_ids)

        # Build the export structure
        items_with_charts = []
        for item in items:
            item_id = item.get('B', '')
            if item_id and str(item_id) in charts_by_item:
                charts = charts_by_item[str(item_id)]
                if charts:  # Only include items that have charts
                    items_with_charts.append({
                        'item_id': item_id,
                        'item_title': item.get('C', ''),
                        'tuning': item.get('H', ''),
                        'charts': charts  # Full chart data including svg_content if present
                    })

        export_data = {
            'exported_at': datetime.utcnow().isoformat(),
            'items': items_with_charts
        }

        response = jsonify(export_data)
        response.headers['Content-Disposition'] = f'attachment; filename=chord-charts-{datetime.utcnow().date()}.json'
        return response

    except Exception as e:
        app.logger.error(f"Error exporting chord charts for user {current_user.id}: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        return jsonify({"error": "Failed to export chord charts"}), 500


@app.route('/api/user/export/all', methods=['GET'])
def export_all():
    """
    Export all user data as a ZIP file containing:
    - items.csv + items.json
    - routines.csv + routines.json
    - chord-charts.json + chord-charts.pdf
    - practice-history.csv + practice-history.json

    Returns: ZIP file download
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    try:
        from datetime import datetime
        import csv
        from io import StringIO, BytesIO
        import zipfile
        import json
        from app import appbuilder
        from app.models import PracticeEvent

        db = appbuilder.session
        user_id = current_user.id
        export_date = datetime.utcnow().date()

        # Create ZIP file in memory
        zip_buffer = BytesIO()

        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:

            # ===== ITEMS =====
            items = data_layer.get_all_items()

            # Items CSV
            items_csv = StringIO()
            writer = csv.writer(items_csv)
            writer.writerow(['ItemID', 'Title', 'Notes', 'Duration', 'Description', 'Order', 'Tuning', 'SongbookPath'])
            for item in items:
                writer.writerow([
                    item.get('B', ''),
                    item.get('C', ''),
                    item.get('D', ''),
                    item.get('E', ''),
                    item.get('F', ''),
                    item.get('G', ''),
                    item.get('H', ''),
                    item.get('I', '')
                ])
            zip_file.writestr('items.csv', items_csv.getvalue())

            # Items JSON
            items_json = [{
                'item_id': item.get('B', ''),
                'title': item.get('C', ''),
                'notes': item.get('D', ''),
                'duration': item.get('E', ''),
                'description': item.get('F', ''),
                'order': item.get('G', ''),
                'tuning': item.get('H', ''),
                'songbook_path': item.get('I', '')
            } for item in items]
            zip_file.writestr('items.json', json.dumps(items_json, indent=2))

            # ===== ROUTINES =====
            routines = data_layer.get_all_routines()

            # Build routines with their items
            routines_with_items = []
            for routine in routines:
                routine_id = routine.get('ID')
                routine_items = data_layer.get_routine_items(int(routine_id)) if routine_id else []
                item_ids = [item.get('B', '') for item in routine_items if item.get('B')]

                routines_with_items.append({
                    'routine_id': routine_id,
                    'name': routine.get('name', ''),
                    'order': routine.get('order', ''),
                    'created': routine.get('created', ''),
                    'item_ids': item_ids
                })

            # Routines CSV
            routines_csv = StringIO()
            writer = csv.writer(routines_csv)
            writer.writerow(['RoutineID', 'Name', 'Order', 'ItemIDs'])
            for routine in routines_with_items:
                writer.writerow([
                    routine['routine_id'],
                    routine['name'],
                    routine['order'],
                    ', '.join(routine['item_ids'])
                ])
            zip_file.writestr('routines.csv', routines_csv.getvalue())

            # Routines JSON
            zip_file.writestr('routines.json', json.dumps(routines_with_items, indent=2))

            # ===== CHORD CHARTS =====
            item_ids = [int(item.get('B')) for item in items if item.get('B')]
            charts_by_item = data_layer.batch_get_chord_charts(item_ids)

            items_with_charts = []
            for item in items:
                item_id = item.get('B', '')
                if item_id and str(item_id) in charts_by_item:
                    charts = charts_by_item[str(item_id)]
                    if charts:
                        items_with_charts.append({
                            'item_id': item_id,
                            'item_title': item.get('C', ''),
                            'tuning': item.get('H', ''),
                            'charts': charts
                        })

            chord_charts_data = {
                'exported_at': datetime.utcnow().isoformat(),
                'items': items_with_charts
            }
            zip_file.writestr('chord-charts.json', json.dumps(chord_charts_data, indent=2))
            # Note: PDF chord charts are generated client-side with SVGuitar for proper visual rendering

            # ===== PRACTICE HISTORY (skip old PDF generation) =====
            # The following PDF generation code has been removed - client-side now handles it
            if False and items_with_charts:  # Disabled - client generates PDFs with proper chord diagrams
                try:
                    from fpdf import FPDF

                    pdf = FPDF(orientation='L', unit='mm', format='A4')  # Landscape A4
                    pdf.set_auto_page_break(auto=True, margin=15)
                    pdf.add_page()

                    # Title
                    pdf.set_font('Helvetica', 'B', 16)
                    pdf.cell(0, 10, 'Guitar Practice Routine App - Chord Charts', align='C', new_x='LMARGIN', new_y='NEXT')
                    pdf.set_font('Helvetica', '', 10)
                    pdf.cell(0, 6, f'Exported {export_date}', align='C', new_x='LMARGIN', new_y='NEXT')
                    pdf.ln(5)

                    page_width = pdf.w - 20  # margins
                    col_width = page_width / 5  # 5 columns
                    chart_height = 35

                    for item in items_with_charts:
                        # Item header
                        pdf.set_font('Helvetica', 'B', 12)
                        pdf.cell(0, 8, item.get('item_title', 'Untitled'), new_x='LMARGIN', new_y='NEXT')

                        if item.get('tuning'):
                            pdf.set_font('Helvetica', 'I', 9)
                            pdf.cell(0, 5, f"Tuning: {item['tuning']}", new_x='LMARGIN', new_y='NEXT')

                        pdf.ln(2)

                        # Group charts by section
                        sections = {}
                        for chart in item.get('charts', []):
                            section = chart.get('sectionLabel', 'General')
                            if section not in sections:
                                sections[section] = []
                            sections[section].append(chart)

                        for section_name, charts in sections.items():
                            # Section header
                            pdf.set_font('Helvetica', 'B', 10)
                            pdf.cell(0, 6, section_name, new_x='LMARGIN', new_y='NEXT')

                            # Charts in 5-column layout
                            start_y = pdf.get_y()
                            col_idx = 0

                            for chart in charts:
                                if col_idx >= 5:
                                    col_idx = 0
                                    pdf.ln(chart_height)
                                    start_y = pdf.get_y()

                                x = 10 + (col_idx * col_width)
                                y = start_y

                                # Check if we need a new page
                                if y + chart_height > pdf.h - 20:
                                    pdf.add_page()
                                    start_y = pdf.get_y()
                                    y = start_y

                                # Chord name
                                pdf.set_xy(x, y)
                                pdf.set_font('Helvetica', 'B', 9)
                                pdf.cell(col_width - 2, 5, chart.get('title', 'Unknown'), new_x='LEFT', new_y='NEXT')

                                pdf.set_font('Courier', '', 7)
                                line_y = y + 5

                                # Starting fret
                                if chart.get('startingFret', 1) > 1:
                                    pdf.set_xy(x, line_y)
                                    pdf.cell(col_width - 2, 3, f"Fret: {chart['startingFret']}", new_x='LEFT', new_y='NEXT')
                                    line_y += 3

                                # Finger positions
                                fingers = chart.get('fingers', [])
                                if fingers:
                                    fret_info = ' '.join([f"{f[0]}:{f[1]}" for f in fingers if isinstance(f, list) and len(f) >= 2])
                                    if fret_info:
                                        pdf.set_xy(x, line_y)
                                        pdf.cell(col_width - 2, 3, f"Frets: {fret_info[:20]}", new_x='LEFT', new_y='NEXT')
                                        line_y += 3

                                # Open strings
                                open_strings = chart.get('openStrings', [])
                                if open_strings:
                                    pdf.set_xy(x, line_y)
                                    pdf.cell(col_width - 2, 3, f"Open: {', '.join(map(str, open_strings))}", new_x='LEFT', new_y='NEXT')
                                    line_y += 3

                                # Muted strings
                                muted = chart.get('mutedStrings', [])
                                if muted:
                                    pdf.set_xy(x, line_y)
                                    pdf.cell(col_width - 2, 3, f"Muted: {', '.join(map(str, muted))}", new_x='LEFT', new_y='NEXT')
                                    line_y += 3

                                # Barres
                                barres = chart.get('barres', [])
                                if barres:
                                    barre_str = ', '.join([f"Bar {b['fret']}" for b in barres if isinstance(b, dict)])
                                    if barre_str:
                                        pdf.set_xy(x, line_y)
                                        pdf.cell(col_width - 2, 3, barre_str[:20], new_x='LEFT', new_y='NEXT')

                                # Draw box around chord
                                pdf.set_draw_color(150, 150, 150)
                                pdf.rect(x, y, col_width - 2, chart_height - 2)

                                col_idx += 1

                            pdf.ln(chart_height + 5)

                        pdf.ln(3)

                    # Generate PDF bytes
                    pdf_bytes = pdf.output()
                    zip_file.writestr('chord-charts.pdf', pdf_bytes)
                except Exception as pdf_error:
                    app.logger.warning(f"Could not generate chord charts PDF: {pdf_error}")
                    # Continue without PDF - JSON is already included

            # ===== PRACTICE HISTORY =====
            events = db.query(PracticeEvent).filter_by(user_id=user_id).order_by(PracticeEvent.created_at.desc()).all()

            # Practice History CSV
            history_csv = StringIO()
            writer = csv.writer(history_csv)
            writer.writerow(['Event Type', 'Item Name', 'Routine Name', 'Duration (seconds)', 'Created At'])
            for event in events:
                writer.writerow([
                    event.event_type,
                    event.item_name or '',
                    event.routine_name or '',
                    event.duration_seconds or '',
                    event.created_at.isoformat()
                ])
            zip_file.writestr('practice-history.csv', history_csv.getvalue())

            # Practice History JSON
            events_json = [{
                'event_type': event.event_type,
                'item_name': event.item_name,
                'routine_name': event.routine_name,
                'duration_seconds': event.duration_seconds,
                'additional_data': event.additional_data,
                'created_at': event.created_at.isoformat()
            } for event in events]
            zip_file.writestr('practice-history.json', json.dumps(events_json, indent=2))

        # Prepare ZIP file for download
        zip_buffer.seek(0)

        response = app.response_class(
            response=zip_buffer.getvalue(),
            mimetype='application/zip'
        )
        response.headers['Content-Disposition'] = f'attachment; filename=gpra-export-{export_date}.zip'
        return response

    except Exception as e:
        app.logger.error(f"Error exporting all data for user {current_user.id}: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        return jsonify({"error": "Failed to export data"}), 500


@app.route('/api/webhooks/stripe', methods=['POST'])
def stripe_webhook():
    """Handle Stripe webhook events"""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        return billing.handle_stripe_webhook(db)
    finally:
        db.close()


@app.route('/api/unsubscribe/inactivity/<token>', methods=['GET'])
def unsubscribe_inactivity_emails(token):
    """
    Handle one-click unsubscribe from inactivity reminder emails.

    This endpoint allows users to opt out of 90-day inactivity emails
    without needing to log in. The token is cryptographically signed
    and tied to a specific user.

    Returns a simple HTML page confirming the unsubscribe action.
    """
    from itsdangerous import SignatureExpired, BadSignature
    from app.unsubscribe_tokens import validate_unsubscribe_token

    html_template = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>GPRA - Unsubscribe</title>
        <style>
            body {{
                font-family: Arial, sans-serif;
                background-color: #111827;
                color: #f3f4f6;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                margin: 0;
            }}
            .container {{
                background-color: #1f2937;
                padding: 40px;
                border-radius: 8px;
                text-align: center;
                max-width: 500px;
            }}
            h1 {{
                color: #ea580c;
                margin-bottom: 20px;
            }}
            p {{
                color: #d1d5db;
                line-height: 1.6;
            }}
            .success {{
                color: #16a34a;
            }}
            .error {{
                color: #dc2626;
            }}
            a {{
                color: #ea580c;
                text-decoration: none;
            }}
            a:hover {{
                text-decoration: underline;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            {content}
        </div>
    </body>
    </html>
    """

    try:
        # Validate the token
        payload = validate_unsubscribe_token(token)
        user_id = payload['user_id']

        # Update the subscription to opt out of inactivity emails
        with DatabaseTransaction() as tx:
            tx.execute(text("""
                UPDATE subscriptions
                SET inactivity_emails_opted_out = TRUE
                WHERE user_id = :user_id
            """), {"user_id": user_id})
            tx.commit()

        app.logger.info(f"User {user_id} unsubscribed from inactivity emails")

        content = """
            <h1>Unsubscribed</h1>
            <p class="success">You've been successfully unsubscribed from inactivity reminder emails.</p>
            <p>You will no longer receive emails about unused subscriptions.</p>
            <p style="margin-top: 30px;">
                <a href="https://guitarpracticeroutine.com/">Go to GPRA</a>
            </p>
        """

        return html_template.format(content=content), 200

    except SignatureExpired:
        app.logger.warning(f"Expired unsubscribe token used")
        content = """
            <h1>Link Expired</h1>
            <p class="error">This unsubscribe link has expired.</p>
            <p>Please log in to your account to manage your email preferences, or contact support.</p>
            <p style="margin-top: 30px;">
                <a href="https://guitarpracticeroutine.com/#Account">Go to Account Settings</a>
            </p>
        """
        return html_template.format(content=content), 400

    except BadSignature:
        app.logger.warning(f"Invalid unsubscribe token used")
        content = """
            <h1>Invalid Link</h1>
            <p class="error">This unsubscribe link is invalid.</p>
            <p>Please log in to your account to manage your email preferences, or contact support.</p>
            <p style="margin-top: 30px;">
                <a href="https://guitarpracticeroutine.com/#Account">Go to Account Settings</a>
            </p>
        """
        return html_template.format(content=content), 400

    except Exception as e:
        app.logger.error(f"Error processing unsubscribe: {e}")
        content = """
            <h1>Something Went Wrong</h1>
            <p class="error">We couldn't process your unsubscribe request.</p>
            <p>Please try again later or contact support.</p>
            <p style="margin-top: 30px;">
                <a href="https://guitarpracticeroutine.com/#Account">Go to Account Settings</a>
            </p>
        """
        return html_template.format(content=content), 500


# ============================================================================
# Practice Stats (PostHog Endpoints)
# ============================================================================

PRACTICE_STATS_PERIODS = {
    'today': 1,
    'week': 7,
    'month': 30,
    'year': 365,
    'all': 3650,
}

@app.route('/api/user/practice-stats', methods=['GET'])
def get_practice_stats():
    """
    Fetch practice statistics for the current user via PostHog Endpoints.

    Calls three PostHog SQL Endpoints (summary, daily breakdown, top items)
    and returns the combined results.

    Query params:
        period: 'today', 'week', 'month', 'year', 'all' (default: 'week')

    Returns:
        {
            "summary": {"days_practiced": N, "items_completed": N, ...},
            "daily": [{"practice_date": "2026-04-01", ...}, ...],
            "top_items": [{"item_name": "...", ...}, ...],
            "period": "week"
        }

    Errors:
        401 - Not authenticated
        403 - Free tier (stats require a paid subscription)
        503 - PostHog unavailable
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    # Tier gating: free tier users cannot access stats
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        subscription = db.execute(text("""
            SELECT tier FROM subscriptions WHERE user_id = :user_id
        """), {'user_id': current_user.id}).fetchone()
        tier = subscription[0] if subscription else 'free'
    finally:
        db.close()
        SessionLocal.remove()

    if tier == 'free':
        return jsonify({"error": "Stats require a paid subscription"}), 403

    # Parse period
    period = request.args.get('period', 'week')
    if period not in PRACTICE_STATS_PERIODS:
        return jsonify({"error": f"Invalid period. Must be one of: {', '.join(PRACTICE_STATS_PERIODS.keys())}"}), 400

    days_back = PRACTICE_STATS_PERIODS[period]

    # Get PostHog distinct_id for this user
    from app.utils.posthog_client import get_posthog_distinct_id, call_posthog_endpoint
    distinct_id = get_posthog_distinct_id(current_user.id, current_user.email)

    variables = {'distinct_id': distinct_id, 'days_back': days_back}

    # Call all three endpoints in parallel - each is an independent HTTPS
    # round trip to PostHog, so wall time drops to the slowest single call.
    # carry_otel_context keeps their spans nested under the request trace.
    from concurrent.futures import ThreadPoolExecutor
    from app.utils.otel_traces import carry_otel_context
    call_endpoint = carry_otel_context(call_posthog_endpoint)
    with ThreadPoolExecutor(max_workers=3) as pool:
        summary_future = pool.submit(call_endpoint, 'user_practice_summary', variables)
        daily_future = pool.submit(call_endpoint, 'user_daily_practice', variables)
        top_items_future = pool.submit(call_endpoint, 'user_top_items', variables)
        summary_rows = summary_future.result()
        daily_rows = daily_future.result()
        top_items_rows = top_items_future.result()

    # If all three failed, PostHog is likely down
    if summary_rows is None and daily_rows is None and top_items_rows is None:
        return jsonify({"error": "Practice stats are temporarily unavailable"}), 503

    # Build response — use empty defaults for any individual failures
    summary = summary_rows[0] if summary_rows else {
        'days_practiced': 0,
        'items_completed': 0,
        'timers_started': 0,
        'total_practice_seconds': 0,
        'avg_item_seconds': 0,
    }

    return jsonify({
        "summary": summary,
        "daily": daily_rows or [],
        "top_items": top_items_rows or [],
        "period": period,
    })
