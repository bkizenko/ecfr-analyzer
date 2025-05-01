#!/bin/bash

# Set these variables to your GitHub username and desired repository name
GITHUB_USERNAME="yourusername"
REPO_NAME="ecfr-analyzer"

# Check if GitHub CLI is installed
if ! command -v gh &> /dev/null
then
    echo "GitHub CLI (gh) is not installed. Please install it first:"
    echo "https://cli.github.com/manual/installation"
    exit 1
fi

# Check if user is authenticated
if ! gh auth status &> /dev/null
then
    echo "You need to authenticate with GitHub first. Run:"
    echo "gh auth login"
    exit 1
fi

# Create a new GitHub repository
echo "Creating GitHub repository: $GITHUB_USERNAME/$REPO_NAME"
gh repo create "$REPO_NAME" --public --description "A tool to analyze the Electronic Code of Federal Regulations (eCFR) data."

# Add GitHub as a remote
git remote add origin "https://github.com/$GITHUB_USERNAME/$REPO_NAME.git"

# Push to GitHub
echo "Pushing code to GitHub..."
git push -u origin main

echo "Repository setup complete!"
echo "Your project is now available at: https://github.com/$GITHUB_USERNAME/$REPO_NAME" 