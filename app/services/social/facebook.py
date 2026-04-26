"""Facebook Graph API adapter — posts to a Page's feed.

Credentials come from env (FACEBOOK_PAGE_ID, FACEBOOK_PAGE_ACCESS_TOKEN). The
access token must be a **Page** access token (not a user token), and must have
both `pages_manage_posts` and `pages_read_engagement` permissions — the API
errors on missing read permission despite docs implying only the post one is
needed. A long-lived Page token derived from a long-lived User token typically
shows `Expires: Never` in the token debugger.

The token is sent in the request body, so error sanitization is critical —
this module scrubs `access_token=...` fragments from any error string before
returning.
"""
import os
import re
from typing import Any, Dict, Optional

import requests


GRAPH_API_VERSION = 'v21.0'
DEFAULT_TIMEOUT_SECONDS = 30


def _safe_error(e: Exception) -> str:
    """Strip Facebook tokens from error messages so we never log them.

    Two passes:
      1. `access_token=<value>` query/body fragments — the most common leak path.
      2. Bare `EAA...`-prefixed tokens — defense in depth for any future code
         path that stringifies a request body, response, or exception chain.
    """
    msg = str(e)
    msg = re.sub(r'access_token=[^&\s\'"]+', 'access_token=[REDACTED]', msg, flags=re.IGNORECASE)
    msg = re.sub(r'EAA[A-Za-z0-9_\-]{50,}', '[REDACTED]', msg)
    if len(msg) > 200:
        msg = msg[:200] + '...'
    return msg


def _extract_api_error(response: requests.Response) -> str:
    """Pull a sanitized error message from a Graph API response."""
    try:
        body = response.json()
        err = body.get('error', {})
        return f"{err.get('type', 'Error')}: {err.get('message', 'unknown')}"
    except Exception:
        return f'http {response.status_code}'


def post(
    message: str,
    link: Optional[str] = None,
    page_id: Optional[str] = None,
    page_access_token: Optional[str] = None,
) -> Dict[str, Any]:
    """Post a message (with optional link) to a Facebook Page feed.

    Returns:
        {'ok': True, 'post_id': '<page_id>_<post_id>'} on success
        {'ok': False, 'error': '<safe message>'} on failure (token redacted)
    """
    if page_id is None:
        page_id = os.getenv('FACEBOOK_PAGE_ID')
    if page_access_token is None:
        page_access_token = os.getenv('FACEBOOK_PAGE_ACCESS_TOKEN')
    if not page_id or not page_access_token:
        return {'ok': False, 'error': 'Facebook credentials not configured (FACEBOOK_PAGE_ID, FACEBOOK_PAGE_ACCESS_TOKEN)'}

    url = f'https://graph.facebook.com/{GRAPH_API_VERSION}/{page_id}/feed'
    payload = {'message': message, 'access_token': page_access_token}
    if link:
        payload['link'] = link

    try:
        r = requests.post(url, data=payload, timeout=DEFAULT_TIMEOUT_SECONDS)
    except Exception as e:
        return {'ok': False, 'error': f'Facebook post failed: {_safe_error(e)}'}

    if r.status_code != 200:
        return {'ok': False, 'error': f'Facebook post failed: {_extract_api_error(r)}'}

    try:
        result = r.json()
    except Exception:
        return {'ok': False, 'error': 'Facebook post returned invalid JSON'}

    return {'ok': True, 'post_id': result.get('id')}


def delete_post(post_id: str, page_access_token: Optional[str] = None) -> Dict[str, Any]:
    """Delete a Page post by id. Used for live-test cleanup."""
    if page_access_token is None:
        page_access_token = os.getenv('FACEBOOK_PAGE_ACCESS_TOKEN')
    if not page_access_token:
        return {'ok': False, 'error': 'Facebook credentials not configured'}

    url = f'https://graph.facebook.com/{GRAPH_API_VERSION}/{post_id}'
    try:
        r = requests.delete(url, params={'access_token': page_access_token}, timeout=DEFAULT_TIMEOUT_SECONDS)
    except Exception as e:
        return {'ok': False, 'error': f'Facebook delete failed: {_safe_error(e)}'}

    if r.status_code != 200:
        return {'ok': False, 'error': f'Facebook delete failed: {_extract_api_error(r)}'}

    return {'ok': True}
