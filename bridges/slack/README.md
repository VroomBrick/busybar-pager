# Slack bridge for Pager

Each direct message you get in Slack, and each message that @mentions you in a channel, shows on your BUSY Bar a
moment later as **Slack: Justin**, with a link that opens it. By default only who wrote goes out, never what they wrote.

It runs on any computer with [Node](https://nodejs.org) 22 or later, needs no server or open port (Slack's Socket
Mode: the bridge calls out to Slack), and has no dependencies: one file, `pager-slack.mjs`.

## Set it up (about 5 minutes)

1. **Make the Slack app.** At [api.slack.com/apps](https://api.slack.com/apps), choose **Create New App → From a
   manifest**, pick your workspace, and paste [manifest.yml](manifest.yml). It reads, as you, your direct
   messages and the channels you are in (to find @mentions of you), and people's and channels' names. It cannot
   post anything. Some workspaces need an admin to approve it.
2. **Make the app-level token.** In the app's **Basic Information**, under **App-Level Tokens**, choose **Generate
   Token and Scopes**, name it `socket`, add the scope `connections:write`, and copy the token (`xapp-...`).
3. **Install it.** In **Install App**, choose **Install to Workspace** and allow it. Copy the **User OAuth Token**
   (`xoxp-...`).
4. **Run the bridge** with the two tokens and your Pager topic:

   macOS and Linux:

   ```sh
   SLACK_APP_TOKEN=xapp-... SLACK_USER_TOKEN=xoxp-... NTFY_TOPIC=your-topic node pager-slack.mjs
   ```

   Windows (PowerShell):

   ```powershell
   $env:SLACK_APP_TOKEN="xapp-..."; $env:SLACK_USER_TOKEN="xoxp-..."; $env:NTFY_TOPIC="your-topic"; node pager-slack.mjs
   ```

   It prints `connected to Slack`. Ask someone to send you a direct message: your bar shows it within the
   "Seconds between checks" you set in Pager.

To keep it running, start it the way your system runs background programs: a systemd user service on Linux, a
launchd agent on macOS, a scheduled task at log-on on Windows.

## Options

| Variable | What it does | Default |
| --- | --- | --- |
| `PAGER_MENTIONS` | `off` stops pages for @mentions of you in channels | `on` |
| `PAGER_CHANNEL_WIDE` | `on` also pages for @channel, @here and @everyone | `off` |
| `PAGER_TEXT` | `on` sends the message text too | `off` |
| `PAGER_PRIORITY` | ntfy priority of a DM: `min`, `low`, `default`, `high`, `urgent` | `high` |
| `NTFY_SERVER` | Your own ntfy server | `https://ntfy.sh` |
| `NTFY_TOKEN` | An ntfy access token for a protected topic | none |

## Privacy

With the default, what leaves Slack is the sender's name and a link to the conversation, which only people in your
workspace can open. Turn on `PAGER_TEXT` only with your own ntfy server or a protected topic: on ntfy.sh, anyone who
knows a topic can read what is sent to it, and messages stay there for up to 12 hours.

Your own messages, edits, deletions and messages from bots are not sent. Keep the two tokens out of your shell
history and out of git: they let anyone who has them read your direct messages.
