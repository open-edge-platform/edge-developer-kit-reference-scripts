# Contributing to Edge Developer Kit Reference Scripts

Thank you for considering contributing to Edge Developer Kit Reference Scripts! We welcome contributions from the community to help improve and expand the project. Please take a moment to review this document to understand how you can contribute effectively.

## Table of Contents
1. [How Can I Contribute?](#how-can-i-contribute)
    - [Provide Feedback](#provide-feedback)
    - [Contribute to Code Change](#contribute-to-code-change)
    - [Documentation](#documentation)
2. [Style Guides](#commit-type-message-guidelines)
    - [Git Commit Messeges](#commit-types-and-examples)
    - [Code Style](#code-style)

## How Can I Contribute
### Provide feedback

We value your feedback! If you encounter a bug or have suggestion for improvements or new features, please create an issue on Github. Before doing so, check the existing issues if the bug or suggestion has been reported. When providing feedback, please include:

- A clear and descriptive title.
- A detailed description of the problem or suggestion.
- Steps to reproduce the issue (if applicable).
- Any relevant logs, screenshots, or other information.

You can use the following link to report issues or suggest features:
https://github.com/intel-innersource/applications.platforms.network-and-edge-developer-kits/issues/new/choose

In both cases, provide a detailed description, benefits, and potential challenges. If your suggestions align well with the product vision, they may be included in the development roadmap.

User feedback is crucial for the development of this project. Even if your input is not immediately prioritized, it may be considered at a later time or undertaken by the community, regardless of the official roadmap.

### Contribute to Code Change
If you have a fix or enhancement for this project, please follow these steps:
> NOTE: All changes must have issues created !

1. Fork the repository. Ensure you are at the tip of the main branch. 
2. Create a new branch (`git checkout -b feature/your-feature-name`).
3. Make your changes.
4. Commit your changes (`git commit -m 'Add some feature'`).
5. Push to the branch (`git push origin feature/your-feature-name`).
6. Open a pull request.
7. Make your PRs small - each PR should address one issue. Remove all changes unrelated to the PR.
8. Wait for your review. All reviews will undergo code scan per Intel guideline and CI. 

Please ensure your pull request adheres to the following guidelines:

- Link the created issue to your pull request.
- The pull request should include tests for the changes.
- Follow the project's coding style.
- Include a clear description of the changes and why they are necessary.
- Reference any related issues in the pull request description.

All PR that merge into main branch will be automatically sync to external repository https://github.com/intel/edge-developer-kit-reference-scripts and approved/merge by reviewer.

**Use Cases**

If you are contributing use cases:
- Pre-requsites must use platform setup scripts from this project.
- Use case run in docker container. 
- Ensure your docker containers ports are not expose to external system. All services should be only accessible in localhost.
- No proxy configuration in docker compose file.

### Ensure Change Quality

Your pull request will be automatically tested by pre-commit and marked as "✓" if it is ready for merging. If any builders fail, the tatus is "✗", you need to fix the issues listed in console logs. Any change to the PR branch will automatically trigger the checks, so you don't need to recreate the PR, just wait for the updated results. 

> NOTE: Occationally you may see code scan alerts that are not from your commit. Please comment the PR so that reviewers are aware.

Regardless of the automated tests, you should ensure the quality of your changes:

* Test your changes locally:
  * Make sure to double-check your code. 
  * Run tests locally to identify and fix potential issues
* Before creating a PR, make sure that your branch is up to date with the latest state of the branch you want to contribute to (e.g. git fetch upstream && git merge upstream/main).

### Documentation
1. README.md should contain the following:
    - **Overview** - Short description of what is your content about.
    - **Preview** - Attached a picture (preferred .gif format) showing what is the end result would look like.
    - **Requirement**
        - Validated Hardware:
            - CPU: 
            - GPU:
            - RAM:
            - Disk:
        - OS :
    - **Pre-requisites** - Link to download Ubuntu OS, link to setting up platform (all fresh ubuntu initial setup like install gpu drivers, must use the script in this project), install docker, etc
    - **Get Started Guide** - Instruction should be easy to understand to install. Keep it as simple as possible. If you would like to have tutorial, please create seperate .md file. 
    - **Known Issue (Optional)** - Any known issues.

#### Commit Type Message Guidelines

When writing commit messages, please follow these guidelines to ensure clarity and consistency. The commit type can include the following:

## Commit Types and Examples

| Commit Type | Description | Example |
|-------------|-------------|---------|
| **feat** | A new feature is introduced with the changes. | `feat: add user authentication module` |
| **fix** | A bug fix has occurred. | `fix: resolve issue with user login` |
| **chore** | Changes that do not relate to a fix or feature and don't modify `src` or `test` files (for example, updating dependencies). | `chore: update project dependencies` |
| **refactor** | Refactored code that neither fixes a bug nor adds a feature. | `refactor: improve code readability in user service` |
| **docs** | Updates to documentation such as the README or other markdown files. | `docs: update API documentation` |
| **style** | Changes that do not affect the meaning of the code, likely related to code formatting such as white-space, missing semi-colons, and so on. | `style: fix indentation in main.js` |
| **ci** | Continuous integration related changes. | `ci: update CI configuration for new build process` |
| **revert** | Reverts a previous commit. | `revert: revert commit 1234abcd` |

### Code Style

- Follow the coding conventions used in the project.
- Ensure your code is well-documented.
- Use meaningful variable and function names.
- Write tests for new features and bug fixes.

---

Thank you for your interest in contributing to Edge Developer Kit Reference Scripts! We look forward to working with you. If you have any questions, feel free to reach out to us.