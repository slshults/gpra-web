#!/usr/bin/env python3
"""
fail2ban Status Cron Job

Reads the gpra-probe jail's counters from `fail2ban-client status` and sends
one `fail2ban_status_checked` event to PostHog with the totals and when
fail2ban last started, for the monthly ban report. (The per-ban
`fail2ban_ban` events come from the fail2ban action on the server, not from
this repo; they have no "currently banned" number or start time.)

Total banned counts since fail2ban last started, so read it next to
started_at: a restart sets it back to 0.

The jail's banned IP list is in the same output and is deliberately left out
of the event.

fail2ban-client needs root to reach fail2ban's socket. Run this from the same
crontab as the other cron scripts, not root's: importing app opens
logs/gpr.log, and a rotation done as root would leave the app a log it can't
write. Instead allow just this one command in sudoers:
    <app user> ALL=(root) NOPASSWD: /usr/bin/fail2ban-client status gpra-probe

Example crontab entry (runs daily at 12:05 UTC):
5 12 * * * /path/to/venv/bin/python3 /path/to/gprweb/cron/check_fail2ban_status.py >> /path/to/gprweb/logs/fail2ban_status.log 2>&1
"""

import logging
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / '.env')

from app.utils.posthog_client import track_event, shutdown as posthog_shutdown

JAIL = 'gpra-probe'
FAIL2BAN_CLIENT = '/usr/bin/fail2ban-client'
EVENT_NAME = 'fail2ban_status_checked'
DISTINCT_ID = 'fail2ban-monitor-bot'
COMMAND_TIMEOUT_SECONDS = 30

log_dir = Path(__file__).parent.parent / 'logs'
log_dir.mkdir(exist_ok=True)

# Own named logger with a FileHandler only, matching the other cron scripts:
# something in the `import app` chain configures the root logger first, so
# basicConfig would be a no-op.
logger = logging.getLogger('fail2ban_status_cron')
logger.setLevel(logging.INFO)
logger.propagate = False
_file_handler = logging.FileHandler(log_dir / 'fail2ban_status.log')
_file_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
logger.addHandler(_file_handler)


def _jail_counts() -> dict:
    """Return the jail's total and current ban counts. Raises if fail2ban can't be read."""
    cmd = [FAIL2BAN_CLIENT, 'status', JAIL]
    if os.geteuid() != 0:
        cmd = ['sudo', '-n'] + cmd  # -n: fail at once rather than wait for a password
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=COMMAND_TIMEOUT_SECONDS, check=True).stdout
    counts = {}
    for key, label in (('total_banned', 'Total banned'), ('currently_banned', 'Currently banned')):
        match = re.search(rf'{label}:\s*(\d+)', out)
        if not match:
            raise ValueError(f"no '{label}' line in fail2ban-client output")
        counts[key] = int(match.group(1))
    return counts


def _started_at() -> str:
    """When the fail2ban service last started, as UTC ISO 8601. Raises if systemd can't say."""
    # --timestamp=unix sidesteps parsing a local time with a zone abbreviation.
    out = subprocess.run(
        ['systemctl', 'show', 'fail2ban', '--property=ActiveEnterTimestamp', '--value', '--timestamp=unix'],
        capture_output=True, text=True, timeout=COMMAND_TIMEOUT_SECONDS, check=True,
    ).stdout.strip()
    if not out.startswith('@'):
        raise ValueError(f'unexpected ActiveEnterTimestamp {out!r} (is fail2ban running?)')
    return datetime.fromtimestamp(int(out[1:]), tz=timezone.utc).isoformat()


def _describe(e: Exception) -> str:
    """One line for the log and the event's `error`, with the command's stderr when it failed."""
    text = f"{type(e).__name__}: {e}"
    stderr = getattr(e, 'stderr', None)
    if isinstance(e, subprocess.CalledProcessError) and stderr:
        text += f" ({stderr.strip()[:200]})"
    return text


def check_fail2ban() -> bool:
    """Read the jail and send one event. Returns True if everything was read."""
    properties = {'jail': JAIL}
    errors = []
    try:
        properties.update(_jail_counts())
    except Exception as e:
        # Command failures are routine (fail2ban down, sudo not set up). Anything
        # else is more likely a bug in this script, so log its traceback.
        errors.append(_describe(e))
        logger.error(f"{JAIL}: could not read jail status: {errors[-1]}",
                     exc_info=not isinstance(e, (OSError, subprocess.SubprocessError)))
    try:
        properties['started_at'] = _started_at()
    except Exception as e:
        errors.append(_describe(e))
        logger.error(f"could not read fail2ban start time: {errors[-1]}",
                     exc_info=not isinstance(e, (OSError, subprocess.SubprocessError)))
    if errors:
        properties['error'] = '; '.join(errors)
    else:
        logger.info(f"{JAIL}: {properties['total_banned']} total banned, "
                    f"{properties['currently_banned']} currently banned, fail2ban started {properties['started_at']}")
    track_event(user_id=None, event_name=EVENT_NAME, properties=properties, distinct_id=DISTINCT_ID)
    return not errors


if __name__ == '__main__':
    ok = check_fail2ban()
    posthog_shutdown()
    # Cron mails on output, not exit status; the event's `error` is the signal.
    sys.exit(0 if ok else 1)
