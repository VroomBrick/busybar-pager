// The app's settings, read from the BUSY Bar's HTTP API: GET /api/apps/settings?app_id=<this app>.
//
// Written by BUSY Bar Emulator's `create` in place of the template's helper, which read a global (`Settings`) that
// the released firmware does not have: its loadValues() always gave null.
//
// The BUSY Bar answers with every field of src/appmeta/settings.json: the value a person saved, or the field's "default"
// from that file while nothing is saved. An app reads its settings and cannot write them: a person sets them on the
// BUSY Bar (APPS, the app's card, Setup) or in the BUSY Bar's web page, and the app sees them the next time it asks. Ask at
// the start of the app.
import manifest from "../src/appmeta/manifest.json";
import { device } from "./device";

/** The values: field id -> value; a group is a nested map. */
export type SettingsValues = Record<string, unknown>;

/**
 * Reads the app's settings. Null when the app has no src/appmeta/settings.json or the BUSY Bar did not answer: use the
 * defaults in code then.
 */
export async function loadValues(): Promise<SettingsValues | null> {
  try {
    const answer: unknown = await device.AppsSettingsGet({ app_id: manifest.id });
    const values = (answer as { values?: unknown } | null)?.values;
    return values !== null && typeof values === "object" ? (values as SettingsValues) : null;
  } catch {
    return null;
  }
}

/** A string setting, trimmed; the fallback when it is missing or not a string. */
export function text(values: SettingsValues | null, key: string, fallback: string): string {
  const value = values?.[key];
  return typeof value === "string" ? value.trim() : fallback;
}

/** A whole-number setting, kept within [min, max]; the fallback when it is missing or not a number. */
export function integer(values: SettingsValues | null, key: string, fallback: number, min: number, max: number): number {
  const value = values?.[key];
  const number = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, number));
}

/** A yes/no setting; the fallback when it is missing or not a boolean. */
export function flag(values: SettingsValues | null, key: string, fallback: boolean): boolean {
  const value = values?.[key];
  return typeof value === "boolean" ? value : fallback;
}

/** An app cannot write its settings (the BUSY Bar lets an app only read them): this saves nothing and says so. */
export async function saveValues(_values: SettingsValues): Promise<void> {
  console.error(`${manifest.id}: saveValues() saved nothing: an app can read its settings, not write them.`);
}
