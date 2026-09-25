# Preece Practicometer

A desktop practice companion for piano: metronome, timed practice-set lists with
notes, a chord-grid/randomiser reference tool, and two ear-training games.
Built with Electron (plain HTML/CSS/JS, no framework).

## Layout

A persistent top menu bar switches between the app's tools. The metronome
(left column) runs independently of whichever tool is open in the central
panel:

- 📋 **Practice List** — your saved practice sets (CSV-backed). Opening a set
  shows an editable activity/time table; **Start Practice** runs a per-item
  countdown timer with session tracking and per-item markdown notes.
- 🎹 **Chord Grid** — click a key on the on-screen piano to see a 12-cell
  chord-progression grid for that key; cells advance automatically in time
  with the metronome.
- 🔵 **Randomiser** — a randomized circle-of-fifths drill (note / major7 /
  dominant7 / minor7 / mixed modes); re-opening it always reshuffles.
- 🎤 **Ear Training** — interval recognition. Echo mode plays the interval
  first; Play mode shows the target and lets you find/sing it. Answer via the
  on-screen keyboard, a connected MIDI keyboard, or by singing into the mic
  (autocorrelation pitch detection). Wrong answers replay the interval
  automatically.
- 🎼 **Chord Sequences** — plays a I chord to establish a key, then a target
  chord or short progression (2–4 chords); answer with the roman-numeral
  buttons, which are also labelled with the actual chord name for the current
  key.

Both games also have a **🪜 Staircase** mode (see below).

## Adaptive difficulty ("Staircase" mode)

Staircase mode replaces manual difficulty selection with a simple 1‑up/1‑down
adaptive staircase (Cornsweet, 1962): one rung harder after each correct
answer, one rung easier after each wrong one. This is the standard method
psychophysics experiments use to converge on the difficulty level where a
listener is right about half the time — i.e. the edge of their current
ability, which is where practice is most effective. (Stricter variants exist —
2‑down/1‑up and 3‑down/1‑up converge toward ~70.7%/~79.4% accuracy — but this
app uses the simple version, matched to a single running level rather than
reversal-averaging.)

- **Ear Training** ladder (10 rungs): starts with only the 5th (ascending),
  widens the interval set and adds descending intervals, then — once all six
  intervals are unlocked — progressively tightens the cents tolerance
  required for a mic-sung answer to count as correct.
- **Chord Sequences** ladder (8 rungs): starts with just the V chord in
  single-chord mode, widens the chord pool, then steps up through 2-, 3- and
  4-chord progressions, with the final rung changing key every turn.

While staircase mode is active the manual controls are locked (greyed out) to
show what the current rung has selected; turning it off restores your last
manual selection. The persistent score line shows both your overall
correct/total accuracy and the best (highest) staircase rung you've ever
reached, so difficulty progress survives an app restart.

## Persistence

Both games' scores (and staircase best-level) are saved to `localStorage` and
restored on launch. Use the small "reset" link next to a score to clear it.

## Piano samples

Both ear-training games play real piano recordings rather than a synthesizer:
the Salamander Grand Piano samples by Alexander Holm, redistributed via
[nbrosowsky/tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments),
licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). See
`samples/piano/CREDIT.txt`.

## Accounts and data

Practice sets are stored per-account in Supabase (Postgres + Auth), not as
local CSV files. `js/config.js` holds the Supabase project URL and anon
key and is checked into the repo — that's intentional, not an oversight:
the anon key is meant to be public/client-side (access is enforced by Row
Level Security, not by hiding the key). To point at a different Supabase
project instead, copy `js/config.example.js` over `js/config.js` and fill
in your own project's values.

## Development

The app is a static site (`index.html` + `js/*.js`), deployed via GitHub
Pages at https://dcr-eyethink.github.io/preece-practicometer/ — push to
`main` and it redeploys automatically. Electron just opens a window
pointed at that URL by default.

```bash
npm install
npx serve .                              # serve the site locally, e.g. on :3000
PRACTICOMETER_URL=http://localhost:3000 npm start   # open a local copy in Electron
```

```bash
npm run build:mac  # produce dist/mac-arm64/Preece Practicometer.app
```

The packaged app is unsigned (no Apple Developer certificate configured), so
macOS Gatekeeper will require right-click → Open the first time it's launched
on a machine other than the one it was built on.
