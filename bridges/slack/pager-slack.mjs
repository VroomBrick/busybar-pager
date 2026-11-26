#!/usr/bin/env node
// Pager's Slack bridge: each direct message you receive in Slack becomes a message on your ntfy topic, so your
// BUSY Bar shows "Slack: <who>" a moment later. By default only the sender goes out, never the text.
//
// It uses Slack's Socket Mode: the bridge opens the connection to Slack, so it needs no server, no public address
// and no open port. Node 22 or later, no dependencies. Setup: bridges/slack/README.md.
//
//   SLACK_APP_TOKEN   xapp-...  the app-level token (connections:write)
//   SLACK_USER_TOKEN  xoxp-...  your user token, from installing the app (im:history, mpim:history, users:read)
//   NTFY_TOPIC        the topic Pager reads
//   NTFY_SERVER       optional, default https://ntfy.sh
//   NTFY_TOKEN        optional, an ntfy access token for a protected topic
//   PAGER_TEXT        optional, "on" to send the message text too. Off by default: on ntfy.sh, anyone who knows
//                     the topic can read what is sent to it.
//   PAGER_PRIORITY    optional, ntfy priority for DMs: min, low, default, high (default), urgent
//   PAGER_MENTIONS    optional, "off" to stop pages for @mentions of you in channels (on by default)
//   PAGER_CHANNEL_WIDE optional, "on" to also page for @channel, @here and @everyone (off by default: noisy)

const env = (name, fallback) => {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  console.error(`pager-slack: ${name} is not set. See bridges/slack/README.md.`);
  process.exit(2);
};

const APP_TOKEN = env("SLACK_APP_TOKEN");
const USER_TOKEN = env("SLACK_USER_TOKEN");
const TOPIC = env("NTFY_TOPIC");
const SERVER = env("NTFY_SERVER", "https://ntfy.sh").replace(/\/+$/, "");
const NTFY_TOKEN = env("NTFY_TOKEN", "");
const SEND_TEXT = env("PAGER_TEXT", "off").toLowerCase() === "on";
const PRIORITY = env("PAGER_PRIORITY", "high");
const MENTIONS = env("PAGER_MENTIONS", "on").toLowerCase() !== "off";
const CHANNEL_WIDE = env("PAGER_CHANNEL_WIDE", "off").toLowerCase() === "on";

/** The longest wait between reconnects after Slack or the network fails. */
const MAX_BACKOFF_MS = 60_000;

const log = (...parts) => console.log(new Date().toISOString(), ...parts);

/** One Slack Web API call. Throws with Slack's own error name, like "invalid_auth". */
async function slack(method, token, params = {}) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const answer = await response.json();
  if (!answer.ok) throw new Error(`${method}: ${answer.error}`);
  return answer;
}

/** Who you are, so your own messages in a DM are not sent to your own desk. */
const me = await slack("auth.test", USER_TOKEN);
log(
  `signed in to ${me.team} as ${me.user}; sending to ${SERVER}/${TOPIC}${SEND_TEXT ? " with message text" : " (sender only)"}; ` +
    `mentions ${MENTIONS ? "on" : "off"}, @channel/@here ${CHANNEL_WIDE ? "on" : "off"}`,
);

/** Display names, asked once per person. */
const names = new Map();
async function nameOf(userId) {
  if (!names.has(userId)) {
    try {
      const { user } = await slack("users.info", USER_TOKEN, { user: userId });
      names.set(userId, user.profile?.display_name || user.real_name || user.name || userId);
    } catch (err) {
      log(`could not look up ${userId}: ${err.message}`);
      return "someone";
    }
  }
  return names.get(userId);
}

/** Channel names, asked once per channel. */
const channels = new Map();
async function channelName(id) {
  if (!channels.has(id)) {
    try {
      const { channel } = await slack("conversations.info", USER_TOKEN, { channel: id });
      channels.set(id, channel.name ? `#${channel.name}` : "a channel");
    } catch (err) {
      log(`could not look up channel ${id}: ${err.message}`);
      return "a channel";
    }
  }
  return channels.get(id);
}

/** Sends one message to the topic. A failure is logged, not thrown: one bad send must not end the bridge. */
async function page(title, body, click) {
  const headers = { Title: title, Priority: PRIORITY, Tags: "speech_balloon" };
  if (click) headers.Click = click;
  if (NTFY_TOKEN) headers.Authorization = `Bearer ${NTFY_TOKEN}`;
  try {
    const response = await fetch(`${SERVER}/${encodeURIComponent(TOPIC)}`, { method: "POST", headers, body });
    if (!response.ok) log(`ntfy answered ${response.status} for "${title}"`);
    else log(`paged: ${title}`);
  } catch (err) {
    log(`could not reach ${SERVER}: ${err.message}`);
  }
}

/** A link that opens the message in Slack: the desktop app when it is installed, the browser otherwise. */
function permalink(channel, ts) {
  return `${me.url.replace(/\/+$/, "")}/archives/${channel}/p${ts.replace(".", "")}`;
}

/** Subtypes that are not someone writing to you: edits, deletions, joins. A file someone sends still counts. */
const SKIPPED = new Set(["message_changed", "message_deleted", "channel_join", "bot_message", "message_replied"]);

/** Slack writes a mention of you as <@U123>, and @channel, @here and @everyone as <!channel>, <!here>, <!everyone>. */
const mentionsMe = (text) => text.includes(`<@${me.user_id}>`);
const mentionsEveryone = (text) => /<!(channel|here|everyone)>/.test(text);

async function onEvent(event) {
  if (event.type !== "message") return;
  if (SKIPPED.has(event.subtype) || !event.user || event.user === me.user_id) return;
  const text = event.text ?? "";
  const link = permalink(event.channel, event.ts);
  const body = (fallback) => (SEND_TEXT && text ? text.slice(0, 500) : fallback);

  if (event.channel_type === "im" || event.channel_type === "mpim") {
    const group = event.channel_type === "mpim" ? " (group DM)" : "";
    await page(`Slack: ${await nameOf(event.user)}`, body(`New direct message${group}`), link);
    return;
  }
  // A channel message reaches the desk only when it calls for you: by name, or, if you asked for it, everyone.
  const byName = MENTIONS && mentionsMe(text);
  const byAll = CHANNEL_WIDE && mentionsEveryone(text);
  if (!byName && !byAll) return;
  const where = await channelName(event.channel);
  const how = byName ? "mentioned you" : "called everyone";
  await page(`Slack: ${await nameOf(event.user)}`, body(`${how} in ${where}`), link);
}

/** One Socket Mode session. Resolves when Slack closes it; the caller opens the next. */
async function session() {
  const { url } = await slack("apps.connections.open", APP_TOKEN);
  return new Promise((resolve) => {
    const socket = new WebSocket(url);
    socket.addEventListener("message", (frame) => {
      let envelope;
      try {
        envelope = JSON.parse(String(frame.data));
      } catch {
        return;
      }
      // Every envelope is acknowledged at once, or Slack sends it again.
      if (envelope.envelope_id) socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
      if (envelope.type === "hello") log("connected to Slack");
      else if (envelope.type === "disconnect") socket.close();
      else if (envelope.type === "events_api") void onEvent(envelope.payload?.event ?? {}).catch((err) => log(err.message));
    });
    socket.addEventListener("close", () => resolve());
    socket.addEventListener("error", (err) => log(`socket error: ${err.message ?? "unknown"}`));
  });
}

// Slack ends Socket Mode sessions every few hours by design; the bridge opens a new one each time.
let backoff = 1000;
for (;;) {
  const started = Date.now();
  try {
    await session();
    log("Slack closed the session; reconnecting");
  } catch (err) {
    log(`could not connect: ${err.message}`);
    // Bad tokens do not fix themselves: stop rather than ask Slack again and again.
    if (/invalid_auth|not_authed|account_inactive|token_revoked/.test(err.message)) process.exit(1);
  }
  backoff = Date.now() - started > 60_000 ? 1000 : Math.min(MAX_BACKOFF_MS, backoff * 2);
  await new Promise((wake) => setTimeout(wake, backoff));
}
