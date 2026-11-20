# GP 2026

A racing simulator with open-wheel, GT, prototype, hypercar, stock and kart classes plus two gravel rally stages, built with TypeScript, Vite and Three.js. It runs in the browser and as a Windows desktop app.

**Play:** https://mh-studioz.github.io/games/ — the games shelf, linking **GP 2026** and **DEEP ATLAS**. The site root redirects to it. The repository is published as `MH-Studioz.github.io`, so the site sits at the domain root rather than under a project prefix.

**Beta v0.2:** browser build on GitHub Pages, plus Windows NSIS and portable EXE assets on the GitHub release.

## What is in the game

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
- **Driver Hub:** four routes — Race, Car, Time Trial and Multiplayer — with a local driver profile or guest identity and a live car showcase on the home screen.
- **Car studio:** team and driver identity, paint, five livery patterns, race number, visor tint, aero package, wing angles, brake bias, differential, suspension, ride height and starting compound. The default livery is black and blue, and everything persists locally.
- **Race builder:** choose the car, tune it in the studio, pick a circuit, then set weather, time of day, AI count (0, 5 or 9), AI difficulty, track-limit strictness and race flags before the standing start.
- **Time Trial:** ideal conditions — dry, daylight, no AI, limits off — with the current car and circuit, plus a persistent best-lap ghost recorded at 20 Hz.
- **Multiplayer:** host a private party and share a six-digit code, or join with one. The host launches the race with the party's circuit and car; every guest enters the same session, and lightweight car poses are relayed over PeerJS/WebRTC so party cars appear on track. Contact and authoritative race-state reconciliation are not part of this build.
- **Racecraft and contact:** pure-pursuit AI with braking-distance planning, traffic awareness, staggered start-lane holding, off-track recovery and stuck-car resets; two-circle capsule hitboxes, bodywork-aware barrier contact and a barrier at the visible edge of the run-off.
- **Standing starts:** five gantry lamps illuminate in sequence, hold red for an unpredictable beat, then go out together; the race clock starts on lights out. The painted grid uses wider staggered boxes for ten cars.
- **Performance:** instanced scenery, merged car bodies, low-detail AI wheels, a resolution cap and adaptive pixel ratio keep a full grid smooth.
- **Pit stops:** Monza’s pit entry, exit and box are explicitly calibrated; pit-lane ribbons stay outside the racing surface, with pit-box detection, speed limiter, tyre changes, wing and brake repairs.
- **Weather:** wet sessions switch the field to wet tyres, add rain, diminish slick grip, lower AI pace and cool the tyres.
- **120 Hz fixed-step physics:** load-sensitive tyre grip, wet and gravel surface grip, tyre temperatures and wear, fuel burn, DRS, ERS, brake bias, differential, suspension and banked corners.
- **Driver aids:** traction control, ABS, stability control, automatic gearbox, racing line, difficulty presets, camera modes and full remapping-free keyboard controls.
- **Synthesised audio** for engine, tyres, wind and kerbs.
- **Electron packaging** for Windows (NSIS installer and portable EXE).

## DEEP ATLAS

The site also hosts **DEEP ATLAS**, a self-contained geography rarity game at [`/games/deep-atlas/`](games/deep-atlas/): seven timed prompts per round, five modes plus a private party, three difficulty clocks, typo-tolerant answers, inverse-rarity depth scoring and a shareable emoji scorecard. The bundled database holds 7,970 places — 195 countries, 5,082 cities, 1,060 rivers, 744 lakes, 627 peaks and 262 islands — and needs no API keys. The atlas is loaded after first paint, so the home screen appears from a small entry chunk while the geography tables stream in behind it. It is built as a second Vite page by `npm run build`; open `http://127.0.0.1:5173/games/deep-atlas/` while developing.

## Controls

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

## Development

Requires Node.js 20+.

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

The production bundle uses relative asset paths and is written to `dist/`.

Both games build from the `games/` shelf: `npm run dev` serves the shelf at `http://127.0.0.1:5173/games/`, the racing game at `http://127.0.0.1:5173/games/apex-gp-2026/` and DEEP ATLAS at `http://127.0.0.1:5173/games/deep-atlas/`. The site root is a redirect page to the shelf, matching GitHub Pages, and `desktop:build` packages the same nested entries.

### Windows desktop

```bash
npm run desktop:dev
npm run desktop:build
```

`desktop:build` writes the NSIS installer and a portable `.exe` to `release/`.

The current beta release is tagged `v0.1.0-beta.2` and publishes `GP2026-0.1.0-beta.2-setup.exe` and `GP2026-0.1.0-beta.2-portable.exe` alongside the Pages deployment.

## Deployment

`.github/workflows/deploy.yml` builds and publishes `dist/` to GitHub Pages on every push to `main`, at **https://mh-studioz.github.io/** — the repo is `MH-Studioz.github.io`, so Pages serves `/games/` instead of a `/repository/` prefix. Enable **Settings → Pages → Source: GitHub Actions** once for the repository.

Old `mh-studioz.github.io/apex-gp-2026/...` links return `public/404.html`, which forwards them to the matching new path (`/games/`, `/games/deep-atlas/`, `/games/apex-gp-2026/` or `/assets/...`).

## Project layout

```
src/
  ai/          opponent drivers and racecraft
  audio/       Web Audio synthesis
  game/        session flow, timing, results, ghosts
  garage/      config, liveries, preview
  physics/     vehicle, tyres, aero, setup, settings
  render/      track mesh, cars, environment, cameras
  tracks/      GeoJSON loading and track maths
  ui/          driver hub, race builder, garage, HUD, minimap, pause, multiplayer
electron/      desktop main process and preload
games/         index.html (shelf), apex-gp-2026/ (racing game) and deep-atlas/ (geography game)
public/        circuits, car model, audio, share images and the 404 forwarder
```

## Credits

- Circuit outlines: [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits), MIT, © 2019–2025 Tomislav Bacinger.
- Car model: [“F1 2026 concept (polygon model)”](https://sketchfab.com/3d-models/f1-2026-concept-polygon-model-ea3bde709b1e4dc9b0ec8557d106ed42) by [Qvist_designs](https://sketchfab.com/Qvist_designs), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), sourced via [BadCodesGG/interactive-f1](https://github.com/BadCodesGG/interactive-f1).
- Engine loop: OpenGameArt, CC0.
- Everything else, including the procedural fallback car and tyre-screech audio, was created for this project.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for full attribution.

## Trademark notice

GP 2026 is an original, unofficial project. It is not associated with, approved by or endorsed by Formula One Licensing B.V., the FIA, any racing series, team or circuit operator. “F1”, “FORMULA 1”, “FIA FORMULA ONE WORLD CHAMPIONSHIP”, “GRAND PRIX” and related marks are trademarks of their respective owners. Real circuit names are used only as factual geographic references for their layouts. All teams, drivers and car classes in the game are fictional.

## License

The source code is released under the [MIT License](LICENSE). Third-party assets keep their own licenses as listed above.
