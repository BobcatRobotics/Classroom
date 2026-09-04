#!/usr/bin/env bash
# Reconcile CodeRunner-managed VS Code extensions from the image cache while
# preserving extensions installed by the student.

set -euo pipefail

CACHE_DIR="${1:-/opt/frc-extensions-cache}"
EXTENSIONS_DIR="${2:-${HOME}/extensions}"
CACHE_MANIFEST="${CACHE_DIR}/extensions.json"
TARGET_MANIFEST="${EXTENSIONS_DIR}/extensions.json"

if [[ ! -f "${CACHE_MANIFEST}" ]]; then
  echo "Missing baked extension manifest: ${CACHE_MANIFEST}" >&2
  exit 1
fi

mkdir -p "${EXTENSIONS_DIR}"

current_manifest="$(mktemp)"
merged_manifest="$(mktemp)"
trap 'rm -f "${current_manifest}" "${merged_manifest}"' EXIT

is_safe_component() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]
}

if [[ -s "${TARGET_MANIFEST}" ]] && jq -e 'type == "array"' "${TARGET_MANIFEST}" >/dev/null 2>&1; then
  cp "${TARGET_MANIFEST}" "${current_manifest}"
else
  printf '[]\n' > "${current_manifest}"
fi

managed_versions_match="$({
  jq -r '.[] | "\(.identifier.id)@\(.version)"' "${CACHE_MANIFEST}"
  printf '%s\n' --
  jq --slurpfile baked "${CACHE_MANIFEST}" -r '
    ($baked[0] | map(.identifier.id)) as $managed
    | .[]
    | select(.identifier.id as $id | $managed | index($id))
    | "\(.identifier.id)@\(.version)"
  ' "${current_manifest}"
} | awk '
  /^--$/ { target = 1; next }
  target { current[++current_count] = $0; next }
  { baked[++baked_count] = $0 }
  END {
    if (baked_count != current_count) exit 1
    for (i = 1; i <= baked_count; i++) {
      found = 0
      for (j = 1; j <= current_count; j++) {
        if (baked[i] == current[j]) found = 1
      }
      if (!found) exit 1
    }
  }
' && echo yes || echo no)"

managed_directories_present=yes
while IFS=$'\t' read -r extension_id relative_location; do
  if ! is_safe_component "${extension_id}" \
    || ! is_safe_component "${relative_location}" \
    || [[ "${relative_location}" != "${extension_id}"-* ]] \
    || [[ ! -d "${EXTENSIONS_DIR}/${relative_location}" ]]; then
    managed_directories_present=no
    break
  fi
  while IFS= read -r installed_directory; do
    if [[ "$(basename "${installed_directory}")" != "${relative_location}" ]]; then
      managed_directories_present=no
      break 2
    fi
  done < <(find "${EXTENSIONS_DIR}" -mindepth 1 -maxdepth 1 -type d -name "${extension_id}-*" -print)
done < <(jq -r '.[] | [.identifier.id, .relativeLocation] | @tsv' "${CACHE_MANIFEST}")

if [[ "${managed_versions_match}" == yes && "${managed_directories_present}" == yes ]]; then
  echo unchanged
  exit 0
fi

while IFS= read -r extension_id; do
  is_safe_component "${extension_id}" || {
    echo "Unsafe managed extension ID in baked manifest: ${extension_id}" >&2
    exit 1
  }
  find "${EXTENSIONS_DIR}" -mindepth 1 -maxdepth 1 -type d \
    -name "${extension_id}-*" -exec rm -rf -- {} +
done < <(jq -r '.[].identifier.id' "${CACHE_MANIFEST}")

while IFS=$'\t' read -r extension_id relative_location; do
  is_safe_component "${extension_id}" \
    && is_safe_component "${relative_location}" \
    && [[ "${relative_location}" == "${extension_id}"-* ]] \
    && [[ -d "${CACHE_DIR}/${relative_location}" ]] || {
    echo "Unsafe or missing baked extension directory: ${relative_location}" >&2
    exit 1
  }
  cp -a "${CACHE_DIR}/${relative_location}" "${EXTENSIONS_DIR}/${relative_location}"
done < <(jq -r '.[] | [.identifier.id, .relativeLocation] | @tsv' "${CACHE_MANIFEST}")

jq \
  --slurpfile baked "${CACHE_MANIFEST}" \
  --arg extensionsDir "${EXTENSIONS_DIR}" \
  '
    ($baked[0] | map(.identifier.id)) as $managed
    | [ .[] | select(.identifier.id as $id | ($managed | index($id) | not)) ]
      + [ $baked[0][]
          | .location.path = ($extensionsDir + "/" + .relativeLocation) ]
  ' "${current_manifest}" > "${merged_manifest}"
mv "${merged_manifest}" "${TARGET_MANIFEST}"

if [[ -s "${EXTENSIONS_DIR}/.obsolete" ]] && jq -e 'type == "object"' "${EXTENSIONS_DIR}/.obsolete" >/dev/null 2>&1; then
  obsolete_manifest="$(mktemp)"
  jq --slurpfile baked "${CACHE_MANIFEST}" '
    ($baked[0] | map(.identifier.id + "-")) as $prefixes
    | with_entries(
        select(.key as $key | ($prefixes | map(. as $prefix | $key | startswith($prefix)) | any | not))
      )
  ' "${EXTENSIONS_DIR}/.obsolete" > "${obsolete_manifest}"
  mv "${obsolete_manifest}" "${EXTENSIONS_DIR}/.obsolete"
fi

echo changed
