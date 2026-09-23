; DevPulse hides to the tray when its window is closed, so the default "close the app"
; step can't stop it. Force-close it (and its helper processes) before installing.
!macro customCheckAppRunning
  nsExec::Exec 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  Sleep 1000
!macroend
