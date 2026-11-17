import { changedCalls, openingCall, PublicAddress } from "./announcements.js";

const display = document.querySelector("#board");
const audioButton = document.querySelector("#audio");
const status = document.querySelector("#freshness");
const report = text => { document.querySelector("#message").textContent = text; };
const pa = new PublicAddress(report);
const localClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", timeStyle: "medium" });
const localStamp = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", dateStyle: "medium", timeStyle: "short" });
const maxAge = 25 * 60 * 1000;
let rows = [], names = {}, digest, checked = 0, imageUrl, refreshing = false;
const fresh = time => time > 0 && Date.now() - time < maxAge;

function tick() { document.querySelector("#clock").textContent = localClock.format(new Date()); }
tick();
setInterval(tick, 1000);

audioButton.addEventListener("click", async () => {
  if (pa.enabled) {
    pa.mute();
    audioButton.textContent = "Enable announcements";
    audioButton.setAttribute("aria-pressed", "false");
    report("Announcements muted.");
    return;
  }
  audioButton.disabled = true;
  try {
    await pa.enable();
    audioButton.textContent = "Mute announcements";
    audioButton.setAttribute("aria-pressed", "true");
    report("Sound enabled. Waiting for a recent departure update.");
    if (fresh(checked)) pa.say([openingCall(rows, names)]);
  } catch (error) { report(error.message); }
  finally { audioButton.disabled = false; }
});

async function readBoard(hash) {
  const response = await fetch(`./assets/splitflap-board.svg?v=${hash}`, { cache: "no-cache" });
  if (!response.ok) throw new Error("Board unavailable");
  const bytes = await response.arrayBuffer();
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), x => x.toString(16).padStart(2, "0")).join("");
  if (hash !== actual) throw new Error("New deployment in progress");
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "image/svg+xml");
  const data = JSON.parse(doc.querySelector("metadata#snapshot").textContent);
  if (!Array.isArray(data.rows) || data.rows.length !== 5 ||
      !data.rows.every(row => Array.isArray(row) && row.length === 10 && row.every(cell => typeof cell === "string"))) {
    throw new Error("Invalid flight list");
  }
  if (JSON.stringify(rows) !== JSON.stringify(data.rows)) {
    const img = new Image();
    img.alt = "Zürich departures. " + data.rows.filter(r => r[0]).map(r => r.filter(Boolean).join(", ")).join(". ");
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/svg+xml" }));
    img.src = url;
    try { await img.decode(); } catch (error) { URL.revokeObjectURL(url); throw error; }
    display.replaceChildren(img);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = url;
  }
  return data.rows;
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const response = await fetch("./snapshot.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Update unavailable");
    const snapshot = await response.json();
    const time = Date.parse(snapshot.fetched);
    if (!Number.isFinite(time) || !/^[0-9a-f]{64}$/.test(snapshot.sha256)) throw new Error("Invalid snapshot");
    if (time < checked) return;
    const previous = rows;
    const current = digest === snapshot.sha256 ? rows : await readBoard(snapshot.sha256);
    names = snapshot.announcements ?? {};
    if (pa.enabled && fresh(time) && !document.hidden) {
      if (!fresh(checked)) pa.say([openingCall(current, names)]);
      else pa.say(changedCalls(previous, current, names));
    }
    digest = snapshot.sha256;
    rows = current;
    checked = time;
    status.textContent = (fresh(time) ? "Airport checked " : "Last available update · ") + localStamp.format(time) + " Zürich";
  } catch {
    if (!display.firstElementChild) {
      const fallback = new Image();
      fallback.src = "./assets/splitflap-board.svg";
      fallback.alt = "Last published Zürich departure board";
      display.append(fallback);
    }
    status.textContent = checked ? "Update unavailable · last checked " + localStamp.format(checked) : "Update unavailable · showing the last published board";
  } finally {
    refreshing = false;
    display.setAttribute("aria-busy", "false");
  }
}

refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
