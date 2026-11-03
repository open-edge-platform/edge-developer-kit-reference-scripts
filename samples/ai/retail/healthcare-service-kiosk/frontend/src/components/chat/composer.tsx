// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useId } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** The one place typed citizen input enters the chat. The `mic` slot carries the voice
 *  controls; a dictated turn lands here as editable text. */
export function Composer({
  inputRef,
  busy,
  awaiting,
  placeholder,
  value,
  onValueChange,
  onSubmit,
  mic,
  error,
  status,
}: {
  inputRef?: React.Ref<HTMLInputElement>;
  busy: boolean;
  awaiting?: boolean;
  placeholder: string;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (text: string) => void;
  mic?: React.ReactNode;
  error?: string | null;
  status?: string | null;
}) {
  const hintId = useId();
  const submit = () => {
    const text = value.trim();
    if (!text || busy) return;
    onValueChange("");
    onSubmit(text);
  };
  return (
    <form
      aria-label="Send a message"
      className="shrink-0 border-t bg-card px-3 py-3 sm:px-6 sm:py-4"
      onSubmit={(event) => { event.preventDefault(); submit(); }}
    >
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-2xl border bg-field p-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
        {mic}
        <input
          ref={inputRef}
          value={value}
          aria-label={awaiting ? "Your answer" : "Your message"}
          aria-describedby={hintId}
          autoComplete="off"
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
          }}
          placeholder={placeholder}
          className="h-12 min-w-0 flex-1 rounded-xl bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground sm:px-3 sm:text-lg"
        />
        <Button
          type="submit"
          className="size-12 shrink-0 rounded-xl"
          disabled={busy || !value.trim()}
          aria-label="Send"
        >
          {busy ? <Spinner className="size-5" /> : <ArrowUp className="size-6" />}
        </Button>
      </div>
      <p
        id={hintId}
        role={error ? "alert" : "status"}
        className={cn(
          "mx-auto mt-2 w-full max-w-3xl px-1 text-sm",
          error ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {error ?? status ?? (busy ?"Preparing your reply. You can type your next message." : "Type a message or choose a service above.")}
      </p>
    </form>
  );
}
