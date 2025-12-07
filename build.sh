#!/bin/bash
# Sticky TabSZ - Build Script
# Updates version, lints, and packages the extension for AMO submission

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/xpi.src"
MANIFEST="$SRC_DIR/manifest.json"
OUTPUT_DIR="$SCRIPT_DIR/_build"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════${NC}"
echo -e "${BLUE}  Sticky TabSZ - Build Script${NC}"
echo -e "${BLUE}═══════════════════════════════════════════${NC}"
echo

# Check for required tools
check_dependencies() {
    echo -e "${YELLOW}Checking dependencies...${NC}"
    
    if ! command -v npx &> /dev/null; then
        echo -e "${RED}Error: npx not found. Please install Node.js.${NC}"
        exit 1
    fi
    
    if ! command -v jq &> /dev/null; then
        echo -e "${YELLOW}Warning: jq not found. Version display may be limited.${NC}"
        HAS_JQ=false
    else
        HAS_JQ=true
    fi
    
    echo -e "${GREEN}✓ Dependencies OK${NC}"
    echo
}

# Get current version from manifest
get_version() {
    if [ "$HAS_JQ" = true ]; then
        jq -r '.version' "$MANIFEST"
    else
        grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$MANIFEST" | sed 's/.*"\([^"]*\)"$/\1/'
    fi
}

# Update version in manifest
update_version() {
    local current_version=$(get_version)
    echo -e "${YELLOW}Current version: ${NC}$current_version"
    
    # Parse version components
    IFS='.' read -r major minor patch <<< "$current_version"
    
    echo
    echo "How would you like to update the version?"
    echo "  1) Patch  (${major}.${minor}.$((patch + 1)))"
    echo "  2) Minor  (${major}.$((minor + 1)).0)"
    echo "  3) Major  ($((major + 1)).0.0)"
    echo "  4) Custom"
    echo "  5) Keep current ($current_version)"
    echo
    read -p "Select option [1-5]: " choice
    
    case $choice in
        1)
            new_version="${major}.${minor}.$((patch + 1))"
            ;;
        2)
            new_version="${major}.$((minor + 1)).0"
            ;;
        3)
            new_version="$((major + 1)).0.0"
            ;;
        4)
            read -p "Enter new version: " new_version
            ;;
        5)
            new_version="$current_version"
            ;;
        *)
            echo -e "${RED}Invalid option${NC}"
            exit 1
            ;;
    esac
    
    if [ "$new_version" != "$current_version" ]; then
        echo -e "${YELLOW}Updating version to: ${NC}$new_version"
        
        # Update manifest.json
        if [ "$HAS_JQ" = true ]; then
            jq --arg v "$new_version" '.version = $v' "$MANIFEST" > "$MANIFEST.tmp" && mv "$MANIFEST.tmp" "$MANIFEST"
        else
            sed -i.bak "s/\"version\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"version\": \"$new_version\"/" "$MANIFEST"
            rm -f "$MANIFEST.bak"
        fi
        
        # Update options.html version display
        sed -i.bak "s/v<span id=\"version\">[^<]*<\/span>/v<span id=\"version\">$new_version<\/span>/" "$SRC_DIR/options.html"
        rm -f "$SRC_DIR/options.html.bak"
        
        echo -e "${GREEN}✓ Version updated to $new_version${NC}"
    else
        echo -e "${GREEN}✓ Keeping version $current_version${NC}"
    fi
    
    echo
    VERSION="$new_version"
}

# Run linter
run_lint() {
    echo -e "${YELLOW}Running web-ext lint...${NC}"
    
    cd "$SRC_DIR"
    if npx --yes web-ext lint; then
        echo -e "${GREEN}✓ Linting passed${NC}"
    else
        echo -e "${RED}✗ Linting failed${NC}"
        echo
        read -p "Continue anyway? [y/N]: " continue_anyway
        if [ "$continue_anyway" != "y" ] && [ "$continue_anyway" != "Y" ]; then
            exit 1
        fi
    fi
    cd "$SCRIPT_DIR"
    echo
}

# Package extension
package_extension() {
    echo -e "${YELLOW}Packaging extension...${NC}"
    
    mkdir -p "$OUTPUT_DIR"
    
    local output_file="$OUTPUT_DIR/sticky-tabsz-v${VERSION}.zip"
    
    # Remove old package if exists
    rm -f "$output_file"
    
    # Create ZIP
    cd "$SRC_DIR"
    zip -r "$output_file" . -x ".DS_Store" -x "*.git*" -x "*.bak"
    cd "$SCRIPT_DIR"
    
    local size=$(ls -lh "$output_file" | awk '{print $5}')
    
    echo -e "${GREEN}✓ Package created: ${NC}$output_file"
    echo -e "  Size: $size"
    echo
}

# Show summary
show_summary() {
    echo -e "${BLUE}═══════════════════════════════════════════${NC}"
    echo -e "${GREEN}  Build Complete!${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════${NC}"
    echo
    echo -e "  Version:  ${GREEN}$VERSION${NC}"
    echo -e "  Package:  ${GREEN}_build/sticky-tabsz-v${VERSION}.zip${NC}"
    echo
    echo -e "  Next steps:"
    echo -e "  1. Upload to ${BLUE}https://addons.mozilla.org/developers/${NC}"
    echo -e "  2. Use AMO_SUBMISSION.md for descriptions"
    echo
}

# Main
main() {
    check_dependencies
    update_version
    run_lint
    package_extension
    show_summary
}

main "$@"

