"""BlueSky AT Protocol adapter — posts to a feed via createSession + createRecord.

Credentials come from env (BLUESKY_HANDLE, BLUESKY_APP_PASSWORD). The handle is
the full domain form (e.g. "gpra.bsky.social", no leading @). The password is
an *app password* generated under bsky.app Settings → App Passwords — NOT the
account login password.

Returns sanitized result dicts so the caller can persist outcomes safely. Error
strings never include credentials or full request bodies.
"""
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests


BLUESKY_PDS = 'https://bsky.social'
DEFAULT_TIMEOUT_SECONDS = 30


def _build_facets(text: str, url: Optional[str] = None) -> List[Dict[str, Any]]:
    """Build BlueSky facets (clickable spans) for hashtags and the URL.

    Facet ranges use **byte** offsets in the UTF-8 encoded text, not character
    offsets. This matters when the post contains multibyte characters (emoji,
    accented letters) — getting it wrong makes the spans render in the wrong
    place, or not at all.
    """
    facets: List[Dict[str, Any]] = []

    for m in re.finditer(r'#\w+', text):
        char_start, char_end = m.start(), m.end()
        byte_start = len(text[:char_start].encode('utf-8'))
        byte_end = len(text[:char_end].encode('utf-8'))
        facets.append({
            'index': {'byteStart': byte_start, 'byteEnd': byte_end},
            'features': [{
                '$type': 'app.bsky.richtext.facet#tag',
                'tag': m.group()[1:],  # strip the leading '#'
            }],
        })

    if url and url in text:
        char_start = text.index(url)
        char_end = char_start + len(url)
        byte_start = len(text[:char_start].encode('utf-8'))
        byte_end = len(text[:char_end].encode('utf-8'))
        facets.append({
            'index': {'byteStart': byte_start, 'byteEnd': byte_end},
            'features': [{
                '$type': 'app.bsky.richtext.facet#link',
                'uri': url,
            }],
        })

    return facets


def _safe_error(e: Exception) -> str:
    """Strip JWTs and app-password-shaped strings from error messages."""
    msg = str(e)
    msg = re.sub(r'eyJ[\w\-\.]+', '[REDACTED]', msg)  # JWT pattern (header.payload.signature)
    msg = re.sub(r'\b\w{4}-\w{4}-\w{4}-\w{4}\b', '[REDACTED]', msg)  # app-password pattern
    if len(msg) > 200:
        msg = msg[:200] + '...'
    return msg


def _create_session(handle: str, app_password: str) -> Dict[str, str]:
    url = f'{BLUESKY_PDS}/xrpc/com.atproto.server.createSession'
    r = requests.post(
        url,
        json={'identifier': handle, 'password': app_password},
        timeout=DEFAULT_TIMEOUT_SECONDS,
    )
    r.raise_for_status()
    data = r.json()
    return {
        'accessJwt': data['accessJwt'],
        'did': data['did'],
        'handle': data['handle'],
    }


def _create_record(session: Dict[str, str], record: Dict[str, Any]) -> Dict[str, Any]:
    url = f'{BLUESKY_PDS}/xrpc/com.atproto.repo.createRecord'
    r = requests.post(
        url,
        json={
            'repo': session['did'],
            'collection': 'app.bsky.feed.post',
            'record': record,
        },
        headers={'Authorization': f'Bearer {session["accessJwt"]}'},
        timeout=DEFAULT_TIMEOUT_SECONDS,
    )
    r.raise_for_status()
    return r.json()


def post(
    text: str,
    url: Optional[str] = None,
    handle: Optional[str] = None,
    app_password: Optional[str] = None,
) -> Dict[str, Any]:
    """Post to BlueSky.

    Returns:
        {'ok': True, 'uri': 'at://did:plc:.../app.bsky.feed.post/...'} on success
        {'ok': False, 'error': '<safe message>'} on failure (creds redacted)
    """
    if handle is None:
        handle = os.getenv('BLUESKY_HANDLE')
    if app_password is None:
        app_password = os.getenv('BLUESKY_APP_PASSWORD')
    if not handle or not app_password:
        return {'ok': False, 'error': 'BlueSky credentials not configured (BLUESKY_HANDLE, BLUESKY_APP_PASSWORD)'}

    try:
        session = _create_session(handle, app_password)
    except Exception as e:
        return {'ok': False, 'error': f'BlueSky auth failed: {_safe_error(e)}'}

    record = {
        '$type': 'app.bsky.feed.post',
        'text': text,
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'langs': ['en'],
        'facets': _build_facets(text, url),
    }

    try:
        result = _create_record(session, record)
    except Exception as e:
        return {'ok': False, 'error': f'BlueSky post failed: {_safe_error(e)}'}

    return {'ok': True, 'uri': result.get('uri')}


def delete_post(
    uri: str,
    handle: Optional[str] = None,
    app_password: Optional[str] = None,
) -> Dict[str, Any]:
    """Delete a post by its AT URI. Used for live-test cleanup."""
    if handle is None:
        handle = os.getenv('BLUESKY_HANDLE')
    if app_password is None:
        app_password = os.getenv('BLUESKY_APP_PASSWORD')
    if not handle or not app_password:
        return {'ok': False, 'error': 'BlueSky credentials not configured'}

    parts = uri.split('/')
    if len(parts) < 5:
        return {'ok': False, 'error': 'Invalid AT URI format'}
    rkey = parts[-1]

    try:
        session = _create_session(handle, app_password)
    except Exception as e:
        return {'ok': False, 'error': f'BlueSky auth failed: {_safe_error(e)}'}

    try:
        r = requests.post(
            f'{BLUESKY_PDS}/xrpc/com.atproto.repo.deleteRecord',
            json={
                'repo': session['did'],
                'collection': 'app.bsky.feed.post',
                'rkey': rkey,
            },
            headers={'Authorization': f'Bearer {session["accessJwt"]}'},
            timeout=DEFAULT_TIMEOUT_SECONDS,
        )
        r.raise_for_status()
    except Exception as e:
        return {'ok': False, 'error': f'BlueSky delete failed: {_safe_error(e)}'}

    return {'ok': True}
