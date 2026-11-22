# Sketchfab racetrack models — drop here

Source: https://sketchfab.com/Tyler_Dave/collections/racetracks-164e6dd8e4284547b3d6c87b9fb91b6e
Licence: CC Attribution — credit "Tyler_Dave" on Sketchfab in `THIRD_PARTY_NOTICES.md`.

The Sketchfab download API needs an account token (`401 Authentication
credentials were not provided`), so the models are downloaded by hand.

## What to do

1. Open a model from the collection, log in, click **Download 3D Model** and take
   the glTF or FBX archive.
2. Save it as `public/assets/tracks/sketchfab/<track-id>.glb` (or `<track-id>.zip`
   containing a `.glb`/`.gltf`). The id is the game's circuit id.
3. Ping me and I will run the importer, rebuild the circuit from the model's
   road surface and delete the old polygon for that circuit.

## Which model maps to which circuit

| Save as | Circuit | Sketchfab model |
|---|---|---|
| `it-1922` | Monza | Autodromo Nazionale Monza Circuit 2020 layout |
| `nl-1948` | Zandvoort | Circuit Zandvoort 2023 layout |
| `be-1925` | Spa-Francorchamps | Circuit de Spa-Francorchamps 2022 layout |
| `gb-1948` | Silverstone | Silverstone Circuit 2024 layout |
| `de-1927` | Nürburgring GP | Nürburgring GP 2022 layout |
| `es-1991` | Barcelona-Catalunya | Barcelona-Catalunya Grand Prix 2023 layout |
| `it-1953` | Imola | Imola Circuit 2024 layout |
| `hu-1986` | Hungaroring | Hungaroring 2020 layout |
| `au-1953` | Albert Park | Albert Park Circuit Melbourne 2018 layout |
| `ca-1978` | Gilles Villeneuve | Circuit Gilles Villeneuve Montreal 2019 layout |
| `us-1909` | Indianapolis | Indianapolis Motor Speedway |

Eleven of the collection's models have a matching circuit in the game. The rest
(Zolder, Sachsenring, Bugatti, Magny-Cours, Daytona, the Nordschleife variants,
High Speed Ring, Monte Carlo Rally) have no circuit here yet.

## Notes on conversion

These are display models: 0.5–2 million triangles, with terrain, grandstands and
trees baked in. The importer will:

- strip everything that is not the driveable surface,
- slice cross-sections along the road to recover the centre line (the same
  segment/arc representation the rest of the game uses),
- decimate the road mesh for a web-sized asset and keep the rest as optional
  scenery.

If a model's road is not a separate, cleanable mesh the circuit cannot be
rebuilt from it, and it stays on the current OSM-derived geometry.
