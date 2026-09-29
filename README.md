# Brethren of the Coast — Caribbean, 1716

An open-world Golden Age of Piracy game that runs in the browser. Sail a period-accurate
Jamaica sloop out of Nassau (the "Republic of Pirates"), raid the wrecks of the 1715 Spanish Plate
Fleet, take prizes, trade, dig for buried treasure, and fight your way up to a duel with a Royal
Navy fourth-rate. It plays like an open-world crime game with notoriety, pirate hunters and
free-roaming ports, but at sea.

Everything is procedural: no downloaded art or sound. The islands, towns, ships, characters,
textures, music and sound effects are all generated in code at load time.

## Play

- **In the cloud:** every push runs the **Build & Deploy** GitHub Actions workflow
  (`.github/workflows/deploy.yml`). It builds the game with Vite and:
  - uploads the built site as a downloadable artifact (`brethren-of-the-coast-web`) on every
    branch and PR, and
  - deploys to **GitHub Pages** from the default branch, or from any branch when you run the
    workflow manually from the Actions tab.
  
  One-time setup: in the repository, open **Settings → Pages** and set **Source** to
  **GitHub Actions**.
- **Locally:** `npm install`, then `npm run dev` and open the printed URL. Run `npm run build`
  to produce a static site in `dist/` that you can host anywhere.

You need a browser with WebGL 2 (current Chrome, Edge, Firefox or Safari). A desktop with a
keyboard and mouse is recommended. The graphics quality preset (Low / Medium / High) is picked
automatically and can be changed under Settings.

## Controls

| At the helm | |
|---|---|
| `W` / `S` | Make / shorten sail (furled, half sail, full sail) |
| `A` / `D` | Helm to larboard / starboard |
| Mouse, wheel | Look around, zoom |
| Left click | Fire the broadside on the side you are looking at. The dashed arc shows the fall of shot; look lower or higher to change the range |
| `Q` / `E` | Fire the larboard / starboard battery |
| Right click (hold) | Spyglass |
| `1` `2` `3` | Load round shot (hulls), chain shot (sails) or grape shot (crew) |
| `F` | Board a prize that has struck her colours, dock at a port, or row ashore |
| `G` | Switch between the Jolly Roger and false British colours |
| `R` | Drop or weigh anchor |

| Ashore | |
|---|---|
| `WASD`, `Shift`, `Space` | Walk, run, jump |
| Left click | Cutlass (click again to combo) |
| Right click + left click | Aim and fire your brace of flintlock pistols |
| `E` | Enter the tavern, merchant, shipwright or governor; talk; dig; loot |
| `F` | Return to your ship |

`M` opens the sea chart (click a discovered port to fast-travel), `Tab` opens the captain's log,
and `Esc` pauses.

## Features

- **Seas:** an ocean made of Gerstner waves, computed identically on the GPU and the CPU so ships
  ride the actual swell. It has foam crests, shallow turquoise reefs, shoreline surf, sun glitter
  and subsurface light.
- **Weather and time:** a full day/night cycle with sun, moon, stars and a milky way, plus
  procedural clouds. Trade winds shift over time, and squalls bring rain, lightning, thunder and
  heavy seas.
- **The West Indies of 1716:** New Providence, Cuba, Jamaica, Hispaniola, Tortuga, the Florida
  Keys, Andros, Eleuthera, the Caymans and more. They carry jungle, palms, beaches and reefs.
- **Four living ports:** Nassau (pirate), La Habana (Spanish), Port Royal (British) and Cayona on
  Tortuga (French). Each is built in its own colonial style: Spanish grid towns with plazas,
  English Georgian brick, and Nassau's thatched shanties and ruined fort. Ports have forts that
  fire on wanted captains, piers, markets, and townsfolk and guards in period dress.
- **Ships of the period:** Jamaica sloop, brigantine, Dutch fluyt, sixth-rate frigate, Spanish
  galleon and fourth-rate man-of-war. Rigs are period-correct, including gaff sails, square
  topsails, a lateen mizzen and a spritsail. The ship's wheel is shown only on larger ships.
  Sails billow, brace to the wind, furl, and tear under fire. Hulls carry white-stuff bottoms,
  gunports, stern lanterns and wakes.
- **Sailing model:** the wind drives the ship through the points of sail, and rigs can be taken
  "in irons". Ships make leeway, heel, run aground on reefs, and handle differently by rig.
- **Naval combat:** broadsides of round, chain and grape shot, with ballistic arcs. Hull, sail and
  crew damage are tracked separately. Ships can catch fire, blow up their magazines, strike their
  colours, be boarded, or be taken as your new flagship. Sinking ships leave floating plunder.
- **Notoriety:** per-nation "wanted" levels (skulls). Navies turn hostile, forts open fire, and
  pirate hunters are dispatched. Heat fades while you lie low, or you can buy a pardon.
- **Economy:** twelve colonial trade goods whose prices shift by port and by day. You can hire
  crew, repair, refit (heavier guns, doubled planking, better canvas) and buy new ships.
- **Story campaign:** *The Silver of the Plate Fleet*, five missions with Benjamin Hornigold.
  They run from your first sloop to the wrecks of the 1715 Flota, the Havana treasure galleon and
  a showdown with HMS Scarborough. On top of that there are repeatable tavern contracts (bounties,
  deliveries) and treasure maps.
- **Ashore:** third-person exploration with cutlass and flintlock combat. Guards react to crimes,
  and you can loot and dig for treasure.
- **Presentation:** a physically based renderer with ACES tone mapping, bloom, shadows, a
  painterly colour grade and a parchment sea chart. A procedural score (sailing jig, battle drums,
  tavern tune) plays alongside 3D positional sound; distant cannon fire arrives after its
  light-travel delay.
- **Saving:** progress auto-saves when you dock or rest, and saves are kept in your browser's
  local storage.

## Character models

People are realistic, fully rigged characters assembled at runtime from Quaternius' CC0 *Universal
Base Characters*, *Modular Character Outfits* and *Universal Animation Library*. All three share one
65-bone skeleton, and the animation set is motion captured. Each character is built from a head, an
outfit (recoloured into red, blue or white coats for British, Spanish and French soldiers, or a
crimson coat for the captain), hair, beard and a period hat (tricorne, bandana, straw hat or bonnet),
with a varied skin tone. The web-ready GLBs in `public/models/humans/` are produced by
`node tools/build-humans.mjs <folder with the extracted packs>`.

You can override any role with your own rigged glTF/GLB. Put the file in
`public/models/characters/` and list it in `public/models/characters/manifest.json`:

```json
{ "roles": { "captain": "MyCaptain.glb", "pirate": ["Pirate1.glb", "Pirate2.glb"] } }
```

Roles: `captain`, `pirate`, `pirate_female`, `soldier_britain`, `soldier_spain`, `soldier_france`,
`soldier_pirate`, `townsman`, `townswoman`, `sailor`, `merchant`. Clips are matched by name. If no
models are present, the game falls back to its own procedural rig.

## A note on history

The setting is real: the 1713 Peace of Utrecht, the wreck of the 1715 Plate Fleet off Florida,
Nassau's pirate republic, Benjamin Hornigold and HMS Scarborough. The flags and uniforms are the
ones in use then: the 1707 Red Ensign, the Spanish Cross of Burgundy, the white ensign of the
French navy and the Dutch tricolour. The captain and the story are fiction.

## Project layout

```
src/
  core/      noise, procedural textures, input, procedural audio & music
  world/     terrain & islands, ocean, sky, weather, vegetation, towns, geometry batching
  entities/  ship models, ship physics & AI, projectiles, effects, characters & NPCs
  game/      data (geography, ships, goods), save state & economy, missions
  ui/        HUD, minimap, sea chart, shops & menus
  game.js    orchestration and game rules
```
