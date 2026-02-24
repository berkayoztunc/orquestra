# GitHub Labels Configuration

## How to Add Labels to Your GitHub Repository

1. Go to your GitHub repository settings
2. Click "Labels" in the left sidebar
3. Create each label below

## Recommended Labels for orquestra

### Task Types
- **copilot-task** (color: #FF6B6B, description: "Assign to Copilot Agent for implementation")
- **feature** (color: #00B4D8, description: "New feature request")
- **bug** (color: #FF006E, description: "Bug report")
- **chore** (color: #999999, description: "Maintenance and refactoring")
- **documentation** (color: #8338EC, description: "Documentation improvements")

### Priority
- **priority: critical** (color: #D62828, description: "Critical issue - needs immediate attention")
- **priority: high** (color: #F77F00, description: "High priority")
- **priority: medium** (color: #FCBF49, description: "Medium priority")
- **priority: low** (color: #90E0EF, description: "Low priority")

### Status
- **status: needs-review** (color: #0096FF, description: "Needs code review")
- **status: in-progress** (color: #FFB703, description: "Currently being worked on")
- **status: blocked** (color: #FB5607, description: "Blocked by another issue")
- **status: on-hold** (color: #06FFA5, description: "On hold")

### Team Labels
- **team: frontend** (color: #17C0EB, description: "Frontend work")
- **team: backend** (color: #FF6B9D, description: "Backend/Worker work")
- **team: devops** (color: #C34A36, description: "DevOps and infrastructure")
- **team: security** (color: #D00000, description: "Security concerns")

### Copilot Specific
- **copilot-task** (color: #FF6B6B, description: "Auto-assign to Copilot Agent")
- **needs-review** (color: #0096FF, description: "Copilot to provide code review")

## Automated Label Script

You can also create these labels automatically with the GitHub CLI:

```bash
#!/bin/bash

# Create labels programmatically
LABELS=(
  "copilot-task|FF6B6B|Assign to Copilot Agent for implementation"
  "feature|00B4D8|New feature request"
  "bug|FF006E|Bug report"
  "chore|999999|Maintenance and refactoring"
  "documentation|8338EC|Documentation improvements"
  "priority: critical|D62828|Critical issue - needs immediate attention"
  "priority: high|F77F00|High priority"
  "priority: medium|FCBF49|Medium priority"
  "priority: low|90E0EF|Low priority"
  "status: needs-review|0096FF|Needs code review"
  "status: in-progress|FFB703|Currently being worked on"
  "status: blocked|FB5607|Blocked by another issue"
  "status: on-hold|06FFA5|On hold"
  "team: frontend|17C0EB|Frontend work"
  "team: backend|FF6B9D|Backend/Worker work"
  "team: devops|C34A36|DevOps and infrastructure"
  "team: security|D00000|Security concerns"
)

# Replace with your GitHub username and repo
OWNER="your-username"
REPO="orquestra"

for label in "${LABELS[@]}"; do
  IFS='|' read -r name color description <<< "$label"
  gh label create "$name" \
    --color "$color" \
    --description "$description" \
    --repo "$OWNER/$REPO" \
    2>/dev/null || echo "Label '$name' already exists"
done

echo "✅ Labels created successfully!"
```

To use this script:
```bash
# Install GitHub CLI if not already installed
# https://cli.github.com

# Authenticate with GitHub
gh auth login

# Create a file with the script above
chmod +x create-labels.sh
./create-labels.sh
```

## Using Copilot Agent with Labels

### Example Workflow:

1. **Create an Issue**
   ```
   Title: "Implement IDL validation endpoint"
   Description: "Create POST /api/idl/validate endpoint..."
   ```

2. **Add Label: `copilot-task`**
   - GitHub Actions automatically triggers Copilot Agent
   - Agent analyzes the issue
   - Agent creates a pull request with implementation

3. **Add Label: `needs-review`** (on Pull Requests)
   - Copilot provides automated code review
   - Comments on code quality, tests, documentation

### Label Automation Rules

- Issues with `copilot-task` → Auto-assign Copilot Agent
- PRs with `needs-review` → Auto-request Copilot review
- Issues with `priority: critical` → Highlight in board
- Issues with `status: blocked` → Disable auto-merge

## GitHub Project Board Setup

Recommended columns for your project board:
1. **Backlog** - New issues not started
2. **Ready** - Prioritized and ready to work on
3. **In Progress** - Currently being developed
4. **In Review** - PR submitted, awaiting review
5. **Done** - Completed and merged

