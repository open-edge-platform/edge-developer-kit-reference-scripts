; Custom NSIS installer script for EdgeAIDemoStudio
;
; Features:
;  - Default install directory: folder containing the installer + \EdgeAIDemoStudio
;  - Optional desktop shortcut page (checkbox, checked by default)

; ---- Shared declarations (included in every build pass) ---------------
; Functions MUST be defined here (in customHeader, not inside customWelcomePage).
; Defining Functions inside a macro that is itself expanded from within
; electron-builder's assistedInstaller.nsh causes NSIS 3.0.4 to misparse
; stack Pop operations inside those Functions.
; Guard with !ifndef BUILD_UNINSTALLER so the uninstaller pass does not
; declare variables/functions that are never referenced there (which would
; trigger warning 6001 / 6010, promoted to errors by electron-builder).
!macro customHeader
  !include "nsDialogs.nsh"
  !include "LogicLib.nsh"

  !ifndef BUILD_UNINSTALLER
    Var /GLOBAL DesktopShortcutCtrl
    Var /GLOBAL CreateDesktopShortcut

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

      ; Unchecked by default
      ${NSD_SetState} $DesktopShortcutCtrl ${BST_UNCHECKED}

      nsDialogs::Show
    FunctionEnd

    Function DesktopShortcutPageLeave
      ${NSD_GetState} $DesktopShortcutCtrl $CreateDesktopShortcut
    FunctionEnd
  !endif
!macroend

; ---- Default install directory ----------------------------------------
; $EXEDIR = directory that contains the running installer .exe
!macro customInit
  StrCpy $INSTDIR "$EXEDIR"
!macroend

; ---- Register the custom page in the installer wizard -----------------
; Only contains the Page directive — no Function definitions here.
!macro customWelcomePage
  Page custom DesktopShortcutPageCreate DesktopShortcutPageLeave
!macroend

; ---- Create desktop shortcut when user opted in ----------------------
!macro customInstall
  ${If} $CreateDesktopShortcut == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\EdgeAIDemoStudio.lnk" "$INSTDIR\EdgeAIDemoStudio.exe"
  ${EndIf}
!macroend

; ---- Remove desktop shortcut on uninstall ----------------------------
!macro customUnInstall
  Delete "$DESKTOP\EdgeAIDemoStudio.lnk"
!macroend
