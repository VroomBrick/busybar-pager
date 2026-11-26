# Pager for BUSY Bar

Your own notifications on your BUSY Bar. Anything that can send a web request (a script, your phone, GitHub,
Home Assistant, a Slack automation) sends a message to an [ntfy](https://ntfy.sh) topic, and the bar shows it,
colored by how urgent it is. Turn the wheel to go through them; press Start when you've dealt with one.

<!-- screenshots: screenshots/front-*.png, screenshots/back-*.png -->

## In short

- **Send from anything:** `curl -d "Laundry is done" ntfy.sh/your-topic` and it's on your desk a few seconds later.
- **Colored by priority:** gray for low, blue for normal, amber for high, red for urgent. Urgent ones can play a sound,
  and the bar's light blinks in the message's color.
- **Read it all on the back:** the front scrolls the message; the back display shows the whole of it, how long ago
  it came, and the keys.
- **Clear as you go:** Start marks the shown message done; hold Start to clear them all.
- **No account needed** on ntfy.sh. Use your own ntfy server and a protected topic if you want privacy.

## Controls

| Key | Does |
| --- | --- |
| Wheel | Next or previous message |
| Start | Done: dismiss the shown message |
| Start, held | Dismiss all |
| OK | Check for new messages now |
| Back | Leave |

## Set it up

1. Install **Pager** from the BUSY Apps Catalog.
2. Pick a topic name that is hard to guess, like `desk-7f3k9q`. On ntfy.sh, anyone who knows a topic can send to it
   and read it, so treat the name like a password.
3. On the BUSY Bar (APPS, Pager, Setup) or in its web page, set **ntfy topic** to that name.
4. Send a test: `curl -d "Hello, desk" ntfy.sh/desk-7f3k9q`

The topic starts as `demo`, which plays six sample messages so you can see how it looks before you set it up.

### Settings

| Setting | What it does | Default |
| --- | --- | --- |
| ntfy topic | The topic the bar reads. `demo` shows sample messages. | `demo` |
| ntfy server | `https://ntfy.sh`, or your own server. | `https://ntfy.sh` |
| Access token | For a protected topic: a token starting with `tk_`. | empty |
| Seconds between checks | How often the bar asks for new messages, 10 to 600. | 30 |
| Show from priority | Hide messages below this priority. | all |
| Sound | A sound for urgent messages, for high and urgent, or never. | urgent |
| Blink the light | Blink the status light in the message's color. | on |

## What you can send it

ntfy takes a plain HTTP request, so most tools already can. A title and a priority make the bar show it best:

```sh
curl -H "Title: Deploy" -H "Priority: urgent" -d "Prod deploy failed, rolling back" ntfy.sh/your-topic
```

Priorities are `min`, `low`, `default`, `high` and `urgent` (or 1 to 5).

- **Slack direct messages.** Use an automation service: in Zapier, Make or n8n, trigger on a new Slack direct
  message and send a web request (POST) to `https://ntfy.sh/your-topic` with the sender as the `Title` header and the
  text as the body. Some services need a paid plan for web requests. *(Not yet tested end to end.)*
- **Every notification on an Android phone** (WhatsApp, Signal, Messenger, texts, Slack): with
  [MacroDroid](https://www.macrodroid.com) or [Tasker](https://tasker.joaoapps.com), make a "notification received"
  trigger with an HTTP POST action to your topic. iPhones don't let apps read other apps' notifications, so this
  needs Android.
- **GitHub Actions:** a last step of `curl -H "Title: CI" -d "Build failed on ${{ github.ref_name }}" ntfy.sh/your-topic`
  with `if: failure()`.
- **Home Assistant:** a `rest_command` that posts to your topic, called from any automation (doorbell, laundry, a
  door left open).
- **A long command in your terminal:** `make release; curl -d "make release finished" ntfy.sh/your-topic`
- **Claude Code, Codex or any agent:** a hook that runs `curl -d "Needs your answer" ntfy.sh/your-topic` when it waits
  for you.
- **Servers and monitors:** Uptime Kuma, Grafana, Healthchecks, Proxmox, changedetection.io and
  [many more](https://docs.ntfy.sh/integrations/) send to ntfy directly.

## Privacy

The bar asks your ntfy server for messages on your topic; nothing else leaves it. On the public server, ntfy.sh, the
messages pass through its servers and are kept for up to 12 hours: see
[ntfy's privacy policy](https://ntfy.sh/docs/privacy/). For full control, run your own ntfy server and set its
address in the settings. The access token is stored on the bar as a sensitive setting.

## How it works

The bar has no push connection, so the app asks the server every 30 seconds (your setting) for what arrived since the
last message it saw (`GET /<topic>/json?poll=1&since=<id>`). A topic it has never read starts at its newest message,
so setting a topic does not replay its history. The answer is read as a stream and at most 16 KB at a time, so a
backlog after a day off cannot run the bar out of memory: the app takes what fits and goes on from there at the next
check. Messages that were already old when they arrived come in quietly, without the sound or the blink. It keeps
the last 20 messages on the bar, so they are still there after a restart. When a check fails it says why on the screen (no Wi-Fi, no answer, no access) and waits
longer between tries, up to ten minutes, so a server that is down is not asked over and over.

## Build it yourself

You need Node and the [BUSY Bar Emulator](https://github.com/busy-app/busybar-emulator) or a BUSY Bar.

```sh
npm ci
npx tsc                 # types
npx busy-cli build      # dist/<id>.tgz
npx busy-cli app install --addr 127.0.0.1:8640   # the emulator; 10.0.4.20 for a BUSY Bar on USB
npx busy-cli app run --addr 127.0.0.1:8640
```

- `src/main.ts` is the app: its state, the timers and the keys.
- `src/ntfy.ts` asks the server and reads its answer.
- `src/views.ts` draws the front and back displays.
- `shared/screen.ts` sends only the elements that changed, with one display request at a time.
- `shared/settings.ts` reads the settings the bar keeps for the app.
- `src/appmeta/` holds the manifest, the settings form and the icons.

## Who made it

Built by Adam Becerra at [VroomBrick](https://vroombrick.com) for the BUSY Bar Apps Hackathon, November 2026.
Issues and pull requests are welcome.

## License

MIT. See [LICENSE](LICENSE).
