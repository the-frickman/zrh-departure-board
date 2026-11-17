# Zürich departure board

Five upcoming commercial departures from Zürich Airport on a Frankfurt-inspired split-flap board. The green lamps alternate during gate calls. Times are local to Zürich.

[Open the departure board](https://the-frickman.github.io/zrh-departure-board/)

## Gate announcements

Press **Play** to hear a three-note chime, then the current gate call in German and English. When no gate is calling, the first announcement gives the next scheduled departure. Subsequent boarding calls, final calls and gate changes follow the Zürich feed while the tab is visible. Each call appears on screen and uses the airline name, flight number and localised destination when available. Speech uses the German and English voices available on your device.

**Pause** holds the current call. **Resume** continues it, and **Stop** clears the queue. Use **Chime** to choose the classic three-note sound or the two-note airport recording for the next call.

Open **Special announcements**, choose a flight and generate a boarding, assisted boarding, final call, gate change, delay or departure-time announcement. You can edit the gate and both language versions, or type an entirely custom message. Leave a language blank to skip it. **Play special announcement** plays the call in your tab after any already in progress.

## Sound credits

- **Classic three-note** uses the four-second ascending chime by mpaol2023, released under CC0. [3-tone chime UP](https://freesound.org/people/mpaol2023/sounds/370180/) · [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- **Airport recording** uses Benboncan’s mono recording of the two tones preceding an airport announcement. This site distributes the Freesound MP3 preview unchanged under CC BY 4.0. [Airport Bingbong.wav](https://freesound.org/people/Benboncan/sounds/93646/) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

For comparison, GROVES publishes the Munich terminal gong it designed. Munich Terminal 1 uses Sittig’s PAXGuide with PAXgate for automated gate announcements in 18 languages. [Hear the Munich gong](https://groves.de/wp-content/uploads/2022/02/AM_gong.mp3) · [GROVES project](https://groves.de/airport-munich/) · [Sittig case study](https://www.sittig-tech.com/de/caste-study-munich-airport)

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
