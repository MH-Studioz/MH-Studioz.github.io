# Apex GP 2026

An open-wheel racing simulator built with TypeScript, Vite and Three.js. It runs in the browser and as a Windows desktop app.

**Play:** https://aravgoyal11-rgb.github.io/apex-gp-2026/

## What is in the game

- **41 real circuits** generated from GeoJSON outlines, with elevation, banking, kerbs, run-off, grandstands, marshal posts and DRS zones.
- **Three car formulas** with genuinely different physics:
  - **Apex Hybrid** — 798 kg turbo-hybrid, maximum downforce.
  - **Apex V10** — 760 kg high-revving V10, less aero, higher top speed.
  - **Apex Junior** — 620 kg entry formula, lower power and grip.
- **Garage:** team and driver identity, paint, five livery patterns, race number, visor tint, aero package, wing angles, brake bias, differential, suspension, ride height and starting compound. Everything persists locally.
- **Race Weekend:** three-lap qualifying, live timing, a starting grid, a Feature Race, and the mandatory two-compound rule with a 30-second penalty if you do not stop.
- **Quick Race** and **Time Trial** with persistent best-lap ghosts recorded at 20 Hz.
- **Pit stops:** pit-box detection, pit-lane speed limiter, tyre change, wing and brake repairs.
- **120 Hz fixed-step physics:** load-sensitive tyre grip, tyre temperatures and wear, fuel burn, DRS, ERS, brake bias, differential, suspension and banked corners.
- **Driver aids:** traction control, ABS, stability control, automatic gearbox, racing line, difficulty presets, camera modes and full remapping-free keyboard controls.
- **Synthesised audio** for engine, tyres, wind and kerbs.
- **Electron packaging** for Windows (NSIS installer and portable EXE).

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

### Windows desktop

```bash
npm run desktop:dev
npm run desktop:build
```

`desktop:build` writes the NSIS installer and a portable `.exe` to `release/`.

## Deployment

`.github/workflows/deploy.yml` builds and publishes `dist/` to GitHub Pages on every push to `main`. Enable **Settings → Pages → Source: GitHub Actions** once for the repository.

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
  ui/          menu, garage, HUD, minimap, pause, settings
electron/      desktop main process and preload
public/        circuits, car model and audio
```

## Credits

- Circuit outlines: [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits), MIT, © 2019–2025 Tomislav Bacinger.
- Car model: [“F1 2026 concept (polygon model)”](https://sketchfab.com/3d-models/f1-2026-concept-polygon-model-ea3bde709b1e4dc9b0ec8557d106ed42) by [Qvist_designs](https://sketchfab.com/Qvist_designs), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), sourced via [BadCodesGG/interactive-f1](https://github.com/BadCodesGG/interactive-f1).
- Engine loop: OpenGameArt, CC0.
- Everything else, including the procedural fallback car and tyre-screech audio, was created for this project.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for full attribution.

## Trademark notice

Apex GP 2026 is an original, unofficial project. It is not associated with, approved by or endorsed by Formula One Licensing B.V., the FIA, any racing series, team or circuit operator. “F1”, “FORMULA 1”, “FIA FORMULA ONE WORLD CHAMPIONSHIP”, “GRAND PRIX” and related marks are trademarks of their respective owners. Real circuit names are used only as factual geographic references for their layouts. All teams, drivers and car classes in the game are fictional.

## License

The source code is released under the [MIT License](LICENSE). Third-party assets keep their own licenses as listed above.
