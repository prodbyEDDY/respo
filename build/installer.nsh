; Explorer caches icons by source path. A versioned icon makes an upgrade
; independent of stale entries for Respo.exe, without clearing the system cache.
!macro customInstall
  ${If} ${FileExists} "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$INSTDIR\resources\respo-${VERSION}.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    System::Call 'Shell32::SHChangeNotify(i 0x2000, i 0x1005, w "$newStartMenuLink", p 0)'
  ${EndIf}
  ${If} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\resources\respo-${VERSION}.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    System::Call 'Shell32::SHChangeNotify(i 0x2000, i 0x1005, w "$newDesktopLink", p 0)'
  ${EndIf}
!macroend
