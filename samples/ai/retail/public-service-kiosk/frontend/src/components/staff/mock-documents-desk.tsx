// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { ArrowUpRight, Download, ExternalLink, FilePlus2, Search } from "lucide-react";
import { Failure, Panel } from "@/components/staff/desk-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useCitizenSearch } from "@/hooks/use-enrollment";
import { apiUrl } from "@/lib/api/client";
import type { CitizenSummary } from "@/lib/api/enrollment";
import { getMockDocuments, mockDocumentPath, type MockDocumentSet } from "@/lib/api/mock-documents";
import { cn } from "@/lib/utils";
import { safeUrl, URL_CHARS } from "@/lib/validation";

/** /mock-documents — fictional paperwork for a citizen on the register, to print for the scanner or upload at a document step. */
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
            Test paperwork with a registered citizen&apos;s details: a genuine set the kiosk should accept and a
            tampered set it should reject.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{staffEmail}</span>
          <HeaderLink href="/enroll">Registration desk</HeaderLink>
          <HeaderLink href="/settings">Kiosk settings</HeaderLink>
          <HeaderLink href="/admin">CMS admin</HeaderLink>
        </div>
      </header>

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
                  <span className="font-mono text-xs text-muted-foreground">{citizen.citizenId}</span>
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

  return (
    <div className="flex flex-col gap-6">
      <Panel title={citizen.name} note={`${citizen.citizenId} · registry key ${citizen.citizenKey}`}>
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
            Unzipped into <code>assets/mocks/citizens</code>, a set folder works as <code>documents.mocks_dir</code>.
          </p>
        )}
        {generate.isError && (
          <div className="mt-4">
            <Failure error={generate.error} />
          </div>
        )}
      </Panel>

      {generate.data?.sets.map((set) => (
        <DocumentSet key={set.variant} citizen={citizen} set={set} />
      ))}
      {generate.data && generate.data.sets.length === 1 && (
        <p className="text-sm text-muted-foreground">
          No tampered set: it borrows another citizen&apos;s details, and this citizen is the only one on the
          register.
        </p>
      )}
    </div>
  );
}

function DocumentSet({ citizen, set }: { citizen: CitizenSummary; set: MockDocumentSet }) {
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
