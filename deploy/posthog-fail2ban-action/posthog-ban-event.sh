#!/bin/sh
# Send one `fail2ban_ban` event to GPRA's PostHog project for a fail2ban ban.
#
# Called by the posthog-ban-event fail2ban action (posthog-ban-event.conf,
# next to this file) as:
#   posthog-ban-event.sh <env file> <jail> <bantime> <bancount> <failures>
#
# The action never passes the banned address, so this script can't send it.
# The event goes under one bot distinct_id with no person profile and no
# GeoIP lookup (PostHog would otherwise geolocate this server's own IP).
#
# A ban must never wait on PostHog: the request runs in the background with
# short timeouts, and this script always exits 0 straight away. Problems
# (no key, bad env file) go to syslog under the tag posthog-ban-event.
#
# The PostHog key is read from the app's env file (POSTHOG_API_KEY, the same
# public project key the app uses). Nothing secret lives in this repo.

POSTHOG_HOST='https://tacet.guitarpracticeroutine.com'  # same managed proxy as app/utils/posthog_client.py
EVENT_NAME='fail2ban_ban'
DISTINCT_ID='fail2ban-monitor-bot'

envfile=$1
jail=$2
bantime=$3
bancount=$4
failures=$5

note() {
    logger -t posthog-ban-event -- "$1" 2>/dev/null || true
}

# A whole number (fail2ban uses -1 for a permanent ban), or JSON null. An
# untranslated tag such as "<bancount>" on an older fail2ban also becomes null.
int_or_null() {
    if printf '%s' "$1" | grep -Eq '^-?[0-9]+$'; then
        printf '%s' "$1"
    else
        printf 'null'
    fi
}

if [ ! -r "$envfile" ]; then
    note "can't read env file $envfile; no event sent"
    exit 0
fi

# Read the one line we need instead of sourcing the file, which would run it.
key=$(sed -n 's/^[[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}POSTHOG_API_KEY[[:space:]]*=[[:space:]]*//p' "$envfile" \
    | tail -n 1 | tr -d '\r' | sed "s/^[\"']//; s/[\"'][[:space:]]*\$//")
# Project keys are plain tokens; anything else could break the JSON below.
if ! printf '%s' "$key" | grep -Eq '^[A-Za-z0-9_-]+$'; then
    note "no usable POSTHOG_API_KEY in $envfile; no event sent"
    exit 0
fi

printf '%s' "$jail" | grep -Eq '^[A-Za-z0-9._-]+$' || jail='unknown'

# shellcheck disable=SC2016  # the $-names are PostHog's property names, not shell variables
payload=$(printf '{"api_key":"%s","event":"%s","distinct_id":"%s","timestamp":"%s","properties":{"jail":"%s","bantime_seconds":%s,"ban_count":%s,"failures":%s,"$process_person_profile":false,"$geoip_disable":true,"$lib":"gpra-fail2ban"}}' \
    "$key" "$EVENT_NAME" "$DISTINCT_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$jail" \
    "$(int_or_null "$bantime")" "$(int_or_null "$bancount")" "$(int_or_null "$failures")")

# The payload goes in on stdin so the key never shows in `ps`. Output goes
# to /dev/null so fail2ban isn't left waiting on an open pipe.
printf '%s' "$payload" | curl --silent --fail --connect-timeout 3 --max-time 5 \
    -H 'Content-Type: application/json' --data-binary @- \
    "$POSTHOG_HOST/i/v0/e/" >/dev/null 2>&1 &

exit 0
