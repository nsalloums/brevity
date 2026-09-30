#!/usr/bin/env bash
# Opts the run's empty workspace in to brevity the way README "For reviewers" does: a .brevity/ folder with
# DICT.template.md copied to .brevity/DICT.md. claude plugin eval runs this only with --scaffold.
set -euo pipefail

case_dir=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)
template="$case_dir/../../../DICT.template.md"
if [ ! -f "$template" ]; then
  echo "scaffold.sh: cannot find DICT.template.md at $template" >&2
  exit 1
fi

mkdir -p .brevity
cp "$template" .brevity/DICT.md
