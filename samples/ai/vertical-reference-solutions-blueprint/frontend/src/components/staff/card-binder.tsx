// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { Nfc, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { ApiError } from "@/lib/api/client";
import { readCard } from "@/lib/api/enrollment";
import { ID_GESTURE } from "@/lib/id-reader";
import { cn } from "@/lib/utils";
import { TONE_SURFACE, type Tone } from "@/components/kiosk/tone";

/** How long a read waits for the citizen to present their card (ms). */
const WAIT_MS = 20_000;

/**
 * The card half of an enrollment: the serial of the piece of plastic that
 * will open this citizen's record at the kiosk.
 *
 * The serial is read off the card rather than typed wherever possible — a
 * transposed digit binds a citizen to a card nobody is holding, and neither
 * the desk nor the kiosk would notice until somebody tapped and was told they
 * are not registered. The box is still there for a desk with no reader
 * attached and a serial from `npm run nfc:probe`.
 *
 * What comes back is never simulated: the read goes to the bench route, which
 * reports a missing reader instead of standing a citizen in. A stand-in
 * serial bound to a record is a card that does not exist.
 */
export function CardBinder({
  uid,
  onChange,
  /** Citizen this card is being bound to, so their own card reads as fine. */
  currentId,
  disabled,
}: {
  uid: string;
  onChange: (uid: string) => void;
  currentId?: string;
  disabled?: boolean;
}) {
  const [reading, setReading] = useState(false);
  const [status, setStatus] = useState<{ tone: Tone; text: string } | null>(null);

  async function read() {
    setReading(true);
    setStatus({
      tone: "info",
      text:
        ID_GESTURE === "tap"
          ? "Hold the card flat on the reader…"
          : "Insert the card into the reader chip-first…",
    });
    try {
      const result = await readCard(WAIT_MS);

      // An ATR is the answer a contact card gives when it will not report a
      // serial. Every card of that model answers the same, so binding one
      // would open this citizen's record to a whole box of blank cards.
      if (result.card.fromAtr) {
        setStatus({
          tone: "danger",
          text:
            "That card did not report a serial, only its ATR — which identifies a card model, " +
            "not a card. It cannot be bound to a citizen. Try a contactless card.",
        });
        return;
      }

      const bound = result.boundTo;
      if (bound && bound.citizenId !== currentId) {
        // The serial stays out of the form: filling it in while the warning
        // says it cannot be used leaves Save armed with a conflict the
        // server will only refuse later.
        setStatus({
          tone: "danger",
          text: `Read ${result.card.uid} — but this card already opens ${bound.name}'s record (${bound.citizenId}). It was not filled in; one card belongs to one citizen.`,
        });
        return;
      }
      onChange(result.card.uid);
      if (bound) {
        setStatus({ tone: "success", text: `Read ${result.card.uid} — already this citizen's card.` });
      } else {
        setStatus({
          tone: "success",
          text: `Read ${result.card.uid} on ${result.card.reader}. It is not bound to anybody yet.`,
        });
      }
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "the card could not be read";
      // 404 is a reader that was there and saw nothing usable — worth another
      // tap. Anything else is the hardware itself, so the box below is the
      // way through and the message says so.
      setStatus({
        tone: "warning",
        text:
          error instanceof ApiError && error.status === 404
            ? `${message[0].toUpperCase()}${message.slice(1)}`
            : `${message[0].toUpperCase()}${message.slice(1)} — type the serial below instead ` +
              "(npm run nfc:probe prints it).",
      });
    } finally {
      setReading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="outline"
        onClick={read}
        disabled={disabled || reading}
        className="h-11 justify-start gap-2 rounded-xl"
      >
        {reading ? <Spinner className="size-4" /> : <Nfc className="size-4" />}
        {reading ? "Waiting for the card…" : "Read card from the reader"}
      </Button>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nfcUid" className="text-xs font-medium text-muted-foreground">
          Card serial (UID)
        </Label>
        <Input
          id="nfcUid"
          value={uid}
          disabled={disabled}
          placeholder="04A2B3C4D5E6"
          spellCheck={false}
          onChange={(e) => {
            onChange(e.target.value.toUpperCase());
            setStatus(null);
          }}
          className="h-11 rounded-xl font-mono tracking-wider md:text-sm"
        />
      </div>

      {status ? (
        <p className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-xs", TONE_SURFACE[status.tone])}>
          <ScanLine className="mt-px size-4 shrink-0" />
          {status.text}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Optional — a citizen with no card can still be identified at the kiosk another way.
          One card belongs to one citizen.
        </p>
      )}
    </div>
  );
}
