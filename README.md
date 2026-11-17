# Zürich departure board

Five upcoming commercial departures from Zürich Airport on a Frankfurt-inspired split-flap board. The green lamps alternate during gate calls. Times are local to Zürich.

[Open the departure board](https://the-frickman.github.io/zrh-departure-board/)

Select **Enable announcements** to hear an original descending three-note chime followed by a German announcement, a pause, and its English counterpart. The first call reads a current gate call or the next scheduled departure. Keep the tab open to hear subsequent boarding calls, final calls and gate changes. Announcements use airline names and localised destinations supplied by Zürich Airport. Each announcement also appears as text. **Mute announcements** stops playback. Spoken audio uses the voices available in the browser or operating system.

## How the site updates

[GitHub Actions](.github/workflows/pages.yml) reads [Zürich Airport’s departures feed](https://flightdata.flughafen-zuerich.ch/flights) on a five-minute schedule. It builds and deploys the site directly to GitHub Pages. An open tab checks for a new deployment every minute. Identical flight rows keep their current animation state. The site keeps its last published board when the feed is unavailable. A snapshot older than 25 minutes is excluded from announcements.

The original SVG and Python renderer come from [Manuel’s profile](https://github.com/the-frickman/the-frickman). This copy updates independently. For travel decisions, check the [official airport timetable](https://www.flughafen-zuerich.ch/en/passengers/fly/flightinformation/departures).

## Run locally

From the repository root:

```sh
python3 scripts/build_departures.py
python3 -m http.server 8000 --directory site
```

Open `http://localhost:8000`. Run the checks with `python3 -m unittest discover -s tests` and `npm test`. To publish a fork, select **GitHub Actions** in **Settings → Pages** and run the Zürich departure board workflow.
