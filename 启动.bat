@echo off
chcp 65001 >nul
echo 正在启动果蝇玩东方Project仿真系统...
start http://localhost:3000
node server.js
pause
