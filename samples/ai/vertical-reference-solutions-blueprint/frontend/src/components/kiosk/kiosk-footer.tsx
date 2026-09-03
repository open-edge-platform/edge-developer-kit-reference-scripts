// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ArrowLeft, Lock, Save } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { SecondaryButton } from "./secondary-button";

type Props = {
  showBack: boolean;
  onBack: () => void;
  /** Shown mid-flow once identity is verified: pause the application. */
  onSaveExit?: () => void;
  saving?: boolean;
};

export function KioskFooter({ showBack, onBack, onSaveExit, saving }: Props) {
  return (
    <footer className="ks-veil-footer flex flex-none items-center justify-between gap-4 border-t px-10 py-4 backdrop-blur-xl">
      <div>
        {showBack && (
          <SecondaryButton onClick={onBack} className="px-8">
            <ArrowLeft />
            Back
          </SecondaryButton>
        )}
      </div>
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2.5 text-base text-muted-foreground/80">
          <Lock className="size-5" />
          Secure session · data encrypted end-to-end
        </div>
        {onSaveExit && (
          <SecondaryButton onClick={onSaveExit} disabled={saving} className="px-8">
            {saving ? <Spinner className="size-5" /> : <Save />}
            Save &amp; Exit
          </SecondaryButton>
        )}
      </div>
    </footer>
  );
}
