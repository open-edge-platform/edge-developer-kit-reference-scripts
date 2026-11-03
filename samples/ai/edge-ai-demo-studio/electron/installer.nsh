; Custom NSIS installer script for EdgeAIDemoStudio: installs to <installer folder>\EdgeAIDemoStudio,
; with an optional desktop shortcut and "Run in the background" (tray at login), both unchecked.

; Functions MUST be defined here, not in customWelcomePage: inside a macro expanded from
; electron-builder's assistedInstaller.nsh, NSIS 3.0.4 misparses their stack Pops. The
; BUILD_UNINSTALLER guard keeps unused vars/functions out of the uninstaller pass, where warnings
; 6001/6010 would be errors under electron-builder.
!macro customHeader
  !include "nsDialogs.nsh"
  !include "LogicLib.nsh"

  !ifndef BUILD_UNINSTALLER
    Var /GLOBAL DesktopShortcutCtrl
    Var /GLOBAL CreateDesktopShortcut
    Var /GLOBAL RunInTrayCtrl
    Var /GLOBAL RunInTray

    Function DesktopShortcutPageCreate
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}

      ${NSD_CreateLabel} 0 0 100% 20u "Additional options"
      Pop $0

      ${NSD_CreateCheckbox} 0 28u 100% 14u "Create a shortcut on the Desktop"
      Pop $DesktopShortcutCtrl

      ${NSD_SetState} $DesktopShortcutCtrl ${BST_UNCHECKED}

      ${NSD_CreateCheckbox} 0 46u 100% 14u "Run in the background (tray icon, start at login)"
      Pop $RunInTrayCtrl

      ${NSD_SetState} $RunInTrayCtrl ${BST_UNCHECKED}

      ${NSD_CreateLabel} 12u 62u 100% 24u "Starts hidden in the notification area when you sign in and keeps running after the window is closed. Can be changed later from the tray menu or by reinstalling."
      Pop $0

      nsDialogs::Show
    FunctionEnd

    Function DesktopShortcutPageLeave
      ${NSD_GetState} $DesktopShortcutCtrl $CreateDesktopShortcut
      ${NSD_GetState} $RunInTrayCtrl $RunInTray
    FunctionEnd
  !endif
!macroend

; $EXEDIR is the folder containing the running installer; electron-builder appends the app folder.
!macro customInit
  StrCpy $INSTDIR "$EXEDIR"
!macroend

; Only the Page directive here; its Functions live in customHeader.
!macro customWelcomePage
  Page custom DesktopShortcutPageCreate DesktopShortcutPageLeave
!macroend

; The app (electron/main.js) enables its tray only when resources\tray-mode exists. The Run value
; name matches the app's AppUserModelId, so the tray menu's "Start at login" toggle manages it too.
!macro customInstall
  ${If} $CreateDesktopShortcut == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\EdgeAIDemoStudio.lnk" "$INSTDIR\EdgeAIDemoStudio.exe"
  ${EndIf}

  ${If} $RunInTray == ${BST_CHECKED}
    FileOpen $0 "$INSTDIR\resources\tray-mode" w
    FileWrite $0 "enabled$\r$\n"
    FileClose $0
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.intel.edge-ai-demo-studio" '"$INSTDIR\EdgeAIDemoStudio.exe" --hidden'
  ${Else}
    Delete "$INSTDIR\resources\tray-mode"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.intel.edge-ai-demo-studio"
  ${EndIf}
!macroend

!macro customUnInstall
  Delete "$DESKTOP\EdgeAIDemoStudio.lnk"
  Delete "$INSTDIR\resources\tray-mode"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.intel.edge-ai-demo-studio"
!macroend
