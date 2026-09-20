#!/usr/bin/env bash
# Two-phase simulation runner. Invoked by start-sim.sh under setsid.
#
# Phase 1: run `./gradlew simulateExternalJava`. GradleRIO builds the
# project, extracts JNI natives into build/jni/release, and writes
# build/sim/java.json describing the runnable simulation. Because the
# task is not a JavaExec, Gradle exits cleanly once it finishes.
#
# Phase 2: read the descriptor, set HALSim env vars and library paths, then
# `exec java -cp` so this shell becomes the robot JVM. Because the PID
# survives exec, the caller's pid_file remains valid for the entire sim
# lifetime — Gradle is no longer in memory while the simulation runs.
#
# See docs/decisions/025-detach-sim-from-gradle.md.

set -euo pipefail

if [[ "$#" -lt 6 ]]; then
  echo "Usage: $0 <project_root> <gradle_cache_dir> <max_workers> <gradle_jvmargs> <robot_jvmargs> <init_script>" >&2
  exit 64
fi

project_root="$1"
gradle_cache="$2"
gradle_max_workers="$3"
gradle_jvmargs="$4"
robot_jvmargs="$5"
init_script="$6"

cd "$project_root"

init_args=()
if [[ -f "$init_script" ]]; then
  init_args=(--init-script "$init_script")
fi

./gradlew \
  --no-daemon \
  --no-watch-fs \
  "--max-workers=$gradle_max_workers" \
  --console=plain \
  --project-cache-dir "$gradle_cache" \
  "-Dorg.gradle.jvmargs=$gradle_jvmargs" \
  "${init_args[@]}" \
  simulateExternalJava installDist

descriptor="$project_root/build/sim/java.json"
if [[ ! -f "$descriptor" ]]; then
  echo "BUILD FAILED: sim descriptor was not produced at $descriptor" >&2
  exit 1
fi

robot_jar="$(find "$project_root/build/libs" -maxdepth 1 -type f -name '*.jar' \
  ! -name '*-sources.jar' ! -name '*-javadoc.jar' -print -quit 2>/dev/null || true)"
if [[ -z "$robot_jar" ]]; then
  echo "BUILD FAILED: no robot JAR under $project_root/build/libs" >&2
  exit 1
fi

lib_dir="$(jq -r '.[0].libraryDir // empty' "$descriptor")"

# The init script removes halsim_gui and halsim_ds_socket from the
# simulationRelease config, so their libs are never extracted. The descriptor
# still lists them, so filter by what actually exists on disk.
halsim_extensions="$(
  jq -r '.[0].extensions[]? | select(.defaultEnabled == true) | .libName' "$descriptor" \
    | while IFS= read -r ext; do
        if [[ -n "$ext" && -f "$ext" ]]; then
          printf '%s\n' "$ext"
        fi
      done | paste -sd: -
)"

if [[ -n "$lib_dir" ]]; then
  export LD_LIBRARY_PATH="${lib_dir}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
  export DYLD_LIBRARY_PATH="${lib_dir}${DYLD_LIBRARY_PATH:+:${DYLD_LIBRARY_PATH}}"
  export DYLD_FALLBACK_LIBRARY_PATH="${lib_dir}${DYLD_FALLBACK_LIBRARY_PATH:+:${DYLD_FALLBACK_LIBRARY_PATH}}"
fi
if [[ -n "$halsim_extensions" ]]; then
  export HALSIM_EXTENSIONS="$halsim_extensions"
fi

read -r -a robot_jvmargs_array <<<"$robot_jvmargs"
java_args=(
  "${robot_jvmargs_array[@]}"
  "--add-opens"
  "java.base/jdk.internal.vm=ALL-UNNAMED"
  "--add-opens"
  "java.base/java.lang=ALL-UNNAMED"
  "--enable-native-access=ALL-UNNAMED"
  )
if [[ -n "$lib_dir" ]]; then
  java_args+=("-Djava.library.path=$lib_dir")
fi

install_lib_dir="$(find "$project_root/build/install" \
  -mindepth 2 -maxdepth 2 -type d -name lib -print -quit)"

if [[ -z "$install_lib_dir" ]]; then
  echo "BUILD FAILED: application distribution was not produced" >&2
  exit 1
fi

main_class="$(jq -r '.[0].mainClassName // empty' "$descriptor")"

if [[ -z "$main_class" ]]; then
  echo "BUILD FAILED: simulation descriptor has no mainClassName" >&2
  exit 1
fi

exec java "${java_args[@]}" \
  -cp "$robot_jar:$install_lib_dir/*" \
  "$main_class"
