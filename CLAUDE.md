# Circuit Timer

A single-file interval timer web app for HIIT circuits, used by Andrew on an
iPhone as a home-screen web app. Everything lives in `interval-timer.html` —
markup, styles, script, fonts, audio, icon. No build step, no dependencies,
no external requests.

- **Repo:** `andrewhaythornthwaite/Timer` (public)
- **Live:** `https://andrewhaythornthwaite.github.io/Timer/interval-timer.html`
- **Deploy:** GitHub Pages, `main` branch, `/` root. Push and it's live in ~1 min.
- **Local:** `~/Dropbox/CLAUDE/MY APPS/Circuit Timer/circuit-timer/` — this folder
  *is* the git clone. Drop zone for new files is `../_ INBOX/`.

## Always push — Andrew should never have to

After **any** change in this repo: run `npm test`, and if it passes, commit with
a clear message and `git push`. Don't ask first. Andrew used to upload files
through the GitHub web page by hand and wants that gone entirely. If tests
fail, don't push — say what failed. If he says to hold a change back, hold it.

A Stop hook (`.claude/hooks/check-unpushed.sh`) blocks the end of a turn once
if anything is left uncommitted or unpushed, as a backstop.

## Layout

```
interval-timer.html   the app — the only file Pages actually needs
test/                 headless tests (npm test)
native/               ContentView.swift — SwiftUI version, not deployed
.claude/              project settings + the unpushed-changes hook
```

## Why it is one file with nothing external

It is installed to the iOS home screen and used mid-workout, sometimes with no
signal. The fonts (Barlow / Barlow Condensed, four weights), the beep audio and
the app icon are all base64-embedded. **Do not add a CDN link, a webfont
request, or an external asset.** Verify with:

```bash
grep -c "https://" interval-timer.html   # must be 0
```

The file is ~168KB, mostly fonts. That is fine and not worth optimising.

## Hard-won constraints — read before touching audio

These were all found the slow way. Do not undo them.

### Beeps must be scheduled, never fired

An `<audio>` element plays when the media pipeline gets round to it — on iOS
20–200ms later, and it varies every time. Firing beeps reactively from the
animation loop produced audibly irregular countdowns. The fix was Web Audio:
decode each clip to an `AudioBuffer` and book the whole countdown against
`AudioContext.currentTime` the moment a phase starts. `bookCountdown()` does
this. Sample-accurate, immune to what the rest of the app is doing.

`precise` is true when buffers decoded. The element-based `play()` path is a
fallback only.

### cancelBooked() must only cancel sounds that have not started

The landing tone is booked for the exact instant the next phase begins — and
that phase immediately books its own countdown. Cancelling everything killed
the landing tone milliseconds after it started, so the countdown ran three
ticks and the fourth beep was chopped off. It now compares each booked node's
start time against `currentTime` and leaves anything already sounding alone.

### iOS ignores `volume` on audio elements

It is read-only there. Use `muted` for silent priming. An early version set
`volume = 0` to prime clips inaudibly and instead played every beep at full
blast on first tap.

### Elements must be primed by a user gesture, per element

`unlockAudio()` plays every element muted on first touch, then rewinds and
unmutes. `play()` waits on that promise — an early version let a real beep fire
mid-priming, and priming's `pause()` killed it.

### The wake lock is held through pause

Releasing it on pause let the screen sleep, the phone lock, and iOS then kills
a home-screen web app — losing the session entirely. It is released only on
finish and End.

### The keep-awake video is a fallback, not a default

`#nosleep` is a 12s black mp4, looped, because iOS never sleeps during video
playback. It works at `file://` where the Wake Lock API doesn't. But a
constantly looping video competes for the media pipeline and made beeps
stutter, so it only plays when `navigator.wakeLock` failed. It was also
originally 1s long and restarting every second, which was worse.

### Audio must be re-aimed after route changes

iOS does not re-route an `AudioContext` opened while on the phone speaker, and
suspends it in the background. `rearmAudio()` resumes the context and re-books
the current countdown; it is wired to `devicechange`, `visibilitychange`,
`focus` and resume-from-pause. Symptom without it: Bluetooth headphones
connect and the timer looks fine but is silent.

### localStorage, not window.storage

`window.storage` only exists inside Claude's artifact preview. On GitHub Pages
it silently failed, so settings never persisted. The `store` object tries
localStorage, falls back to `window.storage`, then to memory.

### Claude's artifact preview cannot run this app

It loads as `about:srcdoc` and blocks the inline audio, the video and the wake
lock, surfacing as a bare `Uncaught Error: Script error.` with details stripped
by cross-origin rules. **Never debug this app in an artifact preview** — the
symptoms are the sandbox, not the code. Test on the live URL. The in-app
diagnostic line reports protocol, standalone state, clip load state and timing
mode precisely so this is distinguishable.

## Audio synthesis

WAVs are generated in-page by `renderWav(parts)` and handed over as data URIs.
Two synthesis modes:

- **Harmonic** (`soft`, `warm`, `wood`): sine plus a little 2nd harmonic,
  attack / exponential-decay / release envelope.
- **Bell partials** (`gong`): eight partials at non-integer frequency ratios,
  each with its own decay rate, high ones dying first. Includes a partial
  detuned 0.4% against the prime for shimmer. This is what makes it read as a
  bell rather than a pitched sine.

`TONES` holds timbre params (attack, decay, harmonic content, pitch multiplier,
duration multiplier, partial table). `BASE` holds per-clip pitch/duration/level.
`clipsFor(name)` combines them.

**Every tone must end at zero amplitude.** An early version cut off
mid-waveform and snapped to silence in one sample — a broadband click on the
tail of every beep, which reads as "harsh" no matter how mellow the note is.
The release taper handles this. Verify when changing envelopes:

```bash
node test/tones.js    # prints peak level and final sample for every tone
```

Phone speakers can't move air below ~300Hz, so low clips get extra 2nd-harmonic
content — the ear infers a fundamental the speaker never produced. Do not
"fix" this by raising the pitch.

Duration caps in `clipsFor`: ticks ≤0.92s so consecutive ticks don't smear,
other clips ≤5s so a long tone doesn't run past a short break.

## Sound design

Three ticks at 3-2-1, then the landing tone on the change itself — four evenly
spaced beats. Landing tone is pitched by what is *starting*:

| Moment | Clip | Meaning |
|---|---|---|
| 3, 2, 1 before any change | `tick` | neutral |
| Work begins | `work` | bright — go |
| Work ends, rest begins | `rest` | low — stop |
| New exercise | `brk` | one long low tone |
| Session ends | `done` | descending |

## Visual design

Two distinct states, deliberately:

- **Setup** is a pale "spec plate" — `#EDE9DE` ground, black rules, heavy
  condensed uppercase, like the label on a machine.
- **Run** floods the whole screen with a phase colour, readable across a room
  in peripheral vision: work `#D8331C`, rest `#146B66`, break `#2C3A8C`,
  lead-in `#C8871B`.

The screen itself is the progress bar — it drains bottom-up. No progress ring.
Rep pips along the bottom. Andrew is a product/object designer; the machine-
panel language is intentional, not decoration.

## Testing

There is no browser here, so run it headless. `test/` holds:

- `test/app.js` — boots the page in jsdom, drives start / pause / resume /
  skip / end / previews / tone switches, asserts no runtime errors
- `test/presets.js` — save, load, highlight, delete, persistence
- `test/tones.js` — renders every clip in every tone, checks peak level and
  that each ends at silence

```bash
npm install           # once — jsdom, from package.json
npm test              # all three
```

`node_modules/` is marked Dropbox-ignored (`xattr com.dropbox.ignored`) so it
doesn't sync. On another machine, just `npm install` again.

**Run these before every push.** A crash I shipped — declaring the scheduler's
state after the setup code that used it — killed the entire script, and it took
several rounds of "it's not working" to catch because I was reading the code
instead of running it. jsdom found it in seconds.

## Deploying

```bash
npm test && git add -A && git commit -m "..." && git push
```

Live in about a minute. Confirm with
`curl -s https://andrewhaythornthwaite.github.io/Timer/interval-timer.html | grep -c <something new>`.
If a change makes things worse: `git revert HEAD && git push`. On the phone, force-close the timer from the app
switcher before reopening or iOS serves the cached version.

## Known limits

- **Will not run with the screen locked.** iOS suspends home-screen web apps.
  The wake lock means the phone won't lock on its own during a session, but
  pressing the power button ends it. Unfixable in a web app — the native
  SwiftUI version (`native/ContentView.swift`) handles this via a background
  audio session.
- Presets are per-device, tied to this origin's localStorage.

## Open threads

- Andrew wants the gong matched to a reference sound from a video. Approach:
  FFT the file, extract fundamental, measure actual partial ratios and per-
  partial decay rates, feed them into the `gong` partial table.
- Possible: expose tone pitches/durations as in-app controls so sound tweaks
  don't need a deploy at all.
