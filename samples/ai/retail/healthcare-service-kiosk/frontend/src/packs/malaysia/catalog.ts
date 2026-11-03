// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type {
  CategoryDefinition,
  CategoryMeta,
  GroupMeta,
  ServiceDefinition,
} from "@/services/types";

// Single require.context on purpose — Turbopack dedupes contexts on the same
// directory, so multiple calls with different filters won't work.
const definitionCtx = require.context("./services", true, /\/(category|group|service)\.ts$/);

const keysEndingWith = (name: string) =>
  definitionCtx.keys().filter((key) => key.endsWith(`/${name}.ts`));

const dirOf = (key: string) => key.slice(2, key.lastIndexOf("/"));
const byOrder = <T extends { order?: number }>(a: T, b: T) =>
  (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);

const services = keysEndingWith("service").map((key) => {
  const { service } = definitionCtx<{ service: ServiceDefinition }>(key);
  return { ...service, dir: dirOf(key) };
});

const groups = keysEndingWith("group").map((key) => {
  const { group } = definitionCtx<{ group: GroupMeta }>(key);
  const dir = dirOf(key);
  return {
    ...group,
    dir,
    services: services.filter((s) => s.dir!.startsWith(`${dir}/`)).sort(byOrder),
  };
});

export const CATEGORIES: CategoryDefinition[] = keysEndingWith("category")
  .map((key) => {
    const { category } = definitionCtx<{ category: CategoryMeta }>(key);
    const dir = dirOf(key);
    return {
      ...category,
      groups: groups.filter((g) => g.dir.startsWith(`${dir}/`)).sort(byOrder),
    };
  })
  .sort(byOrder);

export const SERVICES: ServiceDefinition[] = services;
