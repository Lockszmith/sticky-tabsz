#!/usr/bin/env bash
# Repository Strategy Validation Script
# Checks that the repository adheres to the git strategy
# Only validates commits after the 'git-strategy-begins' tag

set -u

# Navigate to repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Strategy enforcement starts from this tag
STRATEGY_TAG="git-strategy-begins"

# Colors
if [[ -t 1 ]]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'
    YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; NC=''
fi

pass=0
fail=0
warn=0

check_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((pass++))
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    ((fail++))
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((warn++))
}

echo -e "${BLUE}════════════════════════════════════${NC}"
echo -e "${BLUE}  Repository Strategy Check${NC}"
echo -e "${BLUE}════════════════════════════════════${NC}"
echo ""

# Check if we're in a git repo
if ! git rev-parse --git-dir &>/dev/null; then
    check_fail "Not a git repository"
    exit 1
fi

# Check if strategy tag exists
if ! git rev-parse "$STRATEGY_TAG" &>/dev/null; then
    check_warn "Tag '$STRATEGY_TAG' not found - checking all commits"
    STRATEGY_TAG=""
else
    echo -e "  Strategy enforced from: ${BLUE}$STRATEGY_TAG${NC}"
fi
echo ""

# --- Check 1: Required branches exist ---
echo -e "${YELLOW}Checking required branches...${NC}"

if git show-ref --verify --quiet refs/heads/main 2>/dev/null || \
   git show-ref --verify --quiet refs/remotes/origin/main 2>/dev/null; then
    check_pass "Branch 'main' exists"
else
    check_fail "Branch 'main' not found (required for releases)"
fi

if git show-ref --verify --quiet refs/heads/dev 2>/dev/null || \
   git show-ref --verify --quiet refs/remotes/origin/dev 2>/dev/null; then
    check_pass "Branch 'dev' exists"
else
    check_warn "Branch 'dev' not found (recommended for integration)"
fi
echo ""

# --- Check 2: Current branch naming ---
echo -e "${YELLOW}Checking current branch...${NC}"

CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
if [[ -z "$CURRENT_BRANCH" ]]; then
    check_warn "Detached HEAD state (not on a branch)"
else
    echo "  Current branch: $CURRENT_BRANCH"
    
    case "$CURRENT_BRANCH" in
        main)
            check_warn "On 'main' - avoid direct commits, use PRs from 'dev'"
            ;;
        dev)
            check_warn "On 'dev' - consider using feature/* or fix/* branch"
            ;;
        feature/*|fix/*)
            check_pass "Branch follows naming convention: $CURRENT_BRANCH"
            ;;
        *)
            check_warn "Branch '$CURRENT_BRANCH' doesn't follow convention (feature/* or fix/*)"
            ;;
    esac
fi
echo ""

# --- Check 3: All local branches follow naming convention ---
echo -e "${YELLOW}Checking all local branches...${NC}"

invalid_branches=()
while IFS= read -r branch; do
    branch=$(echo "$branch" | sed 's/^[ *]*//')  # Remove leading spaces and asterisk
    case "$branch" in
        main|dev|feature/*|fix/*|HEAD*) 
            # Valid
            ;;
        *)
            invalid_branches+=("$branch")
            ;;
    esac
done < <(git branch 2>/dev/null)

if [[ ${#invalid_branches[@]} -eq 0 ]]; then
    check_pass "All branches follow naming convention"
else
    for branch in "${invalid_branches[@]}"; do
        check_warn "Non-standard branch: '$branch' (expected: main, dev, feature/*, fix/*)"
    done
fi
echo ""

# --- Check 4: Commit messages since strategy tag ---
echo -e "${YELLOW}Checking commit messages (since $STRATEGY_TAG)...${NC}"

conventional_pattern='^(feat|fix|docs|chore|refactor|test|style|perf|ci|build|revert)(\(.+\))?: .+'
merge_pattern='^Merge '

bad_commits=0
total_checked=0

# Build git log command based on whether tag exists
if [[ -n "$STRATEGY_TAG" ]]; then
    log_range="${STRATEGY_TAG}..HEAD"
else
    log_range="-20"  # Fallback: check last 20 commits
fi

while IFS= read -r line; do
    if [[ -z "$line" ]]; then continue; fi
    ((total_checked++))
    
    # Skip merge commits
    if [[ "$line" =~ $merge_pattern ]]; then
        continue
    fi
    
    if ! [[ "$line" =~ $conventional_pattern ]]; then
        ((bad_commits++))
        if [[ $bad_commits -le 3 ]]; then  # Only show first 3
            check_warn "Non-conventional commit: \"${line:0:50}...\""
        fi
    fi
done < <(git log $log_range --format="%s" 2>/dev/null)

if [[ $total_checked -eq 0 ]]; then
    check_pass "No new commits since $STRATEGY_TAG"
elif [[ $bad_commits -eq 0 ]]; then
    check_pass "All $total_checked commit(s) follow conventional format"
else
    if [[ $bad_commits -gt 3 ]]; then
        echo -e "  ${YELLOW}... and $((bad_commits - 3)) more non-conventional commits${NC}"
    fi
    echo -e "  ${YELLOW}$bad_commits of $total_checked commits don't follow convention${NC}"
fi
echo ""

# --- Check 5: Uncommitted changes ---
echo -e "${YELLOW}Checking working directory...${NC}"

if git diff --quiet 2>/dev/null && git diff --cached --quiet 2>/dev/null; then
    check_pass "Working directory is clean"
else
    staged=$(git diff --cached --name-only 2>/dev/null | wc -l)
    unstaged=$(git diff --name-only 2>/dev/null | wc -l)
    check_warn "Uncommitted changes: $staged staged, $unstaged unstaged"
fi

untracked=$(git ls-files --others --exclude-standard 2>/dev/null | wc -l)
if [[ $untracked -gt 0 ]]; then
    check_warn "$untracked untracked file(s)"
fi
echo ""

# --- Check 6: Sync status with remote ---
echo -e "${YELLOW}Checking remote sync...${NC}"

if git remote get-url origin &>/dev/null; then
    # Fetch to get latest (quiet, don't fail if offline)
    git fetch origin --quiet 2>/dev/null || true
    
    if [[ -n "$CURRENT_BRANCH" ]]; then
        LOCAL=$(git rev-parse "$CURRENT_BRANCH" 2>/dev/null)
        REMOTE=$(git rev-parse "origin/$CURRENT_BRANCH" 2>/dev/null)
        BASE=$(git merge-base "$CURRENT_BRANCH" "origin/$CURRENT_BRANCH" 2>/dev/null)
        
        if [[ -z "$REMOTE" ]]; then
            check_warn "Branch '$CURRENT_BRANCH' not pushed to remote"
        elif [[ "$LOCAL" == "$REMOTE" ]]; then
            check_pass "Branch is up to date with origin"
        elif [[ "$LOCAL" == "$BASE" ]]; then
            check_warn "Branch is behind origin (pull needed)"
        elif [[ "$REMOTE" == "$BASE" ]]; then
            check_warn "Branch is ahead of origin (push needed)"
        else
            check_warn "Branch has diverged from origin"
        fi
    fi
else
    check_warn "No remote 'origin' configured"
fi
echo ""

# --- Summary ---
echo -e "${BLUE}════════════════════════════════════${NC}"
echo -e "Results: ${GREEN}$pass passed${NC}, ${RED}$fail failed${NC}, ${YELLOW}$warn warnings${NC}"
echo -e "${BLUE}════════════════════════════════════${NC}"

# Exit with error if any failures
[[ $fail -eq 0 ]] && exit 0 || exit 1

