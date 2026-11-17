const gateStates = new Set(["GO TO GATE", "GATE OPEN", "BOARDING", "FINAL CALL", "LAST CALL"]);
export const flightKey = row => [row[0], row[1], row[3]].join("|");

export function announcement(row, names, kind) {
  const info = names[flightKey(row)] ?? {};
  const airline = info.airline ? info.airline + " " : "";
  const flight = row[0].trim().replace(/\s+/g, " ");
  const deFlight = `${airline}Flug ${flight} nach ${info.de || row[1]}`;
  const enFlight = `${airline}flight ${flight} to ${info.en || row[1]}`;
  const gate = row[8].replace(/^([A-Z]+)(\d+)/, "$1 $2");
  let de, en;
  switch (kind) {
    case "PREBOARDING":
      de = `Fluggäste für ${deFlight}, die beim Einsteigen Unterstützung benötigen, werden jetzt zu Gate ${gate} gebeten.`;
      en = `Passengers on ${enFlight} who require assistance with boarding are now invited to gate ${gate}.`;
      break;
    case "DELAYED":
      de = `Der Abflug von ${deFlight} verzögert sich. Bitte beachten Sie die Anzeigen für weitere Informationen.`;
      en = `${enFlight} has been delayed. Please check the departure screens for updates.`;
      break;
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
  const old = new Map(previous.map(row => [flightKey(row), row]));
  const messages = [];
  for (const row of current.filter(row => row[0])) {
    const before = old.get(flightKey(row));
    if (before && before[8] === row[8] && before[9] === row[9]) continue;
    if (!row[8]) continue;
    if (gateStates.has(row[9])) messages.push(announcement(row, names, row[9]));
    else if (before?.[8] && before[8] !== row[8] && row[9] !== "CLOSED") {
      messages.push(announcement(row, names, "GATE CHANGE"));
    }
  }
  return messages;
}

export class PublicAddress {
  constructor(report) {
    this.report = report;
    this.generation = 0;
    this.enabled = false;
    this.paused = false;
    this.pending = [];
    this.chimeFile = "three-tone-chime.mp3";
    this.buffers = new Map();
  }

  async enable() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error("Audio playback is unavailable in this browser.");
    this.context ??= new Audio();
    await this.context.resume();
    this.enabled = true;
    if (this.paused) {
      this.paused = false;
      window.speechSynthesis?.resume();
      this.wake?.();
    }
  }

  async pause() {
    if (!this.enabled || this.paused) return;
    this.paused = true;
    window.speechSynthesis?.pause();
    await this.context.suspend();
  }

  async ready(generation) {
    while (this.paused && generation === this.generation) {
      await new Promise(resolve => { this.wake = resolve; });
      this.wake = null;
    }
    return this.enabled && generation === this.generation;
  }

  mute() {
    this.enabled = this.paused = false;
    this.generation++;
    this.pending = [];
    this.wake?.();
    this.source?.stop();
    this.finishSpeech?.();
    window.speechSynthesis?.cancel();
    window.speechSynthesis?.resume();
    this.busy = false;
  }

  async chime(generation) {
    const file = this.chimeFile;
    if (!this.buffers.has(file)) {
      const response = await fetch(new URL("./assets/audio/" + file, import.meta.url));
      if (!response.ok) throw new Error("Could not load the announcement chime.");
      this.buffers.set(file, await this.context.decodeAudioData(await response.arrayBuffer()));
    }
    if (!await this.ready(generation)) return;
    const source = this.context.createBufferSource();
    const volume = this.context.createGain();
    volume.gain.value = .55;
    source.buffer = this.buffers.get(file);
    source.connect(volume).connect(this.context.destination);
    this.source = source;
    return new Promise(resolve => {
      source.onended = () => {
        source.disconnect();
        volume.disconnect();
        if (this.source === source) this.source = null;
        resolve();
      };
      source.start();
    });
  }

  say(messages) {
    if (!this.enabled) return;
    this.pending.push(...messages.filter(Boolean));
    if (!this.busy) void this.play(this.generation);
  }

  async play(generation) {
    this.busy = true;
    while (this.pending.length && this.enabled && generation === this.generation) {
      if (!await this.ready(generation)) return;
      const lines = this.pending.shift();
      const transcript = lines.map(line => line.text).join(" / ");
      this.report(transcript);
      try { await this.chime(generation); }
      catch {
        if (generation !== this.generation) return;
        this.report("Chime unavailable. Continuing with the announcement.");
      }
      for (const line of lines) {
        await new Promise(resolve => setTimeout(resolve, 350));
        if (!await this.ready(generation)) return;
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
        clearInterval(timer);
        utterance.onend = utterance.onerror = null;
        this.finishSpeech = null;
        resolve(success);
      };
      let activeSeconds = 0;
      const timer = setInterval(() => {
        if (!this.paused && ++activeSeconds > Math.max(30, text.length / 5)) {
          finish(false);
          window.speechSynthesis.cancel();
        }
      }, 1000);
      this.finishSpeech = () => finish(false);
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      window.speechSynthesis.speak(utterance);
    });
  }
}
