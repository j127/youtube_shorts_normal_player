#!/usr/bin/env bash

# This script deletes unnecessary files.
# Edit the arrays to customize it.
#
# Keep this compatible with bash 3.2, the version macOS ships as /bin/bash: no
# namerefs (`local -n`), negative array indexes, `mapfile`, or other bash 4+ features.

set -euo pipefail

# node_modules cache
rm -rf ./node_modules/.cache/prettier/.prettier-cache

# Directories to exclude from traversal (relative to the repo root)
excluded_dirs=(
  '.claude'
  '.git'
  '.worktrees'
  'node_modules'
  'TANK'
)

# Files deleted by find
find_files=(
  '.DS_Store'
  'Thumbs.db'
  '*.pyc'
  '*.pyo'
  '*~'
)

# Directories deleted by find
find_dirs=(
  '__pycache__'
)

# ======= You don't need to edit below this line =======

# Build a find expression that is true when any argument matches the given test,
# e.g. `match_expr -name a b` -> `-false -o -name a -o -name b`. Bash 3.2 has no
# namerefs, so the result goes in the global `expr` array. The leading `-false`
# keeps the expression valid when there are no arguments.
match_expr() {
  local primary=$1
  shift
  expr=(-false)
  for arg in "$@"; do
    expr+=(-o "$primary" "$arg")
  done
}

# `${arr[@]+"${arr[@]}"}` expands an empty array to nothing; a plain "${arr[@]}"
# is an unbound-variable error under `set -u` in bash < 4.4.
excluded_paths=()
for dir in ${excluded_dirs[@]+"${excluded_dirs[@]}"}; do
  excluded_paths+=("./$dir")
done

match_expr -path ${excluded_paths[@]+"${excluded_paths[@]}"}
excluded_expr=("${expr[@]}")
match_expr -name ${find_files[@]+"${find_files[@]}"}
file_expr=("${expr[@]}")
match_expr -name ${find_dirs[@]+"${find_dirs[@]}"}
dir_expr=("${expr[@]}")

# Matched directories are pruned so find doesn't descend into them while they're deleted.
find . \
  \( "${excluded_expr[@]}" \) -prune -o \
  \( -type f \( "${file_expr[@]}" \) -print -exec rm -f {} + \) -o \
  \( -type d \( "${dir_expr[@]}" \) -prune -print -exec rm -rf {} + \)
