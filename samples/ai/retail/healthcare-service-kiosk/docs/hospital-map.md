# 🗺️ Hospital Map

How to change the floor plan behind Indoor Navigation: rooms, corridors, floors, lifts and
escalators, and the records that point into it. What the feature does is in the
[README](../README.md#indoor-navigation). Code paths are relative to `healthcare-service-kiosk/frontend/`.

- [Where the map comes from](#where-the-map-comes-from)
- [Changing it, step by step](#changing-it-step-by-step)
- [Common changes](#common-changes)
- [Ids and names the kiosk relies on](#ids-and-names-the-kiosk-relies-on)
- [What the build and the tests check](#what-the-build-and-the-tests-check)
- [Putting the change live](#putting-the-change-live)
- [A different building](#a-different-building)

---

## Where the map comes from

| File | Role |
|---|---|
| `scripts/build-hospital-map.mjs` | **The source.** Floors, rooms, corridors, lifts and escalators as tables and a few functions |
| `public/maps/hospital.json` | **Generated** by `npm run map:build`. Never edit it by hand: the next build overwrites it |
| `public/maps/map.schema.json` | The JSON format the routing engine reads |
| `src/hospital/data.ts` | Departments (`DEPARTMENTS`) and wards (`WARDS`), each naming its room on the map (`place`), its `floor` and written `directions` |
| `src/hospital/wayfinding.ts` | Links the map to the hospital data: facilities, search, the kiosk's own spot |
| `src/hospital/place-badges.ts` | The icon each place wears on the 3D map |

The browser loads `/maps/hospital.json` for the 2D and 3D views. The server reads the same file
for chat replies (`src/hospital/wayfinding.server.ts`) and keeps it in memory until it restarts.

Coordinates are in metres: `x` runs east and `y` runs north. Every room is a rectangle
`[x0, y0, x1, y1]`, every floor is 4.5 m high (`STOREY`), and the four blocks sit inside the
footprints in `FOOTPRINT`.

## Changing it, step by step

From `healthcare-service-kiosk/frontend/`:

1. Edit `scripts/build-hospital-map.mjs`.
2. Rebuild the map:

   ```bash
   npm run map:build
   ```

   It prints what it wrote, for example `7 levels, 358 rooms, 7 points, 489 nodes, 586 edges`.
   Running it on an unchanged script reproduces `hospital.json` byte for byte, so a diff shows
   only your change.
3. Check the map. This needs no kiosk server and takes a few seconds:

   ```bash
   npm run test:ui -- wayfinding -g "map data"
   ```

4. Fix what the tests report, usually a department's or ward's `place`, `floor` or
   `directions` in `src/hospital/data.ts` (see [Move a department or ward](#move-a-department-or-ward)).
5. Restart the kiosk (see [Putting the change live](#putting-the-change-live)) and commit the
   script, `hospital.json` and any `data.ts` changes together.

> Edit the script under `scripts/`. The copy under `.next/standalone/scripts/` is build output:
> it is gitignored, nothing reads it, and the next build replaces it.

## Common changes

### Move the kiosk

This needs no map change. Set `wayfinding.start` in `config.yaml` to a place id, or set it on
`/settings`, then restart. An id that is not on the map falls back to the map's default start,
`a-l2-information-counter`, without an error, so look up the id in `hospital.json` first. The
written `directions` in `data.ts` stay as routes from the default start, which is what the tests
check.

### Rename, resize or swap rooms on a floor

Rooms are listed per block and floor:

| Table or function | What it holds |
|---|---|
| `A_SOUTH`, `A_NORTH` | Block A's rows south and north of its two corridors, from x = 60 eastwards |
| `A_CORE` | Block A's core round the lifts: `nw`, `se`, `ne`, `west`, `east` |
| `B`, `C` | The east and west wings: `[south row, north row]` per floor |
| `blockD()` | The emergency block, written out per floor |
| `lobby()` | The Level 2 lobby: entrance, information counter, café, ATMs |

A row entry is `[name, category, width, doorX?]`:

- Rooms sit side by side in list order.
- A `null` name leaves a gap of that width.
- The door defaults to the middle of the room's corridor side.
- Widths in a row must add up to the block's width: 72 m in Block A, 44 m in a wing. A wing's
  south row is 38 m of rooms plus its 6 m stairwell.
- `category` is one of the keys of `CATEGORIES` at the top of the script. `core` marks a
  staff-only room: it gets no badge and search skips it.

Renaming a room changes its id (see [Ids and names](#ids-and-names-the-kiosk-relies-on)). Fix
any `place` in `data.ts` that pointed at the old id.

### Add a department

1. Add its room to the right row. The `category` can be anything that fits: the kiosk gives
   every department's room the department look and name.
2. `npm run map:build`, then find the new id in `hospital.json`. For example, "Eye Clinic" on
   Level 3 of Block A is `a-l3-eye-clinic`.
3. Add a `DEPARTMENTS` entry in `src/hospital/data.ts` with `place` set to that id,
   `building: "Block A"`, `floor: "Level 3"`, and `directions: []` for now.
4. Run the map tests. The directions check fails and prints the route's steps under
   `Received`. Paste them into `directions`.
5. To give it its own icon, add it to `DEPARTMENT` in `src/hospital/place-badges.ts`.
   Otherwise its category picks the icon.

Other services read `DEPARTMENTS` too, such as Find a Doctor and specialist booking. See
[service-coverage.md](service-coverage.md).

### Move a department or ward

1. Change its `place`, its `floor` and, if needed, its `building` in `data.ts`.
2. Set its `directions` to `[]` and run the map tests.
3. Paste the steps printed under `Received` into `directions`.

The written `directions` are what the kiosk says and prints when it cannot show the map.

### Add or change a ward

A numbered ward takes its name from its level and block. Ward 5A is on Level 5 of Block A.

- Its counter is a room named `Ward 5A` with category `ward`. In Block A it is the `nw` entry
  of `A_CORE`.
- Its rooms come from `beds(prefix, first, count, width)`, for example
  `beds("5A-", 1, 16, 4)` for `Room 5A-01` to `Room 5A-16`. Room-number search ("5A-12",
  "ward 5A bed 12") only finds rooms with category `ward` whose names end in
  ` <level><block>-<two digits>`, such as `Room 5A-12` or `Private Suite 7A-03`.
- Every ward also needs a `WARDS` entry in `data.ts`, kept in step like a department's.

### Add a facility

Facilities are found by name, and the nearest one wins (`FACILITIES` in
`src/hospital/wayfinding.ts`):

| Facility | A place counts if |
|---|---|
| Restrooms | its category is `restroom`, or its name ends in `Restroom` |
| Surau | its name is exactly `Surau` |
| ATM | its name starts with `ATM` |
| Baby room | its name starts with `Baby Room` |
| Cafeteria | its id is `a-l1-cafeteria` |

A new restroom, surau, ATM or baby room with the right name joins the facility by itself. Each
facility also has hand-written `directions` in `FACILITIES` ("The surau is on Level 2…"). The
tests do not check these, so update them by hand.

### Add a point or a corridor

- A **point** is a spot rather than a room, such as an entrance or an ATM:
  `poi(level, block, name, category, [x, y], door)`.
- A **corridor** is `corridor(level, [x, y], [x, y])`. It must be horizontal or vertical.
  Junctions appear wherever corridors cross, and an end within 0.6 m of another node joins it.

Every room's and point's door must sit exactly on a corridor, or the build stops.

### Add a floor

1. Add `[id, subtitle]` to `LEVELS`, such as `["L8", "Day Surgery"]`. The order sets the
   display name: the eighth entry is "Level 8".
2. List it in `has` for each block that reaches it.
3. Give Block A rooms for it in `A_SOUTH`, `A_NORTH` and `A_CORE`. Block A is built on every
   floor, and the build stops on a floor with no entry there. Add entries in `B` and `C` for
   any wing that reaches it.

Block A's lifts stop at every floor on their own. Escalators run only on Levels 1–3
(`ESCALATOR_LEVELS` and `escalators()`). On the other floors the Pantry and Clean Utility take
the escalators' space.

Putting a floor anywhere but on top renumbers every floor above it. Every `floor: "Level N"`
in `data.ts` above it then needs updating, and the tests list each one.

### Add a lift or escalator

- **Lifts:** add `[name, landing, door]` to `LIFTS`. Block A gets a landing at that spot on
  every floor, and the landings are joined by lift edges. The 3D view turns landings stacked
  at one spot into a shaft.
- **Escalators:** see `escalators()`. Each landing's name ends in `-<U|D>-<I|O>`, such as
  `Escalator A-U-I`: up or down, and boarding (`I`) or alighting (`O`). The edges run one way. The 3D view relies
  on these names to draw the flights. See
  [README: Escalators and lifts in 3D](../README.md#indoor-navigation).

## Ids and names the kiosk relies on

- **Room and point ids** are `<block>-<level>-<name>` in lower case. The name keeps only
  letters and digits, joined by `-`, with `&` and `'` dropped. "Billing & Insurance Counter"
  on Level 2 of Block A is `a-l2-billing-insurance-counter`.
- **Repeated names** on one floor of one block get `-2`, `-3`… in build order:
  `a-l1-stairs`, `a-l1-stairs-2`. Adding a room with an existing name earlier in the list can
  therefore shift the ids after it.
- The block letter at the start of an id becomes "Block A" in search results.
- **Level ids** are `L1`…`L7`, and their names are "Level 1"…"Level 7" in `LEVELS` order. A
  record's `floor` must match its room's level name exactly.
- **The default start**, `defaultStart: "a-l2-information-counter"`, is set near the end of
  the script.
- **Badges** follow names as well as categories (`place-badges.ts`): "Accessible Restroom",
  "Surau", "Baby Room", "Cafeteria", "ATM…", "Car Park…", "…Entrance", "…Wheelchair…".
- **The tests name places** such as "Eye Clinic", "Room 5A-12", "Surau" and
  "Intensive Care Unit". Renaming or removing one of those means updating
  `tests/verify/wayfinding.spec.ts` as well.

## What the build and the tests check

| Rule | Where | What you see |
|---|---|---|
| Every door is on a corridor | build | `<id> on L2: door 98,26 is not on a corridor` |
| Each floor's outline is one piece | build | `floor outline is not one piece` |
| Every node can be reached, and every reference resolves | test `loads without issues` | The loader's list of issues |
| Every room is inside its floor, no two rooms overlap, every floor has a subtitle | test | `<id> is outside L3`, `<a> overlaps <b>` |
| Every department's and ward's room exists and is on its `floor` | test | `<id>: <place> is not on the map` |
| Written `directions` match the route | test | `<id>: regenerate directions from the map`, followed by the new steps |
| Every destination can be reached step-free (lifts and ramps only) | test | The destination's id |
| The 3D walk-through rides real escalators and lifts and never jumps a floor | test | The destination's id |
| The nearest restroom is on the kiosk's floor | test | The route's floors |

The routes in these tests start at the map's default start. The `no-gate` config used above
does not read `config.yaml`, so a `wayfinding.start` set there does not affect them. Setting
`NEXT_PUBLIC_KIOSK_WAYFINDING_START` in your shell does.

## Putting the change live

- **Development (`npm run dev`):** restart the server, because it keeps the map it loaded for
  chat replies. Then reload the kiosk page.
- **Production (`npm run start`, or a launcher's `start` script):** restart. `public/` is
  served as it is, so the map itself needs no rebuild. A `data.ts` change is code, so it does
  need one: `npm run build`, or the launcher's `--rebuild`.
- **Packaged kiosk:** rebuild the bundle. Packaging copies `public/maps/` into the package
  when it is built.

## A different building

The routing engine and the map views work with any map that follows `map.schema.json`. To
swap the hospital for another building:

1. Write the map as JSON, by hand or with your own generator, and save it as
   `public/maps/<name>.json`. Set a `defaultStart`.
2. Point `HOSPITAL_MAP` in `src/hospital/wayfinding.ts` at `<name>`.
3. Point every `place` in `data.ts` at the new map's ids. Update each `floor` and `building`,
   and regenerate `directions`.
4. Check the `FACILITIES` rules and their hand-written directions in `wayfinding.ts`.
5. Update the place names that `tests/verify/wayfinding.spec.ts` expects, then run it.
