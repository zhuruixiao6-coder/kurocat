; 安装前先结束正在运行的实例，避免 exe 被占用导致 NSIS 中止（"Error launching installer"）
!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Closing running KuroCat instances..."
  nsExec::Exec 'taskkill /IM KuroCat.exe /F'
  Sleep 600
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /IM KuroCat.exe /F'
  Sleep 600
!macroend
