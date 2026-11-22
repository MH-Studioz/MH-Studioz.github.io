# Third-party notices

## Circuit GeoJSON data

- **Source:** https://github.com/bacinger/f1-circuits
- **License:** MIT
- **Copyright:** © 2019–2025 Tomislav Bacinger

The dataset is included as `public/assets/tracks/circuits.geojson`. Circuit names and layouts are factual references; they are not official data and are not endorsed by any circuit operator or racing series.

## Circuit geometry from OpenStreetMap

- **Source:** https://www.openstreetmap.org/ — `highway=raceway` ways, queried through the Overpass API by `.tools/osm-import.mjs` and assembled into closed lap rings
- **License:** Open Database License (ODbL) 1.0 — https://opendatacommons.org/licenses/odbl/1-0/
- **Copyright:** © OpenStreetMap contributors — https://www.openstreetmap.org/copyright

Included as `public/assets/tracks/osm-circuits.json`. The derived database is made available under the same ODbL terms. This file supplies the detailed centre lines the game drives on; the MIT-licensed GeoJSON above still supplies names, locations and official lap lengths.

## AI driver

- **Speed Dreams — Simplix robot** — https://www.speed-dreams.net/ — GPL-2.0, © 2007–2014 Wolf-Dieter Beelitz, derived from Tim Foden's `mouse_2006`.
- **TORCS** — https://torcs.sourceforge.net/ — GPL-2.0.

`src/ai/aiDriver.ts` reimplements three parts of Simplix in TypeScript: the PID controller (`TPidController`), the speed controller (`TDriver::BrakingForceController`: a PID on the cube of the speed error) and the steering law (`TDriver::SteerAngle`: speed-scaled lookahead, yaw-rate feedback, curvature feed-forward and a P/D controller on the offset from the line), plus the ramped avoidance of `TDriver::Runaround`. No C++ source is copied; the algorithms are reimplemented against this game's car and track data, with gains rescaled to the units used here.

## Vehicle physics

- **Bullet Physics** — https://github.com/bulletphysics/bullet3 — zlib licence. The raycast-vehicle suspension and friction model (`btRaycastVehicle`, `btWheelInfo`) is the basis of `src/physics/raycastVehicle.ts`.
- **cannon-es** — https://github.com/pmndrs/cannon-es — MIT licence. TypeScript port of the Bullet vehicle used as the reference for the port above.
- **TORCS / Speed Dreams** — https://www.speed-dreams.net/ — GPL-2.0. The per-wheel slip model in `src/physics/vehicle.ts` follows the approach of the `simuv2` tyre model (separate slip ratio and slip angle, combined into one friction demand), and the track representation in `src/tracks/arcChain.ts` follows the segment (straight / constant-radius arc) model those simulators use for circuits. No source code from either project is copied; the algorithms are reimplemented in TypeScript.

## Car model

- **Title:** F1 2026 concept (polygon model)
- **Author:** Qvist_designs — https://sketchfab.com/Qvist_designs
- **Source:** https://sketchfab.com/3d-models/f1-2026-concept-polygon-model-ea3bde709b1e4dc9b0ec8557d106ed42 (distributed via https://github.com/BadCodesGG/interactive-f1)
- **License:** Creative Commons Attribution 4.0 International (CC BY 4.0) — https://creativecommons.org/licenses/by/4.0/

The model is included as `public/assets/models/car.glb` and has not been modified beyond runtime materials.

## Engine loop

- **Source:** OpenGameArt — https://opengameart.org/
- **License:** CC0 1.0 Universal (public domain dedication)

Included as `public/assets/audio/engine_loop.wav`.

## DEEP ATLAS geography data

- **Natural Earth** — https://www.naturalearthdata.com/ — public domain. River centrelines, lake outlines, country outlines and elevation points (rivers, lakes, peaks and the continent lookup) are derived from the 1:10m layers and reduced to name, coordinate and one measured metric.
- **Wikidata** — https://www.wikidata.org/ — CC0 1.0. Island coordinates and continent assignments.
- **Wikipedia, "List of islands by area"** — https://en.wikipedia.org/wiki/List_of_islands_by_area — CC BY-SA 4.0. Island areas are factual measurements taken from that table.
- **GeoNames via `all-the-cities`** — https://www.geonames.org/ — CC BY 4.0. The generated city rows come from this package's dump.

## Trademarks

GP 2026 is an unofficial, original project and is not associated with or endorsed by Formula One Licensing B.V., the FIA, any team, driver, championship or circuit operator. All trademarks remain the property of their respective owners.
