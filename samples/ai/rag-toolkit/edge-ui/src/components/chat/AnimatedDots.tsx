// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable react/no-unknown-property -- style jsx false trigger */
import React from "react";

export default function AnimatedDots(): React.JSX.Element {
  return (
    <div className="dotContainer">
      <div className="dot" />
      <div className="dot" />
      <div className="dot" />
      <style jsx>{`
          .dotContainer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 40px;
          }
          .dot {
            width: 3px;
            height: 3px;
            background-color: #333;
            border-radius: 50%;
            animation: float 1.5s infinite ease-in-out;
            margin: 0 5px;
          }
          .dot:nth-child(2) {
            animation-delay: 0.3s;
          }
          .dot:nth-child(3) {
            animation-delay: 0.6s;
          }
          @keyframes float {
            0%,
            100% {
              transform: translateY(0);
            }
            50% {
              transform: translateY(-10px);
            }
          }
        `}</style>
    </div>
  );
};