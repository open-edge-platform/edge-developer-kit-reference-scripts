// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

const label = document.getElementById("progress-label");
const output = document.getElementById("output");
const progressBar = document.getElementById("progress-bar");

window.electronAPI.onPipProgress((step) => {
  console.log(step);
  if (output) {
    output.textContent += step.status + "\n";
  }
  label.textContent = step.status;
  progressBar.style.width = step.progress + "%";
});

window.electronAPI.onPipDone((code) => {
  label.textContent =
    code === 0 ? "Installation complete!" : "Installation failed!";
  progressBar.style.width = "100%";
});
