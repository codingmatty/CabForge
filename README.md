# CabForge

Parametric 32mm (frameless / Euro) cabinet design in the browser. Plain PHP and JavaScript,
no external libraries, no build step.

## Screenshots

### Kitchen design in 3D

![Kitchen with shaker cabinets, appliances, and an island](docs/screenshots/kitchen-3d.png)

### Cabinet layout in 3D

![Cabinet run with base cabinets, wall cabinets, and a countertop](docs/screenshots/cabinet-3d.png)

### Part drawings

![Dimensioned cabinet side drawing with drawer-slide drilling positions](docs/screenshots/part-drawing.png)

### Sheet nesting

![Panel-saw nesting layout with part labels and sheet utilization](docs/screenshots/nesting.png)

### Materials and costs

![Materials report with sheet goods, edge banding, hardware, and cost totals](docs/screenshots/materials.png)

## How it fits together

| Path | What it is |
|---|---|
| `index.php` | App shell. Adds a file-time version to asset URLs so deploys show up immediately. |
| `api.php` | JSON API: saves projects, the shop settings (material library + construction) and the shop preferences (display units). |
| `lib/Storage.php` | JSON-file storage with atomic writes. |
| `lib/Ai.php` | Optional AI chat proxy to Anthropic or OpenAI (streams server-sent events). |
| `data/` | Saved projects (`projects/*.json`), `shop.json` and `prefs.json`. Must be writable by Apache. |
| `assets/js/engine/` | The parametric engine: specs → parts, 32mm boring, cut list. Pure functions, no DOM. |
| `assets/js/ui/` | Browser UI: sidebar, settings dialog, projects dialog, SVG elevation and part drawings, WebGL2 3D view. |
| `tests/` | Engine tests. Open `tests/` in a browser; the page title reads `PASS n/n`. |

The engine runs in the browser, so edits update instantly. PHP only stores and serves JSON.

## Deploy

Requirements: Apache 2.4 with `AllowOverride` enabled for this folder (the `.htaccess` files are
used) and PHP 8.1 or newer. Developed against PHP 8.4.

1. Copy the folder to the web server.
2. Make `data/` writable by the web server user, e.g. `chown -R www-data data && chmod -R u+rwX data`.
3. Open `api.php?action=health`. It should report `"writable": true`.

`data/` and `lib/` are blocked from the web by their own `.htaccess`. API writes require the
`X-CabForge: 1` header, which browsers won't send cross-site without a CORS preflight that the
API never grants.

**There is no login.** Anyone who can reach the URL can view and edit projects. To restrict
it, add Apache Basic Auth to this folder's `.htaccess`, for example:

```apache
AuthType Basic
AuthName "CabForge"
AuthUserFile /etc/apache2/.htpasswd-cabforge
Require valid-user
```

and create the password file with `htpasswd -c /etc/apache2/.htpasswd-cabforge yourname`.

### AI chat (optional)

The **AI chat** button appears when the server has an API key. Requests run through `api.php`
(`lib/Ai.php`), which adds the key and streams the reply; the model's tool calls run in the browser on the
open job (`assets/js/engine/aitools.js`), through the same engine code as the forms. PHP needs the curl
extension. Set these as real environment variables (Apache `SetEnv`, php-fpm `env[...]`) or in a `.env`
file in this folder or in `data/` (see `.env.example`; `.env` is git-ignored and blocked from the web):

| Variable | |
|---|---|
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | Turns the chat on. |
| `CABFORGE_AI_PROVIDER` | `anthropic` or `openai`; default: whichever key is set, Anthropic first. |
| `CABFORGE_AI_MODEL` | Default `claude-opus-5-5` (`claude-sonnet-5-5` costs half). Required for OpenAI. |
| `CABFORGE_AI_DAILY_LIMIT` | Model calls per day across the server (default 200, `0` = no limit), counted in `data/ai-usage.json`. One chat message takes a call per tool round. |

The chat has no login of its own: anyone who can reach the app can spend the key up to the daily limit, so
keep the app on a private network or behind the Basic Auth above.

The chat can add, resize, move and remove cabinets, fillers, panels and appliance spaces, set fronts and end
panels, edit walls and islands, change the job's construction settings (materials, default sizes, toe kick,
front style, reveals, countertop) and answer questions about the job and its materials and costs. Lengths go
both ways in the shop's units. Photos and sketches can be attached (pasted or dropped too); they are scaled to
1568 px and saved with the job. Each request lists what it changed and has **Undo** (until the page is
reloaded); the conversation is saved with the job (**Clear** starts over). The history is kept in the
provider's own format and only appended to, so switching provider starts a new conversation. Anthropic
requests opt into server-side fallback (`fallbacks: "default"`) when a safety classifier declines.

Tests: `php tests/ai.test.php` for the proxy.

## Construction model (defaults)

All lengths are stored in millimetres. Everything is editable from the gear button (Settings). Settings has a section nav on the
left (Shop: Units; Cabinets: Sizes & fronts, Case & base, 32mm system; Hardware: Hinges, Drawers; Materials: Sheet materials,
Edge banding; Machining: CNC router), each page a column of setting groups that scrolls.

- **Units** (Settings → Units, for the whole shop, saved in `data/prefs.json`): millimetres or inches. In inches,
  lengths show as fractions rounded to 1/8, 1/16 or 1/32 (the default), or as decimals, and anything over 36" as feet
  and inches (`4' 6 1/2"`). Length fields then take `23.5`, `23 1/2`, `23-1/2"`, `3/4`, `4' 6"`, `4ft 6in`, `600mm` or
  `60cm`; a typed size is stored exactly (23 5/8" = 600.075mm), and hovering a field shows its mm value. The cut list,
  Materials report, their CSV exports, the part drawings, the CNC settings and the G-code (G20, inches and in/min)
  follow the units. These stay in mm: material and edge band thickness, the 32mm system, hinge, slide and drawer
  settings (drawer unit, sizes, box heights), hole positions and sizes on the drawings, and the SolidCraft export.
  Edge band and countertop prices stay per metre. (`engine/units.js`)
- **Use US standard sizes for new jobs** (Settings → Units) sets the shop defaults: 24" wide cabinets, 34 1/2" base
  with a 4" toe kick (3" overhang), 30" wall and 84" tall cabinets, 23 1/4" deep bases and 11 1/4" deep walls (24" and
  12" with a 3/4" door), 24" dishwasher, 30" range, 36" × 70" fridge, 24" corner walls (12" L-corner doors) and a
  1 1/2" countertop with a 1" overhang; doors up to 24" stay single. The open job is not changed, and editing it no
  longer overwrites the shop defaults unless its construction settings change.

- Materials come from a library: name, type, thickness, colour, sheet size, grain. Stock sheets
  default to 49" × 97" (1244.6 × 2463.8mm) for melamine and 48" × 96" (1219.2 × 2438.4mm) otherwise. Construction
  picks the case, front and drawer box materials. Defaults: White melamine 16mm (case),
  Painted MDF 19mm (fronts), Baltic birch 12mm (drawer boxes). The back is cut from the case
  material and drawer bottoms from the drawer box material.
- Bottom, top and stretchers are butt-joined between the sides.
- New cabinet sizes (Settings → Sizes & fronts): width, box height and depth per type. Base 600 × 768 box
  × 610 deep (878 overall on the toe kick), wall 600 × 720 × 320, tall 600 × 2050 box × 610. Existing
  cabinets keep their sizes.
- Base box with 120mm front/rear stretchers, on a 110mm × 550mm plinth frame
  (**Separate Toe Kick (Plinth Frame)**, 60mm overhang). The base can also be a single **Toe Kick
  Board**; **Integrated Toe Kick**: base and
  tall sides run down to the floor, notched at the front (base height × overhang) with a toe-kick
  board between them at the back of the notch, the case staying at the base height (the sides' holes
  are measured from their new bottom edge; the CNC cuts the notch as part of the outline). A **toe kick
  cover** (on by default; Settings → Case & base, or per cabinet) of front material goes over the board and
  the notches, the full toe-kick height; like a filler it is banded and painted (Toe kick covers) and joins
  with the covers of the cabinets and fillers beside it into one board; or
  **None**: no toe kick, so base and tall cases stand on the floor and take the full cabinet height.
- **Countertop** (Settings → Countertop, on by default): one continuous top over each run of base cabinets and base
  fillers standing side by side at each wall or island (a corner cabinet's top runs into the corner, its return
  gets a top on the next wall; islands as above) (end panels included; cabinets within 10mm of each other in height share a top, on the
  highest), from the wall to 25mm past the fronts, 30mm thick, with an optional overhang past both ends of the run. It is
  drawn in the 3D view (Visibility → Countertop) and listed by length per run in the Materials report (priced per
  metre); it is not a part, so it stays out of the cut list, drawings, nesting, CNC and SolidCraft export.
- Cabinets and fillers standing side by side on the same base share one plinth front (or toe kick)
  and, for a plinth frame, one rear rail. A board breaks only at a cabinet edge, and only where it
  would be longer than the case material allows (sheet length less the trim at both ends, 2443.8mm on
  97" melamine). The board is listed under the cabinet it starts at. Plinth frames have a cross member
  at every cabinet edge; where two cabinets meet they share one, centred on the joint, and a filler at
  the end of a frame gets one at its open end.
- End panels (per cabinet, left and/or right) are cut from the front material and stand 22mm proud of
  the case front. They carry scribe allowances: 13mm at the rear and, on base/tall cabinets, 10mm at the
  floor, so a 610 × 880 base gets a 645 × 890 panel. Base/tall panels are notched 55mm deep × (base
  height + 10) for the toe kick, 55 × 120 by default; with the notch turned off they run full height and keep
  the scribe. Runs leave room for the panel thickness.
- Back between the sides, flush with the rear. Butt joint, or dado: let into both the bottom and
  the top on wall/tall cabinets; on base cabinets into the bottom only (butt joint at the stretchers).
- 32mm system: 5mm holes on lines 37mm from the front (plus a rear line), grid origin at half the
  case thickness.
- Full-overlay fronts: 1.5mm side/top reveals, 3mm gaps. Doors switch to a pair above 600mm.
- Fronts per cabinet: a stack of sections, top to bottom, each a **Door** (auto, 1 or 2), a **Drawer** or
  **Open**, in any order (drawer / drawer / door / drawer, door over drawer for a tall upper standing on the
  countertop…). Each takes a size in drawer units, a custom height, or fills what the sized ones leave (several
  filling sections share it). Under each section: nothing, a **stretcher** (the default under a drawer; a front rail, stretcher width deep) or
  a **full panel** in front of the back, centred on the gap; drawers over a divider ride on it. Door and open
  sections have their own adjustable shelves (system holes only in their bay) and **fixed shelves**, evenly
  spaced. Jobs saved with the older front types open as stacks.
  The case side drawings show each stretcher, full panel and fixed shelf as a centre line with its height
  from the side's bottom edge.
- **Front style** (Settings → Sizes & fronts, or per cabinet on its Fronts & shelves page): **Slab** (the default)
  or **Shaker (2-piece)**. A shaker door or drawer front is a frame cut from the front material (2 1/4" = 57.15mm
  stiles and rails, its opening cut through) with a rabbet on the back around the opening (2mm wide, as deep as the
  door panel material is thick), and a center panel of the **Door panels** material (Settings → Sheet materials;
  1/4" MDF by default) dropped into it, its back flush with the frame's. The panel is 0.5mm short of the rabbet all round, its
  corners rounded to the CNC tool's radius to fit the rabbet's. Fronts whose opening would be under the min. opening
  (60mm; a 5-unit top drawer) stay slab. Shaker frames are not edge banded; the hinge cups must stay clear of the
  rabbet. The 3D view and elevation show the frame and panel; the part drawing shows the opening and rabbet. On the
  CNC the frame lies back face up: drilled, the rabbet cleared in laps inside its outer edge, then the opening cut
  out from inside (climb, tabs and lead-in on the scrap side) before the outline; the panels nest on their own
  material and are cut on their rounded outline. Paint counts the frame without its opening, plus its inside edges.
- Edge banding is set per part type under Settings → Edge banding → Banding on parts, edge by
  edge. Defaults: fronts all round; sides, bottom/top, front stretcher, shelves and end panels on the
  front edge; fillers on both long edges; nothing else. Cut sizes drop by the band on banded edges.
- Edge bands are managed on Settings → **Edge banding**: the band rolls (colour, name, type, thickness;
  default White PVC 1mm) and the list of **edge band types** (PVC, ABS, Wood veneer, Melamine, Acrylic
  by default; add, rename and delete them). Each part type (sides, doors, shelves…) picks its band
  under Banding on parts; its thickness is the band thickness. The cut list
  shows the band length the whole job needs, per band and in total, and each row's band.
- Hinges: Richelieu RCS 322 105° clip-on, full overlay, 35mm cups 11.5mm deep, 2–5 per door by height.
  The cup boring distance K (door edge to cup edge; cup centre = K + 17.5) comes from the door
  thickness and overlay: each plate height (0/2/4) gives the exact overlay at one K
  (overlay = 12 + K − plate), and the K nearest the preferred one (5) that the RCS tables say the door
  can swing open at wins. Thicker doors need a smaller K. A fixed K can be set instead. Each hinge is centred between two 32mm grid holes; its mounting plate screws into those two
  holes on the 37mm line (16mm above and below the hinge).
- Drawers: Richelieu 818 EVOLUTION undermount slides, 550mm by default (270–550 available; shallow
  cabinets drop to the longest that fits, needing slide + 3mm inside depth). Drawer length = slide − 10,
  inside width = cabinet inside width − 42, drawer material up to 16mm. Sides are 100 or 200mm, the
  tallest that fits under the front (front − 50). The bottom is raised 12mm and runs from the front of the
  box to the back; the sub-front stands on the bottom and the back runs down past it (100mm box in 16mm
  material: 12 + 16 + 72 at the front, back 88).
  Both sides get the slide's screw holes: two rows 26 and 38mm above the base of the slide, at the
  818 EVOLUTION positions for that slide length (37, 69, 165mm from the front, then 197–339mm depending
  on length). The drawer bottom rides 28mm above the base of the slide, so the lowest drawer's slides
  stand on the cabinet bottom. System holes stop below the drawer in drawer-over-door cabinets.
- Drawer fronts are set **In Units** by default (or Equal heights): a new stack of three or more
  drawers starts with a 5-unit top drawer (Settings → Drawers → Drawer sizes → Top drawer; 0 = even) and the rest
  share what's left, the extra going to the bottom (5 / 9 / 10 in a base; two drawers stay even). A
  unit is 32mm by default; a front n units tall is
  n × 32 less the 3mm gap (5 units 157, 9 units 285, 10 units 317), stacked from the top, so a 768 box
  holds 24 units. Settings → Drawers → **Drawer sizes** lists the sizes and the drawer box (side
  height) each one takes (5–7 units 100mm, 8–12 units 200mm by default). In the cabinet dialog each
  drawer picks a size; units left over stay open at the bottom (**Bottom drawer fills** takes them up).
  A drawer-over-doors drawer can be set in units too.

## Room, corners and islands

- **Plan** (view tab) shows the room from above, with the room editor beside it. **Walls** run one after
  another: wall 1 left to right, each next wall turning 90° at the end of the one before, at an **inside
  corner** (the usual kitchen corner) or an **outside corner** (a jog out). **Islands** stand anywhere (X, Y: the
  top-left corner of their cabinets in the plan, Y from wall 1), facing 0/90/180/270°; changing the facing spins the
  island in place, and each row fills left to right in the plan (top to bottom at 90/270°) in list order: a **single run** or **back to back** (two rows under one top), with a seating
  overhang at the back of the top (past the back row's fronts on a back-to-back island; 300mm) and an end overhang
  past both ends (0). (`engine/room.js`)
- Every cabinet stands at a wall or island (cabinet dialog → Size & position → Wall / island). The sidebar
  groups the cabinets by wall and island; new cabinets go to the highlighted one, and dragging a cabinet
  among another wall's cabinets moves it there. Runs (base, wall, tall) lay out per wall or island.
  **Elevation** shows one wall or island at a time (tabs above the drawing).
- **Corner cabinets** (+ Corner base, + Corner wall) stand in the corner at the end of their wall and return
  along the next one; that wall's runs start after the return. A corner stands off both walls so its fronts line up
  with the run (a 590 corner base among 600 deep cabinets stands 10 off: room for an uneven corner); its **Off the
  walls** setting can change that. A wall with a corner cabinet at its end lines its
  cabinets up from the corner (right to left, still in list order) unless a corner returns onto its start; each
  wall's **Line up from** (Plan view) can force its start or its end instead.
- **Spaces** (**+ Other ▾**: Space 600, Dishwasher 610, Range 762, Fridge 914 on the tall run; these start sizes
  are in Settings → Sizes & fronts → Appliance spaces, a blank height or depth being the run's) keep room in a
  run for an appliance: nothing is made for them, they show dashed in the plan and elevation, and a base run's
  countertop runs over a space (dishwasher) or stops at it (range), set per space. The 3D view sketches the appliance in a
  Dishwasher, Range or Fridge space, sized to it (`engine/appliance.js`; Visibility → Appliances hides them). Their back corner is cut off at 45° (50mm
  along each wall) so they clear an out-of-square corner, closed by a narrow back. (`engine/corner.js`)
  - **Corner base**: L-shaped, 590mm deep, a door on each leg (300 × 300 door openings by default, set per
    cabinet), the return's door tucking behind the first in the inside corner; L-shaped bottom, top and
    shelf; a toe-kick board under each leg. 913.5 along its wall × 891.5 along the next with 19mm doors.
  - **Corner wall**: 600 × 600, as deep as wall cabinets, with one door on the 45° diagonal (393mm with
    320-deep legs and 1.5 reveals; use a 45° hinge plate); five-sided bottom, top and shelf.
  - Defaults are in Settings → Corner cabinets. The shaped panels are cut on their outline on the CNC, drawn
    with their edge lengths, and listed in the cut list and nesting at their bounding size. Corner cabinets
    take no end panels. The SolidCraft export leaves out their 45° parts and gives shaped panels as their
    bounding box.

## Per-cabinet construction, visibility, nesting

- The cabinet list is the wall order: drag rows (or use ↑/↓) to reorder; each run (base, wall,
  tall spanning both) is laid out left to right in list order. **+ Other ▾** opens a menu of Space, Filler,
  Panel, Dishwasher, Range and Fridge, at their usual width (change it in the item's settings), and
  **Room wall**, which adds a wall to the room (as + Wall in the Plan view) and makes it the current one.
  It inserts the item after the selected cabinet. A **Panel** is a finished end panel
  standing on its own in the run (beside a dishwasher, say): as wide as the front material is thick, sized,
  scribed and notched like the end panels on cabinets (its End panel page overrides those settings). A filler's **Run** (base, wall, tall) and **Place after** (start of run or any cabinet in
  that run) settings put it where it belongs. A base or tall filler takes its base (type, height, overhang)
  from the cabinet it follows, or the next one at the start of a run, so there is no toe kick beside a cabinet
  without one; the filler's own Construction settings still win: a strip of front material flush with the doors, with a plinth
  front on base/tall runs. Reordering, inserting or deleting re-lays the wall, closing gaps.

- **Paint** (Settings → Paint; in the Materials report and its cost): the painted area of the built parts — for
  each part type (doors & drawer fronts, fillers, end panels, standing panels, case sides, shelves, toe kicks) not
  painted, one face or both, and optionally its edges (perimeter × thickness). Each product (default Sealer 1 coat,
  Primer 2, Top coat 3, all 350 ft² per gallon at $99 / $99 / $131) takes area × coats ÷ coverage, bought in whole
  units; the report shows what is needed, what to buy, the cost of what is used and the cost bought. (`engine/paint.js`)
- A standard sizes reference (6″ 152, 9″ 229, 12″ 305, 15″ 381, 18″ 457, 21″ 533, 24″ 610, 30″ 762, 36″ 914 mm) sits under
  the size fields on a cabinet's Size & position page and under New cabinet sizes in Settings.

- The gear at the end of a cabinet row (or a double-click on the row) opens the cabinet dialog. Like Settings it has a
  section nav on the left: **Size & position**, **Fronts & shelves**, **Case & base**, **Materials** and **End panels**
  (for a filler: Filler, Materials, Base; for a panel also End panel). Each page holds the cabinet's own settings and, below them, the job
  construction settings that page covers (reveals and drawer slides on Fronts, back and base on Case & base…), which
  override the job for that cabinet only: overridden fields are highlighted with a ↺ reset, each nav item counts its
  overrides, the gear turns blue, and **Reset n to job settings** at the foot of the nav clears them all.
  ‹ › and the cabinet picker in the dialog header step through the cabinets without closing it.
- **Part drawing** of a left or right side is a shop drawing of its inside face, standing up: hinge
  plate, slide and system holes dimensioned by ordinates from the bottom and front edges, the
  bottom/top/back shown dashed, and a hole table. **Print drawing** prints just the drawing (any part).
- **Visibility** (3D view) hides part groups, the countertops or the room's **walls** (drawn 100mm thick up to
  the ceiling height set in the Plan view, 2400 by default, in the wall colour set there), or shows only the selected cabinet; the checkboxes
  in the parts table hide single parts. The selected cabinet is tinted blue with blue edges in 3D (its selected
  part orange); spaces show as an outline. Clicking the selected cabinet again (in the list, plan or elevation) or Esc clears the selection
  for a clean view to share; picking a cabinet selects it again.
- **CNC** (after Nesting) machines the parts picked in its part list (saved with the job) on a GRBL
  router: they are nested per material on the stock that fits the table (49" × 49" by default),
  drilled face up and cut out with one end mill (5 mm by default), and each sheet downloads as a
  `.nc` program. X0 Y0 is the stock's front-left corner and Z0 the top of the material. Holes the
  tool's size are plunged, or with **Peck drilling** on drilled in pecks (3 mm by default) with a
  full retract after each (clears the chips) or a chip break (backs off 0.5 mm); bigger holes (hinge
  cups) are bored in a helix. Outlines
  are cut outside the part in depth passes with rounded corners, climb or conventional: the tool
  ramps down along the outline (each pass from the last depth, the last ramp cleaned up at full
  depth) instead of plunging, comes onto and off the outline on a small tangent arc (2 mm), and on
  the passes below the tab top rises over triangle tabs (one slope up and down, the same triangle on
  every pass; square tabs optional). Hole positions are measured from the cut edges (before
  banding), and each side lies with its inside face up, so the left and right sides come out as
  mirror images. The CNC view picks the parts and turns operations on and off; table, stock, tool,
  feeds and speeds, heights, tabs and entry are in **Settings → CNC router** (part of the construction, so
  they become the shop's). **Dados** (the back's rabbet in the bottom and top) are cleared from
  the top after drilling, back and forth a stepover apart (40% of the tool), ramping in, with the
  passes running out through their open edges; through notches (the end panels' toe kick) make the
  cut-out follow the notched outline, the inside corner keeping the tool's radius.
- **Export SolidCraft** (3D view) downloads the whole job as a `.solidcraft` design (plain JSON,
  format `solidcraft/28`, for [SolidCraft](https://github.com/tangency-labs/solidcraft)): a
  component per cabinet holding a component per part, each a box body with its dadoes cut out and
  its drilling as Hole features (one per kind of hole, at the points of a sketch on the drilled
  face). Every cut names only its own part's body. Each part's material, finished and cut size,
  edge banding, grain and drilling are its component's properties, which SolidCraft's bill of
  materials reads. SolidCraft is Z-up: the fronts face −Y.
- **Nesting** optimizes the sheet layout per material: fewest sheets first, then the leftover
  gathered into one large offcut. *CNC router* mode nests freely (MaxRects); *Panel saw* mode
  produces guillotine layouts that cut apart with straight edge-to-edge cuts. It tries six part
  orders against every placement rule, then refines the best plan with a seeded random search
  (Quick / Normal / Thorough), in a Web Worker (`engine/nest.worker.js`). Plans are repeatable:
  the same job always nests the same way. Each sheet shows numbered parts, % used, the largest
  offcut (≥ 100mm) and a layout plan (part, cabinet, size, X/Y, rotation). Grain materials never
  rotate parts: tick **Follow grain** on a material in the nesting view (or *Has grain* in Settings).
  **Group identical parts** (on by default) also tries same-size parts as strips laid side by side, so one
  cut frees a row of them, and keeps that layout whenever it needs no extra sheet; grouped parts are
  numbered consecutively. Print prints the sheets with their plans.
- **Materials** lists what the job needs to buy (`engine/supplies.js`): sheets per material (from the
  nesting plan), edge banding per band, countertop length per run, and hardware — hinges and mounting plates (one per hinge),
  drawer slides in pairs by length, and shelf pins (4 per shelf). Export CSV or Print.

Part-local coordinates: `x` along the length (grain), `y` across the width, `y = 0` is edge L1
(the front edge of case parts). Cabinet space: `x` left→right, `y` up, `z` back→front.
