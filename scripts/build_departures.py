"""Generate a self-contained split-flap snapshot from Zürich Airport's public feed."""

import hashlib
import json
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from string import ascii_uppercase, digits
from urllib.request import urlopen
from xml.etree import ElementTree
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

BOARD = Path(__file__).resolve().parents[1] / "site" / "assets" / "splitflap-board.svg"
FEED = "https://flightdata.flughafen-zuerich.ch/flights"
ZURICH = ZoneInfo("Europe/Zurich")
MARKER = "  <!-- BEGIN GENERATED DEPARTURES -->"
COLUMNS = ((51, 7), (222, 13), (518, 3), (597, 5), (719, 5),
           (848, 1), (910, 1), (1008, 7), (1177, 3), (1260, 10))
EMPTY = [""] * len(COLUMNS)
STEP = 1 / (16 * 0.60)
OPENING = 2 * STEP
CYCLE = 6  # Long enough for the staggered destination drums to settle.
ATTENTION = {"BOARDING", "GO TO GATE", "GATE OPEN", "FINAL CALL", "LAST CALL"}


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def lettering(value):
    letters = unicodedata.normalize("NFKD", str(value or "").upper())
    return re.sub(r"[^ A-Z0-9*./:-]", "", letters)


def next_departures(feed, now):
    airports = {f.get("airportName"): f["PDS"] for f in feed
                if f.get("airportName") and re.fullmatch("[A-Z]{3}", f.get("PDS") or "")}
    upcoming = []
    for f in feed:
        if f.get("flightType") != "D" or not f.get("isCommercial") or f.get("ATD"):
            continue
        status = lettering(f.get("statusTextEn"))
        if status in {"DEPARTED", "CANCELLED", "CANCELED", "ROLLING", "AIRBORNE"}:
            continue
        scheduled, estimated = timestamp(f.get("STD")), timestamp(f.get("ETD"))
        due = estimated or scheduled
        grace = timedelta(minutes=20) if status in ATTENTION or status == "CLOSED" else timedelta()
        if not scheduled or not now - grace <= due < now + timedelta(days=1):
            continue
        carrier, number = lettering(f.get("FLC")), lettering(f.get("FLN"))
        if not carrier or not number:
            continue
        city = lettering(f.get("cityEn"))
        if len(city) > 13 or not city:
            city = lettering(f.get("PDS")) or city[:13]
        gate = lettering(f.get("GAT"))
        # The airport announces when a gate will be published before calling passengers.
        if status.startswith("GATE INFO AT "):
            remark = "INFO " + status[-5:]
            gate = ""
        else:
            remark = status or "SCHEDULED"
        values = [f"{carrier} {number:>4}", city, airports.get(f.get("viaAirportName"), ""),
                  scheduled.astimezone(ZURICH).strftime("%H:%M"),
                  estimated.astimezone(ZURICH).strftime("%H:%M") if estimated else "",
                  gate[:1] if gate[:1].isalpha() else "", lettering(f.get("CAM")), "",
                  gate, remark]
        upcoming.append((due, scheduled, carrier, number, values))
    rows, seen = [], set()
    for _, scheduled, carrier, number, values in sorted(upcoming):
        key = (scheduled, carrier, number)
        if key not in seen:
            rows.append([v[:width] for v, (_, width) in zip(values, COLUMNS)])
            seen.add(key)
        if len(rows) == 5:
            break
    if not rows:
        raise ValueError("No upcoming commercial departures in feed. Keeping last snapshot.")
    return rows + [EMPTY] * (5 - len(rows))


def ref(char):
    return "#g" + {" ": "_", ":": "c", "*": "star", "/": "slash", ".": "dot"}.get(char, char)


def discrete(attribute, events):
    """Hold each face until the next key, then leave the final face visible."""
    times = ";".join(f"{time / CYCLE:.6f}".rstrip("0").rstrip(".") for time, _ in events)
    values = ";".join(str(value) for _, value in events)
    return (f'<animate attributeName="{attribute}" calcMode="discrete" dur="{CYCLE}s" '
            f'keyTimes="{times}" values="{values}" fill="freeze"/>')


def print_track(name, events):
    return f'<use id="{name}" href="{events[-1][1]}">{discrete("href", events)}</use>'


def motor(tile_id, x, row, goal, stops, *, place_name):
    """A released card exposes the next top and turns into the next bottom."""
    if goal == " ":
        return ""
    alphabet = " " + ascii_uppercase + digits + "*-./:"
    opening = OPENING
    if place_name:
        # The Frankfurt close-up shows numerals, an asterisk and punctuation
        # passing through destination cells as their drums seek the next name.
        alphabet = " " + digits + "*:-./" + ascii_uppercase
        opening += ((x + 3 * row) % 9) * STEP
    elif goal in digits + ":":
        alphabet = " " + digits + (":" if goal == ":" else "")

    phase = ((x + 3 * row) % 7) * STEP / 12
    top = [(0, ref(" "))]
    bottom = [(0, ref(" "))]
    moving = [(0, 0)]
    count = alphabet.index(goal)
    start = opening + phase
    stop = start + STEP * count
    stops.append(stop)
    moving.extend(((start, 1), (stop, 0)))
    for step in range(count):
        exposed = ref(alphabet[step + 1])
        top.append((start + step * STEP, exposed))
        bottom.append((start + (step + 1) * STEP, exposed))
    for events in (top, bottom, moving):
        events.append((CYCLE, events[-1][1]))
    a, b = tile_id + "t", tile_id + "b"
    return f'''<g class="rest-face"><use href="{ref(goal)}"/></g>
<g class="animated-face">
  <defs>{print_track(a, top)}{print_track(b, bottom)}</defs>
  <g clip-path="url(#top-clip)"><use href="#{a}"/></g>
  <g clip-path="url(#bottom-clip)"><use href="#{b}"/></g>
  <g opacity="0">{discrete("opacity", moving)}
    <g transform="translate(0 30)"><g>
      <animateTransform attributeName="transform" type="scale" dur="{STEP}s" begin="{start:.6f}s" repeatCount="{count}"
        keyTimes="0;.20;.38;.55;.68;.8;1" values="1 1;1 .98;1 .77;1 0;1 -.65;1 -1;1 -1"/>
      <g transform="translate(0 -30)">
        <g clip-path="url(#top-clip)">
          <animate attributeName="opacity" calcMode="discrete" begin="{start:.6f}s" dur="{STEP}s" repeatCount="{count}" keyTimes="0;.55;1" values="1;0;0"/>
          <use href="#upper"/><use href="#{b}"/>
        </g>
        <g transform="translate(0 60) scale(1 -1)" clip-path="url(#bottom-clip)" opacity="0">
          <animate attributeName="opacity" calcMode="discrete" begin="{start:.6f}s" dur="{STEP}s" repeatCount="{count}" keyTimes="0;.55;1" values="0;1;1"/>
          <use href="#lower"/><use href="#{a}"/>
        </g>
      </g>
    </g></g>
  </g>
</g>'''


def build(rows, now):
    old_svg = BOARD.read_text()
    shell, marker, _ = old_svg.partition(MARKER)
    if not marker:
        raise ValueError("SVG artwork is missing its departures marker")
    saved = ElementTree.fromstring(old_svg).find("{*}metadata[@id='snapshot']")
    if saved is not None:
        state = json.loads(saved.text)
        last_change = timestamp(state["checked"])
        if rows == state["rows"] and now.astimezone(ZURICH).date() == last_change.astimezone(ZURICH).date():
            if state.get("drum_revision") == 3:
                return
            # Upgrade the existing SVG even when the airport data hasn't changed.
            now = last_change
    state = {"rows": rows, "checked": now.isoformat(), "drum_revision": 3}
    stamp = now.astimezone(ZURICH).strftime("%d %b %Y · %H:%M %Z").upper()
    parts = [shell.rstrip(), MARKER, f'<metadata id="snapshot">{escape(json.dumps(state))}</metadata>',
             f'<text x="755" y="57" text-anchor="middle" fill="#c9c7bb" '
             f'font-family="monospace" font-size="18">BOARD UPDATED · {stamp}</text>']
    for row, new in enumerate(rows):
        stops = []
        label = escape(" · ".join(filter(None, new)))
        parts.append(f'<g data-row="{row}" aria-label="{label}" fill="#f8f5e9" '
                     f'transform="translate(0 {143 + 43*row}) scale(1 .68)">')
        for field, (x, width) in enumerate(COLUMNS):
            for i, char in enumerate(new[field].ljust(width)):
                pos = x + 22*i
                face = motor(f"r{row}x{pos}", pos, row, char, stops, place_name=field in (1, 2))
                parts.append(f'<g transform="translate({pos} 0)"><use href="#tile"/>'
                             f'{face}<use href="#seam"/></g>')
        parts.append(f'</g><g transform="translate(27 {163.4 + 43*row:.1f})"><use href="#dark-pair"/>')
        if new[-1] in ATTENTION:
            parts.append('<use class="rest-face" href="#attention-pair"/>')
            parts.append('<g class="motion-lamps" opacity="0"><use href="#attention-pair"/>'
                         f'<set attributeName="opacity" to="1" begin="{max(stops):.6f}s" fill="freeze"/></g>')
        parts.append("</g>")
    parts.append("</svg>\n")
    BOARD.write_text("\n".join(parts))


if __name__ == "__main__":
    with urlopen(FEED, timeout=30) as response:
        flights = json.load(response)
    checked = datetime.now(timezone.utc)
    build(next_departures(flights, checked), checked)
    digest = hashlib.sha256(BOARD.read_bytes()).hexdigest()
    manifest = {"fetched": checked.isoformat(), "sha256": digest}
    (BOARD.parent.parent / "snapshot.json").write_text(json.dumps(manifest) + "\n")
