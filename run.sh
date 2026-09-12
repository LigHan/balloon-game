#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/javac" ]]; then
  BALLOON_JDK="$JAVA_HOME"
elif [[ -x "/Applications/PyCharm CE.app/Contents/jbr/Contents/Home/bin/javac" ]]; then
  BALLOON_JDK="/Applications/PyCharm CE.app/Contents/jbr/Contents/Home"
else
  BALLOON_JDK=""
fi
if [[ -n "$BALLOON_JDK" ]]; then
  BALLOON_JAVA="$BALLOON_JDK/bin/java"
  BALLOON_JAVAC="$BALLOON_JDK/bin/javac"
else
  BALLOON_JAVA="java"
  BALLOON_JAVAC="javac"
fi
mkdir -p build
"$BALLOON_JAVAC" --release 21 --add-modules jdk.httpserver -encoding UTF-8 -d build src/balloon/*.java
exec "$BALLOON_JAVA" --add-modules jdk.httpserver -cp build balloon.Server
