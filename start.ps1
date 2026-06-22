# Start the LaravelERD extension locally
# VS Code extension: TypeScript

$Root = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host "Starting LaravelERD (VS Code extension dev) ..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$Root`"; npm install; npm run watch; Write-Host 'Press F5 in VS Code to launch Extension Development Host'"

Write-Host "Done — the watch process is already running in the new window. Just press F5 in VS Code to launch the Extension Development Host." -ForegroundColor Cyan
