@echo off
setlocal

echo === ���� npm run compile ===
call npm run compile
if errorlevel 1 (
  echo [���~] npm compile ���ѡA�������
  exit /b %errorlevel%
)

echo === ���� vsce package ===
call vsce package --allow-missing-repository --allow-star-activation
if errorlevel 1 (
  echo [���~] vsce package ����
  exit /b %errorlevel%
)

echo === �����B�J���� ===
endlocal
