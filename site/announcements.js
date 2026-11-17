const gateStates = new Set(["GO TO GATE", "GATE OPEN", "BOARDING", "FINAL CALL", "LAST CALL"]);
const key = row => [row[0], row[1], row[3]].join("|");

function announcement(row, names, kind) {
  const info = names[key(row)] ?? {};
  const airline = info.airline ? info.airline + " " : "";
  const flight = row[0].trim().replace(/\s+/g, " ");
  const deFlight = `${airline}Flug ${flight} nach ${info.de || row[1]}`;
  const enFlight = `${airline}flight ${flight} to ${info.en || row[1]}`;
  const gate = row[8].replace(/^([A-Z]+)(\d+)/, "$1 $2");
  let de, en;
  switch (kind) {
    case "BOARDING":
      de = `Das Boarding für ${deFlight} beginnt. Bitte begeben Sie sich zu Gate ${gate}.`;
      en = `${enFlight} is now boarding at gate ${gate}.`;
      break;
    case "FINAL CALL":
    case "LAST CALL":
      de = `Letzter Aufruf für ${deFlight}. Bitte begeben Sie sich umgehend zu Gate ${gate}.`;
      en = `Final call for ${enFlight}. Please proceed immediately to gate ${gate}.`;
      break;
    case "GO TO GATE":
    case "GATE OPEN":
      de = `Fluggäste für ${deFlight} werden gebeten, sich zu Gate ${gate} zu begeben.`;
      en = `Passengers on ${enFlight}, please proceed to gate ${gate}.`;
      break;
    case "GATE CHANGE":
      de = `Gateänderung für ${deFlight}. Das neue Gate ist ${gate}.`;
      en = `Gate change for ${enFlight}. The new gate is ${gate}.`;
      break;
    case "SCHEDULED":
      de = `${deFlight}. Die planmässige Abflugzeit ist ${row[3]} Uhr.`;
      en = `${enFlight} is scheduled to depart at ${row[3]} local time.`;
      break;
    default:
      throw new Error("Unknown announcement type");
  }
  return [{lang: "de-CH", text: de}, {lang: "en-GB", text: en[0].toUpperCase() + en.slice(1)}];
}

export function openingCall(rows, names = {}) {
  const active = rows.find(row => row[8] && gateStates.has(row[9]));
  if (active) return announcement(active, names, active[9]);
  const next = rows.find(row => row[0]);
  return next ? announcement(next, names, "SCHEDULED") : null;
}

export function changedCalls(previous, current, names = {}) {
  const old = new Map(previous.map(row => [key(row), row]));
  const messages = [];
  for (const row of current.filter(row => row[0])) {
    const before = old.get(key(row));
    if (before && before[8] === row[8] && before[9] === row[9]) continue;
    if (!row[8]) continue;
    if (gateStates.has(row[9])) messages.push(announcement(row, names, row[9]));
    else if (before?.[8] && before[8] !== row[8] && row[9] !== "CLOSED") {
      messages.push(announcement(row, names, "GATE CHANGE"));
    }
  }
  return messages;
}

// Each note has a short attack and a longer, quieter overtone like a struck bell.
function chime(context, output) {
  const lastNotes = [];
  const onset = context.currentTime + .02;
  for (const [index, pitch] of [783.99, 659.25, 523.25].entries()) {
    for (const [ratio, level] of [[1, .16], [2.01, .035]]) {
      const start = onset + index * .40;
      const bell = context.createOscillator();
      const envelope = context.createGain();
      bell.frequency.value = pitch * ratio;
      envelope.gain.setValueAtTime(.0001, start);
      envelope.gain.exponentialRampToValueAtTime(level, start + .015);
      envelope.gain.exponentialRampToValueAtTime(.0001, start + (index === 2 ? 1.05 : .72));
      bell.connect(envelope).connect(output);
      lastNotes.push(new Promise(resolve => { bell.onended = resolve; }));
      bell.start(start);
      bell.stop(start + (index === 2 ? 1.1 : .76));
    }
  }
  return Promise.all(lastNotes);
}

export class PublicAddress {
  constructor(report) {
    this.report = report;
    this.generation = 0;
    this.enabled = false;
    this.pending = [];
  }

  async enable() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error("This browser does not support the airport chime.");
    this.context ??= new Audio();
    await this.context.resume();
    this.output = this.context.createGain();
    this.output.connect(this.context.destination);
    this.enabled = true;
  }

  mute() {
    this.enabled = false;
    this.generation++;
    this.pending = [];
    this.output?.disconnect();
    window.speechSynthesis?.cancel();
    this.finishSpeech?.();
    this.busy = false;
  }

  say(messages) {
    if (!this.enabled) return;
    this.pending.push(...messages.filter(Boolean));
    if (!this.busy) void this.play(this.generation);
  }

  async play(generation) {
    this.busy = true;
    while (this.pending.length && this.enabled && generation === this.generation) {
      const lines = this.pending.shift();
      const transcript = lines.map(line => line.text).join(" / ");
      this.report(transcript);
      await chime(this.context, this.output);
      for (const line of lines) {
        await new Promise(resolve => setTimeout(resolve, 350));
        if (!this.enabled || generation !== this.generation) return;
        if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
          this.report(transcript + " · Speech unavailable on this device.");
          break;
        }
        this.report(line.text);
        const spoken = await this.speak(line);
        if (!this.enabled || generation !== this.generation) return;
        if (!spoken) this.report(transcript + " · Speech unavailable for " + line.lang + ".");
      }
    }
    if (generation === this.generation) this.busy = false;
  }

  speak({lang, text}) {
    // Keep the callsign compact on screen, but pronounce each letter and digit.
    const spoken = text.replace(/\b([A-Z0-9]{2}) (\d{1,4}[A-Z]?)\b/g,
      (_, carrier, number) => [...carrier, ...number].join(" "));
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = lang;
    utterance.rate = .90;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang.toLowerCase() === lang.toLowerCase())
      ?? voices.find(v => v.lang.toLowerCase().startsWith(lang.slice(0, 2) + "-"));
    if (preferred) utterance.voice = preferred;
    return new Promise(resolve => {
      const finish = success => {
        clearTimeout(timer);
        utterance.onend = utterance.onerror = null;
        this.finishSpeech = null;
        resolve(success);
      };
      const timer = setTimeout(() => { finish(false); window.speechSynthesis.cancel(); }, 30000);
      this.finishSpeech = () => finish(false);
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      window.speechSynthesis.speak(utterance);
    });
  }
}
