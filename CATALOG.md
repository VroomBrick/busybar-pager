Your own notifications on your BUSY Bar, from anything that can send a web request: a script, your phone, GitHub, Home Assistant, Slack. Send to an [ntfy](https://ntfy.sh) topic and it's on your desk a few seconds later, colored by how urgent it is.

## What it does

- **Send from anything:** curl -d 'Laundry is done' ntfy.sh/your-topic, or any of the [hundreds of tools](https://docs.ntfy.sh/integrations/) that already send to ntfy.
- **Colored by priority:** gray for low, blue for normal, amber for high, red for urgent. Urgent messages can play a sound, and the light blinks in the message's color.
- **Read it all on the back:** the front scrolls the message; the back shows all of it, how long ago it came, and the keys.
- **Clear as you go:** Start marks a message done. Hold Start to clear them all. The last 20 stay on the bar after a restart.

## Controls

- **Wheel:** next or previous message
- **Start:** done, dismiss this one
- **Start, held:** dismiss all
- **OK:** check now
- **Back:** leave

## Set it up

1. Pick a topic name that is hard to guess, like desk-7f3k9q. On ntfy.sh anyone who knows a topic can send to it, so treat it like a password.
2. In the app's Setup, set **ntfy topic** to that name.
3. Send a test: curl -d 'Hello, desk' ntfy.sh/desk-7f3k9q

Until you set a topic, the app shows sample messages so you can see how it looks.

## Ideas

- **Slack direct messages:** the Slack bridge in the app's repository shows who sent you a DM within seconds (sender only, never the text).
- **Every phone notification on Android:** MacroDroid or Tasker forwards WhatsApp, Signal, texts and more.
- **CI and deploys:** one curl line at the end of a GitHub Actions job.
- **Home Assistant:** the doorbell, the washer, a door left open.
- **Your terminal and AI agents:** know when a long command ends or an agent needs your answer.

## Privacy

The bar asks your ntfy server for messages on your topic and nothing else. On ntfy.sh, messages pass through its servers and are kept for up to 12 hours: see [ntfy's privacy policy](https://ntfy.sh/docs/privacy/). You can run your own ntfy server and set its address in Setup, with an access token for a protected topic.

## Who made it

Built by Adam Becerra at [VroomBrick](https://vroombrick.com). Source, issues and pull requests: [github.com/VroomBrick/busybar-pager](https://github.com/VroomBrick/busybar-pager).
