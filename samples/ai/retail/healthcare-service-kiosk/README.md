# Hospital Concierge Kiosk

A patient self-service kiosk built from the same kit as the public-service
kiosk: identity by MyKad with a face match, or by a scanned patient card,
appointment slip or typed MRN with a date-of-birth check; document capture,
payment, and chat/voice flows. Its 19 services follow
[docs/service-hierarchy.xlsx](docs/service-hierarchy.xlsx), step by step — see
[docs/service-coverage.md](docs/service-coverage.md). How patients
identify, sign in once per visit, check in and get their queue ticket, slip or
patient card is in [docs/patient-journey.md](docs/patient-journey.md). Every
service and feature is a part you can switch off in `config.yaml` or take out of
the code — see [docs/modules.md](docs/modules.md).

| Category | Services |
|---|---|
| Patient Registration | Create Patient Record · Patient Verification · Eligibility Check |
| Appointments | New Specialist Visit · Follow-up Visit · Same-Day Check-In |
| Clinical Information | Medication Lookup · Refill Request · Lab Test Pricing · Lab Results |
| Financial Services | Estimate Procedure Cost · Outstanding Balance |
| Navigation & Help | Indoor Navigation · Way to My Appointment · Service Discovery · Find a Doctor |
| Diagnostics | Referral Validation · Medical Document Intake |
| Patient Support | General Q&A · Patient Survey |

| Path | What |
|---|---|
| `frontend/` | The Next.js + Payload app; services under `frontend/src/packs/malaysia/services/<category>/<group>/<service>/` |
| `frontend/src/hospital/` | Mock hospital information system: departments, doctors, lab tests, procedures, payers, and per-patient records derived from the ID number, with what the kiosk filed (bills paid, refills, follow-ups booked) applied on top |
| `kiosk.json` | Product name, app id, desktop data folder, studio sample id and port |
| `deployment.json` | The Edge AI Studio services each terminal mode runs, with their model and devices |
| `scripts/` | `setup.sh` `start.sh` `uninstall.sh` (+ `_win.bat`): the `common/` launchers with this kiosk selected |
| `docs/` | The source spreadsheet, [service-coverage.md](docs/service-coverage.md) (each service against it), [patient-journey.md](docs/patient-journey.md) (identification, check-in, queue, scanner setup, test documents), [modules.md](docs/modules.md) (the parts, switching them off, taking them out) and [hospital-map.md](docs/hospital-map.md) (changing the indoor-navigation floor plan) |

From the repository root:

```bash
healthcare-service-kiosk/scripts/start.sh --mock      # http://127.0.0.1:3001, no AI gateway needed
common/scripts/dev/dev.sh --kiosk healthcare --mock   # hot reload
```

This kiosk serves on port **3001** (`kiosk.json` `"port"`), so it runs side by
side with the public-service kiosk on 3000. From the repository root,
`healthcare-service-kiosk/scripts/start.sh` starts it alone; the root `./start.sh` starts it when
`./setup.sh` was told to set it up (answer `healthcare` or `all`, or
`./start.sh --kiosk healthcare` for one run). After changing the UI, run `healthcare-service-kiosk/scripts/start.sh --rebuild`
to refresh the production build, or `common/scripts/dev/dev.sh --kiosk healthcare`
for hot reload (`./setup.sh --dev --kiosk healthcare` sets it up first).
Add `--mock` to either command when working without the AI gateway.

## Parts and staff pages

`npm run modules` (in `frontend/`) lists the parts — 19 services, the assistant,
the MCP server, and the shared wayfinding, queue, booking and Q&A pieces — and
whether this terminal runs them. Switch parts off with `modules.disabled` or
`modules.only` in `config.yaml`, or at **/settings → Modules**; take them out of
the code with `npm run modules -- remove <id>` or `keep <id>…`. Details in
[docs/modules.md](docs/modules.md).

The staff pages are in every kiosk and are reached by address only, behind the
CMS admin login: **/staff** (all of them in one list), **/enroll** (the
registration desk: date of birth, portrait, card, then a printable patient
card), **/settings** (this terminal's `config.yaml`), **/mock-documents** (a
patient's test documents to download, or to present to the simulated card
reader, barcode scanner and document scanner), **/outbox** (the SMS, emails and
clinic notes the kiosk sent) and **/admin** (the CMS).
In the desktop shell, F9 or five taps in the top-right corner open them.

Chat mode is agentic: a tool-calling model reads what the patient says or taps
and drives the services through the kiosk's own MCP server (`/api/mcp`) — there
is no keyword routing. It needs a live model: under `--mock` the chat screen
only says so, so use touch mode there (the `simulated` profile starts in it).

### The lip-synced assistant

In chat mode the assistant beside the conversation is a real person: the
studio's lipsync service (Wav2Lip) streams the person to the screen over
WebRTC and lip-syncs every reply into the stream, so the voice comes out in
step with the lips — the avatar of the PMJB mall kiosk. The kiosk server
synthesizes a reply with the `voice.tts` voice a sentence or two at a time and
hands each piece to the worker, which queues them, so she starts talking after
the first sentence rather than after the whole reply. The stream connects while
the welcome screen is still up. If it cannot connect (the service is down, or
the network changed under it), the tile says **Not connected**, replies play
from the page, and it keeps retrying: it starts over after 15 s stuck
connecting, 6 s after a drop, and at once when the network changes. With
`voice.avatar` unset (or under `--mock`) there is no tile and the conversation
takes the whole width. Settings:
`voice.avatar` ([configuration.md](../common/docs/configuration.md#lip-synced-avatar-chat-mode));
the code is `frontend/src/components/chat/use-lipsync-avatar.ts` and
`frontend/src/app/api/avatar/`.

Where chat mode runs each model (`deployment.json`), chosen for a Core Ultra
with an Arc iGPU and an NPU:

| Service | Device | Why |
|---|---|---|
| Text generation (Gemma 4 E4B, llama.cpp) | iGPU | the fastest decode |
| Lipsync (Wav2Lip **FP16, batch 1**) | NPU | the NPU keeps OpenVINO off the iGPU while the model decodes (OpenVINO GPU work fails during llama.cpp decode); only batch 1 keeps the lips in time on the NPU (SyncNet LSE-C 6.3 at batch 1, 1.8 at batch 8); FP16 keeps the person's own skin tone where INT8 renders the mouth area 16–23 levels darker |
| Speech-to-text (Whisper base) | iGPU | it never runs during a decode: the microphone is paused while a reply is generated. 0.2 s a clip (0.4 s on the CPU); Whisper base on the NPU failed every transcription on the X7 358H (OpenVINO `invalid unordered_map key`). Forced to overlap a decode it still transcribed 26/26, at 0.27 s a clip, without slowing the model |
| Text-to-speech, OCR, face match | CPU | |

Measured on a Core Ultra X7 358H (Arc B390, NPU, Windows 11) against the
studio, in Edge: Wav2Lip infers a frame in 12 ms on the NPU (85 fps, 3.4× the
stream's 25 fps, so no frame generation is needed); the 868×1080 stream held
25 fps with no dropped frames or freezes, idle and talking; the first sound came
1.25 s after a reply was ready (0.5 s to synthesize its first sentence, ~0.75 s
from hand-over to sound; 6.2 s when the whole reply was synthesized first);
**Stop** silenced it within the jitter buffer. While a screen is connected, the
worker uses about half a CPU core even when the avatar is silent; with no
screen connected it uses none. The face is the worker's sample person; upload
another on the studio's Lipsync page (Avatars tab). For a kiosk with no network up,
WebRTC needs loopback on both ends, which neither the browser nor the worker
offers by default.

Information services (lab prices, directions, doctor search, hospital
information, health Q&A, feedback, procedure estimates) run without identity in
both modes. Once a patient has verified in chat, **Something else** carries the
conversation on to their next service without the card again, as touch mode's
sign-in does. A finished request leaves the microphone and the message box open:
whatever the patient says or types next carries on the same way, and the reset
countdown waits while they are speaking.

The patient UI adapts automatically to portrait or landscape displays, including
1080×1920 portrait kiosks and 768×1024 tablets. Portrait uses a stacked welcome
screen, two-column service menu and a compact assistant above the conversation.
Rotating the display preserves the current session; no orientation setting is needed.

## Indoor navigation

Indoor Navigation routes from the kiosk to a department, a ward or the nearest
facility (restrooms, surau, ATM, baby room, cafeteria). The route appears on a
2D floor plan, a stacked 3D view, or both, with turn-by-turn steps, a
walk-through and a step-free (lifts only) option. Chat mode shows the same map
as a card under the reply. In the touch flow, the service menu's "Find your
way" panel opens a route in one tap: a search box (a place, a ward, a ward
room number or a doctor's name), popular destinations, nearby facilities, the
ward numbers and intensive care units under "Visiting a patient", and a
preview of the kiosk's floor. Find a Doctor links each clinic to its route too. Way to My
Appointment finds the signed-in patient's visit today and routes to that doctor's clinic:
"take me to my appointment" starts it in chat, and the **For you** row offers it in touch
mode. A check-in finished in chat shows the map to the clinic under its ticket. The route
screen has its own search box over the map: picking a department, facility,
doctor or any room on the map (a ward room such as "Room 5A-12") re-routes in
place, and an empty box lists the popular destinations, clinics, wards and
facilities.
The routing engine is in `frontend/src/lib/wayfinding/`,
the map views are in `frontend/src/components/wayfinding/`, and
`frontend/src/hospital/wayfinding.ts` connects them to the hospital data.

In 3D the floor on show is solid and every other floor is an outline, fainter
when the route does not touch it. During the walk-through a figure walks the
route, rides each escalator flight and takes the lift car up its glass shaft;
only the escalators and lifts on the route move. Places wear icon badges
coloured by kind (`frontend/src/hospital/place-badges.ts`), and the destination
keeps its badge and a red beam on every floor.

The hospital map (`frontend/public/maps/hospital.json`) is a fictional
hospital of four blocks joined by link corridors:

| Block | Levels | What is there |
| --- | --- | --- |
| A, main block | 1–7 | Main entrance and lobby (Level 2), pharmacy, diagnostics, specialist clinics, Heart Centre, wards and ICU |
| B, east wing | 1–7 | Rehab, outpatient clinics, Bone & Joint Centre, wards |
| C, west wing | 1–6 | Women & Children: paediatrics, neonatal care, maternity, obstetrics & gynaecology |
| D, emergency block | 1–2 | Emergency Department with its own entrance, operating theatres |

Each floor of Block A has two corridors round a core of four lifts, restrooms
and stairs; escalators in the core link Levels 1–3. The wings are a single
corridor with rooms both sides. Each department in
`frontend/src/hospital/data.ts` names its room on the map (`place`).

- **Changing the map:** edit `frontend/scripts/build-hospital-map.mjs` (rooms
  are listed per block and floor) and run `cd frontend && npm run map:build`.
  `tests/verify/wayfinding.spec.ts` checks that every room stays inside its
  floor and that no two rooms overlap. Step-by-step recipes (rooms,
  departments, wards, floors, lifts) are in
  [docs/hospital-map.md](docs/hospital-map.md).
- **Where the kiosk stands:** `wayfinding.start` in `config.yaml` takes a map
  place id. The default is `a-l2-information-counter`, in the main lobby.
- **Route search:** `wayfinding.search` in `config.yaml` is `astar` (the
  default) or `dijkstra`. Both find the cheapest route, so the directions are
  the same. A\* searches toward the destination and expands fewer nodes.
  Dijkstra searches outward from the kiosk.
- **Moving a department:** change its `place` and `floor`, then replace its
  `directions` with the new route's steps. When they disagree,
  `tests/verify/wayfinding.spec.ts` fails and prints the new steps.
- **Wards:** `WARDS` in `frontend/src/hospital/data.ts` lists the numbered
  wards (Ward 4A to 7B), the intensive care units (ICU, HDU, CCU, SICU, NICU,
  PICU) and the other wards, each with its map `place`, visiting hours and
  `directions`, kept in step with the map like a department's. A numbered
  ward is named after its level and block: Ward 5A is on Level 5 of Block A,
  and its counter faces the lifts. Its rooms are numbered 5A-01 onwards, and
  "5A-12", "5a 12" or "ward 5A bed 12" finds that room.
- **Escalators and lifts in 3D:** `frontend/src/lib/wayfinding/transfers.ts`
  turns escalator landings named `<bank>-<U|D>-<I|O>` (boarding, alighting)
  into one-floor flights, and lift nodes stacked at one spot into shafts. A
  route edge that skips floors is ridden as a chain of flights. Escalator nodes
  without those names fall back to escalator edges between neighbouring floors.
