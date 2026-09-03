// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/** What the assistant is doing right now, as the pose that shows it. */
export type AvatarState =
  | "greeting"
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "pointing"
  | "celebrating";

/** Never both on one arm: `rotate` and an animated `transform` would compose, not replace. */
const ARM_POSE: Record<AvatarState, { left: string; right: string }> = {
  idle: { left: "rotate-[7deg]", right: "rotate-[-7deg]" },
  greeting: { left: "rotate-[7deg]", right: "animate-ks-arm-wave" },
  listening: { left: "rotate-[126deg]", right: "rotate-[-7deg]" },
  thinking: { left: "rotate-[7deg]", right: "rotate-[-112deg]" },
  speaking: { left: "animate-ks-arm-talk-l", right: "animate-ks-arm-talk-r" },
  pointing: { left: "rotate-[7deg]", right: "animate-ks-arm-point" },
  celebrating: { left: "rotate-[128deg]", right: "rotate-[-128deg]" },
};

/**
 * The drawn kiosk assistant in a cleanroom "bunny suit", animated entirely in
 * CSS. Colors are fixed, not theme tokens: the face is a dark screen and the
 * suit is white in both themes.
 */
export function AvatarFigure({
  state,
  className,
}: {
  state: AvatarState;
  className?: string;
}) {
  // Several figures can be on one page — gradient and filter ids must not collide.
  const uid = useId();
  const suit = `suit-${uid}`;
  const glow = `glow-${uid}`;

  const speaking = state === "speaking";
  const listening = state === "listening";
  const thinking = state === "thinking";
  const happyEyes = state === "greeting" || state === "celebrating";

  // Arms are drawn hanging straight down; poses rotate them about the shoulder joint.
  const armBase = "origin-[50%_12px] transition-transform duration-500 [transform-box:fill-box]";
  const pose = ARM_POSE[state];

  const accentPulse = speaking || listening ? "animate-ks-blink" : "opacity-70";

  const eye = (x: number) => (
    <rect
      key={x}
      className="origin-center animate-ks-eye-blink [transform-box:fill-box]"
      x={x}
      y="104"
      width="24"
      height="34"
      rx="12"
      fill="#00c7fd"
      filter={`url(#${glow})`}
    />
  );

  return (
    <svg
      viewBox="0 0 320 320"
      role="img"
      aria-label={`Kiosk assistant, ${state}`}
      className={cn("overflow-visible", className)}
    >
      <defs>
        <linearGradient id={suit} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#eef2fb" />
          <stop offset="1" stopColor="#dde5f4" />
        </linearGradient>
        <filter id={glow} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <ellipse cx="160" cy="296" rx="88" ry="10" fill="rgba(16,27,58,0.12)" />

      {/* The whole figure bobs as one — bobbing only the head opened a seam at the shoulders. */}
      <g className="animate-ks-bob">
        {/* Sleeves, with a cuff and a glove each. */}
        <g className={cn(armBase, pose.left)}>
          <rect
            x="53"
            y="218"
            width="22"
            height="58"
            rx="11"
            fill={`url(#${suit})`}
            stroke="rgba(16,27,58,0.16)"
            strokeWidth="2"
          />
          <rect x="53" y="252" width="22" height="10" rx="5" fill="#c9dcf5" />
          <circle
            cx="64"
            cy="280"
            r="13"
            fill="#b9d4f1"
            stroke="rgba(16,27,58,0.14)"
            strokeWidth="2"
          />
        </g>
        <g className={cn(armBase, pose.right)}>
          <rect
            x="245"
            y="218"
            width="22"
            height="58"
            rx="11"
            fill={`url(#${suit})`}
            stroke="rgba(16,27,58,0.16)"
            strokeWidth="2"
          />
          <rect x="245" y="252" width="22" height="10" rx="5" fill="#c9dcf5" />
          <circle
            cx="256"
            cy="280"
            r="13"
            fill="#b9d4f1"
            stroke="rgba(16,27,58,0.14)"
            strokeWidth="2"
          />
        </g>

        {/* The suit's body: zipper down the front, status light on the chest. */}
        <rect
          x="72"
          y="212"
          width="176"
          height="82"
          rx="38"
          fill={`url(#${suit})`}
          stroke="rgba(16,27,58,0.16)"
          strokeWidth="2"
        />
        <line
          x1="160"
          y1="238"
          x2="160"
          y2="292"
          stroke="#c3cede"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <rect x="154" y="238" width="12" height="8" rx="3" fill="#aebfd9" />
        <circle
          className={accentPulse}
          cx="129"
          cy="252"
          r="7"
          fill="#00c7fd"
          filter={`url(#${glow})`}
        />
        {listening && (
          <circle
            className="origin-center animate-ks-wave [transform-box:fill-box]"
            cx="129"
            cy="252"
            r="14"
            fill="none"
            stroke="#00c7fd"
            strokeWidth="3"
          />
        )}

        <g className={cn(speaking && "origin-[center_80%] animate-ks-tilt [transform-box:fill-box]")}>
          <line
            x1="160"
            y1="44"
            x2="160"
            y2="26"
            stroke="#aebfd9"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <circle
            className={accentPulse}
            cx="160"
            cy="18"
            r="7.5"
            fill="#00c7fd"
            filter={`url(#${glow})`}
          />
          {/* The hood, and the seam around its face window. */}
          <rect
            x="58"
            y="44"
            width="204"
            height="180"
            rx="62"
            fill={`url(#${suit})`}
            stroke="rgba(16,27,58,0.16)"
            strokeWidth="2"
          />
          <rect
            x="82"
            y="72"
            width="156"
            height="126"
            rx="44"
            fill="none"
            stroke="#ccd7ea"
            strokeWidth="7"
          />
          <rect x="84" y="74" width="152" height="122" rx="42" fill="#0d1730" />

          {/* Eyes: happy arcs, a glance aside while thinking, blinking otherwise. */}
          {happyEyes ? (
            <g
              stroke="#00c7fd"
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
              filter={`url(#${glow})`}
            >
              <path d="M114 126 Q128 110 142 126" />
              <path d="M178 126 Q192 110 206 126" />
            </g>
          ) : (
            <g style={thinking ? { transform: "translate(7px, -6px)" } : undefined}>
              {eye(116)}
              {eye(180)}
            </g>
          )}

          {/* Mouth: equalizer while speaking, busy dots while thinking, a smile otherwise. */}
          {speaking ? (
            <g fill="#00c7fd" filter={`url(#${glow})`}>
              {[
                { x: 128, y: 150, h: 22, delay: 0 },
                { x: 142, y: 144, h: 34, delay: 120 },
                { x: 156, y: 140, h: 42, delay: 240 },
                { x: 170, y: 144, h: 34, delay: 360 },
                { x: 184, y: 150, h: 22, delay: 480 },
              ].map((bar) => (
                <rect
                  key={bar.x}
                  className="origin-bottom animate-ks-equalize [transform-box:fill-box]"
                  style={{ animationDelay: `${bar.delay}ms` }}
                  x={bar.x}
                  y={bar.y}
                  width="7"
                  height={bar.h}
                  rx="3.5"
                />
              ))}
            </g>
          ) : thinking ? (
            <g fill="#00c7fd" filter={`url(#${glow})`}>
              {[140, 160, 180].map((x, i) => (
                <circle
                  key={x}
                  className="animate-ks-think-dot"
                  style={{ animationDelay: `${i * 200}ms` }}
                  cx={x}
                  cy="163"
                  r="5"
                />
              ))}
            </g>
          ) : (
            <path
              d="M136 160 Q160 173 184 160"
              stroke="#00c7fd"
              strokeWidth={happyEyes ? 6 : 5}
              fill="none"
              strokeLinecap="round"
              filter={`url(#${glow})`}
            />
          )}
        </g>
      </g>
    </svg>
  );
}
