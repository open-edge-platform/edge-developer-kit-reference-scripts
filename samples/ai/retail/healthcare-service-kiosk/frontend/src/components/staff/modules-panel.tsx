// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { DeskCheckbox, DeskField } from "@/components/staff/desk-fields";
import { Badge } from "@/components/ui/badge";
import { MODULES } from "@/modules/manifest";
import { dependentsOf, enabledModules, needsOf } from "@/modules/state";
import type { NamedModule } from "@/modules/types";
import { allCategories, allServices } from "@/services/catalog";

const ids = (value: string): string[] =>
  value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

/**
 * modules.disabled as a checkbox per service and feature, and modules.only as
 * the list it is. What a module needs, and whether it actually runs once those
 * are taken into account, is shown beside it; shared parts follow the modules
 * that use them and have no box of their own.
 */
export function ModulesPanel({
  disabled,
  only,
  running,
  overridden,
  onChange,
}: {
  disabled: string;
  only: string;
  /** The same two settings as the running kiosk has them. */
  running: { disabled: string; only: string };
  /** Which of the two config.local.yaml sets, shadowing this file. */
  overridden: string[];
  onChange: (key: "modules.disabled" | "modules.only", value: string) => void;
}) {
  const off = ids(disabled);
  const kept = ids(only);
  const on = enabledModules({ disabled: off, only: kept });
  const runs = enabledModules({ disabled: ids(running.disabled), only: ids(running.only) });
  const shadowed = overridden.length > 0;
  const features = MODULES.filter((m): m is NamedModule => m.kind === "feature");
  const shared = MODULES.filter((m): m is NamedModule => m.kind === "shared");
  const services = allServices();
  const titleOf = (id: string) =>
    MODULES.find((m): m is NamedModule => m.id === id && m.kind !== "service")?.title ??
    services.find((s) => s.id === id)?.label ??
    id;
  const known = new Set([...MODULES.map((m) => m.id), ...services.map((s) => s.id)]);
  const unknown = [...off, ...kept].filter((id) => !known.has(id));

  const toggle = (id: string, checked: boolean) =>
    onChange("modules.disabled", (checked ? off.filter((x) => x !== id) : [...off, id]).join(","));

  const row = (id: string, title: string, summary?: string) => {
    const needs = needsOf(id);
    const blocked = !off.includes(id) && !on(id);
    return (
      <div key={id} className="flex flex-col gap-1">
        <DeskCheckbox id={`module-${id}`} label={title} checked={!off.includes(id)} onChange={(checked) => toggle(id, checked)} />
        <p className="pl-7 text-xs text-muted-foreground">
          <code>{id}</code>
          {summary && ` — ${summary}`}
          {needs.length > 0 && ` · needs ${needs.map(titleOf).join(", ")}`}
          {blocked && <span className="text-warning"> · off: {kept.length > 0 && !kept.includes(id) ? "not in “Only these”" : "something it needs is off"}</span>}
          {runs(id) !== on(id) && (
            <span className="text-warning">
              {" "}
              · running {runs(id) ? "on" : "off"}
              {shadowed ? " (config.local.yaml)" : " — restart to apply"}
            </span>
          )}
        </p>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {shadowed && (
        <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
          config.local.yaml sets {overridden.join(" and ")}, so what runs follows that file, not
          these boxes — rows marked “running” show where the two differ.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">{features.map((m) => row(m.id, m.title, m.summary))}</div>

      {allCategories().map((category) => (
        <div key={category.id} className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{category.label}</h3>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {category.groups.flatMap((group) => group.services).map((service) => row(service.id, service.label))}
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Shared parts</h3>
        <div className="flex flex-wrap gap-2">
          {shared.map((m) => (
            <Badge
              key={m.id}
              variant={on(m.id) ? "secondary" : "outline"}
              title={`${m.summary} Used by ${dependentsOf(m.id).map(titleOf).join(", ")}.`}
            >
              {m.title}: {on(m.id) ? "on" : "off"}
            </Badge>
          ))}
        </div>
      </div>

      <DeskField
        id="setting-modules-only"
        label="Only these"
        value={only}
        onChange={(value) => onChange("modules.only", value)}
        placeholder="every module"
        hint="Comma-separated ids: keep just these and what they need. The boxes above still switch modules off within them."
      />

      {unknown.length > 0 && (
        <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
          Not a module of this kiosk, so ignored: {unknown.join(", ")}
        </p>
      )}
    </div>
  );
}
