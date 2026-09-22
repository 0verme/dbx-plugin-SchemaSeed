@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo SchemaSeed Table Context Probe requires Node.js 22 or newer. 1>&2
  exit /b 127
)
node "%~dp0..\..\backend\schema-seed-probe.mjs" %*
exit /b %errorlevel%
