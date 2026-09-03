// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { COUNTRIES, DEFAULT_COUNTRY } from "@/lib/countries";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CheckCircle2, IdCard, UserPlus } from "lucide-react";
import { BindExisting } from "@/components/staff/bind-existing";
import { CardBinder } from "@/components/staff/card-binder";
import { DeskCheckbox, DeskField, DeskSelect } from "@/components/staff/desk-fields";
import { Failure, Panel } from "@/components/staff/desk-shell";
import { PortraitCapture } from "@/components/staff/portrait-capture";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useEnrollCitizen } from "@/hooks/use-enrollment";
import type { CitizenSummary, EnrollmentDraft } from "@/lib/api/enrollment";
import { cn } from "@/lib/utils";

/** The registration desk: enroll a citizen in one pass, or issue a card to
 *  one already on the register. Everything it writes is editable at /admin. */

const EMPTY: EnrollmentDraft = {
  name: "",
  citizenId: "",
  country: DEFAULT_COUNTRY,
  addressLine: "",
  city: "",
  postcode: "",
  age: "",
  phone: "",
  email: "",
  race: "",
  religion: "",
  maritalStatus: "",
  monthlyIncome: "",
  childrenUnder18: "",
  isOku: false,
  notes: "",
};

/** Registry vocabularies, as the citizens collection defines them. */
const RACES = ["Malay", "Chinese", "Indian", "Other"] as const;
const RELIGIONS = ["Islam", "Buddhist", "Christian", "Hindu", "Other"] as const;
const MARITAL = ["single", "married"] as const;

type Tab = "new" | "existing";

export function EnrollDesk({ staffEmail }: { staffEmail: string }) {
  const [tab, setTab] = useState<Tab>("new");

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Registration desk</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enroll a citizen with their portrait and their card, or issue a card to somebody
            already on the register.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{staffEmail}</span>
          <Link
            href="/admin/collections/citizens"
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 font-medium text-foreground transition-colors hover:bg-muted"
          >
            CMS registry
            <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </header>

      <div className="inline-flex w-fit gap-1 rounded-xl bg-muted p-1">
        {(
          [
            { id: "new", label: "New citizen", icon: UserPlus },
            { id: "existing", label: "Card for an existing citizen", icon: IdCard },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              tab === id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "new" ? <NewCitizenForm /> : <BindExisting />}
    </div>
  );
}

function NewCitizenForm() {
  const [draft, setDraft] = useState<EnrollmentDraft>(EMPTY);
  const [portrait, setPortrait] = useState<Blob | null>(null);
  const [nfcUid, setNfcUid] = useState("");
  const [enrolled, setEnrolled] = useState<CitizenSummary | null>(null);
  const enroll = useEnrollCitizen();

  const set = <K extends keyof EnrollmentDraft>(key: K, value: EnrollmentDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  // Only keeps the button honest — the route re-checks, and its answer counts.
  const complete =
    draft.name.trim() &&
    draft.citizenId.trim() &&
    draft.addressLine.trim() &&
    draft.city.trim() &&
    draft.postcode.trim();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setEnrolled(null);
    enroll.mutate(
      { draft, nfcUid, portrait },
      {
        onSuccess: (result) => {
          setEnrolled(result.citizen);
          setDraft(EMPTY);
          setPortrait(null);
          setNfcUid("");
        },
      },
    );
  }

  if (enrolled) {
    return <Enrolled citizen={enrolled} onAgain={() => setEnrolled(null)} />;
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <div className="flex flex-col gap-6">
        <Panel title="Portrait" note="Matched against the kiosk camera at the identity step.">
          <PortraitCapture
            portrait={portrait}
            onChange={setPortrait}
            disabled={enroll.isPending}
          />
        </Panel>
        <Panel title="NFC card" note="The card that opens this citizen's record at the kiosk.">
          <CardBinder uid={nfcUid} onChange={setNfcUid} disabled={enroll.isPending} />
        </Panel>
      </div>

      <div className="flex flex-col gap-6">
        <Panel title="Particulars">
          <div className="grid gap-4 sm:grid-cols-2">
            <DeskField
              id="name"
              label="Full name"
              required
              value={draft.name}
              onChange={(v) => set("name", v)}
              className="sm:col-span-2"
              disabled={enroll.isPending}
            />
            <DeskField
              id="citizenId"
              label="IC / passport number"
              required
              value={draft.citizenId}
              onChange={(v) => set("citizenId", v.toUpperCase())}
              placeholder="MY3080592042"
              hint="Everything the kiosk does is keyed on this."
              disabled={enroll.isPending}
            />
            <DeskSelect
              id="country"
              label="Country"
              required
              value={draft.country}
              onChange={(v) => set("country", (v || DEFAULT_COUNTRY) as EnrollmentDraft["country"])}
              options={COUNTRIES}
              placeholder={DEFAULT_COUNTRY}
              hint="Malaysians present a MyKad; foreigners a passport."
              disabled={enroll.isPending}
            />
            <DeskField
              id="age"
              label="Age"
              type="number"
              value={draft.age}
              onChange={(v) => set("age", v)}
              disabled={enroll.isPending}
            />
            <DeskField
              id="phone"
              label="Phone"
              type="tel"
              value={draft.phone}
              onChange={(v) => set("phone", v)}
              disabled={enroll.isPending}
            />
            <DeskField
              id="email"
              label="Email"
              type="email"
              value={draft.email}
              onChange={(v) => set("email", v)}
              className="sm:col-span-2"
              disabled={enroll.isPending}
            />
          </div>
        </Panel>

        <Panel title="Address">
          <div className="grid gap-4 sm:grid-cols-2">
            <DeskField
              id="addressLine"
              label="Street address"
              required
              value={draft.addressLine}
              onChange={(v) => set("addressLine", v)}
              className="sm:col-span-2"
              disabled={enroll.isPending}
            />
            <DeskField
              id="city"
              label="City"
              required
              value={draft.city}
              onChange={(v) => set("city", v)}
              disabled={enroll.isPending}
            />
            <DeskField
              id="postcode"
              label="Postcode"
              required
              value={draft.postcode}
              onChange={(v) => set("postcode", v)}
              disabled={enroll.isPending}
            />
          </div>
        </Panel>

        <Panel
          title="Registry details"
          note="Optional — these are what service steps check when they decide who is eligible for what."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <DeskSelect
              id="race"
              label="Race"
              value={draft.race}
              onChange={(v) => set("race", v)}
              options={RACES}
              disabled={enroll.isPending}
            />
            <DeskSelect
              id="religion"
              label="Religion"
              value={draft.religion}
              onChange={(v) => set("religion", v)}
              options={RELIGIONS}
              hint="Muslims marry via the Syariah system, not Act 164."
              disabled={enroll.isPending}
            />
            <DeskSelect
              id="maritalStatus"
              label="Marital status"
              value={draft.maritalStatus}
              onChange={(v) => set("maritalStatus", v)}
              options={MARITAL}
              disabled={enroll.isPending}
            />
            <DeskField
              id="monthlyIncome"
              label="Monthly household income (RM)"
              type="number"
              value={draft.monthlyIncome}
              onChange={(v) => set("monthlyIncome", v)}
              hint="Used for JKM means-testing."
              disabled={enroll.isPending}
            />
            <DeskField
              id="childrenUnder18"
              label="Children under 18"
              type="number"
              value={draft.childrenUnder18}
              onChange={(v) => set("childrenUnder18", v)}
              disabled={enroll.isPending}
            />
            <DeskCheckbox
              id="isOku"
              label="Registered OKU"
              checked={draft.isOku}
              onChange={(v) => set("isOku", v)}
              hint="JKM disability registration."
              disabled={enroll.isPending}
            />
            <DeskField
              id="notes"
              label="Notes"
              value={draft.notes}
              onChange={(v) => set("notes", v)}
              className="sm:col-span-2"
              disabled={enroll.isPending}
            />
          </div>
        </Panel>

        {enroll.isError && <Failure error={enroll.error} />}

        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDraft(EMPTY);
              setPortrait(null);
              setNfcUid("");
              enroll.reset();
            }}
            disabled={enroll.isPending}
          >
            Clear
          </Button>
          <Button type="submit" size="lg" disabled={!complete || enroll.isPending}>
            {enroll.isPending ? <Spinner /> : <UserPlus />}
            {enroll.isPending ? "Registering…" : "Register citizen"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Enrolled({ citizen, onAgain }: { citizen: CitizenSummary; onAgain: () => void }) {
  return (
    <div className="flex flex-col items-start gap-5 rounded-2xl border border-success/30 bg-success/5 p-6">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success" />
        <div>
          <h2 className="font-heading text-lg font-semibold">{citizen.name} is registered</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {citizen.citizenId} · registry key {citizen.citizenKey}
          </p>
        </div>
      </div>

      <dl className="grid w-full max-w-lg gap-2 text-sm">
        <Bound
          label="Portrait"
          done={Boolean(citizen.portrait)}
          value={citizen.portrait ?? "none — the kiosk face check cannot pass without one"}
        />
        <Bound
          label="NFC card"
          done={Boolean(citizen.nfcUid)}
          value={citizen.nfcUid ?? "none — no card opens this record yet"}
        />
      </dl>

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={onAgain}>
          <UserPlus />
          Register another
        </Button>
        <Button asChild variant="outline">
          <Link href={`/admin/collections/citizens/${citizen.id}`}>
            Open in the CMS
            <ArrowUpRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Bound({ label, value, done }: { label: string; value: string; done: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-right font-medium",
          done ? "font-mono text-foreground" : "text-warning",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
