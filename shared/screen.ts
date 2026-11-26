// Draws on the BUSY Bar without wasting its time: only elements that changed are sent, elements that went away are
// cleared once, and at most one display request is in flight. A frame asked for while one is being sent replaces any
// frame still waiting, so a burst of redraws becomes a single request.
import type { DisplayClearParams, DisplayDrawParams } from "@busy-app/busy-lib";
import { device } from "./device";

/** One element of a draw request, as the BUSY Bar's API takes it. */
export type Element = DisplayDrawParams["elements"][number];

export type Screen = {
  /** Shows these elements, all of them; `led` blinks the bar's status light once in that color (#RRGGBBAA). */
  draw(elements: Element[], led?: string | null): Promise<void>;
};

/** Marks an element as on the bar but in an unknown state: it is sent again, or cleared, next time. */
const UNKNOWN = "";

export function createScreen(app: string, report: (err: unknown) => void): Screen {
  /** What the bar shows now: element id -> the element as JSON, to tell what changed. */
  const shown = new Map<string, string>();
  let sending = false;
  let waiting: { elements: Element[]; led: string | null } | null = null;

  async function send(elements: Element[], led: string | null): Promise<void> {
    const changed: Element[] = [];
    const keep = new Set<string>();
    for (const element of elements) {
      keep.add(element.id);
      if (shown.get(element.id) !== JSON.stringify(element)) changed.push(element);
    }
    const gone: string[] = [];
    shown.forEach((_json, id) => {
      if (!keep.has(id)) gone.push(id);
    });

    if (gone.length > 0) {
      const clear: DisplayClearParams = { application_name: app, element_ids: gone };
      await device.DisplayClear(clear);
      for (const id of gone) shown.delete(id);
    }
    if (changed.length > 0 || led) {
      // The light blinks only with a draw request, so a blink with nothing new resends one element.
      const batch = changed.length > 0 ? changed : elements.slice(0, 1);
      const request: DisplayDrawParams = { application_name: app, priority: 50, elements: batch };
      if (led) request.led_notification_color = led;
      await device.DisplayDraw(request);
      for (const element of batch) shown.set(element.id, JSON.stringify(element));
    }
  }

  async function pump(): Promise<void> {
    sending = true;
    try {
      while (waiting) {
        const next = waiting;
        waiting = null;
        try {
          await send(next.elements, next.led);
        } catch (err) {
          // What the bar shows is now unknown. Its ids are kept, so the next frame sends the ones it has and clears
          // the ones it lacks; forgetting them would leave stale elements on the bar for good.
          shown.forEach((_json, id) => shown.set(id, UNKNOWN));
          report(err);
        }
      }
    } finally {
      sending = false;
    }
  }

  return {
    draw(elements, led = null) {
      // A blink asked for by a frame that is replaced before it is sent is kept for the frame that replaces it.
      waiting = { elements, led: led ?? waiting?.led ?? null };
      return sending ? Promise.resolve() : pump();
    },
  };
}
