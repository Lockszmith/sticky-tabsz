#! /usr/bin/env bash
# Sticky TabSZ - Build Script
# Usage:
#   ./build.sh                         # Interactive (local dev)
#   ./build.sh --ci                    # Non-interactive (CI mode)
#   ./build.sh --version 0.2.0         # Explicit version
#   ./build.sh patch|minor|major       # Bump version
#   ./build.sh --flavor public         # Public AMO build only
#   ./build.sh --flavor unlisted       # Unlisted build only
#   ./build.sh --flavor both           # Both flavors (default in CI)

set -euo pipefail

# --- Configuration ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/xpi.src"
MANIFEST="$SRC_DIR/manifest.json"
OUTPUT_DIR="$SCRIPT_DIR/_build"

# Extension IDs
PUBLIC_ID="sticky-tabsz@code.lksz.me"
UNLISTED_ID="sticky-tabsz-unlisted@code.lksz.me"

# --- Detect CI environment ---
if [[ -n "${CI:-}" || -n "${FORGEJO_ACTIONS:-}" || -n "${GITHUB_ACTIONS:-}" || "$*" == *"--ci"* ]]; then
    CI_MODE=true
else
    CI_MODE=false
fi

# --- Colors (disabled in CI or non-TTY) ---
if [[ -t 1 ]] && [[ "$CI_MODE" == false ]]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'
    YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; NC=''
fi

# --- Parse arguments ---
VERSION_ARG=""
BUMP_TYPE=""
FORCE=false
FLAVOR=""  # public, unlisted, or both

while [[ $# -gt 0 ]]; do
    case $1 in
        --version|-v) VERSION_ARG="$2"; shift 2 ;;
        --ci) shift ;;  # Already handled above
        --force|-f) FORCE=true; shift ;;
        --flavor) FLAVOR="$2"; shift 2 ;;
        --lint-only) LINT_ONLY=true; shift ;;
        patch|minor|major) BUMP_TYPE="$1"; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# Default flavor: both in CI, public locally
if [[ -z "$FLAVOR" ]]; then
    if [[ "$CI_MODE" == true ]]; then
        FLAVOR="both"
    else
        FLAVOR="public"
    fi
fi

LINT_ONLY="${LINT_ONLY:-false}"

# --- Functions ---
get_version() {
    if command -v jq &> /dev/null; then
        jq -r '.version' "$MANIFEST"
    else
        grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$MANIFEST" | sed 's/.*"\([^"]*\)"$/\1/'
    fi
}

get_extension_id() {
    if command -v jq &> /dev/null; then
        jq -r '.browser_specific_settings.gecko.id' "$MANIFEST"
    else
        grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' "$MANIFEST" | head -1 | sed 's/.*"\([^"]*\)"$/\1/'
    fi
}

set_version() {
    local new_version="$1"
    if command -v jq &> /dev/null; then
        jq --arg v "$new_version" '.version = $v' "$MANIFEST" > "$MANIFEST.tmp"
        mv "$MANIFEST.tmp" "$MANIFEST"
    else
        sed -i.bak "s/\"version\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"version\": \"$new_version\"/" "$MANIFEST"
        rm -f "$MANIFEST.bak"
    fi
}

bump_version() {
    local current="$1" type="$2"
    IFS='.' read -r major minor patch <<< "$current"
    case $type in
        patch) echo "${major}.${minor}.$((patch + 1))" ;;
        minor) echo "${major}.$((minor + 1)).0" ;;
        major) echo "$((major + 1)).0.0" ;;
    esac
}

determine_version() {
    local current
    current=$(get_version)
    
    # Priority: CLI arg > git tag > bump type > interactive/current
    if [[ -n "$VERSION_ARG" ]]; then
        echo "$VERSION_ARG"
    elif [[ -n "${GITHUB_REF_NAME:-}" ]] && [[ "${GITHUB_REF_TYPE:-}" == "tag" ]]; then
        echo "${GITHUB_REF_NAME#v}"  # Strip 'v' prefix from tag
    elif [[ -n "$BUMP_TYPE" ]]; then
        bump_version "$current" "$BUMP_TYPE"
    elif [[ "$CI_MODE" == true ]]; then
        echo "$current"  # CI without explicit version: use current
    else
        interactive_version_select "$current"
    fi
}

interactive_version_select() {
    local current="$1"
    IFS='.' read -r major minor patch <<< "$current"
    
    echo -e "${YELLOW}Current version: ${NC}$current"
    echo "  1) Patch  (${major}.${minor}.$((patch + 1)))"
    echo "  2) Minor  (${major}.$((minor + 1)).0)"
    echo "  3) Major  ($((major + 1)).0.0)"
    echo "  4) Custom"
    echo "  5) Keep current"
    read -p "Select [1-5]: " choice
    
    case $choice in
        1) bump_version "$current" patch ;;
        2) bump_version "$current" minor ;;
        3) bump_version "$current" major ;;
        4) read -p "Enter version: " v; echo "$v" ;;
        5|"") echo "$current" ;;
        *) echo "$current" ;;
    esac
}

run_lint() {
    echo -e "${YELLOW}Running web-ext lint...${NC}"
    cd "$SRC_DIR"
    
    if npx --yes web-ext lint; then
        echo -e "${GREEN}✓ Lint passed${NC}"
        cd "$SCRIPT_DIR"
        return 0
    fi
    
    cd "$SCRIPT_DIR"
    
    if [[ "$CI_MODE" == true ]] && [[ "$FORCE" == false ]]; then
        echo -e "${RED}✗ Lint failed (use --force to ignore)${NC}"
        exit 1
    elif [[ "$CI_MODE" == false ]]; then
        read -p "Lint failed. Continue anyway? [y/N]: " yn
        [[ "$yn" =~ ^[Yy]$ ]] || exit 1
    fi
}

# Package a single flavor
package_flavor() {
    local version="$1"
    local flavor="$2"  # public or unlisted
    local temp_dir
    local output_file
    local target_id
    
    if [[ "$flavor" == "unlisted" ]]; then
        output_file="$OUTPUT_DIR/sticky-tabsz-v${version}-unlisted.zip"
        target_id="$UNLISTED_ID"
    else
        output_file="$OUTPUT_DIR/sticky-tabsz-v${version}.zip"
        target_id="$PUBLIC_ID"
    fi
    
    echo -e "${YELLOW}Building ${flavor} package...${NC}"
    
    # Create temp directory for this build
    temp_dir=$(mktemp -d)
    trap "rm -rf '$temp_dir'" RETURN
    
    # Copy source files
    cp -r "$SRC_DIR"/* "$temp_dir/"
    
    # Modify extension ID if needed
    local current_id
    current_id=$(get_extension_id)
    if [[ "$current_id" != "$target_id" ]]; then
        if command -v jq &> /dev/null; then
            jq --arg id "$target_id" '.browser_specific_settings.gecko.id = $id' \
                "$temp_dir/manifest.json" > "$temp_dir/manifest.json.tmp"
            mv "$temp_dir/manifest.json.tmp" "$temp_dir/manifest.json"
        else
            sed -i.bak "s|$current_id|$target_id|g" "$temp_dir/manifest.json"
            rm -f "$temp_dir/manifest.json.bak"
        fi
    fi
    
    # Create ZIP
    rm -f "$output_file"
    cd "$temp_dir"
    zip -r "$output_file" . -x ".DS_Store" -x "*.git*" -x "*.bak" -x "*.tmp"
    cd "$SCRIPT_DIR"
    
    echo -e "${GREEN}✓ Created: ${NC}$output_file"
}

package_extension() {
    local version="$1"
    
    mkdir -p "$OUTPUT_DIR"
    
    case "$FLAVOR" in
        public)
            package_flavor "$version" "public"
            ;;
        unlisted)
            package_flavor "$version" "unlisted"
            ;;
        both)
            package_flavor "$version" "public"
            package_flavor "$version" "unlisted"
            ;;
        *)
            echo -e "${RED}Unknown flavor: $FLAVOR${NC}"
            exit 1
            ;;
    esac
}

# --- Main ---
main() {
    echo -e "${BLUE}══════════════════════════════════════${NC}"
    echo -e "${BLUE}  Sticky TabSZ Build${NC}"
    [[ "$CI_MODE" == true ]] && echo -e "${BLUE}  (CI Mode)${NC}"
    echo -e "${BLUE}══════════════════════════════════════${NC}"
    
    VERSION=$(determine_version)
    current=$(get_version)
    
    if [[ "$VERSION" != "$current" ]]; then
        echo -e "${YELLOW}Updating version: ${NC}$current → $VERSION"
        set_version "$VERSION"
    fi
    
    echo -e "${YELLOW}Version: ${NC}$VERSION"
    echo -e "${YELLOW}Flavor:  ${NC}$FLAVOR"
    echo ""
    
    run_lint
    
    if [[ "$LINT_ONLY" == true ]]; then
        echo -e "${GREEN}Lint-only mode, skipping package${NC}"
        exit 0
    fi
    
    package_extension "$VERSION"
    
    echo ""
    echo -e "${GREEN}Done! Version $VERSION${NC}"
    
    # List outputs
    echo -e "${BLUE}Output files:${NC}"
    ls -la "$OUTPUT_DIR"/sticky-tabsz-v"${VERSION}"*.zip 2>/dev/null | awk '{print "  " $NF " (" $5 ")"}'
}

main
