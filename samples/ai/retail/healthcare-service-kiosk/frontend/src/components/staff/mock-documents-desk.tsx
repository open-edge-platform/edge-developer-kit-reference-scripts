// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Barcode, Download, ExternalLink, FilePlus2, IdCard, ScanLine, Search, X } from "lucide-react";
import { Failure, Panel } from "@/components/staff/desk-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useCitizenSearch } from "@/hooks/use-enrollment";
import { apiUrl } from "@/lib/api/client";
import type { CitizenSummary } from "@/lib/api/enrollment";
import {
  emptyFeeder,
  getMockBench,
  getMockDocuments,
  mockDocumentPath,
  presentAtKiosk,
  type BenchAction,
  type MockBench,
  type MockDocuments,
  type MockDocumentSet,
} from "@/lib/api/mock-documents";
import { cn } from "@/lib/utils";
import { safeUrl, URL_CHARS } from "@/lib/validation";

/** /mock-documents — fictional paperwork for a patient on the register, to print for the scanner or upload at a document step. */
export function MockDocumentsDesk({ staffEmail }: { staffEmail: string }) {
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<CitizenSummary | null>(null);
  const search = useCitizenSearch(useDebounced(term, 250));

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Mock documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Test paperwork with a registered patient&apos;s details: a genuine set the kiosk should accept and a
            tampered set it should reject. Print it for a real scanner, or present it to this kiosk&apos;s simulated
            card reader, barcode scanner and document scanner.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{staffEmail}</span>
          <HeaderLink href="/staff">Staff pages</HeaderLink>
          <HeaderLink href="/settings">Kiosk settings</HeaderLink>
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
          <Documents key={selected.id} citizen={selected} />
        ) : (
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-border p-10 text-sm text-muted-foreground">
            Pick somebody from the list to generate their documents.
          </div>
        )}
      </div>
    </div>
  );
}

function Documents({ citizen }: { citizen: CitizenSummary }) {
  const generate = useMutation({ mutationFn: getMockDocuments, retry: false });
  const bench = useQuery({ queryKey: ["mock-bench"], queryFn: getMockBench, refetchInterval: 5_000 });
  const queryClient = useQueryClient();
  const present = useMutation({
    mutationFn: (what: BenchAction) => presentAtKiosk(citizen.id, what),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["mock-bench"] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <Panel title={citizen.name} note={`${citizen.citizenId} · ${citizen.mrn}`}>
        <div className="flex flex-wrap items-center gap-3">
          {!generate.data && (
            <Button size="lg" onClick={() => generate.mutate(citizen.id)} disabled={generate.isPending}>
              {generate.isPending ? <Spinner /> : <FilePlus2 />}
              Generate documents
            </Button>
          )}
          {generate.data && (
            <DownloadLink path={mockDocumentPath(citizen.id)} variant="outline" size="lg">
              <Download />
              Download both sets (.zip)
            </DownloadLink>
          )}
        </div>
        {generate.data && (
          <p className="mt-3 text-xs text-muted-foreground">
            A simulated scanner already hands over the genuine set of whoever signed in. Unzipped into{" "}
            <code>assets/mocks/citizens</code>, a set folder can replace that as <code>documents.mocks_dir</code>.
          </p>
        )}
        {generate.isError && (
          <div className="mt-4">
            <Failure error={generate.error} />
          </div>
        )}
      </Panel>

      {generate.data && bench.data && (
        <PresentPanel
          documents={generate.data}
          bench={bench.data}
          busy={present.isPending}
          done={present.data}
          error={present.error}
          onPresent={(what) => present.mutate(what)}
          onEmpty={() => void emptyFeeder().then(() => queryClient.invalidateQueries({ queryKey: ["mock-bench"] }))}
        />
      )}

      {generate.data?.sets.map((set) => (
        <DocumentSet
          key={set.variant}
          citizen={citizen}
          set={set}
          canFeed={Boolean(bench.data?.feed)}
          feeding={present.isPending}
          onFeed={(file) => present.mutate({ action: "feed", variant: set.variant, file })}
        />
      ))}
      {generate.data && generate.data.sets.length === 1 && (
        <p className="text-sm text-muted-foreground">
          No tampered set: it borrows another patient&apos;s details, and this patient is the only one on the
          register.
        </p>
      )}
    </div>
  );
}

/** The patient's paperwork presented to this kiosk's simulated peripherals, the way a patient would hand it over. */
function PresentPanel({
  documents,
  bench,
  busy,
  done,
  error,
  onPresent,
  onEmpty,
}: {
  documents: MockDocuments;
  bench: MockBench;
  busy: boolean;
  done?: { fed?: MockBench["fed"]; tapped?: string; scanned?: string };
  error: Error | null;
  onPresent: (what: BenchAction) => void;
  onEmpty: () => void;
}) {
  const { codes } = documents;
  const idDocument = documents.citizen.foreign ? "passport" : "MyKad";
  const slip = codes.slip;
  return (
    <Panel
      title="Present at this kiosk"
      note="Hands the paperwork to this kiosk's simulated peripherals. A step waiting for a card or a code picks it up at once."
    >
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!bench.tap || busy} onClick={() => onPresent({ action: "tap" })}>
          <IdCard />
          Tap {idDocument} on the reader
        </Button>
        <Button
          variant="outline"
          disabled={!bench.scan || !codes.mrn || busy}
          onClick={() => onPresent({ action: "scan-card" })}
        >
          <Barcode />
          Scan patient card
        </Button>
        <Button variant="outline" disabled={!bench.scan || !slip || busy} onClick={() => onPresent({ action: "scan-slip" })}>
          <Barcode />
          Scan appointment slip
        </Button>
      </div>
      <ul className="mt-3 flex flex-col gap-1 text-xs text-muted-foreground">
        {!bench.tap && <li>The card reader is real here (nfc.simulate: never) — tap the physical card.</li>}
        {!bench.scan && <li>A barcode scanner is fitted here — print the patient card or slip and scan it.</li>}
        {!bench.feed && <li>The document scanner is real here — print a document and feed it in.</li>}
        <li>
          {slip
            ? `Today's visit: ${slip.clinic} at ${slip.time} (reference ${slip.reference}).`
            : "No appointment today, so there is no slip to scan."}
        </li>
      </ul>
      {bench.fed && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ring/40 bg-selected px-3 py-2 text-sm">
          <span className="flex items-center gap-2">
            <ScanLine className="size-4 text-primary" />
            In the feeder for the next scan: {bench.fed.label}
          </span>
          <Button variant="ghost" size="sm" onClick={onEmpty}>
            <X />
            Take it out
          </Button>
        </div>
      )}
      {done && !error && (done.tapped || done.scanned) && (
        <p className="mt-3 text-sm text-success" role="status">
          {done.tapped ? `${done.tapped}'s ${idDocument} is on the reader.` : `The ${done.scanned} was scanned.`}
        </p>
      )}
      {error && (
        <div className="mt-3">
          <Failure error={error} />
        </div>
      )}
    </Panel>
  );
}

function DocumentSet({
  citizen,
  set,
  canFeed,
  feeding,
  onFeed,
}: {
  citizen: CitizenSummary;
  set: MockDocumentSet;
  canFeed: boolean;
  feeding: boolean;
  onFeed: (file: string) => void;
}) {
  const genuine = set.variant === "good";
  return (
    <Panel
      title={genuine ? "Genuine set" : "Tampered set"}
      note={
        genuine
          ? "Matches the register, so the kiosk should accept every one."
          : `Each one carries a detail that is not ${citizen.name}'s (some from ${set.donor}), so the kiosk should reject it.`
      }
    >
      <ul className="flex flex-col divide-y divide-border">
        {set.files.map((doc) => (
          <li key={doc.file} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">{doc.label}</span>
              <span className="font-mono text-xs text-muted-foreground">{doc.file}</span>
              {doc.note && <span className="text-xs text-muted-foreground first-letter:uppercase">{doc.note}</span>}
            </div>
            <div className="flex gap-2">
              {canFeed && doc.role !== "code" && (
                <Button variant="secondary" size="sm" disabled={feeding} onClick={() => onFeed(doc.file)}>
                  <ScanLine />
                  Feed to scanner
                </Button>
              )}
              <DownloadLink
                path={mockDocumentPath(citizen.id, { variant: set.variant, file: doc.file, inline: true })}
                newTab
                variant="ghost"
                size="sm"
              >
                <ExternalLink />
                Open
              </DownloadLink>
              <DownloadLink
                path={mockDocumentPath(citizen.id, { variant: set.variant, file: doc.file })}
                variant="outline"
                size="sm"
              >
                <Download />
                Download
              </DownloadLink>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <DownloadLink path={mockDocumentPath(citizen.id, { variant: set.variant })} variant="secondary">
          <Download />
          Download this set (.zip)
        </DownloadLink>
      </div>
    </Panel>
  );
}

function DownloadLink({
  path,
  newTab,
  variant,
  size,
  children,
}: {
  path: string;
  newTab?: boolean;
  variant: "outline" | "ghost" | "secondary";
  size?: "sm" | "lg";
  children: React.ReactNode;
}) {
  // Rebuilt inline off the allowlist: the security scan only trusts
  // sanitization done in the same function as the sink.
  let href = "";
  try {
    for (const ch of safeUrl(apiUrl(path))) {
      let ok = "";
      for (const allowed of URL_CHARS) {
        if (allowed === ch) {
          ok = allowed;
          break;
        }
      }
      if (!ok) {
        href = "";
        break;
      }
      href += ok;
    }
  } catch {
    href = "";
  }
  if (!href) return null;
  return (
    <Button asChild variant={variant} size={size}>
      <a href={href} {...(newTab ? { target: "_blank", rel: "noreferrer" } : { download: "" })}>
        {children}
      </a>
    </Button>
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
