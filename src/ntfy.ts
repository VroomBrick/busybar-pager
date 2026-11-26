// Talking to ntfy: one poll of a topic, read as a stream so a large backlog cannot run the bar out of memory.
// ntfy answers `GET /<topic>/json?poll=1&since=<id>` with one JSON object per line; see https://docs.ntfy.sh/subscribe/api/.
import { device } from "@shared/device";

/** Messages one poll keeps: the newest of what came. The app keeps no more than this either. */
export const MAX_MESSAGES = 20;
/** Characters kept of a message: what the back display can show, with room to spare. */
const MAX_TEXT = 180;
/**
 * Bytes of an answer read at most. The heap is 128 KiB; a line is at most ~4 KiB. Past this the poll stops taking
 * messages and the next one goes on from the last it took.
 */
const MAX_BYTES = 16 * 1024;

export type Message = {
  id: string;
  /** Unix seconds, as ntfy gives it. */
  time: number;
  title: string;
  text: string;
  /** 1 min, 2 low, 3 default, 4 high, 5 urgent. */
  priority: number;
};

export type Failure = { word: string; detail: string };

export type Poll =
  | { ok: true; messages: Message[]; lastId: string | null }
  | { ok: false; failure: Failure };

export type Source = { server: string; topic: string; token: string; minPriority: number };

/** The bar's fonts are printable ASCII; a text element with anything else is refused. */
export function printable(value: string): string {
  let out = "";
  for (const ch of value) {
    if (ch === "\n" || ch === "\t") out += " ";
    else if (ch >= " " && ch <= "~") out += ch;
    else if (ch === "’" || ch === "‘") out += "'";
    else if (ch === "“" || ch === "”") out += '"';
    else if (ch === "–" || ch === "—") out += "-";
    else if (ch === "…") out += "...";
    // Emoji and letters the fonts lack are left out rather than drawn as boxes.
  }
  return out.replace(/ {2,}/g, " ").trim();
}

/** Bytes as one character each, a slice at a time: one call per slice is far faster on the bar than one per byte. */
function bytesToString(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 512) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 512)));
  }
  return out;
}

/** UTF-8 bytes, held one per character, as text. The bar's JavaScript has no TextDecoder. */
function decodeUtf8(bytes: string): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes.charCodeAt(i);
    let code = b;
    let extra = 0;
    if (b >= 0xf0) [code, extra] = [b & 0x07, 3];
    else if (b >= 0xe0) [code, extra] = [b & 0x0f, 2];
    else if (b >= 0xc0) [code, extra] = [b & 0x1f, 1];
    for (let k = 1; k <= extra; k++) code = (code << 6) | (bytes.charCodeAt(i + k) & 0x3f);
    // Past the 16-bit range is only emoji and rare scripts, which the bar's fonts lack anyway.
    if (code <= 0xffff) out += String.fromCharCode(code);
    i += extra + 1;
  }
  return out;
}

/** One line of the answer as a message; null for keepalives, other events and lines that are not JSON. */
function parseLine(line: string, topic: string): Message | null {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(decodeUtf8(line)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (event.event !== "message" || typeof event.id !== "string") return null;
  const priority = typeof event.priority === "number" ? event.priority : 3;
  const title = typeof event.title === "string" ? printable(event.title) : "";
  return {
    id: event.id,
    time: typeof event.time === "number" ? event.time : Math.round(Date.now() / 1000),
    title: (title || topic).slice(0, 40),
    text: printable(typeof event.message === "string" ? event.message : "").slice(0, MAX_TEXT),
    priority: Math.min(5, Math.max(1, Math.round(priority))),
  };
}

export async function online(): Promise<boolean> {
  try {
    return (await device.WifiStatusGet()).state === "connected";
  } catch {
    // Not knowing is not "offline".
    return true;
  }
}

const fail = (word: string, detail: string): Poll => ({ ok: false, failure: { word, detail } });

/**
 * Asks the server for what arrived since `since` (a message id, or "latest"). Never throws. `stopped` is asked
 * between reads, so leaving the app does not wait for a long answer to finish.
 */
export async function poll(source: Source, since: string, stopped: () => boolean): Promise<Poll> {
  const host = source.server.replace(/^https?:\/\//, "");
  const url = `${source.server}/${encodeURIComponent(source.topic)}/json?poll=1&since=${encodeURIComponent(since)}`;
  let response: Response;
  try {
    response = await fetch(url, source.token ? { headers: { Authorization: `Bearer ${source.token}` } } : undefined);
  } catch (err) {
    // On the bar `fetch` rejects with "Inactivity timeout", "Failed to connect to server" and the like.
    const reason = err instanceof Error ? err.message : String(err);
    if (!(await online())) return fail("NO WIFI", "The bar is not on Wi-Fi.");
    if (/timeout/i.test(reason)) return fail("TIMEOUT", `${host} did not answer in time. Trying again soon.`);
    return fail("NO ANSWER", `Could not reach ${host}. Check the server in Setup. (${reason})`);
  }
  if (response.status === 401 || response.status === 403) return fail("NO ACCESS", "The topic is protected: check the access token.");
  if (response.status === 429) return fail("TOO OFTEN", "The server asks to check less often: raise the seconds between checks.");
  if (!response.ok) return fail(`HTTP ${response.status}`, `The server answered ${response.status}. Check the server address in Setup.`);
  if (!response.body) return fail("ERROR", "The answer had no body.");

  // Lines are cut from the bytes as they come; only the newest MAX_MESSAGES messages are kept.
  const messages: Message[] = [];
  let lastId: string | null = null;
  let pending = "";
  let read = 0;
  const take = (line: string) => {
    const message = line.trim() === "" ? null : parseLine(line, source.topic);
    if (!message) return;
    lastId = message.id;
    if (message.priority < source.minPriority) return;
    messages.push(message);
    if (messages.length > MAX_MESSAGES) messages.shift();
  };

  const reader = response.body.getReader();
  for (;;) {
    const chunk = await reader.read();
    // A stream that stopped in its middle ends with done and the error as its value, not with a rejection.
    if (chunk.done) {
      if (typeof chunk.value === "string" && lastId === null) return fail("ERROR", chunk.value);
      take(pending);
      break;
    }
    const bytes = chunk.value as Uint8Array;
    read += bytes.length;
    pending += bytesToString(bytes);
    let end = pending.indexOf("\n");
    while (end >= 0) {
      take(pending.slice(0, end));
      pending = pending.slice(end + 1);
      end = pending.indexOf("\n");
    }
    // Past the cap the rest is not read: the next poll goes on from the last message taken.
    if (read >= MAX_BYTES || stopped()) {
      void reader.cancel().catch(() => undefined);
      break;
    }
  }
  return { ok: true, messages, lastId };
}
