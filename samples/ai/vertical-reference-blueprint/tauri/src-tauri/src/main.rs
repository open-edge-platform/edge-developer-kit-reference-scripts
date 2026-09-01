// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// The kiosk is a Next.js server. This shell starts that server as a child
// process, waits for it to answer, and points one webview window at it — so
// the whole kiosk ships as a single .AppImage/.exe instead of a machine with
// Node and a checked-out repository on it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io;
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent};

/// How long the server gets to answer before the window says so. Generous:
/// a kiosk that is slow to start is still a kiosk, and one that gives up is
/// a black screen someone has to drive out to.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(180);

/// Every process group the shell has started, in start order.
///
/// Closing the window is the only "quit" a kiosk gets, so the shell owns the
/// teardown of everything below it. Killing the process it spawned is not
/// enough: that process is a shell script, and the stack under it (npm, the
/// studio's Next server, and the AI workers the studio detaches into process
/// groups of their own) outlives it.
struct Children(Mutex<Vec<Child>>);

/// How long a group gets to wind down after SIGTERM before it is killed
/// outright. The studio stops its AI workers one at a time, each with its own
/// grace period, so this is deliberately generous.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(20);

/// Set by the SIGINT/SIGTERM handler — storing a flag is all a signal handler
/// may safely do; the watchdog thread it starts does the actual teardown.
static INTERRUPTED: AtomicBool = AtomicBool::new(false);

/// Set once the shell knows it is showing the platform rather than the
/// standalone kiosk — only then does a page need a way back to it.
static PLATFORM_MODE: AtomicBool = AtomicBool::new(false);

/// Injected into every page the window loads while in platform mode.
///
/// The window has no chrome — no tabs, no back button — so a sample opened
/// from the gallery would otherwise be a one-way trip. This adds the way
/// back, and keeps links that ask for a new tab (the gallery's "Open the
/// kiosk") in this one window, since the shell has nowhere else to put them.
const RETURN_TO_PLATFORM: &str = r#"
(function () {
  if (window.__blueprintShell) return;
  window.__blueprintShell = true;

  var HOME = "http://127.0.0.1:8080";
  var HOME_PORT = "8080";

  window.open = function (url) { if (url) location.href = url; return null; };
  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest && event.target.closest('a[target="_blank"]');
    if (link && link.href) { event.preventDefault(); location.href = link.href; }
  }, true);

  if (location.port === HOME_PORT) return;

  document.addEventListener("keydown", function (event) {
    if (event.key === "F2" || (event.ctrlKey && event.shiftKey && event.key === "Backspace")) {
      location.href = HOME;
    }
  });

  var button = document.createElement("button");
  button.type = "button";
  button.textContent = "← Platform";
  button.title = "Back to the platform (F2)";
  button.setAttribute("style", [
    "position:fixed", "left:16px", "bottom:16px", "z-index:2147483647",
    "padding:8px 14px", "border-radius:999px", "border:1px solid rgba(255,255,255,.28)",
    "background:rgba(15,17,22,.72)", "color:#fff", "cursor:pointer",
    "font:600 12px system-ui,-apple-system,sans-serif", "opacity:.35",
    "backdrop-filter:blur(6px)", "transition:opacity .15s",
  ].join(";"));
  var show = function () { button.style.opacity = "1"; };
  var fade = function () { button.style.opacity = ".35"; };
  button.addEventListener("mouseenter", show);
  button.addEventListener("mouseleave", fade);
  button.addEventListener("touchstart", show, { passive: true });
  button.addEventListener("click", function () { location.href = HOME; });

  var attach = function () { if (document.body) document.body.appendChild(button); };
  if (document.body) attach();
  else document.addEventListener("DOMContentLoaded", attach);
})();
"#;

fn main() {
    tauri::Builder::default()
        .manage(Children(Mutex::new(Vec::new())))
        .on_page_load(|webview, _payload| {
            if PLATFORM_MODE.load(Ordering::Relaxed) {
                let _ = webview.eval(RETURN_TO_PLATFORM);
            }
        })
        .setup(|app| {
            install_signal_handlers(app.handle().clone());

            // External-target mode: something else runs the server — e.g. the
            // embedded studio bundle, which starts the kiosk itself as one of
            // its worker processes. The shell then only (optionally) launches
            // that stack and points the window at the given URL, and stops it
            // again on the way out — set KIOSK_SHELL_KEEP_ALIVE=1 to leave it
            // running instead (a studio that was already up is not ours to
            // stop; this mode only launches one when asked to).
            if let Ok(url) = std::env::var("KIOSK_SHELL_URL") {
                let port: u16 = url
                    .rsplit(':')
                    .next()
                    .map(|p| p.trim_end_matches('/'))
                    .and_then(|p| p.parse().ok())
                    .unwrap_or(80);
                // Pointed at the platform, the window needs the way back from
                // whatever a sample opens; pointed straight at the kiosk it is
                // the only page there is.
                PLATFORM_MODE.store(port == STUDIO_PORT, Ordering::Relaxed);
                if let Ok(cmd) = std::env::var("KIOSK_SHELL_CMD") {
                    let cwd = std::env::var("KIOSK_SHELL_CWD")
                        .unwrap_or_else(|_| ".".to_string());
                    let mut launch = Command::new("bash");
                    launch
                        .arg("-lc")
                        .arg(&cmd)
                        .current_dir(&cwd)
                        .stdout(Stdio::inherit())
                        .stderr(Stdio::inherit());
                    scrub_appimage_env(&mut launch);
                    if std::env::var("KIOSK_SHELL_KEEP_ALIVE").is_ok() {
                        launch.spawn()?;
                    } else {
                        spawn_tracked(app.handle(), &mut launch)?;
                    }
                }
                let timeout = std::env::var("KIOSK_SHELL_TIMEOUT_SECS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .map(Duration::from_secs)
                    .unwrap_or(STARTUP_TIMEOUT);
                let window = app
                    .get_webview_window("main")
                    .expect("the main window is declared in tauri.conf.json");
                thread::spawn(move || {
                    if wait_for_port(port, timeout) {
                        if let Ok(url) = url.parse() {
                            let _ = window.navigate(url);
                        }
                    } else {
                        let _ = window.eval(
                            "document.documentElement.dataset.state = 'failed'",
                        );
                    }
                });
                return Ok(());
            }

            let resource_dir = app.path().resource_dir()?;

            // Embedded-bundle mode: the package carries the minimal studio
            // export (kiosk injected as a sample) as a single tar. First
            // launch unpacks it into the data directory and runs the studio's
            // own setup there — the worker environments must be created where
            // they will live, and the install itself is read-only. Every
            // launch then starts the studio, which brings the kiosk up as its
            // own worker process; the window opens on the studio.
            let bundle_tar = bundled(&resource_dir, "kiosk-studio.tar");
            if bundle_tar.exists() {
                PLATFORM_MODE.store(true, Ordering::Relaxed);
                let data_dir = app.path().app_data_dir()?;
                let window = app
                    .get_webview_window("main")
                    .expect("the main window is declared in tauri.conf.json");
                let handle = app.handle().clone();
                thread::spawn(move || run_bundle(handle, window, bundle_tar, data_dir));
                return Ok(());
            }

            let server_dir = bundled(&resource_dir, "server");
            let data_dir = app.path().app_data_dir()?;
            prepare_data_dir(&resource_dir, &data_dir)?;

            let port = match std::env::var("KIOSK_PORT").ok().and_then(|p| p.parse().ok()) {
                Some(port) => port,
                None => free_port()?,
            };

            spawn_tracked(
                app.handle(),
                &mut server_command(&server_dir, &data_dir, port),
            )?;

            // The window is already up showing the splash; it is swapped for
            // the kiosk itself once the port answers, off the main thread so
            // the splash keeps painting while Next boots.
            let window = app
                .get_webview_window("main")
                .expect("the main window is declared in tauri.conf.json");
            thread::spawn(move || {
                if wait_for_port(port, STARTUP_TIMEOUT) {
                    let url = format!("http://127.0.0.1:{port}");
                    if let Ok(url) = url.parse() {
                        let _ = window.navigate(url);
                    }
                } else {
                    let _ = window.eval(
                        "document.documentElement.dataset.state = 'failed'",
                    );
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start the kiosk shell")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_all(app);
            }
        });
}

/// The port the embedded bundle's studio serves on. Fixed by the studio's own
/// start script, not chosen here.
const STUDIO_PORT: u16 = 8080;

/// An AppImage's launch hooks export PYTHONHOME, PYTHONPATH, PATH and library
/// paths pointing into the mounted image (/tmp/.mount_*) so the webview finds
/// its bundled libraries. Children of the shell are not part of the image —
/// a worker venv's Python with PYTHONHOME on the mount cannot even find its
/// stdlib ("No module named 'encodings'"), and the mount vanishes when the
/// app closes while detached workers live on. Drop every inherited value that
/// points into the image; path lists keep their system entries. No-op outside
/// an AppImage (APPDIR unset).
fn scrub_appimage_env(command: &mut Command) {
    let Ok(appdir) = std::env::var("APPDIR") else { return };
    if appdir.is_empty() {
        return;
    }
    for (key, value) in std::env::vars() {
        if !value.contains(&appdir) {
            continue;
        }
        let kept: Vec<&str> = value
            .split(':')
            .filter(|part| !part.contains(&appdir))
            .collect();
        if kept.is_empty() {
            command.env_remove(&key);
        } else {
            command.env(&key, kept.join(":"));
        }
    }
}

/// Unpack (first launch), set up (first launch) and start the embedded
/// bundle, then point the window at the studio once it answers.
fn run_bundle(
    handle: tauri::AppHandle,
    window: tauri::WebviewWindow,
    tar: PathBuf,
    data_dir: PathBuf,
) {
    let studio = data_dir.join("kiosk-studio");
    if let Err(error) = prepare_bundle(&handle, &window, &tar, &data_dir, &studio) {
        eprintln!("kiosk-shell: {error}");
        let _ = window.eval("document.documentElement.dataset.state = 'failed'");
        return;
    }

    splash_note(&window, "Starting the platform...");
    let mut start = Command::new("bash");
    start
        .arg("./start.sh")
        .current_dir(&studio)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    scrub_appimage_env(&mut start);
    if let Err(error) = spawn_tracked(&handle, &mut start) {
        eprintln!("kiosk-shell: could not start the studio: {error}");
        let _ = window.eval("document.documentElement.dataset.state = 'failed'");
        return;
    }

    let timeout = std::env::var("KIOSK_SHELL_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .map(Duration::from_secs)
        .unwrap_or(Duration::from_secs(900));
    if wait_for_port(STUDIO_PORT, timeout) {
        if let Ok(url) = format!("http://127.0.0.1:{STUDIO_PORT}").parse() {
            let _ = window.navigate(url);
        }
    } else {
        let _ = window.eval("document.documentElement.dataset.state = 'failed'");
    }
}

fn prepare_bundle(
    handle: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    tar: &Path,
    data_dir: &Path,
    studio: &Path,
) -> io::Result<()> {
    if !studio.exists() {
        splash_note(window, "Unpacking the platform (first launch)...");
        // Extract next to the final name and rename at the end, so a launch
        // killed mid-extract does not leave a half tree that the next launch
        // takes for a finished one.
        let scratch = data_dir.join("kiosk-studio.partial");
        let _ = fs::remove_dir_all(&scratch);
        fs::create_dir_all(&scratch)?;
        let mut unpack = Command::new("tar");
        unpack.arg("-xf").arg(tar).current_dir(&scratch);
        scrub_appimage_env(&mut unpack);
        run_ok(handle, &mut unpack)?;
        fs::rename(scratch.join("studio"), studio)?;
        let _ = fs::remove_dir_all(&scratch);
    }

    if !studio.join("frontend").join(".next").join("BUILD_ID").exists() {
        splash_note(
            window,
            "Installing services (first launch) - this downloads and can take a while...",
        );
        let mut setup = Command::new("bash");
        setup.arg("./setup.sh").current_dir(studio);
        scrub_appimage_env(&mut setup);
        run_ok(handle, &mut setup)?;
    }
    Ok(())
}

/// Run `command` to completion, tracked, so that closing the window during a
/// first-launch setup stops the download instead of orphaning it.
fn run_ok(handle: &tauri::AppHandle, command: &mut Command) -> io::Result<()> {
    command.stdout(Stdio::inherit()).stderr(Stdio::inherit());
    let status = wait_tracked(handle, spawn_tracked(handle, command)?)?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other(format!("`{command:?}` exited with {status}")))
    }
}

/// Progress text on the splash page; a no-op once the page is replaced.
/// Messages are ASCII literals without quotes, so no escaping is needed.
fn splash_note(window: &tauri::WebviewWindow, message: &str) {
    let _ = window.eval(&format!(
        "document.getElementById('progress-label').textContent = '{message}'"
    ));
}

/// Start `node kiosk.cjs` — the standalone Next server with the kiosk's
/// settings read in first (see resources/server/kiosk.cjs).
///
/// Everything the kiosk writes is pointed at `data_dir`: an .AppImage is a
/// read-only mount and an installed .exe lives under Program Files, so the
/// database, the captured documents and the uploaded portraits cannot stay
/// beside the bundled server the way they do in a checkout.
fn server_command(server_dir: &Path, data_dir: &Path, port: u16) -> Command {
    let mut command = Command::new(node_binary());
    command
        .arg(server_dir.join("kiosk.cjs"))
        .current_dir(server_dir)
        .env("NODE_ENV", "production")
        .env("PORT", port.to_string())
        // Loopback only. The kiosk's API has no authentication of its own and
        // Next would otherwise bind every interface on the machine.
        .env("HOSTNAME", "127.0.0.1")
        .env("KIOSK_DATA_DIR", data_dir)
        .env(
            "DATABASE_URL",
            format!("file:{}", data_dir.join("db.sqlite").display()),
        )
        .env("KIOSK_UPLOADS_DIR", data_dir.join("documents"))
        .env("KIOSK_FACE_PHOTOS_DIR", data_dir.join("face-photos"))
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    command
}

/// The Node runtime bundled beside the executable (see `externalBin`), or
/// whatever `node` is on PATH — which is what `tauri dev` runs against.
fn node_binary() -> PathBuf {
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(name)))
        .filter(|path| path.exists())
        .unwrap_or_else(|| PathBuf::from(name))
}

/// Resources keep their staged path inside the bundle on some targets and are
/// flattened on others; look in both rather than guess.
fn bundled(resource_dir: &Path, name: &str) -> PathBuf {
    let nested = resource_dir.join("resources").join(name);
    if nested.exists() {
        return nested;
    }
    resource_dir.join(name)
}

/// Create the writable half of the install and fill it in on first run.
///
/// Nothing here is ever overwritten: config.yaml is the operator's to edit,
/// and the database is the terminal's own once it has taken a request. An
/// upgrade replaces the bundle beside them and leaves both alone.
fn prepare_data_dir(resource_dir: &Path, data_dir: &Path) -> io::Result<()> {
    fs::create_dir_all(data_dir.join("documents"))?;
    fs::create_dir_all(data_dir.join("face-photos"))?;

    let config = data_dir.join("config.yaml");
    if !config.exists() {
        let template = bundled(resource_dir, "config.yaml");
        if template.exists() {
            fs::copy(&template, &config)?;
        }
    }

    // Built and seeded at package time, because Payload only creates its
    // tables outside production and a packaged kiosk has no other chance.
    let database = data_dir.join("db.sqlite");
    if !database.exists() {
        let template = bundled(resource_dir, "database");
        if template.join("db.sqlite").exists() {
            fs::copy(template.join("db.sqlite"), &database)?;
            // The portraits the seeded rows point at.
            copy_dir(&template.join("face-photos"), &data_dir.join("face-photos"))?;
        }
    }
    Ok(())
}

fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    if !from.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// A port the kiosk can have to itself. Asking the OS for one and letting it
/// go is a race in theory; in practice it beats a fixed port that a second
/// kiosk — or anything else on the machine — may already hold.
fn free_port() -> io::Result<u16> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    listener.local_addr().map(|addr| addr.port())
}

fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    false
}

/// Spawn `command` as the leader of a new process group and remember it, so
/// the whole tree it grows can be signalled later as one.
///
/// A group of its own is also why the shell forwards the terminal's Ctrl+C
/// itself (`install_signal_handlers`) — the kernel no longer delivers it to
/// these children.
fn spawn_tracked(handle: &tauri::AppHandle, command: &mut Command) -> io::Result<u32> {
    #[cfg(unix)]
    command.process_group(0);
    let child = command.spawn()?;
    let pid = child.id();
    handle.state::<Children>().0.lock().unwrap().push(child);
    Ok(pid)
}

/// Wait for a tracked child, leaving it tracked while it runs. Polled rather
/// than blocked on, because the exit handler needs the list in the meantime;
/// a teardown that takes the child out from under this reports it as an error
/// so the caller stops instead of carrying on into a half-finished install.
fn wait_tracked(handle: &tauri::AppHandle, pid: u32) -> io::Result<ExitStatus> {
    loop {
        {
            let state = handle.state::<Children>();
            let mut children = state.0.lock().unwrap();
            let Some(index) = children.iter().position(|child| child.id() == pid) else {
                return Err(io::Error::other("stopped before it finished"));
            };
            if let Some(status) = children[index].try_wait()? {
                // Already reaped by try_wait; wait() only hands back the
                // status it cached, and keeps clippy from calling this a leak.
                let _ = children.remove(index).wait();
                return Ok(status);
            }
        }
        thread::sleep(Duration::from_millis(200));
    }
}

/// Stop everything the shell started, most recent first: SIGTERM to each
/// process group, then a shared grace period, then SIGKILL for whatever is
/// left. The gentle signal is the point — the studio's Next server stops its
/// AI workers from its own SIGTERM handler, and those workers are detached
/// into process groups of their own that nothing here would otherwise reach.
fn stop_all(handle: &tauri::AppHandle) {
    let mut children: Vec<Child> =
        std::mem::take(&mut *handle.state::<Children>().0.lock().unwrap());
    if children.is_empty() {
        return;
    }
    for child in children.iter().rev() {
        terminate_group(child.id());
    }

    let deadline = Instant::now() + shutdown_grace();
    loop {
        // Reap our own children first: a zombie leader keeps its group alive.
        for child in children.iter_mut() {
            let _ = child.try_wait();
        }
        if children.iter().all(|child| !group_alive(child.id())) {
            return;
        }
        if Instant::now() >= deadline {
            break;
        }
        thread::sleep(Duration::from_millis(200));
    }

    for child in children.iter_mut() {
        kill_group(child.id());
        let _ = child.try_wait();
    }
}

fn shutdown_grace() -> Duration {
    std::env::var("KIOSK_SHELL_SHUTDOWN_SECS")
        .ok()
        .and_then(|value| value.parse().ok())
        .map(Duration::from_secs)
        .unwrap_or(SHUTDOWN_GRACE)
}

#[cfg(unix)]
fn terminate_group(pid: u32) {
    signal_group(pid, libc::SIGTERM);
}

#[cfg(unix)]
fn kill_group(pid: u32) {
    signal_group(pid, libc::SIGKILL);
}

/// True while any process in the group still exists. A group is addressed by
/// the pid of its leader even after that leader is gone.
#[cfg(unix)]
fn group_alive(pid: u32) -> bool {
    unsafe { libc::kill(-(pid as i32), 0) == 0 }
}

#[cfg(unix)]
fn signal_group(pid: u32, signal: i32) {
    unsafe {
        libc::kill(-(pid as i32), signal);
    }
}

/// Windows has no process groups to signal and no SIGTERM to be gentle with;
/// `taskkill /T` walks the parent-child tree instead, which is enough there
/// because the studio does not detach its workers on Windows.
#[cfg(windows)]
fn terminate_group(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(windows)]
fn kill_group(pid: u32) {
    terminate_group(pid);
}

#[cfg(windows)]
fn group_alive(_pid: u32) -> bool {
    false
}

/// Ctrl+C in the terminal that launched the app, and the SIGTERM a session
/// logout sends, both bypass Tauri's exit event — and the children are no
/// longer in this process's group, so the kernel does not pass the signal on.
/// Catch both and run the same teardown the window's close runs.
#[cfg(unix)]
fn install_signal_handlers(handle: tauri::AppHandle) {
    extern "C" fn note_signal(_signal: libc::c_int) {
        INTERRUPTED.store(true, Ordering::SeqCst);
    }
    unsafe {
        libc::signal(libc::SIGINT, note_signal as *const () as libc::sighandler_t);
        libc::signal(libc::SIGTERM, note_signal as *const () as libc::sighandler_t);
    }
    thread::spawn(move || loop {
        if INTERRUPTED.load(Ordering::SeqCst) {
            stop_all(&handle);
            std::process::exit(130);
        }
        thread::sleep(Duration::from_millis(100));
    });
}

#[cfg(windows)]
fn install_signal_handlers(_handle: tauri::AppHandle) {}
