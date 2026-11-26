// Pager: your own notifications on the BUSY Bar. Anything that can send an HTTP request posts to an ntfy topic
// (https://ntfy.sh); the bar checks the topic and shows what arrived, colored by priority. The wheel steps through
// the messages, Start dismisses one (held: all), OK checks now, Back leaves.
import type { AudioPlayParams } from "@busy-app/busy-lib";
import { device } from "@shared/device";
import { createScreen } from "@shared/screen";
import { flag, integer, loadValues, text } from "@shared/settings";
import manifest from "./appmeta/manifest.json";
import { MAX_MESSAGES, online, poll, type Failure, type Message, type Source } from "./ntfy";
import { back, front, PRIORITY_COLOR, type View } from "./views";

/** The name the app draws under; the device clears elements by this id. */
const APP = manifest.id;

/** The topic that shows sample messages without a network. */
const DEMO = "demo";
const DEMO_EVERY_S = 6;
/** The first check of a topic takes only its newest message, so setting a topic does not replay its history. */
const FIRST_SINCE = "latest";
/** A message older than this when it reaches the bar (caught up after a restart) comes without sound or blink. */
const ALERT_WITHIN_S = 300;
/** How long a note ("DONE", "2 NEW") stays on the front display. */
const NOTE_MS = 1500;
/** The back display's "min ago" is brought up to date this often while a message shows. */
const CLOCK_MS = 30000;
/** After failed checks, the wait doubles up to this, so a server that is down is not asked over and over. */
const MAX_BACKOFF_S = 600;
const STORE_KEY = "pager";
const ALERT_SOUND = "shared/sounds/calendar_event_starts.snd";

type Settings = Source & {
  interval: number;
  /** The lowest priority that plays a sound; 0 for none. */
  soundFrom: number;
  blink: boolean;
};

async function loadSettings(): Promise<Settings> {
  const values = await loadValues();
  const sound = text(values, "sound", "5");
  return {
    server: text(values, "server", "https://ntfy.sh").replace(/\/+$/, "") || "https://ntfy.sh",
    // A topic left empty is the demo, not a request to "/json".
    topic: text(values, "topic", DEMO) || DEMO,
    token: text(values, "token", ""),
    minPriority: Math.min(5, Math.max(1, Number(text(values, "min_priority", "1")) || 1)),
    interval: integer(values, "interval", 30, 10, 600),
    soundFrom: sound === "off" ? 0 : Number(sound) || 5,
    blink: flag(values, "blink", true),
  };
}

/** The sample messages: what a desk might get in a day. */
const DEMO_SCRIPT: Array<[number, string, string]> = [
  [3, "Laundry", "The washer is done. Move it to the dryer before it starts to smell."],
  [2, "Backup", "Nightly backup finished: 214 GB, no errors."],
  [4, "Doorbell", "Someone is at the front door."],
  [5, "CI: main", "Build failed on main: 3 tests failed in checkout.spec.ts."],
  [3, "Mom", "Call me when you get a minute, nothing urgent."],
  [4, "Server", "Disk on nas-01 is 91% full."],
];

// ------------------------------------------------------------------------------------------------------ storage

/** What the bar keeps between launches: the messages and where the last check ended, for one server and topic. */
type Stored = { key: string; since: string | null; messages: Message[] };

function loadStore(key: string): Stored {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as Stored | null;
    // Messages of another topic, or of the same name on another server, are not this one's.
    if (saved && saved.key === key && Array.isArray(saved.messages)) return saved;
  } catch {
    // A store that cannot be read starts over.
  }
  return { key, since: null, messages: [] };
}

// ------------------------------------------------------------------------------------------------------- the app

/**
 * Entry point, called at the end of the file: the device runs this script from top to bottom and starts nothing by itself.
 */
function main(): void {
  const report = (err: unknown) => console.error(`${APP}: ${err instanceof Error ? err.message : String(err)}`);
  const screen = createScreen(APP, report);

  let settings: Settings | null = null;
  let stored: Stored = { key: DEMO, since: null, messages: [] };
  let cursor = 0;
  let failure: Failure | null = null;
  let checked = false;
  let note: string | null = null;
  let checking = false;
  let stopped = false;
  let failures = 0;
  let demoStep = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  let clock: ReturnType<typeof setInterval> | undefined;
  /** Clearing a timer that was never set, or has fired, makes the firmware warn: each timer forgets its id as it fires. */
  const cancel = (id: ReturnType<typeof setTimeout> | undefined) => {
    if (id !== undefined) clearTimeout(id);
  };

  const isDemo = () => settings?.topic === DEMO;

  function render(led: string | null = null): void {
    if (stopped || !settings) return;
    const view: View = {
      messages: stored.messages,
      cursor,
      failure,
      checked,
      note,
      demo: isDemo(),
      address: `${settings.server.replace(/^https?:\/\//, "")}/${settings.topic}`,
      now: Math.round(Date.now() / 1000),
    };
    void screen.draw([...front(view), ...back(view)], led).catch(report);
  }

  function showNote(value: string): void {
    note = value;
    cancel(noteTimer);
    noteTimer = setTimeout(() => {
      noteTimer = undefined;
      note = null;
      render();
    }, NOTE_MS);
    render();
  }

  /** Writes the messages to flash. Every write rewrites the whole store, so it is done only when something changed. */
  function save(): void {
    if (isDemo()) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(stored));
    } catch (err) {
      report(err);
    }
  }

  /** Takes in what a check brought (oldest first): newest first, no duplicates, at most MAX_MESSAGES. */
  function arrive(fresh: Message[]): void {
    if (!settings) return;
    const known = new Set(stored.messages.map((m) => m.id));
    const added = fresh.filter((m) => !known.has(m.id)).reverse();
    if (added.length === 0) return;
    stored.messages = [...added, ...stored.messages].slice(0, MAX_MESSAGES);
    // At the newest message, the newest is shown; reading an older one, it stays, and a note says what came.
    if (cursor > 0) {
      cursor = Math.min(cursor + added.length, stored.messages.length - 1);
      showNote(`${added.length} NEW`);
    }

    // Messages caught up after a restart arrive quietly; only ones that are new now ring.
    const now = Math.round(Date.now() / 1000);
    const ringing = added.filter((m) => now - m.time <= ALERT_WITHIN_S);
    const top = Math.max(0, ...ringing.map((m) => m.priority));
    if (settings.soundFrom > 0 && top >= settings.soundFrom) {
      const sound: AudioPlayParams = { application_name: APP, stock_path: ALERT_SOUND };
      void device.AudioPlay(sound).catch(report);
    }
    render(settings.blink && top >= 3 ? (PRIORITY_COLOR[top] ?? null) : null);
  }

  /** The demo's next step: one sample message every few seconds, once through; OK plays it again once cleared. */
  function demoStepOnce(): number | null {
    if (demoStep >= DEMO_SCRIPT.length && stored.messages.length === 0) demoStep = 0;
    const sample = DEMO_SCRIPT[demoStep];
    if (sample) {
      demoStep += 1;
      const [priority, title, body] = sample;
      arrive([{ id: `demo-${demoStep}`, time: Math.round(Date.now() / 1000), title, text: body, priority }]);
    }
    return demoStep < DEMO_SCRIPT.length ? DEMO_EVERY_S : null;
  }

  /** One check of the topic; returns the seconds until the next one. */
  async function pollOnce(s: Settings): Promise<number> {
    // After a failure, a bar that is off Wi-Fi is not sent out to the network again.
    if (failures > 0 && !(await online())) {
      failure = { word: "NO WIFI", detail: "The bar is not on Wi-Fi." };
      failures += 1;
      return Math.min(MAX_BACKOFF_S, s.interval * 2 ** Math.min(failures, 5));
    }
    const result = await poll(s, stored.since ?? FIRST_SINCE, () => stopped);
    if (stopped) return s.interval;
    if (!result.ok) {
      if (failure?.word !== result.failure.word) report(`${s.topic}: ${result.failure.detail}`);
      failure = result.failure;
      failures += 1;
      return Math.min(MAX_BACKOFF_S, s.interval * 2 ** Math.min(failures, 5));
    }
    failure = null;
    failures = 0;
    const before = stored.messages.length;
    const sinceChanged = result.lastId !== null && result.lastId !== stored.since;
    if (result.lastId !== null) stored.since = result.lastId;
    arrive(result.messages);
    if (sinceChanged || stored.messages.length !== before) save();
    return s.interval;
  }

  /** One check at a time; the next is scheduled only when this one has ended, whatever happened in it. */
  async function run(): Promise<void> {
    if (stopped || checking || !settings) return;
    checking = true;
    cancel(timer);
    timer = undefined;
    let next: number | null = settings.interval;
    try {
      next = isDemo() ? demoStepOnce() : await pollOnce(settings);
    } catch (err) {
      report(err);
    } finally {
      checking = false;
      checked = true;
      if (!stopped) {
        render();
        if (next !== null) {
          timer = setTimeout(() => {
            // A timer that has fired is gone: cancelling it again would make the firmware warn.
            timer = undefined;
            void run();
          }, next * 1000);
        }
      }
    }
  }

  function dismiss(all: boolean): void {
    if (stored.messages.length === 0) return;
    const count = all ? stored.messages.length : 1;
    stored.messages = all ? [] : stored.messages.filter((_m, i) => i !== cursor);
    cursor = Math.min(cursor, Math.max(0, stored.messages.length - 1));
    save();
    showNote(all ? `CLEARED ${count}` : stored.messages.length === 0 ? "ALL DONE" : "DONE");
  }

  function leave(): void {
    stopped = true;
    cancel(timer);
    cancel(noteTimer);
    if (clock !== undefined) clearInterval(clock);
    // A check on its way ends by itself within 5 s. The handler is not detached from inside itself: the unbind would
    // stop the app while the handler still runs.
    setTimeout(unbind, 0);
  }

  // The listener keeps the app alive; a long Back is handled by the firmware and quits it.
  const unbind = listen("input", (event) => {
    if (stopped) return;
    // Back works even before the settings have loaded.
    if (event.key === "back" && event.action === "short") return leave();
    if (!settings) return;
    if (event.key === "encoder") {
      const next = Math.min(stored.messages.length - 1, Math.max(0, cursor + event.delta));
      if (next >= 0 && next !== cursor) {
        cursor = next;
        render();
      }
    } else if (event.key === "start" && event.action === "short") {
      dismiss(false);
    } else if (event.key === "start" && event.action === "long") {
      dismiss(true);
    } else if (event.key === "ok" && event.action === "short") {
      showNote("CHECKING");
      void run();
    }
  });

  void (async () => {
    const loaded = await loadSettings();
    if (stopped) return;
    settings = loaded;
    stored = isDemo() ? { key: DEMO, since: null, messages: [] } : loadStore(`${loaded.server} ${loaded.topic}`);
    render();
    clock = setInterval(() => {
      if (stored.messages.length > 0) render();
    }, CLOCK_MS);
    await run();
  })().catch(report);
}

main();
