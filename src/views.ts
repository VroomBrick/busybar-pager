// The two displays. Each view is a pure function of the state: the screen helper sends only what changed.
import type { Element } from "@shared/screen";
import type { Message } from "./ntfy";

export const WHITE = "#FFFFFFFF";
export const GRAY = "#8A8F9CFF";
const DIM = "#FFFFFF80";
const GREEN = "#22E06AFF";
const RED = "#FF4030FF";

/** ntfy's priorities, 1 min to 5 urgent, as colors and names. */
export const PRIORITY_COLOR: Record<number, string> = { 1: "#5A5F6BFF", 2: GRAY, 3: "#3D8BFFFF", 4: "#FFB020FF", 5: RED };
const PRIORITY_NAME: Record<number, string> = { 1: "min", 2: "low", 3: "default", 4: "high", 5: "URGENT" };

// The front display is 72x16. The small font's letters advance about 4 px and its lines are 9 px.
const FRONT_W = 72;
const STRIPE_W = 3;
const TEXT_X = STRIPE_W + 2;
const TOP_Y = -1;
const BODY_Y = 7;
const CHAR_W = 4;

// The back display is 160x80; the firmware's status bar takes the right 12 px.
const BACK_X = 2;
const BACK_CHARS = 36;
const BACK_TITLE_CHARS = 22;
const BACK_LINE_H = 9;
const BACK_BODY_Y = 14;
const BACK_BODY_LINES = 5;
const BACK_META_Y = 60;
const BACK_KEYS_Y = 69;

export type View = {
  messages: Message[];
  cursor: number;
  /** The last check's failure, or null when it went through. */
  failure: { word: string; detail: string } | null;
  /** True once a check has ended. */
  checked: boolean;
  /** Shown in place of the title for a moment: "DONE", "2 NEW". */
  note: string | null;
  demo: boolean;
  /** How to send a test, for the empty screen: "ntfy.sh/topic". */
  address: string;
  /** Unix seconds, bar clock. */
  now: number;
};

/** Text cut to `max` characters, with "..." when it was longer. */
function fit(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

/** Splits text into lines of at most `width` characters, at spaces where it can; "..." ends a cut last line. */
export function wrap(value: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let rest = value;
  while (rest.length > 0 && lines.length < maxLines) {
    if (rest.length <= width) {
      lines.push(rest);
      rest = "";
      break;
    }
    let cut = rest.lastIndexOf(" ", width);
    if (cut <= 0) cut = width;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^ +/, "");
  }
  if (rest.length > 0) lines[lines.length - 1] = fit(`${lines[lines.length - 1]} ${rest}`, width);
  return lines;
}

function ago(seconds: number): string {
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

/**
 * The front display: a stripe in the message's priority color down the left edge, the title and the count on top,
 * the message below, scrolling by itself when it is longer than the room. With no messages, the state in one word.
 */
export function front(v: View): Element[] {
  const message = v.messages[v.cursor];
  if (!message) {
    const body = v.failure ? v.failure.word : v.checked ? "All clear" : "Checking";
    return [
      { id: "f_title", type: "text", text: v.note ?? "PAGER", font: "small", color: v.note ? WHITE : GRAY, x: FRONT_W / 2, y: TOP_Y, align: "top_mid" },
      { id: "f_body", type: "text", text: body, font: "small", color: v.failure ? RED : v.checked ? GREEN : GRAY, x: FRONT_W / 2, y: BODY_Y, align: "top_mid" },
    ];
  }
  const color = PRIORITY_COLOR[message.priority] ?? WHITE;
  const count = `${v.cursor + 1}/${v.messages.length}`;
  return [
    { id: "f_stripe", type: "rectangle", x: 0, y: 0, width: STRIPE_W, height: 16, fill: "solid", fill_colors: [color], border_width: 0 },
    {
      id: "f_title",
      type: "text",
      text: v.note ?? message.title,
      font: "small",
      color: v.note ? WHITE : color,
      x: TEXT_X,
      y: TOP_Y,
      width: FRONT_W - TEXT_X - count.length * CHAR_W - 2,
      align: "top_left",
    },
    // A failed check shows as a red count, without hiding the message.
    { id: "f_count", type: "text", text: count, font: "small", color: v.failure ? RED : DIM, x: FRONT_W, y: TOP_Y, align: "top_right" },
    {
      id: "f_body",
      type: "text",
      text: message.text || message.title,
      font: "small",
      color: WHITE,
      x: TEXT_X,
      y: BODY_Y,
      width: FRONT_W - TEXT_X,
      align: "top_left",
      scroll_rate: 1500,
      scroll_start_delay: 1500,
      scroll_repeat_delay: 3000,
    },
  ];
}

function backLine(id: string, value: string, font: "small" | "normal", y: number): Element {
  return { id, type: "text", text: value || " ", font, x: BACK_X, y, align: "top_left", display: "back" };
}

/** The back display faces the person at the desk: the whole message, when it came, and the keys. */
export function back(v: View): Element[] {
  const message = v.messages[v.cursor];
  const elements: Element[] = [];
  if (!message) {
    elements.push(backLine("b_head", v.failure ? v.failure.word : "Pager", "normal", 0));
    const intro = v.demo
      ? "Demo: sample messages. Set your own ntfy topic in Setup, then send to it from anything."
      : v.failure
        ? v.failure.detail
        : v.checked
          ? `No new messages. Send one: curl -d hi ${v.address}`
          : `Checking ${v.address} for messages...`;
    wrap(intro, BACK_CHARS, BACK_BODY_LINES).forEach((line, i) => elements.push(backLine(`b_l${i}`, line, "small", BACK_BODY_Y + 1 + i * BACK_LINE_H)));
    elements.push(backLine("b_keys", "OK check now   BACK leave", "small", BACK_KEYS_Y));
    return elements;
  }
  elements.push(backLine("b_head", fit(message.title, BACK_TITLE_CHARS), "normal", 0));
  wrap(message.text, BACK_CHARS, BACK_BODY_LINES).forEach((line, i) => elements.push(backLine(`b_l${i}`, line, "small", BACK_BODY_Y + i * BACK_LINE_H)));
  const failed = v.failure ? `  ${v.failure.word}` : "";
  const meta = `${v.cursor + 1}/${v.messages.length}  ${PRIORITY_NAME[message.priority]}  ${ago(Math.max(0, v.now - message.time))}${failed}`;
  elements.push(backLine("b_meta", meta, "small", BACK_META_Y));
  elements.push(backLine("b_keys", "START done  hold: all  WHEEL next", "small", BACK_KEYS_Y));
  return elements;
}
