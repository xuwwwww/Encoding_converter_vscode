@echo off
setlocal

echo === 執行 npm run compile ===
call npm run compile
if errorlevel 1 (
  echo [錯誤] npm compile 失敗，停止後續
  exit /b %errorlevel%
)

echo === 執行 vsce package ===
call vsce package --allow-missing-repository --allow-star-activation
if errorlevel 1 (
  echo [錯誤] vsce package 失敗
  exit /b %errorlevel%
)

echo === 全部步驟完成 ===
endlocal
