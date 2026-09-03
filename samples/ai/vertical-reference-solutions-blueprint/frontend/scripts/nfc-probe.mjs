// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Prints the serial of every card presented to the kiosk's PC/SC reader, so a
 * card can be bound to a citizen without guessing at its number.
 *
 * Usage:
 *   npm run nfc:probe                 # watch every reader until Ctrl-C
 *   npm run nfc:probe -- --once       # print the first card and exit
 *   KIOSK_NFC_READER=ACR122U npm run nfc:probe
 *
 * Paste what it prints into either place a card is bound:
 *   - the CMS admin, Citizens -> NFC card serial (UID), for a real install
 *   - `nfc.cards:` in config.yaml, for a demo kit
 *
 * This talks to the same daemon and reads the same APDU the kiosk does
 * (src/app/api/_lib/nfc.ts), so a card that prints here is a card the identity
 * step can read. Nothing is written to the registry.
 */
import * as pcsc from "pcsc-mini";

const { CardDisposition, CardMode, ReaderStatus } = pcsc;

const ONCE = process.argv.includes("--once");
const WANTED = process.env.KIOSK_NFC_READER?.trim();
const UID_COMMAND = process.env.KIOSK_NFC_UID_COMMAND ?? "FFCA000000";

const hex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

const apdu = (command) =>
  Uint8Array.from(command.replace(/[^0-9a-fA-F]/g, "").match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );

/** Read one card's serial, falling back to its ATR the way the kiosk does. */
async function readCard(reader, atr) {
  const card = await reader.connect(CardMode.SHARED);
  try {
    const res = await card.transmit(apdu(UID_COMMAND));
    const ok = res.length > 2 && res.at(-2) === 0x90 && res.at(-1) === 0x00;
    if (ok) return { uid: hex(res.subarray(0, -2)), fromAtr: false };
    if (atr.length === 0) throw new Error(`card answered ${hex(res)} and reported no ATR`);
    return { uid: hex(atr), fromAtr: true };
  } finally {
    await card.disconnect(CardDisposition.LEAVE).catch(() => {});
  }
}

const client = new pcsc.Client()
  .on("error", (err) => {
    console.error(`\nreader monitoring stopped: ${err.message} (${err.code})`);
    process.exit(1);
  })
  .on("reader", (reader) => {
    const name = reader.name();
    if (WANTED && !name.toLowerCase().includes(WANTED.toLowerCase())) {
      console.log(`ignoring reader (does not match KIOSK_NFC_READER): ${name}`);
      return;
    }
    console.log(`reader ready: ${name}`);

    reader.on("change", async (status, atr) => {
      if (!status.has(ReaderStatus.PRESENT)) return;
      if (status.hasAny(ReaderStatus.MUTE, ReaderStatus.IN_USE)) return;
      try {
        const { uid, fromAtr } = await readCard(reader, atr);
        console.log(`\n  card serial : ${uid}${fromAtr ? "   (from ATR — see below)" : ""}`);
        console.log(`  reader      : ${name}`);
        console.log(`  ATR         : ${hex(atr) || "(none)"}`);
        if (fromAtr) {
          console.log(
            "\n  This card did not answer the serial APDU, so what you see is its ATR —\n" +
              "  which names a card MODEL, not a card. Every card of this type would read\n" +
              "  the same, so do not bind it to a citizen.",
          );
        } else {
          console.log("\n  Bind it in the CMS (Citizens -> NFC card serial) or in config.yaml:");
          console.log(`      nfc:\n        cards:\n          ${uid}: 1`);
        }
        if (ONCE) {
          client.stop();
          process.exit(0);
        }
      } catch (err) {
        console.error(`\n  could not read the card: ${err.message}`);
      }
    });

    reader.on("disconnect", () => console.log(`reader disconnected: ${name}`));
  });

try {
  client.start();
} catch (err) {
  console.error(`could not attach to the PC/SC service: ${err.message} (${err.code})`);
  console.error(
    "Is pcscd running? On Debian/Ubuntu: sudo apt install libpcsclite1 pcscd && " +
      "sudo systemctl start pcscd",
  );
  process.exit(1);
}

console.log(
  WANTED
    ? `watching readers matching "${WANTED}" — present a card (Ctrl-C to stop)`
    : "watching every reader — present a card (Ctrl-C to stop)",
);
process.on("SIGINT", () => {
  client.stop();
  process.exit(0);
});
