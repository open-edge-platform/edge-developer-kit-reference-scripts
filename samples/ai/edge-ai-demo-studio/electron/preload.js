// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onPipProgress: (callback) =>
    ipcRenderer.on("pip-progress", (event, data) => callback(data)),
  onPipDone: (callback) =>
    ipcRenderer.on("pip-done", (event, code) => callback(code)),
  onPipLog: (callback) =>
    ipcRenderer.on("pip-log", (_, line) => callback(line)),
});
