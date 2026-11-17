import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from xml.etree import ElementTree

from scripts import build_departures as board


class DeparturesAnimationTest(unittest.TestCase):
    def test_opening_and_settled_board_match_the_same_snapshot(self):
        fields = ["LX  092", "BUENOS AIRES", "GRU", "22:35", "22:45", "E", "1",
                  "121-126", "E23", "BOARDING"]
        previous = [fields, *[board.EMPTY] * 4]
        current = [[*fields[:-1], "CLOSED"], *previous[1:]]
        checked = datetime(2026, 11, 17, 21, 30, tzinfo=timezone.utc)
        # This is the metadata written by the original, delta-only renderer.
        saved = {"rows": current, "before": previous, "checked": checked.isoformat()}
        shell = board.BOARD.read_text().partition(board.MARKER)[0]
        with TemporaryDirectory() as directory:
            path = Path(directory) / "board.svg"
            path.write_text(shell + board.MARKER + '<metadata id="snapshot">'
                            + json.dumps(saved) + '</metadata></svg>')
            with patch.object(board, "BOARD", path):
                board.build(current, checked + timedelta(minutes=5))
                rendered = path.read_bytes()
                board.build(current, checked + timedelta(minutes=10))
                self.assertEqual(path.read_bytes(), rendered)

        root = ElementTree.fromstring(rendered)
        self.assertEqual(json.loads(root.find("{*}metadata").text)["checked"], saved["checked"])
        for motor in root.findall(".//{*}animateTransform"):
            self.assertGreater(int(motor.get("repeatCount")), 0)
        for node in root.iter():
            if node.get("repeatCount") == "indefinite":
                self.assertEqual(node.get("attributeName"), "opacity")
                self.assertEqual(node.get("dur"), "2s")
        cells = iter(root.find("{*}g[@data-row='0']"))
        for field, (new, (_, width)) in enumerate(zip(current[0], board.COLUMNS)):
            for final in new.ljust(width):
                cell = next(cells)
                tracks = cell.findall(".//{*}defs/{*}use/{*}animate")
                if final == " ":
                    self.assertFalse(tracks)
                    continue
                settled = cell.find("{*}g[@class='rest-face']/{*}use")
                self.assertEqual(settled.get("href"), board.ref(final))
                self.assertEqual(len(tracks), 2)
                for track in tracks:
                    times = [float(t) * board.CYCLE for t in track.get("keyTimes").split(";")]
                    faces = track.get("values").split(";")
                    self.assertEqual(faces[0], board.ref(" "))
                    self.assertEqual(faces[-2], board.ref(final))
                    self.assertEqual(faces.count(board.ref(final)), 2)
                    self.assertLess(times[-2], board.CYCLE)
                    self.assertEqual(faces[-1], board.ref(final))
                    if field in (1, 2) and final.isalpha():
                        for symbol in "9*:-./":
                            self.assertIn(board.ref(symbol), faces[:faces.index(board.ref(final))])
                    elif field in (3, 4):
                        self.assertNotIn(board.ref("*"), faces)
