#! /usr/bin/env bash
# Test script for build.sh

set -u

# Navigate to repo root (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass=0
fail=0

test_result() {
    local name="$1" expected="$2" actual="$3"
    if [[ "$actual" == *"$expected"* ]]; then
        echo -e "${GREEN}✓ PASS${NC}: $name"
        ((pass++))
    else
        echo -e "${RED}✗ FAIL${NC}: $name"
        echo "  Expected: $expected"
        echo "  Actual: $actual"
        ((fail++))
    fi
}

test_exit_code() {
    local name="$1" expected="$2" actual="$3"
    if [[ "$actual" -eq "$expected" ]]; then
        echo -e "${GREEN}✓ PASS${NC}: $name (exit code $actual)"
        ((pass++))
    else
        echo -e "${RED}✗ FAIL${NC}: $name"
        echo "  Expected exit code: $expected"
        echo "  Actual exit code: $actual"
        ((fail++))
    fi
}

echo -e "${YELLOW}════════════════════════════════════${NC}"
echo -e "${YELLOW}  Testing build.sh${NC}"
echo -e "${YELLOW}════════════════════════════════════${NC}"
echo ""

# Save original version for restore
ORIGINAL_VERSION=$(grep -o '"version": "[^"]*"' xpi.src/manifest.json | sed 's/.*"\([^"]*\)"$/\1/')

restore_manifest() {
    sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$ORIGINAL_VERSION\"/" xpi.src/manifest.json
}

# Test 1: Unknown option
echo -e "${YELLOW}Test 1: Unknown option handling${NC}"
output=$(./build.sh --unknown 2>&1)
code=$?
test_result "Unknown option message" "Unknown option" "$output"
test_exit_code "Unknown option exits with 1" 1 "$code"
echo ""

# Test 2: Version extraction
echo -e "${YELLOW}Test 2: Version functions${NC}"
source <(sed -n '/^get_version/,/^}/p' build.sh)
MANIFEST="xpi.src/manifest.json"
version=$(get_version)
test_result "Get version from manifest" "0.1" "$version"
echo ""

# Test 3: CI mode detection
echo -e "${YELLOW}Test 3: CI mode detection${NC}"
output=$(CI=true ./build.sh --force 2>&1 | head -5)
test_result "CI mode shows (CI Mode)" "(CI Mode)" "$output"
echo ""

# Test 4: --ci flag
echo -e "${YELLOW}Test 4: --ci flag${NC}"
output=$(./build.sh --ci --force 2>&1 | head -5)
test_result "--ci flag enables CI mode" "(CI Mode)" "$output"
echo ""

# Test 5: Version bump (patch)
echo -e "${YELLOW}Test 5: Version bump - patch${NC}"
restore_manifest  # Reset
output=$(./build.sh patch --force 2>&1)
test_result "Patch bump message" "Updating version" "$output"
# Check the version was actually bumped
new_version=$(get_version)
test_result "Patch version incremented" "0.1.9" "$new_version"
echo ""

# Test 6: Version bump (minor)
echo -e "${YELLOW}Test 6: Version bump - minor${NC}"
restore_manifest  # Reset
output=$(./build.sh minor --force 2>&1)
new_version=$(get_version)
test_result "Minor version incremented" "0.2.0" "$new_version"
echo ""

# Test 7: Version bump (major)
echo -e "${YELLOW}Test 7: Version bump - major${NC}"
restore_manifest  # Reset
output=$(./build.sh major --force 2>&1)
new_version=$(get_version)
test_result "Major version incremented" "1.0.0" "$new_version"
echo ""

# Test 8: Explicit version
echo -e "${YELLOW}Test 8: Explicit --version${NC}"
restore_manifest  # Reset
output=$(./build.sh --version 2.5.3 --force 2>&1)
new_version=$(get_version)
test_result "Explicit version set" "2.5.3" "$new_version"
echo ""

# Test 9: Keep version in CI mode (no bump)
echo -e "${YELLOW}Test 9: CI mode keeps current version${NC}"
restore_manifest  # Reset
output=$(./build.sh --ci --force 2>&1)
new_version=$(get_version)
test_result "CI mode keeps version" "0.1.8" "$new_version"
echo ""

# Test 10: Colors disabled in CI
echo -e "${YELLOW}Test 10: Colors disabled in CI mode${NC}"
output=$(CI=true ./build.sh --force 2>&1 | head -1)
# In CI mode with no TTY, should not have ANSI codes
if [[ "$output" != *$'\033'* ]]; then
    echo -e "${GREEN}✓ PASS${NC}: No ANSI colors in CI output"
    ((pass++))
else
    echo -e "${RED}✗ FAIL${NC}: ANSI colors present in CI output"
    ((fail++))
fi
echo ""

# Test 11: --flavor public (single file)
echo -e "${YELLOW}Test 11: --flavor public${NC}"
restore_manifest
rm -f _build/sticky-tabsz-v*.zip 2>/dev/null
output=$(./build.sh --ci --flavor public --force 2>&1)
test_result "Public flavor message" "Building public" "$output"
if [[ -f "_build/sticky-tabsz-v${ORIGINAL_VERSION}.zip" ]]; then
    echo -e "${GREEN}✓ PASS${NC}: Public zip created"
    ((pass++))
else
    echo -e "${RED}✗ FAIL${NC}: Public zip not found"
    ((fail++))
fi
echo ""

# Test 12: --flavor unlisted (single file with modified ID)
echo -e "${YELLOW}Test 12: --flavor unlisted${NC}"
restore_manifest
rm -f _build/sticky-tabsz-v*.zip 2>/dev/null
output=$(./build.sh --ci --flavor unlisted --force 2>&1)
test_result "Unlisted flavor message" "Building unlisted" "$output"
if [[ -f "_build/sticky-tabsz-v${ORIGINAL_VERSION}-unlisted.zip" ]]; then
    echo -e "${GREEN}✓ PASS${NC}: Unlisted zip created"
    ((pass++))
    # Verify the ID was changed
    temp_check=$(mktemp -d)
    unzip -q "_build/sticky-tabsz-v${ORIGINAL_VERSION}-unlisted.zip" -d "$temp_check"
    if grep -q "sticky-tabsz-unlisted@" "$temp_check/manifest.json"; then
        echo -e "${GREEN}✓ PASS${NC}: Unlisted has modified extension ID"
        ((pass++))
    else
        echo -e "${RED}✗ FAIL${NC}: Unlisted ID not modified"
        ((fail++))
    fi
    rm -rf "$temp_check"
else
    echo -e "${RED}✗ FAIL${NC}: Unlisted zip not found"
    ((fail++))
fi
echo ""

# Test 13: --flavor both (two files)
echo -e "${YELLOW}Test 13: --flavor both${NC}"
restore_manifest
rm -f _build/sticky-tabsz-v*.zip 2>/dev/null
output=$(./build.sh --ci --flavor both --force 2>&1)
public_exists=false
unlisted_exists=false
[[ -f "_build/sticky-tabsz-v${ORIGINAL_VERSION}.zip" ]] && public_exists=true
[[ -f "_build/sticky-tabsz-v${ORIGINAL_VERSION}-unlisted.zip" ]] && unlisted_exists=true
if [[ "$public_exists" == true ]] && [[ "$unlisted_exists" == true ]]; then
    echo -e "${GREEN}✓ PASS${NC}: Both flavors created"
    ((pass++))
else
    echo -e "${RED}✗ FAIL${NC}: Missing flavor(s) - public:$public_exists unlisted:$unlisted_exists"
    ((fail++))
fi
echo ""

# Test 14: --lint-only skips packaging
echo -e "${YELLOW}Test 14: --lint-only${NC}"
restore_manifest
rm -f _build/sticky-tabsz-v*.zip 2>/dev/null
output=$(./build.sh --ci --lint-only 2>&1)
test_result "Lint-only message" "Lint-only mode" "$output"
if ! ls _build/sticky-tabsz-v*.zip &>/dev/null; then
    echo -e "${GREEN}✓ PASS${NC}: No zip created in lint-only mode"
    ((pass++))
else
    echo -e "${RED}✗ FAIL${NC}: Zip created despite lint-only"
    ((fail++))
fi
echo ""

# Test 15: CI mode defaults to both flavors
echo -e "${YELLOW}Test 15: CI mode defaults to both flavors${NC}"
restore_manifest
rm -f _build/sticky-tabsz-v*.zip 2>/dev/null
output=$(./build.sh --ci --force 2>&1)
test_result "Shows both flavor" "Flavor:  both" "$output"
echo ""

# Restore manifest
restore_manifest

# Summary
echo -e "${YELLOW}════════════════════════════════════${NC}"
echo -e "Results: ${GREEN}$pass passed${NC}, ${RED}$fail failed${NC}"
echo -e "${YELLOW}════════════════════════════════════${NC}"

[[ $fail -eq 0 ]] && exit 0 || exit 1
