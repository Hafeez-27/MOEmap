# Rebuild the Option Remote map and publish it to Vercel (Windows PowerShell)
$ErrorActionPreference = "Stop"

Set-Location "$PSScriptRoot\.."

Write-Host "Building remote map..." -ForegroundColor Cyan
node tools/build-remote-map.mjs

Write-Host "Building deploy bundle..." -ForegroundColor Cyan
node tools/build-deploy.mjs

Write-Host "Deploying to Vercel..." -ForegroundColor Cyan
Set-Location "deploy/moe-option-remote-map"
npx --yes vercel@latest deploy --prod --yes

