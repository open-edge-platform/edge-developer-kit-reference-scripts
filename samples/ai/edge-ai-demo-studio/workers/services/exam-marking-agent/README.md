# Exam Marking Agent - Setup Guide

## Overview
The Exam Marking Agent handles exam result delivery via Email, Telegram, and printing support.

## Prerequisites
- Python 3.12
- UV package manager (or pip)
- Contact information in `Contact_Info.xlsx`
- Exam results in `results/{subject}/{student_id}/` (in `data/exam-marking-agent/<instance>/` when started from the app, the repository root when run by hand)

## Quick Setup

### 1. Install Dependencies
```bash
cd workers/services/exam-marking-agent
uv sync
# Start the service with: uv run main.py
```

### 2. Configure Credentials
Copy .env.example and create .env file
Modify it based on [Message Configuration](#message-configuration)

**IMPORTANT:** `.env` is git-ignored and will NOT be committed to the repository.

### 3. Start the Service
If running in chatbot dashboard:
1. Find **exam-marking-agent** service
2. Click **Start** (or **Restart** if already running)

If running standalone:
```bash
uv run main.py --api-base http://localhost:8001/v1 --model dummy --api-key dummy
```
Without `--api-base` (or `LLM_API_BASE`), the agent asks the app (`EDGE_AI_STUDIO_URL`, default `http://127.0.0.1:8080`) for the running Text Generation instance. It reads the Exam Marking Database's `exam_marking.db` from that service's data directory; pass `--db-path` to point elsewhere.

## Message Configuration

**How to get Gmail App Password:**
1. Go to [myaccount.google.com](https://myaccount.google.com)
2. Go to **Security** → **2-Step Verification** → **App passwords**
3. Generate a password for "Mail" on "Windows Computer"
4. Copy the 16-character password into `SMTP_PASSWORD` (without spacing)

### Telegram
**How to get Telegram Bot Token:**
1. Open Telegram, search for **BotFather**
2. Send `/newbot` command
3. Follow prompts to create a bot
4. Copy the token (format: `123456:ABCDEFg...`) into `TELEGRAM_BOT_TOKEN`

### Contact Data
Excel file should have columns:
- `student_id` — Unique student ID
- `student_name` — Full name
- `student_email` — Student email
- `parent_email` — Parent email
- `teacher_email` — Teacher email
- `student_phone` — For WhatsApp
- `parent_phone` — For WhatsApp
- `teacher_phone` — For WhatsApp
- `student_telegram_id` — Telegram chat ID
- `parent_telegram_id` — Telegram chat ID
- `teacher_telegram_id` — Telegram chat ID

