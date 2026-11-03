// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Barcode, CalendarCheck, IdCard, Search } from "lucide-react";
import { Failure, Panel } from "@/components/staff/desk-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useCitizenSearch } from "@/hooks/use-enrollment";
import { displayMrn } from "@/hospital/patient-id";
import { getDemoVisit, prepareDemoVisit } from "@/lib/api/demo-visit";
import type { CitizenSummary } from "@/lib/api/enrollment";
import { getMockBench, presentAtKiosk, type BenchAction, type MockBench } from "@/lib/api/mock-documents";
import { formatLongDate, formatMoney, kioskCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

/** /demo-visit — one patient made ready to walk a visit at the kiosk again, between demo runs. */
export function DemoVisitDesk({ staffEmail }: { staffEmail: string }) {
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<CitizenSummary | null>(null);
  const search = useCitizenSearch(useDebounced(term, 250));
  const bench = useQuery({ queryKey: ["mock-bench"], queryFn: getMockBench, refetchInterval: 5_000 });

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Demo reset</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gets a patient ready to walk a whole visit at the kiosk — sign in, check in, pay — and ready again after
            each run. Linked from the CMS admin only.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{staffEmail}</span>
          <HeaderLink href="/mock-documents">Mock documents</HeaderLink>
          <HeaderLink href="/outbox">Outbox</HeaderLink>
          <HeaderLink href="/admin">CMS admin</HeaderLink>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Panel title="Find the patient" note="Search by name or by IC / passport number.">
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
              <li className="px-1 py-3 text-sm text-muted-foreground">Nobody on the register matches that.</li>
            )}
            {search.data?.citizens.map((citizen) => (
              <li key={citizen.id}>
                <button
                  type="button"
                  onClick={() => setSelected(citizen)}
                  aria-current={selected?.id === citizen.id}
                  className={cn(
                    "flex w-full flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors",
                    selected?.id === citizen.id ? "border-ring bg-selected" : "border-transparent hover:bg-muted",
                  )}
                >
                  <span className="text-sm font-medium">{citizen.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {citizen.citizenId} · {citizen.mrn}
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
          <DemoVisitPanel key={selected.id} citizen={selected} bench={bench.data} />
        ) : (
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-border p-10 text-sm text-muted-foreground">
            Pick the patient you demo with.
          </div>
        )}
      </div>
    </div>
  );
}

function DemoVisitPanel({ citizen, bench }: { citizen: CitizenSummary; bench?: MockBench }) {
  const queryClient = useQueryClient();
  const key = ["demo-visit", citizen.id];
  // Polled, so each step taken at the kiosk shows up here as it lands.
  const visit = useQuery({ queryKey: key, queryFn: () => getDemoVisit(citizen.id), refetchInterval: 5_000 });
  const prepare = useMutation({
    mutationFn: () => prepareDemoVisit(citizen.id),
    onSuccess: (result) => queryClient.setQueryData(key, result.visit),
  });
  const present = useMutation({ mutationFn: (what: BenchAction) => presentAtKiosk(citizen.id, what) });

  const v = visit.data;
  const currency = kioskCurrency();
  const due = v?.due.reduce((sum, inv) => sum + inv.amount, 0) ?? 0;
  // Checking in bills the consultation, so a visit still to check in is all a run needs.
  const ready = Boolean(v?.appointments.some((a) => !a.queueNumber));

  return (
    <Panel
      title={citizen.name}
      note="Set up today's visit takes today's check-in out of the queue, undoes the bill payments so the bill is due again, and books the slot nearest to now if there is no appointment today. Checking in at the kiosk then bills the consultation and sends its prescription to the pharmacy. Nothing is deleted: cleared cases are put on hold."
    >
      {visit.isPending && <Spinner className="size-4" />}
      {visit.isError && <Failure error={visit.error} />}
      {v && (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">Today</dt>
          <dd className="flex flex-col gap-1">
            {v.appointments.length === 0 && <span>No appointment</span>}
            {v.appointments.map((a) => (
              <span key={a.reference}>
                {a.clinic} at {a.time} with {a.doctor}{" "}
                <span className="text-muted-foreground">
                  ({a.source}, {a.reference})
                </span>{" "}
                — {a.queueNumber ? <strong>checked in, {a.queueNumber}</strong> : "not checked in"}
              </span>
            ))}
          </dd>
          <dt className="text-muted-foreground">Bill</dt>
          <dd>
            {due > 0
              ? `${formatMoney(due, currency)} due — ${v.due.map((inv) => inv.description).join(", ")}`
              : ready
                ? "The consultation is billed at check-in"
                : <strong>Paid</strong>}
          </dd>
          <dt className="text-muted-foreground">Sign-in</dt>
          <dd>
            <span className="font-mono">{displayMrn(citizen.mrn)}</span> · date of birth{" "}
            <strong>{formatLongDate(v.dateOfBirth)}</strong>
          </dd>
        </dl>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={() => prepare.mutate()} disabled={prepare.isPending || !v}>
          {prepare.isPending ? <Spinner /> : <CalendarCheck />}
          Set up today&apos;s visit
        </Button>
        {v && (
          <span className={cn("text-sm", ready ? "text-success" : "text-muted-foreground")}>
            {ready ? "Ready to walk at the kiosk." : "Set it up to walk the visit again."}
          </span>
        )}
      </div>
      {prepare.data && (
        <ul className="mt-3 flex flex-col gap-1 text-sm text-success" role="status">
          {prepare.data.done.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {prepare.error && (
        <div className="mt-3">
          <Failure error={prepare.error} />
        </div>
      )}

      <ol className="mt-4 flex list-decimal flex-col gap-1.5 pl-5 text-sm">
        <li>
          Sign in at the kiosk:{" "}
          {bench?.scan || bench?.tap ? (
            <span className="inline-flex flex-wrap gap-2 align-middle">
              {bench.scan && (
                <Button variant="outline" size="sm" disabled={present.isPending} onClick={() => present.mutate({ action: "scan-slip" })}>
                  <Barcode />
                  Scan the slip
                </Button>
              )}
              {bench.tap && (
                <Button variant="outline" size="sm" disabled={present.isPending} onClick={() => present.mutate({ action: "tap" })}>
                  <IdCard />
                  Tap the ID card
                </Button>
              )}
            </span>
          ) : (
            "type the MRN on the keypad, then the date of birth above."
          )}
        </li>
        <li>
          Check in for the visit. The queue ticket then offers <strong>Pay now</strong>.
        </li>
        <li>Pay the bill. Each step shows up here; set up the visit again for the next run.</li>
      </ol>
      {present.data && !present.error && (
        <p className="mt-2 text-sm text-success" role="status">
          {present.data.scanned ? `The ${present.data.scanned} was scanned.` : `${present.data.tapped}'s card is on the reader.`}
        </p>
      )}
      {present.error && (
        <div className="mt-3">
          <Failure error={present.error} />
        </div>
      )}
    </Panel>
  );
}

function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 font-medium text-foreground transition-colors hover:bg-muted"
    >
      {children}
      <ArrowUpRight className="size-3.5" />
    </Link>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
