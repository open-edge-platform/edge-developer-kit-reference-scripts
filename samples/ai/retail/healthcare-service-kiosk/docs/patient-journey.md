# 🪪 Patient Identification & Visit Flow

How a patient identifies at the hospital kiosk, what they get after each kind of visit, and how
to set up the barcode scanner. Code paths are relative to `healthcare-service-kiosk/frontend/`.

- [Ways to identify](#ways-to-identify)
- [What the codes contain](#what-the-codes-contain)
- [Signing in once per visit](#signing-in-once-per-visit)
- [Check-in and the queue](#check-in-and-the-queue)
- [Bookings and appointment slips](#bookings-and-appointment-slips)
- [New patients and the patient card](#new-patients-and-the-patient-card)
- [Taking things to a phone](#taking-things-to-a-phone)
- [Messages to patients and clinics](#messages-to-patients-and-clinics)
- [Test documents and simulated peripherals](#test-documents-and-simulated-peripherals)
- [Barcode scanner setup](#barcode-scanner-setup)
- [Chat mode](#chat-mode)
- [API reference](#api-reference)
- [Design notes and sources](#design-notes-and-sources)
- [Not done yet](#not-done-yet)

---

## Ways to identify

The identity screen ("Let's find your record") lays out three numbered ways, and all of them
are live at once: **1. Scan your card** and **2. Feed in a document** as tiles on the left, **3.
Type your MRN** as a keypad on the right. The patient doesn't pick one first. The card reader, the barcode scanner and the document
scanner all listen, and the MRN keypad is already on screen. Whichever is used first wins: its
panel lights up with what was detected and the others dim. A scan, a page or a typed MRN only
**finds** the record. Nothing that names the patient appears until the second step confirms it is
them.

| Patient has | Step 1: find the record | Step 2: confirm it's them |
|---|---|---|
| MyKad or passport | Insert or tap it on the card reader | Face scan against the portrait on record |
| Patient card | Hold its barcode under the scanner | Date of birth on the on-screen keypad |
| Appointment slip (paper or a phone photo) | Hold its barcode under the scanner | Date of birth, then straight to check-in for that visit |
| A hospital letter, patient card or slip on paper | Feed it into the document scanner; OCR reads the printed MRN | Date of birth |
| A passport photo page, MyKad copy or referral letter | Feed it into the document scanner; OCR reads the ID number | Face scan, as for the card itself |
| Only their MRN | Type it on the keypad (the check digit catches typos) | Date of birth |

- **Which date of birth.** The one recorded at the registration desk (`/enroll`). A seeded demo
  patient has none recorded and is asked for the date derived from their registry key and their
  seeded age, counted to 2026 so it never moves (patient 6, who has an appointment every day:
  23 July 1988).
- **Mismatches.** A wrong date of birth gets a generic "Those details don't match our records";
  the screen never says which detail was wrong. After 3 wrong tries the record is locked for
  10 minutes and the patient is sent to the registration counter.
- **The second step.** A bar at the top says what was read: the name for a card or an ID
  number, only the MRN's last digits for a code or a printed MRN. Its **Not you?** button goes
  back to the first step. The face check shows its three stages (get in the frame, hold still,
  matching) as they happen. Without a camera, the same layout offers the camera-free check. The
  date of birth is read back in words ("23 July 1988") before **Confirm**, and a mismatch shows
  how many tries are left. Both checks end on the same **Welcome** screen.
- **No ID at all.** The screen points the patient to the registration counter.
- **Reading a page.** A printed MRN wins over an ID number on the same page. An ID number
  goes to the face check because a MyKad number has the date of birth in it. A page with
  neither gets "We couldn't find an MRN, IC or passport number on that page". The page is stored
  beside the captured documents only while OCR runs, then deleted.
- **How the document scanner notices a page.** It depends on `documents.source` and the scanner:

  | Terminal | What the patient does |
  |---|---|
  | Scanner with a paper sensor (fi-800R status tool) | Feeds the page in; it is read without a tap. After a read, the last page has to come out before the next is looked for |
  | Scanner without a paper sensor | Feeds the page in and taps **Scan my document** |
  | `documents.source: mock`, or a simulated scanner | Taps the **ID copy** demo chip (the waiting patient's MyKad or passport copy), or staff feed any page from /mock-documents |
  | `documents.source: upload`, or no OCR service | The document tile is left out and the MRN becomes way 2 |
- **Code:** `src/services/shared/steps/identity.tsx`, `src/components/kiosk/mrn-pad.tsx`,
  `src/hooks/use-paper-feed.ts`, `src/app/api/identity/{document,scan,paper,verify}`,
  `src/app/api/_lib/{barcode,identity-paper,patients,slips}.ts`, `src/hospital/patient-id.ts`.

## What the codes contain

None of the codes carries a name, an IC number or anything clinical.

| Code | Symbology | Payload | Check |
|---|---|---|---|
| Patient card | Code 128 | `MRN` + 7-digit serial + Luhn check digit, e.g. `MRN29610532` | Luhn digit; Code 128's own mod-103 check |
| Appointment slip | Code 128, across the slip's full width on screen and on paper | 20 digits: the reference as digits, then a 13-digit signature, e.g. `12612341644918059060` | 13 digits (about 43 bits) of an HMAC-SHA256 keyed on the CMS secret, so a guessed case id is not enough to make a slip |

The reference is the booking's case id or the scheduled appointment's id, written as digits:
`HCK-2026-1234` becomes `1261234` and `APT-12345` becomes `2012345`. Code 128 packs digits two to a
symbol, so the slip's barcode fits across a receipt, like the card's. A reference of any other shape,
and slips issued before the digit form, use `HCKAPT:<reference>.<signature>` with an 80-bit base32
signature. That form still scans and verifies.
Scanners that add an AIM symbology prefix (`]C0`, `]Q1`) or a trailing CR/LF are handled.

The MRN is still derived from the ID number by the mock records (`src/hospital/records.ts`),
because there is no hospital information system. A real install would issue it from a counter.

**Where the MRN reaches the patient.** As in most hospitals, the MRN is printed for the patient,
not left for them to remember. The patient card carries it as text and as a Code 128 barcode, and
the appointment slip prints it above its barcode. Scanning one of these is the main way in. The
keypad is the fallback for a patient who has only a letter or a number written down.

## Signing in once per visit

- **Ways to sign in:** scan at the welcome screen, tap **Use MyKad, a document or my MRN** there, or tap the
  **Sign in** banner on the service menu.
- **What changes once signed in:**
  - The header shows the patient's first name and last initial, with **Sign out**.
  - The menu opens with a **For you** row built from their record: check in for today's visit,
    their queue number once checked in, the way to that visit's clinic, unpaid bills, new lab
    results, refills left, a recommended follow-up, and an expired insurance policy.
  - Each later service skips its consent and identity steps. The sign-in screen shows the
    consent notice instead.
- **When the session ends:** **Finish & sign out**, **Start over**, the idle timeout, or 10
  minutes after verification (`SESSION_REUSE_MS` in `src/hooks/use-kiosk-flow.ts`), after which
  the next service asks again.
- **Other services in the same visit:** receipts and results offer **Something else**, which
  returns to the menu still signed in. Chat mode does the same: when a request ends, **Something
  else** keeps the conversation going and the next service skips the card, while **Finish & sign
  out** clears it. The microphone and the message box stay open too, so simply asking the next
  question works like **Something else**; the countdown to the reset pauses while the patient is
  speaking. The kiosk passes the sign-in along itself (`FlowResponse.signIn`); a made-up one is
  refused.

## Check-in and the queue

1. **Find the visit.** Check-in finds today's visits, both the scheduled one and anything booked
   at a kiosk for today. With several, the patient picks one; a scanned slip preselects its own,
   at sign-in or at the service's own identity step. Each appointment is checked in once, so a
   patient with two visits today checks in for each.
2. **Arrival timing.** The screen says when the patient is early (more than 60 minutes before)
   or late (more than 30 minutes after). A late arrival is flagged to the clinic. Nobody is
   turned away.
3. **Two pre-visit questions.** "Have your medicines or allergies changed?" and "Fever, cough or
   rash in the last 3 days?". The answers travel with the check-in.
4. **Queue number.** The server issues it at filing, one series per clinic per day (`P001`,
   `C002`…), one at a time and counted from every check-in filed today, so two kiosks can't hand
   out the same number and a patient already seen keeps theirs (`src/app/api/_lib/queue.ts`).
   Patient Verification issues numbers for Registration & Admissions (`R001`…) the same way.
5. **The clinic is told.** A note goes to the clinic's channel (see
   [Messages](#messages-to-patients-and-clinics)): the number, the appointment and the pre-visit
   flags.
6. **The visit is billed and prescribed.** There is no clinic console, so the visit counts from
   check-in:
   - **Outstanding Balance** lists the specialist consultation (`CONSULTATION_FEE`), so the
     patient can pay while they wait.
   - **Refill Request** offers the clinic's prescription (`VISIT_MEDICATIONS` in
     `src/hospital/data.ts`) as *new today*, ready at the pharmacy at once. Once collected, it is
     an ordinary prescription with refills.
   - Both come from the check-in case (`Ledger.visits` in `src/hospital/records.ts`), so a check-in
     put on hold takes them back.
7. **The ticket.**
   - The number, refreshed every 15 seconds: *N people ahead · about M minutes*, or *it's your
     turn*.
   - **Show me the way** to the clinic. In chat the map to the clinic comes up under the ticket,
     and a patient already checked in gets it with their number.
   - A QR that puts the number and the waiting place on the patient's phone.
   - **Pay now**, when the patient still has a bill: it opens Outstanding Balance still signed
     in, so checking in and paying are one visit. Chat mode shows the same button when the
     check-in ends, and the reply mentions the amount.
8. **The clinic board.** `/queue` is the waiting-area and clinic display: each clinic's *now
   serving* number and the waiting tickets. A dot marks tickets with a pre-visit flag. It shows
   numbers only and refreshes every 5 seconds.

There is no clinic console to call patients yet. The queue therefore advances on a clock: each
doctor in clinic today sees one patient every `KIOSK_QUEUE_VISIT_MIN` minutes (default 12). The
ticket, the board and the chat all read this one model, so they always agree.

## Bookings and appointment slips

- **Taken slots are hidden.** A slot booked by someone else is not offered in New Specialist
  Visit, Follow-up Visit or Find a Doctor (`GET /api/appointments?doctorId=`).
- **Late conflicts are held.** The slot is checked again when the case is filed. If someone took
  it in the meantime, the case is filed **on hold** with the reason.
- **Confirmed, then confirmed again.** The patient confirms the doctor, day and time before
  booking, and gets a text and an email with the appointment
  ([Messages](#messages-to-patients-and-clinics)).
- **One open booking per clinic.** A patient who already has one there is told when it is; a
  booked follow-up is not offered again.
- **Today can be booked.** The doctor's clinic times still ahead today come first, then four a
  clinic day over the next six. With `mock.clinics_always_open` (a demo setting), a
  specialist offers every half-hour left today instead, at any hour, on a day they consult. A
  same-day visit can then be booked, checked in, paid and collected in one demo.
- **Same times in both modes.** Chat offers the slots the touch picker does (`bookableSlots`):
  the first free time of each day, or, for a day and time the patient asked for, that slot or
  the four free ones closest to it. A time asked for alone ("23:30") is on the day asked for
  before it, or else the first day it is free; a doctor asked for on a day they don't consult
  is said to be off that day.
- **The receipt.** It reads *See you Tue 21 Oct at 10:30* and shows an **appointment slip**:
  doctor, clinic and place, the reference, and the signed Code 128 barcode. On the day, the patient scans the
  slip, or a photo of it on their phone, to go straight to check-in.

## New patients and the patient card

Create Patient Record is how someone with no record registers themselves, in touch or chat
mode. There is nothing to identify them against yet, so its enroll step stands where the
identity step would:

1. **Tap the MyKad.** A card that already opens a record, or an IC number already registered,
   is told so — that patient signs in with it instead.
2. **Confirm the details.** Name, IC number (last four digits only), date of birth, sex,
   nationality and address, as the MyKad chip carries them. **No, something is wrong** sends
   the patient to Registration & Admissions to finish there; so does having no MyKad.
3. **Have the photo taken.** A photo the face detector can't find exactly one face in is taken
   again. A kiosk without a working camera registers the patient without one, and the case goes
   to the counter to take it.

That creates the patient's record with the card's serial and the photo
(`src/app/api/_lib/self-enrollment.ts`): the next tap of that MyKad opens it, and the face check
has a portrait to match. The patient is signed in for the rest of the visit, and is asked for a
phone number, language and emergency contact, which are written to the record.

The kiosk reads only a card's serial — the chip's own data sits behind JPN's keys — so the
details are simulated from the serial (`mykad-chip.ts` in the service folder). The same card
always reads as the same person; its IC number carries its date of birth, state code and sex
digit the way a real one does. A stood-in read (no reader) is a new person each time, and binds
no card.

Another record with the same name and date of birth, or a missing photo, sends the registration
to the counter instead of printing a card. Otherwise it ends with a **patient card**: name, MRN
and a Code 128 barcode of the MRN.
Next time the patient scans the card instead of their MyKad. **Print** prints only the card; the
same print rule covers tickets and slips (the `@media print` block in `src/app/globals.css`).

Staff can register a patient at the registration desk (`/enroll`, behind the CMS login) instead:
it records the date of birth the kiosk later asks for, binds a card and a portrait, and shows the
same patient card to print.

## Taking things to a phone

The ticket, and the **Phone** button on the route screen, show a QR that a phone camera opens as
plain text. It holds the queue number, or the numbered walking steps. Text is used rather than a
link because a phone on mobile data cannot reach a kiosk on the hospital network. Text needs no
app and works offline. Nothing in it identifies the patient.

The chat's map card has the same **On my phone** code.

## Messages to patients and clinics

The kiosk sends a text and an email confirming a booking or follow-up, an email receipt for a paid
bill, a text when a refill is being prepared, lab results by email when the patient asks, and a
note to the clinic when a patient checks in. `notify.driver` in `config.yaml` decides where they go
(`src/app/api/_lib/notify.ts`):

| Driver | Messages |
|---|---|
| `outbox` (default) | Stay on this terminal: staff read them at **/outbox** (the last 200, until a restart) |
| `webhook` | Are posted as JSON to `notify.webhook_url` — the hospital's SMS gateway, mail relay or integration engine — and shown at /outbox, marked when delivery failed |
| `off` | Are not sent; screens don't mention them |

The patient sees where a message went with the number and address masked (`+60•••••0502`,
`n•••@demo.local`).

## Test documents and simulated peripherals

**/mock-documents** (CMS admin login) makes a registered patient's test paperwork: a MyKad copy
or, for a foreign patient, a passport copy; a referral letter; lab, imaging and discharge reports;
an insurance card that matches the policy on their record; their **patient card** with the real
Code 128 MRN; and, when they have a visit today, their **appointment slip** with its signed barcode. A
tampered set carries another patient's details, which the kiosk must reject. Print them for real
hardware, or present them to this kiosk's simulated peripherals:

| Button | What the kiosk then sees | Needs |
|---|---|---|
| **Tap MyKad / passport on the reader** | That patient's card on the reader: a waiting identity screen picks it up at once | `nfc.simulate` not `never` |
| **Scan patient card** / **Scan appointment slip** | That code at the barcode scanner | `barcode.driver: mock` |
| **Feed to scanner** (beside any document) | That page, genuine or tampered, for the next document scan, whatever the step asks for. A waiting identity screen reads it at once | `documents.source: mock`, or a simulated scanner |

Without staff feeding a page, a simulated scan is the genuine document of whoever last verified
at this terminal, generated on the spot (`src/app/api/_lib/mock-documents.ts`), so the holder
check passes for any patient. `documents.mocks_dir` names a folder of PDFs to use instead.

**Demo reset.** **/demo-visit** (CMS admin login) gets the chosen patient ready to walk a whole
visit (sign in, check in, pay) and ready again after each run. Only the **Demo reset** link in
the CMS admin nav leads there, so it stays out of sight on the staff pages. **Set up today's
visit** does three things:

- It takes the patient's check-in today out of the queue, and with it the consultation bill and
  prescription that check-in brought.
- It undoes their bill payments, so the bill is due again.
- If they have no appointment today, it books the slot nearest to now, the way New Specialist
  Visit books one (with `mock.clinics_always_open`, the next half-hour).

Cleared cases are put on hold with the staff member's name, not deleted. The panel shows the
MRN and date of birth to sign in with, and refreshes as each step lands at the kiosk. Checking
in bills the consultation, so every patient has something to pay and a medicine to collect
(`src/app/api/_lib/demo-visit.ts`).

**A same-day demo without the staff page.** With `mock.clinics_always_open: true`, a patient can
walk the whole day at the kiosk or in chat: book *a cardiologist today*, check in, pay the
consultation and collect the medicine. Doctors still keep their days, so on a weekend no
specialist can be booked for today.

## Barcode scanner setup

Configure the scanner under `barcode:` in `config.yaml`, or on the **Barcode scanner** section of
`/settings`:

| Key | Values | Default |
|---|---|---|
| `barcode.driver` | `hid`: keyboard-wedge scanner typing into the kiosk page. `serial`: USB-CDC scanner read by the server. `mock`: no scanner; the screens offer **Demo slip** and **Demo card** | `hid` |
| `barcode.device` | Serial device for the `serial` driver | `/dev/ttyACM0` |

`configs/simulated.yaml` uses `mock`; `configs/hardware.yaml` uses `serial`.

- **Hardware.** Use a 2D imager that reads phone screens, such as a Honeywell N3680 or HF680
  presentation scanner, or a Newland FM430 or FM3080 kiosk reader. The slip and the patient card
  can then come off paper or off a phone photo.
- **Scanner settings** (programmed with the vendor's setup barcodes):
  - Add a CR suffix.
  - Turn on the AIM ID prefix.
  - Turn on presentation (auto-trigger) mode and the screen-reading mode.
  - Turn off symbologies you don't use (EAN/UPC), so product packaging isn't read.
  - Set a delay before the same code can be read again.
- **`hid` (keyboard wedge).** It works out of the box. The page treats a burst of at least 6
  characters typed under 50 ms apart and ended by Enter or Tab as a scan
  (`src/hooks/use-barcode-input.ts`). Typing into a focused text field is never taken as a scan.
- **`serial` (USB-CDC / virtual COM).** This mode is recommended for production. It doesn't
  depend on page focus or keyboard layout. The server puts the tty in raw mode and reads one
  code per line, with no native module needed. On Linux:
  - Add the kiosk user to `dialout`.
  - Give the device a stable name with a udev rule.
  - Set `ENV{ID_MM_DEVICE_IGNORE}="1"` so ModemManager doesn't probe it.

## Receipt printer setup

The kiosk can print the patient card and the appointment slip on an ESC/POS thermal receipt
printer, barcode included, so the patient can scan the paper at any kiosk later.

- **Touch mode.** On the receipt screen, **Print** sends the card or slip to the printer. Any other
  receipt still opens the browser's print dialog.
- **Chat mode.** **Print my card** or **Print my slip** appears under the card or slip in the
  chat. Without a printer, neither button is shown.

Configure the printer under `printer:` in `config.yaml`, or in the **Receipt printer** section of
`/settings`. A change needs a server restart, not a rebuild.

| Key | Values | Default |
|---|---|---|
| `printer.enabled` | `false` hides every Print button on the kiosk, the browser's included, and the printer is never probed. The staff enrolment desk's **Print patient card** is not affected | `true` |
| `printer.driver` | `escpos`: the server writes ESC/POS to the printer. `mock`: printing is pretended (`configs/simulated.yaml`). `off`: Print uses the browser dialog | `off` |
| `printer.device` | `usb`: the first USB printer. Or a device path (`/dev/usb/lp0`, a Windows `\\?\USB#…` interface), part of one (`VID_0483&PID_7540`), or `tcp://host:9100` for a network printer | `usb` |
| `printer.width_dots` | Printable width: `576` for 80 mm paper, `384` for 58 mm | `576` |

`configs/hardware.yaml` uses `escpos` on `usb`. The reference hardware is the YK ET80 (80 mm,
ESC/POS, auto-cutter, USB `0483:7540`).

- **What is printed.** The page sends only the code (the MRN or the signed slip code) to
  `POST /api/print`. The server prints what that code resolves to in the registry. A forged slip
  or an MRN with a wrong check digit prints nothing.
- **The barcode.** Code 128 is drawn as a raster image, 15 mm tall, with bars 3 dots wide
  (0.375 mm). On 58 mm paper the bars are 2 dots (0.25 mm). The card's MRN and the slip's 20-digit
  code both fit across the paper: on 80 mm paper the card's code is about 46 mm wide and the slip's
  about 54 mm. A code too long for either width would be printed along the paper instead. A card or a
  slip comes out about 7 cm long.
- **Status.** Before each job the server asks the printer for its status (`DLE EOT`). Out of
  paper, an open cover or offline means nothing is sent, so the job can't print later for the next
  person. The patient is told to take a photo of the screen or ask at the counter. A paper
  near-end warning goes to the server log only. `/api/health` reports `printer` and keeps the
  result for one minute.
- **Windows.** Node can't open the USB printer interface, so a short Windows PowerShell script
  does the Win32 calls. It runs with `-EncodedCommand`, so the execution policy doesn't block it.
  No print queue or vendor driver is needed: the in-box "USB Printing Support" driver is enough.
- **Linux.** The `usblp` module provides `/dev/usb/lp0`. Add the kiosk user to the `lp` group.
  The paper status can't be read there.
- **Text.** The printer's built-in font is ASCII. Accents are dropped from names, and any other
  character prints as `?`.

## Chat mode

- **At the card step.** The assistant names every way in: the card, a patient card or slip under
  the scanner light, a page in the document scanner (when this terminal has one), or the MRN.
  All of them are live while the step waits. Under `hid`, a scan counts as presenting the code. A
  page fed in is read as on the touch screen. **Type my MRN** opens the same keypad and holds the
  step's no-reader timer while it is open.
- **After a scan.** The assistant says it has read the card or slip and asks for the date of
  birth instead of a face scan. It never names the patient before the date of birth matches.
  The date of birth is never saved into the draft.
- **Scanning a slip at the welcome screen.** This opens the chat with "I'd like to check in for
  my appointment". The scanned code waits at the server for up to 60 seconds for the identity
  step.
- **The way to today's appointment.** "Take me to my appointment" (or my booking, or my doctor)
  starts Way to My Appointment. After the card, the kiosk names the doctor, the time and the
  clinic, says whether the patient has checked in, and shows the route on the map card. With
  two visits today it asks which one first. It only shows the way: checking in is still
  Same-Day Check-In, one sentence away.
- **The agent knows the whole kiosk.** With `agent.turns: single` (the default), the system
  prompt carries every service's steps, fields and accepted values (the clinic ids and the
  specialists' names, days and languages among them), and the model has only the two flow tools.
  It starts the service the patient names right away, with whatever they already said, and the
  flow asks for the rest.
- **Saying it all at once.** "Book me with Dr Lim on Thursday at 10" starts New Specialist Visit
  with the doctor, day and time as `answers`. "I want to see a cardiologist today" starts it with
  `department: "cardiology"` and today's date. They wait on the flow (`heldAnswers`) through the
  card and face scan, then go into the draft, so the next question is the first one still open:
  - The name is matched loosely (`doctorsCalled`): one match also settles the clinic; several are
    asked about, with their clinics; none is said, and the department question follows.
  - A clinic and a day without a doctor offers only that clinic's doctors free that day, and
    settles the doctor when only one is.
  - A free slot goes straight to *Book Dr. Lim Wei Jie (Cardiology) on Thu 5 Nov at 10:00?*.
    Otherwise the reply says why (taken, not a clinic day, too far ahead) and offers the four
    free times closest to it.
  - A day or time asked for at the slot question works the same way. The agent's prompt carries
    today's date and the next two weeks (`{{calendar}}`), so "Thursday" becomes a date by lookup.
  - Follow-up Visit takes a day and time the same way; Find a Doctor takes a name, specialty or
    language.
- **Several services in one sentence.** "Check me in, then I want to pay my bill" is still one
  model call: `start_service_flow` for the first service, with the rest in `then`, each carrying
  its own answers ("where's radiology, and book me a cardiologist on Wednesday" queues New
  Specialist Visit with the clinic and the date). The flow comes back with them as `queued`:
  - The chat route carries the queue on every flow it writes, as it does the sign-in, and a
    `[kiosk]` line tells the model what is waiting so it does not start them itself.
  - When a flow ends, completed or failed, the route starts the next queued service inside the
    same tool call and returns it under `next`. The model relays both in one reply. The next
    service goes out with the sign-in the last one earned, so the card is read once.
  - A look-up that finishes at once (prices, directions) leads straight into the next service in
    the same turn. A service that waits on the patient starts its queued one only when it ends.
  - A `continue_service_flow` call can add a service in `then` too. It only adds services not
    already waiting and not the one in progress, since the model tends to repeat the queue it
    was shown. Starting a different service replaces the queue.
  - At most three services wait; unknown service ids are dropped.
- **Filed results in the reply.** After filing, the reply includes the queue number and wait,
  the slip reference, or the new MRN (`ChainSpec.filed`).
- **What the patient takes away.** A filed case's receipt card shows the same ticket, slip or
  patient card the touch receipt does (a service's `steps/takeaway.tsx`), and a finished look-up
  — prices, medications, results — shows its result card, so the facts never rest on the
  model's wording alone.
- **No card for public services.** Lab prices, estimates, directions, hospital information,
  doctors, health questions and feedback run without identifying, as in touch mode.
- **Signed in for the visit.** See [Signing in once per visit](#signing-in-once-per-visit).
- **My Requests** accepts a scanned card or slip with the date of birth, as the services do.

## API reference

| Route | What |
|---|---|
| `GET /api/identity/document?watch=1` | Long-poll: a card read, a scanned code or a page read at `/api/identity/paper`, whichever comes first; `204` when none arrives within 25 s. Without `watch`, a page or scan read in the last minute, else the card reader, standing a citizen in when the reader is simulated |
| `POST /api/identity/scan` | `{code}` from a wedge scanner or the MRN keypad, or `{simulate: "card" \| "slip"}` under the `mock` driver |
| `GET /api/identity/paper` | `{mode}`: `sensor`, `button`, `simulated` or `off`. With `?watch=1`, a long-poll that returns `{fed: true}` once a page is in the feeder, or `204` after 25 s. `&rearm=1` first waits for the last page to come out |
| `POST /api/identity/paper` | Scans the page and runs OCR on it, then hands the record it names to `/api/identity/document`: `{found: "mrn" \| "id"}`. A `404` with a `reason` (`nothing_to_scan`, `blank`, `no_identifier`, `unregistered`) means the patient can try again; a `503` means OCR or the scanner is down |
| `POST /api/identity/verify` | `method: "dob"` with `dateOfBirth: "YYYY-MM-DD"`; `401` on a mismatch, `429` once locked |
| `GET /api/identity/card?handoff=1` | The chat's card step: the card it sees is the one the next identity read takes, so a tap that is over before that read still counts |
| `GET /api/enroll/card?watch=1` | Registering: a MyKad on the reader within 25 s, read as a new patient — `{token, details, lines, simulated}`, `204` when none comes, `409` (`reason: "registered"`) for a card or IC number that already has a record. Without `watch`, the card the chat's step saw, else the reader, standing a MyKad in when the reader is simulated |
| `POST /api/enroll` | `{token, image?}`: creates the confirmed patient's record with the photo and card serial and answers like `/api/identity/verify`; `400` with `reason` `no_face` or `several_faces` asks for the photo again, `404` `expired` for the card again. `DELETE ?token=` drops a read the patient said is not theirs |
| `GET /api/appointments?documentNumber=` | Today's visits and today's check-in |
| `GET /api/appointments?doctorId=` | That doctor's booked slots |
| `GET /api/queue` | Every clinic's queue today, numbers only |
| `GET /api/queue/ticket?department=&number=` | People ahead, wait in minutes, now serving |
| `GET /api/barcode?type=qr\|code128&text=` | SVG barcode (bwip-js) |
| `GET /api/modules` | Which parts this terminal runs, `{ "<id>": true \| false }` — see [modules.md](modules.md) |
| `GET /api/ledger?documentNumber=` | What the kiosk's filings changed on the record: paid invoices, dispensed refills, a booked follow-up. Only for the patient who verified at this terminal |
| `GET /api/lab-tests?q=` | The lab tests the patient's words could mean, by catalog search and then by the model |
| `POST /api/labs/email` | `{documentNumber}`: the latest results, explained, to the email on the record. Only for the patient who verified here |
| `GET/POST/DELETE /api/staff/mock-documents/present` | Staff: what the simulated peripherals accept; tap a card, scan a code or feed a document; empty the feeder |
| `GET/POST /api/staff/demo-visit?citizen=` | Staff: where a patient's visit stands today (appointments, check-ins, bill due); `POST {citizen}` sets up the visit again |
| `GET /api/staff/outbox` | Staff: the messages this terminal sent |

## Design notes and sources

- **Scan, then a second identifier.**
  - Joint Commission NPSG.01.01.01 and WHO Patient Safety Solution 2 require two identifiers.
    A barcode is one identifier anyone can carry.
  - NHS UHB and Sussex, Oracle Health, Patients Know Best and Royal Children's Melbourne kiosks
    all find the record by a letter barcode or card, then confirm with the date of birth.
- **One screen, every method live at once.** Precedents: Hong Kong Hospital Authority kiosks
  (HKID, slip or prescription), QMed Asia kiosks in Malaysia (MyKad or QR), and the
  scan-or-type patterns in Singapore Airlines, Lyft and CVS "Let's confirm it's you" (Mobbin).
- **Opaque, signed slip codes.** These follow SMART Health Links' "pointer, not data" approach.
- **Ticket and booking screens.**
  - The live position and next action follow Chick-fil-A's wait card and Flighty's
    gate-and-countdown.
  - The *See you …* headline follows Warby Parker and Zocdoc.
  - The **For you** row follows CVS's visit checklist.
- **Scanner modes.** Zebra and Newland documentation describes the HID-KBW, CDC and HID-POS
  modes. The 30 ms per character timing comes from the onScan.js defaults.
- **No camera decoding in the browser.** The browser's `BarcodeDetector` isn't available on
  Linux desktop Chromium, so the dedicated imager is the primary path.

## Not done yet

- **A real SMS and email gateway.** Messages go to the outbox, or to whatever
  `notify.webhook_url` names; no gateway client ships with the kit.
- **Camera QR decoding.** A fallback that decodes codes with the face camera (zxing-wasm via the
  `barcode-detector` ponyfill, with the wasm file served locally) is not built.
- **Phone links.** A hosted hand-off page, so phone QRs open a map rather than text, needs a
  public web host.
- **Clinic console.** A console to call, recall and mark no-shows, which would replace the
  clock-driven queue.
- **Printing other receipts.** Only the patient card and the appointment slip go to the receipt
  printer ([Receipt printer setup](#receipt-printer-setup)). Queue tickets, case receipts, doctor
  lists and routes still use the browser dialog. Silent printing of those pages
  (`webContents.print({silent: true})` in the Electron shell) is not built.
- **GS1 DataMatrix wristbands** (AI 8018) for inpatients are not parsed.
