// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "child_process";
import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import { createConnection } from "net";
import path from "path";
import { publicBoolean } from "@/lib/public-config";
import type { ServiceHealth } from "./health";
import { delay } from "./http";

/** escpos: a receipt printer the server writes ESC/POS to; mock: printing is pretended; off: only the browser's Print. */
export type PrinterDriverId = "escpos" | "mock" | "off";

export function printerDriverId(): PrinterDriverId {
  // printer.enabled: false hides every Print, so the printer is neither probed nor sent anything.
  if (!publicBoolean("NEXT_PUBLIC_KIOSK_PRINTER_ENABLED", true)) return "off";
  const id = process.env.KIOSK_PRINTER_DRIVER?.trim().toLowerCase();
  return id === "escpos" || id === "mock" ? id : "off";
}

/** "usb": the first USB printer; else a device path, part of a Windows one (VID_0483&PID_7540), or tcp://host:port. */
const target = () => process.env.KIOSK_PRINTER_DEVICE?.trim() || "usb";

/** The printable width in dots: 576 for 80 mm paper, 384 for 58 mm. */
export function printerWidthDots(): number {
  const dots = Number(process.env.KIOSK_PRINTER_WIDTH_DOTS);
  return dots >= 192 && dots <= 1024 ? Math.floor(dots / 8) * 8 : 576;
}

export type PrintFailure = "no_printer" | "paper_out" | "cover_open" | "offline" | "failed";

export class PrintError extends Error {
  constructor(
    readonly reason: PrintFailure,
    message: string,
  ) {
    super(message);
    this.name = "PrintError";
  }
}

/** For the citizen; the error's own message is for the log. */
export const PRINT_FAILURE_MESSAGE: Record<PrintFailure, string> = {
  no_printer: "The printer isn't connected. Take a photo of the screen instead, or ask at the counter.",
  paper_out: "The printer is out of paper. Take a photo of the screen instead, or ask at the counter.",
  cover_open: "The printer's cover is open. Take a photo of the screen instead, or ask at the counter.",
  offline: "The printer isn't ready. Take a photo of the screen instead, or ask at the counter.",
  failed: "The printer didn't print that. Take a photo of the screen instead, or ask at the counter.",
};

type Sent = { device: string; paperLow?: boolean };

const WRITE_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 3_000;
const LINUX_USB = Array.from({ length: 10 }, (_, n) => `/dev/usb/lp${n}`);

/**
 * Windows hands a USB printer out as a device interface that Node's fs cannot
 * open (the C runtime refuses its "unknown" file type), so a short Windows
 * PowerShell script does the Win32 calls: find the printer, ask its status
 * (DLE EOT 1, 2, 4), and write the job. stdin carries the target on its first
 * line and the job (base64) after it. Every read and write is overlapped and
 * cancelled at a deadline: a printer that never
 * answers must not hang the kiosk. It is passed with -EncodedCommand, which
 * the execution policy does not apply to, and prints one JSON line.
 */
const WINDOWS_HELPER = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32.SafeHandles;

public static class KioskPrinter {
  static Guid UsbPrint = new Guid("28d78fad-5a12-11d1-ae5b-0000f803a8c2");

  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
  static extern int CM_Get_Device_Interface_List_SizeW(out int length, ref Guid cls, string device, int flags);
  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
  static extern int CM_Get_Device_Interface_ListW(ref Guid cls, string device, char[] buffer, int length, int flags);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool WriteFile(SafeFileHandle file, IntPtr buffer, int length, IntPtr done, IntPtr overlapped);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool ReadFile(SafeFileHandle file, IntPtr buffer, int length, IntPtr done, IntPtr overlapped);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetOverlappedResult(SafeFileHandle file, IntPtr overlapped, out int done, bool wait);
  [DllImport("kernel32.dll")]
  static extern bool CancelIoEx(SafeFileHandle file, IntPtr overlapped);

  // Present USB printers only: a printer redirected over Remote Desktop is not this kiosk's.
  static string Find(string target) {
    if (target.StartsWith(@"\\")) return target;
    int length;
    if (CM_Get_Device_Interface_List_SizeW(out length, ref UsbPrint, null, 0) != 0 || length <= 1) return null;
    var buffer = new char[length];
    if (CM_Get_Device_Interface_ListW(ref UsbPrint, null, buffer, length, 0) != 0) return null;
    foreach (var path in new string(buffer).Split(new[] { '\0' }, StringSplitOptions.RemoveEmptyEntries)) {
      if (path.IndexOf(@"\USB#", StringComparison.OrdinalIgnoreCase) < 0) continue;
      if (target == "usb" || path.IndexOf(target, StringComparison.OrdinalIgnoreCase) >= 0) return path;
    }
    return null;
  }

  // Bytes moved, or -1 on an error or at the deadline.
  static int Io(SafeFileHandle file, bool write, byte[] data, int timeoutMs) {
    IntPtr buffer = Marshal.AllocHGlobal(Math.Max(data.Length, 1));
    IntPtr overlapped = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(NativeOverlapped)));
    using (var finished = new ManualResetEvent(false)) {
      try {
        var request = new NativeOverlapped();
        request.EventHandle = finished.SafeWaitHandle.DangerousGetHandle();
        Marshal.StructureToPtr(request, overlapped, false);
        if (write) Marshal.Copy(data, 0, buffer, data.Length);
        bool started = write
          ? WriteFile(file, buffer, data.Length, IntPtr.Zero, overlapped)
          : ReadFile(file, buffer, data.Length, IntPtr.Zero, overlapped);
        if (!started && Marshal.GetLastWin32Error() != 997) return -1;
        int count;
        if (!finished.WaitOne(timeoutMs)) {
          CancelIoEx(file, overlapped);
          GetOverlappedResult(file, overlapped, out count, true);
          return -1;
        }
        if (!GetOverlappedResult(file, overlapped, out count, false)) return -1;
        if (!write) Marshal.Copy(buffer, data, 0, count);
        return count;
      } finally {
        Marshal.FreeHGlobal(overlapped);
        Marshal.FreeHGlobal(buffer);
      }
    }
  }

  // DLE EOT n: one status byte, -1 when the printer does not answer with one.
  static int Ask(SafeFileHandle file, byte n) {
    if (Io(file, true, new byte[] { 0x10, 0x04, n }, 1000) != 3) return -1;
    var reply = new byte[8];
    int count = Io(file, false, reply, 700);
    if (count < 1) return -1;
    int status = reply[count - 1];
    return (status & 0x93) == 0x12 ? status : -1;
  }

  static string Quote(string text) {
    return "\"" + text.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
  }

  static string Fail(string reason, string message) {
    return "{\"ok\":false,\"reason\":" + Quote(reason) + ",\"message\":" + Quote(message) + "}";
  }

  public static string Run(string target, byte[] job) {
    string path = Find(target);
    if (path == null) return Fail("no_printer", "no USB printer matching '" + target + "' is connected");
    using (var file = CreateFileW(path, 0xC0000000, 3, IntPtr.Zero, 3, 0x40000000, IntPtr.Zero)) {
      if (file.IsInvalid) return Fail("no_printer", "cannot open " + path + " (error " + Marshal.GetLastWin32Error() + ")");
      int printer = Ask(file, 1), cause = Ask(file, 2), paper = Ask(file, 4);
      if (cause >= 0 && (cause & 0x04) != 0) return Fail("cover_open", "the cover is open");
      if ((paper >= 0 && (paper & 0x60) != 0) || (cause >= 0 && (cause & 0x20) != 0)) return Fail("paper_out", "out of paper");
      if (printer >= 0 && (printer & 0x08) != 0) return Fail("offline", "the printer reports itself offline");
      if (job.Length > 0 && Io(file, true, job, ${WRITE_TIMEOUT_MS}) != job.Length) return Fail("failed", "the printer did not take the whole job");
      bool low = paper >= 0 && (paper & 0x0C) != 0;
      return "{\"ok\":true,\"device\":" + Quote(path) + ",\"paperLow\":" + (low ? "true" : "false") + "}";
    }
  }
}
'@
$target, $job = [Console]::In.ReadToEnd() -split '\n', 2
[Console]::Out.Write([KioskPrinter]::Run($target.Trim(), [Convert]::FromBase64String($job.Trim())))
`;

/** Only Windows PowerShell itself is ever run: the one under SystemRoot when that is
 *  the usual C:\Windows, else whichever powershell.exe PATH resolves. */
const POWERSHELL_BINS = ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"];
const POWERSHELL =
  POWERSHELL_BINS.find(
    (allowed) =>
      allowed.toLowerCase() ===
      path.win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe").toLowerCase(),
  ) ?? "powershell.exe";

type HelperReply = { ok: true; device: string; paperLow: boolean } | { ok: false; reason: PrintFailure; message: string };

/** An empty job only asks for the status. */
function windowsUsb(job: Buffer): Promise<Sent> {
  const script = Buffer.from(WINDOWS_HELPER, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    const child = execFile(
      POWERSHELL,
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", script],
      { timeout: WRITE_TIMEOUT_MS + 15_000, windowsHide: true },
      (error, stdout, stderr) => {
        let reply: HelperReply | null = null;
        try {
          reply = JSON.parse(String(stdout).trim()) as HelperReply;
        } catch {
          // Reported below with whatever PowerShell said.
        }
        if (reply?.ok) return resolve({ device: reply.device, paperLow: reply.paperLow });
        if (reply) return reject(new PrintError(reply.reason, reply.message));
        const detail = String(stderr).trim().split("\n").pop() || error?.message || "no reply";
        reject(new PrintError("failed", `printer helper: ${detail}`));
      },
    );
    child.stdin?.end(`${target()}\n${job.toString("base64")}`);
  });
}

function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PrintError("offline", `${what} did not finish within ${ms / 1000}s`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** The usblp device takes the job as it is; it cannot be asked about paper. */
async function deviceFile(job: Buffer): Promise<Sent> {
  const wanted = target();
  const device = wanted === "usb" ? LINUX_USB.find((file) => existsSync(file)) : wanted;
  if (!device || !existsSync(device)) throw new PrintError("no_printer", `${wanted === "usb" ? "/dev/usb/lp*" : wanted} is not present`);
  if (job.length > 0) await withDeadline(writeFile(device, job), WRITE_TIMEOUT_MS, device);
  return { device };
}

/** A network printer's raw port (9100); an empty job only checks it answers. */
function network(url: string, job: Buffer): Promise<Sent> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: hostname, port: Number(port) || 9100 });
    socket.setTimeout(job.length > 0 ? WRITE_TIMEOUT_MS : PROBE_TIMEOUT_MS, () => socket.destroy(new Error("timed out")));
    socket.on("error", (error) => reject(new PrintError("no_printer", `${url}: ${error.message}`)));
    socket.on("connect", () => socket.end(job, () => resolve({ device: url })));
  });
}

function transport(job: Buffer): Promise<Sent> {
  const wanted = target();
  if (/^tcp:\/\//i.test(wanted)) return network(wanted, job);
  return process.platform === "win32" ? windowsUsb(job) : deviceFile(job);
}

const QUEUE = Symbol.for("kiosk.printer.queue");
type Global = { [QUEUE]?: Promise<unknown> };

/** One job at a time: a status query landing inside another job's raster would garble the print. */
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const globals = globalThis as Global;
  const run = (globals[QUEUE] ?? Promise.resolve()).then(work, work);
  globals[QUEUE] = run.catch(() => undefined);
  return run;
}

/** Sends a finished ESC/POS job; throws a PrintError the citizen can be told about. */
export async function printJob(job: Buffer, label: string): Promise<Sent> {
  if (printerDriverId() === "mock") {
    // Stand in for the seconds a real print takes.
    await delay(1_500);
    console.info(`[printer] mock: ${label} (${job.length} bytes)`);
    return { device: "mock" };
  }
  if (printerDriverId() === "off") throw new PrintError("no_printer", "printer.driver is off");
  const sent = await exclusive(() => transport(job));
  if (sent.paperLow) console.warn(`[printer] ${sent.device}: paper is running low`);
  console.info(`[printer] ${label} -> ${sent.device} (${job.length} bytes)`);
  return sent;
}

const HEALTH_TTL_MS = 60_000;
const HEALTH = Symbol.for("kiosk.printer.health");
type HealthCache = { at: number; health: ServiceHealth };

/** Report-only, like the scanners; the result is held a minute, since the screens poll health every few seconds. */
export async function printerHealth(): Promise<ServiceHealth> {
  if (printerDriverId() !== "escpos") return "off";
  const globals = globalThis as { [HEALTH]?: HealthCache };
  const cached = globals[HEALTH];
  if (cached && Date.now() - cached.at < HEALTH_TTL_MS) return cached.health;
  const health: ServiceHealth = await exclusive(() => transport(Buffer.alloc(0))).then(
    () => "ok",
    () => "unreachable",
  );
  globals[HEALTH] = { at: Date.now(), health };
  return health;
}
