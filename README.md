# MH Studioz — Games

Three browser games in one repository, served from the domain root at **https://mh-studioz.github.io/games/**. No accounts, no API keys and no backend: every game runs entirely in the browser and keeps its records on the device.

The site root is a redirect to the shelf, and the repository is published as `MH-Studioz.github.io`, so Pages serves the shelf at `/games/` rather than under a `/repository/` prefix.

**Play:** https://mh-studioz.github.io/games/

| # | Game | What it is | Facts |
| --- | --- | --- | --- |
| 01 | [**DEEP ATLAS**](games/deep-atlas/) | Geography rarity game — name the most obscure real place that fits the prompt | 7,970 places · 5 modes · 3 clocks · daily · party |
| 02 | [**GP 2026**](games/apex-gp-2026/) | Open-wheel, GT, prototype, hypercar, stock and kart racing, plus gravel rally | 41 circuits · 8 cars · 2 rally stages · time trial · party |
| 03 | [**TRACE**](games/trace/) | Circuit recognition — one unlabeled centerline, one name | 113 circuits · 10 championships · 3 difficulties · daily · party |

All three share the same shape: pick a mode, get a seeded set of rounds, answer against a clock, and copy an emoji result grid when the run ends. Scores, streaks and settings live in `localStorage`; private parties use a six-digit code over PeerJS, with no account and no server of ours.

## GP 2026

A racing simulator built with TypeScript, Vite and Three.js, shipped in the browser and as a Windows desktop app. Shelf label: **BETA 0.2**.

**Circuits and cars**

- **41 real circuits plus two gravel rally stages** generated from GeoJSON outlines, with elevation, banking, kerbs, run-off, tyre walls, sponsor boards, marshal posts, camera cranes, flag poles, paddock awnings, start lights, a painted grid, rubbered-in racing line, grandstands and DRS zones.
- **Eight car models** with genuinely different physics and bodies:
  - **GP Hybrid** — 798 kg turbo-hybrid, maximum downforce.
  - **GP V10** — 760 kg high-revving V10, less aero, higher top speed.
  - **GP Junior** — 620 kg entry formula, lower power and grip.
  - **GP GT** — 1,364 kg GT3-style coupe with closed cockpit, ABS-friendly braking and sequential gears.
  - **GP Prototype** — 1,030 kg closed-cockpit hybrid endurance prototype with high-downforce bodywork and ERS.
  - **GP Hypercar** — 1,450 kg road-based hybrid hypercar with active aero, wide bodywork and ERS.
  - **GP Stock** — 1,550 kg full-size stock car with a big rear wing, four-speed gearbox and mechanical grip.
  - **GP Kart** — 175 kg direct-drive kart, single gear, 115 km/h and no DRS or ERS.

**Modes and setup**

- **Driver Hub:** four routes — Race, Car, Time Trial and Multiplayer — with a local driver profile or guest identity and a live car showcase on the home screen.
- **Car studio:** team and driver identity, paint, five livery patterns, race number, visor tint, aero package, wing angles, brake bias, differential, suspension, ride height and starting compound. The default livery is black and blue, and everything persists locally.
- **Race builder:** choose the car, tune it in the studio, pick a circuit, then set weather, time of day, AI count (0, 5 or 9), AI difficulty, track-limit strictness and race flags before the standing start.
- **Time Trial:** ideal conditions — dry, daylight, no AI, limits off — with the current car and circuit, plus a persistent best-lap ghost recorded at 20 Hz.
- **Multiplayer:** host a private party and share a six-digit code, or join with one. The host launches the race with the party's circuit and car; every guest enters the same session, and lightweight car poses are relayed over PeerJS/WebRTC so party cars appear on track. Contact and authoritative race-state reconciliation are not part of this build.

**Driving**

- **120 Hz fixed-step physics:** load-sensitive tyre grip, wet and gravel surface grip, tyre temperatures and wear, fuel burn, DRS, ERS, brake bias, differential, suspension and banked corners.
- **Racecraft and contact:** pure-pursuit AI with braking-distance planning, traffic awareness, staggered start-lane holding, off-track recovery and stuck-car resets; two-circle capsule hitboxes, bodywork-aware barrier contact and a barrier at the visible edge of the run-off.
- **Standing starts:** five gantry lamps illuminate in sequence, hold red for an unpredictable beat, then go out together; the race clock starts on lights out. The painted grid uses wider staggered boxes for ten cars.
- **Pit stops:** Monza's pit entry, exit and box are explicitly calibrated; pit-lane ribbons stay outside the racing surface, with pit-box detection, speed limiter, tyre changes, wing and brake repairs.
- **Weather:** wet sessions switch the field to wet tyres, add rain, diminish slick grip, lower AI pace and cool the tyres.
- **Driver aids:** traction control, ABS, stability control, automatic gearbox, racing line, difficulty presets, camera modes and full remapping-free keyboard controls.
- **Presentation:** instanced scenery, merged car bodies, low-detail AI wheels, a resolution cap and adaptive pixel ratio keep a full grid smooth; engine, tyre, wind and kerb audio is synthesised with Web Audio.
- **Windows packaging:** Electron build with an NSIS installer and a portable EXE.

| Input | Action |
| --- | --- |
| W / Up | Throttle |
| S / Down | Brake |
| A / D | Steer |
| Shift + A / D | Manual gear down / up |
| Space | DRS (in a DRS zone) |
| C | Camera |
| M | Mute |
| R | Reset to track |
| Esc | Pause |

Manual gearbox and clutch are optional in Settings.

## DEEP ATLAS

A self-contained geography rarity game at [`/games/deep-atlas/`](games/deep-atlas/): seven timed prompts per round, five modes plus a private party, three difficulty clocks, typo-tolerant answers, inverse-rarity depth scoring and a shareable emoji scorecard.

The bundled database holds **7,970 places** — 195 countries, 5,082 cities, 1,060 rivers, 744 lakes, 627 peaks and 262 islands — and needs no API keys. The atlas is loaded after first paint, so the home screen appears from a small entry chunk while the geography tables stream in behind it. Day #1 is Monday 23 November, and the daily set rolls over at local midnight.

## TRACE

A circuit-recognition game at [`/games/trace/`](games/trace/): one unlabeled centerline, one name.

- **113 circuits** across F1, F2, F3, F4, WEC, NASCAR and IndyCar — 40 real GPS traces from the racing game's track data plus 73 schematic ovals, airfield, street and road courses.
- **Ten championships:** each series on its own, plus **MIXED** (all seven), **FEEDER** (F2/F3/F4) and **AMERICAN** (NASCAR/IndyCar). A championship run draws eight circuits from its pool in a fresh order.
- **Three modes:** championship, the shared daily trace (a date seed, so everyone reads the same eight outlines until local midnight) and private parties. The host picks the championship and difficulty, the six-digit code admits guests, every browser starts the same eight circuit ids, and scores stream into a live board and final standings.
- **Three difficulties** — ROOKIE, PRO and LEGEND, which rotates and flips the line — changing guesses, clock, country hint and score multiplier. Answers are typo-tolerant and accept city and short-name aliases.
- **Results** copy out as an emoji share grid; streak and best-run records stay in `localStorage`.

The schematic outlines are hand-traced from the real layouts and normalised to a common box; `scripts/gen-trace-circuits.mjs` rebuilds `games/trace/data/circuits.json` from the GPS GeoJSON plus those traces. **TRACE 1.0** is tagged `trace-v1` and ships as the Pages build — there are no downloadable assets, the browser game is the release.

## Development

Requires Node.js 20+.

```bash
npm ci
npm run dev        # Vite dev server on http://127.0.0.1:5173
npm run typecheck  # tsc --noEmit
npm run build      # typecheck, then build every page into dist/
npm run preview    # serve the built bundle
```

All three games are separate Vite inputs, so one `npm run dev` serves the whole site:

| Page | Dev URL |
| --- | --- |
| Shelf | `http://127.0.0.1:5173/games/` |
| GP 2026 | `http://127.0.0.1:5173/games/apex-gp-2026/` |
| DEEP ATLAS | `http://127.0.0.1:5173/games/deep-atlas/` |
| TRACE | `http://127.0.0.1:5173/games/trace/` |

The site root (`/`) is a redirect page to the shelf, matching GitHub Pages. The production bundle uses relative asset paths and is written to `dist/`.

Adding a page means adding it to the `rollupOptions.input` list in `vite.config.ts`; a page that is not listed there is simply absent from the build, and its shelf link will 404 on Pages.

### Windows desktop (GP 2026)

```bash
npm run desktop:dev
npm run desktop:build
```

`desktop:build` writes the NSIS installer and a portable `.exe` to `release/`. GP 2026 is in beta: the shelf labels it BETA 0.2, the release tagged `v0.1.0-beta.2` carries `GP2026-0.1.0-beta.2-setup.exe` and `GP2026-0.1.0-beta.2-portable.exe`, and TRACE 1.0 is the release tagged `trace-v1`.

## Deployment

`.github/workflows/deploy.yml` builds `dist/` and publishes it to GitHub Pages on every push to `main`, at **https://mh-studioz.github.io/**. The repository name is what gives the site the domain root, so Pages serves `/games/` instead of a repository prefix.

The workflow needs **Settings → Pages → Source: GitHub Actions** once. It runs `npm ci`, `npm run build`, `actions/configure-pages`, then uploads `dist/` and deploys it. Because the whole site is one artifact, a push that only touches one game still rebuilds and redeploys all three.

Old `mh-studioz.github.io/apex-gp-2026/...` links return `public/404.html`, which forwards them to the matching new path (`/games/`, `/games/deep-atlas/`, `/games/apex-gp-2026/` or `/assets/...`).

## Project layout

```
src/            GP 2026 source
  ai/           opponent drivers and racecraft
  audio/        Web Audio synthesis
  game/         session flow, timing, results, ghosts
  garage/       config, liveries, preview
  physics/      vehicle, tyres, aero, setup, settings
  render/       track mesh, cars, environment, cameras
  tracks/       GeoJSON loading and track maths
  ui/           driver hub, race builder, garage, HUD, minimap, pause, multiplayer
electron/       desktop main process and preload
games/
  index.html    the shelf
  apex-gp-2026/ GP 2026 page and entry
  deep-atlas/   DEEP ATLAS page, its atlas data and source
  trace/        TRACE page, source and data/circuits.json
scripts/        gen-trace-circuits.mjs (rebuilds the TRACE dataset)
public/         circuits, car model, audio, share images and the 404 forwarder
```

## Privacy

There are no accounts, no analytics and no server. Names, settings, streaks, best runs and party identity are stored in the browser's `localStorage`. Party features open a PeerJS/WebRTC connection directly between the players' browsers, brokered by the public PeerJS signalling service; nothing is stored remotely.

## Credits

- Circuit outlines: [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits), MIT, © 2019–2025 Tomislav Bacinger.
- Car model: [“F1 2026 concept (polygon model)”](https://sketchfab.com/3d-models/f1-2026-concept-polygon-model-ea3bde709b1e4dc9b0ec8557d106ed42) by [Qvist_designs](https://sketchfab.com/Qvist_designs), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), sourced via [BadCodesGG/interactive-f1](https://github.com/BadCodesGG/interactive-f1).
- Engine loop: OpenGameArt, CC0.
- TRACE circuit outlines reuse the repository's GPS circuit data, plus hand-traced schematics for ovals, street courses and road courses the GeoJSON does not carry.
- Everything else, including the procedural fallback car, the tyre-screech audio, the DEEP ATLAS place database and the TRACE outlines, was created for these projects.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for full attribution.

## Trademark notice

These are original, unofficial projects. They are not associated with, approved by or endorsed by Formula One Licensing B.V., the FIA, any racing series, team, circuit operator or mapping provider. “F1”, “FORMULA 1”, “FIA FORMULA ONE WORLD CHAMPIONSHIP”, “GRAND PRIX” and related marks are trademarks of their respective owners. Real circuit, city and country names are used only as factual geographic references. All teams, drivers, car classes and party names in the games are fictional.

## License

The source code is released under the [MIT License](LICENSE). Third-party assets keep their own licenses as listed above.
