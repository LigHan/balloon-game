@echo off
cd /d "%~dp0"
if not exist build mkdir build
javac --release 21 --add-modules jdk.httpserver -encoding UTF-8 -d build src\balloon\*.java
if errorlevel 1 exit /b 1
java --add-modules jdk.httpserver -cp build balloon.Server
