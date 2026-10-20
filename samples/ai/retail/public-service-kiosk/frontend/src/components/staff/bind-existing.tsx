// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, IdCard, Save, Search, UserRound } from "lucide-react";
import { CardBinder } from "@/components/staff/card-binder";
import { Failure, Panel } from "@/components/staff/desk-shell";
import { PortraitCapture } from "@/components/staff/portrait-capture";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useCitizenSearch, useUpdateEnrollment } from "@/hooks/use-enrollment";
import type { CitizenSummary } from "@/lib/api/enrollment";
import { cn } from "@/lib/utils";

/**
 * Issuing a card — and a portrait — to somebody already on the register.
 *
 * The common case, and the one the register is in today: a hundred seeded
 * citizens, not one of them holding a card. Nothing about the person is
 * editable here on purpose. This screen exists to bind two things to a record
 * that already says who they are, and a second place to edit an address is a
 * second place for it to be wrong.
 */
export function BindExisting() {
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<CitizenSummary | null>(null);
  const search = useCitizenSearch(useDebounced(term, 250));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
      <Panel title="Find the citizen" note="Search by name or by IC / passport number.">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Nadia, or MY3080592042"
            aria-label="Search the register"
            className="h-10 rounded-xl border-[1.5px] bg-field pl-9 md:text-sm"
          />
        </div>

        <ul className="mt-4 flex flex-col gap-1.5">
          {search.isPending && (
            <li className="flex items-center gap-2 px-1 py-3 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Searching…
            </li>
          )}
          {search.data?.citizens.length === 0 && (
            <li className="px-1 py-3 text-sm text-muted-foreground">
              Nobody on the register matches that.
            </li>
          )}
          {search.data?.citizens.map((citizen) => (
            <li key={citizen.id}>
              <button
                type="button"
                onClick={() => setSelected(citizen)}
                aria-current={selected?.id === citizen.id}
                className={cn(
                  "flex w-full flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors",
                  selected?.id === citizen.id
                    ? "border-ring bg-selected"
                    : "border-transparent hover:bg-muted",
                )}
              >
                <span className="text-sm font-medium">{citizen.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{citizen.citizenId}</span>
                <span className="mt-1 flex gap-1.5">
                  <Badge variant={citizen.portrait ? "secondary" : "outline"} className="gap-1">
                    <UserRound />
                    {citizen.portrait ? "Portrait" : "No portrait"}
                  </Badge>
                  <Badge variant={citizen.nfcUid ? "secondary" : "outline"} className="gap-1">
                    <IdCard />
                    {citizen.nfcUid ? "Card" : "No card"}
                  </Badge>
                </span>
              </button>
            </li>
          ))}
          {search.isError && (
            <li className="px-1 py-3 text-sm text-destructive">
              The register could not be searched — your admin session may have expired.
            </li>
          )}
        </ul>
      </Panel>

      {selected ? (
        <BindPanel
          key={selected.id}
          citizen={selected}
          onSaved={(updated) => setSelected(updated)}
        />
      ) : (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-border p-10 text-sm text-muted-foreground">
          Pick somebody from the list to give them a card or a portrait.
        </div>
      )}
    </div>
  );
}

function BindPanel({
  citizen,
  onSaved,
}: {
  citizen: CitizenSummary;
  onSaved: (citizen: CitizenSummary) => void;
}) {
  const [uid, setUid] = useState(citizen.nfcUid ?? "");
  const [portrait, setPortrait] = useState<Blob | null>(null);
  const [saved, setSaved] = useState(false);
  const update = useUpdateEnrollment();

  const uidChanged = uid.trim() !== (citizen.nfcUid ?? "");
  const changed = uidChanged || Boolean(portrait);

  function save() {
    setSaved(false);
    update.mutate(
      { id: citizen.id, nfcUid: uidChanged ? uid.trim() : undefined, portrait },
      {
        onSuccess: (result) => {
          setPortrait(null);
          setSaved(true);
          onSaved(result.citizen);
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-[240px_1fr]">
        <Panel title="Portrait" note="Replacing one takes effect on the next kiosk check.">
          <PortraitCapture
            portrait={portrait}
            onChange={setPortrait}
            // Face photos are access-controlled like the rest of the registry;
            // the staff member's own admin cookie is what fetches this one.
            existing={
              citizen.portrait
                ? `/cms-api/face-photos/file/${encodeURIComponent(citizen.portrait)}`
                : null
            }
            disabled={update.isPending}
          />
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title={citizen.name} note={`${citizen.citizenId} · registry key ${citizen.citizenKey}`}>
            <CardBinder
              uid={uid}
              onChange={(next) => {
                setUid(next);
                setSaved(false);
              }}
              currentId={citizen.citizenId}
              disabled={update.isPending}
            />
            {citizen.nfcUid && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="mt-3"
                onClick={() => setUid("")}
                disabled={update.isPending || !uid}
              >
                Unbind this card
              </Button>
            )}
          </Panel>

          {update.isError && <Failure error={update.error} />}

          {saved && !update.isError && (
            <p className="flex items-center gap-2 rounded-2xl bg-success/10 p-4 text-sm text-success">
              <CheckCircle2 className="size-5 shrink-0" />
              {citizen.nfcUid
                ? `Saved — card ${citizen.nfcUid} now opens ${citizen.name}'s record.`
                : `Saved — ${citizen.name} holds no card.`}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="button" size="lg" onClick={save} disabled={!changed || update.isPending}>
              {update.isPending ? <Spinner /> : <Save />}
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Hold a value still until the typing stops. The register is searched on the
 * server, and firing a query per keystroke would have the list of results
 * racing the letters that produced them.
 */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
