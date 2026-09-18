// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, FileCode2, RotateCw, SlidersHorizontal } from "lucide-react";
import { DeskField, DeskSelect } from "@/components/staff/desk-fields";
import { Failure, Panel } from "@/components/staff/desk-shell";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useRestartKiosk, useSaveSettings, useSettings } from "@/hooks/use-settings";
import type { SettingsSnapshot } from "@/lib/api/settings";
import { SETTINGS_SECTIONS, type SettingField } from "@/lib/settings-schema";
import { cn } from "@/lib/utils";

/**
 * This terminal's settings: a form over the documented keys of config.yaml,
 * the file itself for everything else, and the restart that makes a save
 * count. What it edits and how the restart works: src/app/api/_lib/settings.ts
 * and restart.ts.
 */

type Tab = "form" | "raw";

/** How long the page waits for the kiosk to answer again after a restart. */
const RESTART_TIMEOUT_MS = 180_000;

export function SettingsDesk({ staffEmail }: { staffEmail: string }) {
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>("form");

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6 p-6 pb-28 lg:p-10 lg:pb-28">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Kiosk settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This terminal&apos;s config.yaml. Saved changes are read on the next start — restart
            the kiosk from here to apply them.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{staffEmail}</span>
          <HeaderLink href="/enroll">Registration desk</HeaderLink>
          <HeaderLink href="/admin">CMS admin</HeaderLink>
        </div>
      </header>

      {settings.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Reading config.yaml…
        </div>
      ) : settings.isError ? (
        <Failure error={settings.error} />
      ) : (
        <>
          <RestartBanner snapshot={settings.data} />

          <div className="inline-flex w-fit gap-1 rounded-xl bg-muted p-1">
            {(
              [
                { id: "form", label: "Settings", icon: SlidersHorizontal },
                { id: "raw", label: "config.yaml", icon: FileCode2 },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === id
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>

          {tab === "form" ? (
            <SettingsForm snapshot={settings.data} />
          ) : (
            <RawEditor snapshot={settings.data} />
          )}
        </>
      )}
    </div>
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

/** Keys whose saved value the running server does not have yet — keys the
 *  local override file shadows never get there, so they are left out. */
function pendingKeys(snapshot: SettingsSnapshot): string[] {
  return Object.keys(snapshot.values).filter(
    (key) =>
      snapshot.values[key] !== snapshot.running[key] &&
      !snapshot.overridden.includes(key),
  );
}

/**
 * The restart, and what the page does while it happens: it asks, then polls
 * the health route until the kiosk has gone away and come back, and reloads
 * into the restarted server. The poll waits for a failure first so a server
 * that is still on its way out is not mistaken for the new one.
 */
function RestartBanner({ snapshot }: { snapshot: SettingsSnapshot }) {
  const restart = useRestartKiosk();
  const [phase, setPhase] = useState<"idle" | "waiting" | "timeout">("idle");
  const pending = pendingKeys(snapshot);

  useEffect(() => {
    if (phase !== "waiting") return;
    let cancelled = false;
    let sawDown = false;
    const started = Date.now();
    const poll = async () => {
      while (!cancelled) {
        if (Date.now() - started > RESTART_TIMEOUT_MS) {
          setPhase("timeout");
          return;
        }
        await new Promise<void>((resolve) => setTimeout(() => resolve(), 1500));
        try {
          const res = await fetch("/api/health", { cache: "no-store" });
          if (res.ok && (sawDown || Date.now() - started > 8_000)) {
            window.location.reload();
            return;
          }
        } catch {
          sawDown = true;
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  if (phase === "waiting") {
    return (
      <Notice tone="info">
        <Spinner /> Restarting the kiosk — this page reloads when it is back.
      </Notice>
    );
  }
  if (phase === "timeout") {
    return (
      <Notice tone="warn">
        The kiosk has not answered for three minutes. Reload this page, or check the terminal it
        runs in.
      </Notice>
    );
  }
  if (pending.length === 0 && !restart.isError) return null;

  return (
    <Notice tone="warn">
      <div className="flex flex-1 flex-col gap-1">
        <span>
          {pending.length} saved setting{pending.length === 1 ? "" : "s"} the running kiosk does
          not have yet
          {snapshot.restart === "manual"
            ? " — restart the kiosk by hand to apply."
            : "."}
        </span>
        {restart.isError && <Failure error={restart.error} />}
      </div>
      {snapshot.restart === "supervised" && (
        <Button
          type="button"
          size="sm"
          onClick={() => restart.mutate(undefined, { onSuccess: () => setPhase("waiting") })}
          disabled={restart.isPending}
        >
          <RotateCw className="size-3.5" />
          Restart kiosk
        </Button>
      )}
    </Notice>
  );
}

function Notice({ tone, children }: { tone: "info" | "warn"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl p-4 text-sm",
        tone === "warn" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-muted",
      )}
    >
      {children}
    </div>
  );
}

/** The form: the file's values, with the operator's edits on top until they
 *  are saved or dropped. Only edited keys are sent, so a key the operator
 *  never touched keeps its line in the file untouched too. */
function SettingsForm({ snapshot }: { snapshot: SettingsSnapshot }) {
  const save = useSaveSettings();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const dirty = useMemo(
    () => Object.fromEntries(Object.entries(edits).filter(([key, v]) => v !== snapshot.values[key])),
    [edits, snapshot.values],
  );
  const count = Object.keys(dirty).length;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (count === 0) return;
        save.mutate({ values: dirty }, { onSuccess: () => setEdits({}) });
      }}
    >
      <p className="text-xs text-muted-foreground">
        Editing <code className="rounded bg-muted px-1 py-0.5">{snapshot.file}</code>
        {snapshot.local && (
          <>
            {" "}
            — <code className="rounded bg-muted px-1 py-0.5">{snapshot.local}</code> is layered
            on top; keys it sets are marked below.
          </>
        )}{" "}
        A blank field leaves the code default in place. The prompts are on the config.yaml tab.
      </p>

      {SETTINGS_SECTIONS.map((section) => (
        <Panel key={section.id} title={section.title} note={section.note}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {section.fields.map((field) => (
              <SettingInput
                key={field.key}
                field={field}
                value={edits[field.key] ?? snapshot.values[field.key] ?? ""}
                running={snapshot.running[field.key] ?? ""}
                saved={snapshot.values[field.key] ?? ""}
                overridden={snapshot.overridden.includes(field.key)}
                onChange={(value) => setEdits((prev) => ({ ...prev, [field.key]: value }))}
              />
            ))}
          </div>
        </Panel>
      ))}

      {save.isError && <Failure error={save.error} />}

      <SaveBar
        count={count}
        saving={save.isPending}
        onDiscard={() => setEdits({})}
        saved={save.isSuccess && count === 0}
      />
    </form>
  );
}

function SettingInput({
  field,
  value,
  saved,
  running,
  overridden,
  onChange,
}: {
  field: SettingField;
  value: string;
  saved: string;
  running: string;
  overridden: boolean;
  onChange: (value: string) => void;
}) {
  const id = `setting-${field.key.replace(/\./g, "-")}`;
  const notes: string[] = [];
  if (overridden) notes.push("overridden by config.local.yaml");
  else if (saved !== running) {
    notes.push(`running: ${running === "" ? "(default)" : running} — restart to apply`);
  }
  const hint = [field.hint, ...notes].filter(Boolean).join(" · ");
  const placeholder = field.placeholder ? `default: ${field.placeholder}` : undefined;

  if (field.kind === "boolean" || field.kind === "select") {
    const options = field.kind === "boolean" ? ["true", "false"] : (field.options ?? []);
    return (
      <DeskSelect
        id={id}
        label={field.label}
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder ?? "default"}
        hint={hint || undefined}
      />
    );
  }
  return (
    <DeskField
      id={id}
      label={field.label}
      value={value}
      onChange={onChange}
      type={field.kind === "number" ? "number" : field.kind === "secret" ? "password" : "text"}
      placeholder={placeholder}
      hint={hint || undefined}
    />
  );
}

/** The whole file, for the keys the form has no field for. */
function RawEditor({ snapshot }: { snapshot: SettingsSnapshot }) {
  const save = useSaveSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? snapshot.text;
  const dirty = draft !== null && draft !== snapshot.text;
  const unknown = (save.data as { unknown?: string[] } | undefined)?.unknown ?? [];

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!dirty) return;
        save.mutate({ text }, { onSuccess: () => setDraft(null) });
      }}
    >
      <p className="text-xs text-muted-foreground">
        <code className="rounded bg-muted px-1 py-0.5">{snapshot.file}</code>, as it is on disk.
        The previous version is kept beside it as <code>.bak</code>.
      </p>
      <textarea
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        className="min-h-[60vh] w-full rounded-2xl border-[1.5px] border-input bg-field p-4 font-mono text-xs leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {unknown.length > 0 && (
        <Notice tone="warn">
          Saved. The kiosk does not know {unknown.length === 1 ? "this key" : "these keys"} and
          will ignore {unknown.length === 1 ? "it" : "them"}: {unknown.join(", ")}
        </Notice>
      )}
      {save.isError && <Failure error={save.error} />}
      <SaveBar
        count={dirty ? 1 : 0}
        saving={save.isPending}
        onDiscard={() => setDraft(null)}
        saved={save.isSuccess && !dirty}
        label={dirty ? "config.yaml edited" : undefined}
      />
    </form>
  );
}

function SaveBar({
  count,
  saving,
  saved,
  onDiscard,
  label,
}: {
  count: number;
  saving: boolean;
  saved: boolean;
  onDiscard: () => void;
  label?: string;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3 lg:px-10">
        <span className="text-sm text-muted-foreground">
          {count > 0
            ? (label ?? `${count} unsaved change${count === 1 ? "" : "s"}`)
            : saved
              ? "Saved to config.yaml."
              : "No unsaved changes."}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onDiscard} disabled={count === 0 || saving}>
            Discard
          </Button>
          <Button type="submit" disabled={count === 0 || saving}>
            {saving && <Spinner />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
