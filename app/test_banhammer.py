"""Unit tests for banhammer's PostHog events.

Uses an in-memory stand-in for Redis and a mock PostHog client, so nothing
leaves the machine.

Run:
  python3 -m unittest app.test_banhammer
"""
import os
import unittest
from unittest import mock

import requests

import app.utils.posthog_client as posthog_client_module
from app import app as flask_app
from app import banhammer

CLIENT_IP = '203.0.113.7'  # TEST-NET-3, never routed
# requests.get is mocked wherever the key is set, so it never reaches AbuseIPDB.
WITH_ABUSEIPDB_KEY = {'ABUSEIPDB_API_KEY': 'not-a-real-key'}  # pragma: allowlist secret
WITHOUT_ABUSEIPDB_KEY = {'ABUSEIPDB_API_KEY': ''}


class FakeRedis:
    """Just enough of redis.Redis for banhammer: set/incr/expire/exists and pipelines."""

    def __init__(self, incr_floor=0):
        self.store = {}
        self.incr_floor = incr_floor  # lets a test start the AbuseIPDB budget counter high

    def set(self, key, value, ex=None, nx=False):
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True

    def incr(self, key):
        self.store[key] = max(int(self.store.get(key, 0)), self.incr_floor) + 1
        return self.store[key]

    def expire(self, key, seconds):
        return key in self.store

    def exists(self, key):
        return int(key in self.store)

    def delete(self, key):
        self.store.pop(key, None)

    def pipeline(self):
        return FakePipeline(self)


class FakePipeline:
    def __init__(self, redis_client):
        self.redis_client = redis_client
        self.ops = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __getattr__(self, name):
        def queue(*args, **kwargs):
            self.ops.append((name, args, kwargs))
            return self
        return queue

    def execute(self):
        return [getattr(self.redis_client, name)(*args, **kwargs) for name, args, kwargs in self.ops]


class BanhammerEventTests(unittest.TestCase):
    def setUp(self):
        self.posthog = mock.Mock()
        patcher = mock.patch.object(posthog_client_module, 'posthog_client', self.posthog)
        patcher.start()
        self.addCleanup(patcher.stop)
        # The page itself isn't under test, and rendering it would pull in the whole template context.
        patcher = mock.patch.object(banhammer, 'render_template', return_value='page')
        patcher.start()
        self.addCleanup(patcher.stop)
        # Keep test bans out of the real audit log.
        patcher = mock.patch.object(banhammer.ban_log, 'info')
        patcher.start()
        self.addCleanup(patcher.stop)

    def _deny(self, redis_client, times, path='/admin/users/'):
        with flask_app.test_request_context(path, environ_base={'REMOTE_ADDR': CLIENT_IP}):
            for _ in range(times):
                result = banhammer.record_admin_denial(redis_client)
        return result

    def _events(self):
        return [c.kwargs for c in self.posthog.capture.call_args_list]

    def assertNoClientIp(self, event):
        self.assertNotIn(CLIENT_IP, repr(event['properties']))
        self.assertNotIn('bucket', event['properties'])
        self.assertEqual(event['distinct_id'], banhammer.EVENT_DISTINCT_ID)

    @mock.patch.dict(os.environ, WITHOUT_ABUSEIPDB_KEY)
    def test_ban_sends_ip_banned_without_the_ip(self):
        redis_client = FakeRedis()
        self.assertEqual(self._deny(redis_client, banhammer.BAN_AT)[1], 403)
        events = self._events()
        self.assertEqual([e['event'] for e in events], ['ip_banned'])
        self.assertEqual(events[0]['properties'], {
            'days': 30,
            'tier': 'default (no AbuseIPDB key)',
            'attempts': banhammer.BAN_AT,
            'path': '/admin/users/',
        })
        self.assertNoClientIp(events[0])

    @mock.patch.dict(os.environ, WITHOUT_ABUSEIPDB_KEY)
    def test_no_event_before_the_ban(self):
        self._deny(FakeRedis(), banhammer.BAN_AT - 1)
        self.posthog.capture.assert_not_called()

    @mock.patch.dict(os.environ, WITHOUT_ABUSEIPDB_KEY)
    def test_posthog_failure_does_not_stop_the_ban(self):
        self.posthog.capture.side_effect = RuntimeError('PostHog is down')
        redis_client = FakeRedis()
        self.assertEqual(self._deny(redis_client, banhammer.BAN_AT)[1], 403)
        self.assertTrue(redis_client.exists(f'banhammer:banned:{CLIENT_IP}'))

    @mock.patch.dict(os.environ, WITH_ABUSEIPDB_KEY)
    def test_budget_used_up_sends_event(self):
        redis_client = FakeRedis(incr_floor=banhammer.LOOKUPS_PER_HOUR)
        with flask_app.app_context(), mock.patch.object(banhammer.requests, 'get') as get:
            self.assertEqual(banhammer._ban_seconds(CLIENT_IP, redis_client)[0], banhammer.BAN_SECONDS)
            get.assert_not_called()
        (event,) = self._events()
        self.assertEqual(event['event'], 'abuseipdb_lookup_budget_exhausted')
        self.assertEqual(event['properties'], {
            'lookups_requested_this_hour': banhammer.LOOKUPS_PER_HOUR + 1,
            'hourly_limit': banhammer.LOOKUPS_PER_HOUR,
        })
        self.assertNoClientIp(event)

    @mock.patch.dict(os.environ, WITH_ABUSEIPDB_KEY)
    def test_lookup_failure_sends_event_with_status(self):
        response = requests.Response()
        response.status_code = 429
        error = requests.HTTPError('429 Too Many Requests', response=response)
        with flask_app.app_context(), mock.patch.object(banhammer.requests, 'get', side_effect=error):
            self.assertEqual(banhammer._ban_seconds(CLIENT_IP, FakeRedis())[0], banhammer.BAN_SECONDS)
        (event,) = self._events()
        self.assertEqual(event['event'], 'abuseipdb_lookup_failed')
        self.assertEqual(event['properties'], {'error_type': 'HTTPError', 'status_code': 429})
        self.assertNoClientIp(event)

    @mock.patch.dict(os.environ, WITH_ABUSEIPDB_KEY)
    def test_lookup_timeout_sends_event_without_status(self):
        with flask_app.app_context(), mock.patch.object(banhammer.requests, 'get', side_effect=requests.Timeout()):
            banhammer._ban_seconds(CLIENT_IP, FakeRedis())
        (event,) = self._events()
        self.assertEqual(event['properties'], {'error_type': 'Timeout'})


if __name__ == '__main__':
    unittest.main()
