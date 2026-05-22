# AI Exam Marking

AI-powered exam grading that extracts student answers from answer sheet images using OCR (Vision Language Model) and evaluates them against a marking scheme using an LLM — producing annotated, downloadable results.

---

## Overview

The AI Exam Marking sample automates the manual grading workflow in three steps:

1. **Marking Scheme Setup** — Define questions, max marks, and marking rubrics. Draw bounding boxes on a reference answer sheet to map where each question's answer appears.
2. **Grading** — Upload or capture one or more student answer sheet images. Each image is queued and processed automatically: OCR extracts the answers, the LLM grades each answer against the rubric, and the result is annotated directly onto the image.
3. **History** — Browse all graded records, preview annotated images, export PDF reports, and delete individual or all records.

---

## Requirements

| Service | Role |
|---|---|
| **Text Generation (VLM)** | **Required.** Must be a Vision Language Model capable of processing images. Used for both OCR extraction and LLM grading. |

> **Important:** The text-generation service must be loaded with a multimodal (VLM) model such as LLaVA. A warning is shown in the UI if a non-multimodal model is detected.

> **Note:** Grading accuracy and OCR quality vary depending on the model used. Larger, more capable VLM models generally produce more reliable output and better performance. If results appear inconsistent or the JSON structure is malformed, try a different model or refine the prompts via **Edit Prompts**.

---

## Workflow

### Step 1 — Marking Scheme Setup

#### Marking Scheme

Define the structure of the exam:

- **Question** — The question text.
- **Marks** — Maximum marks available for the question.
- **Marking Scheme** — Detailed rubric describing what earns each mark.

A **Load Demo Data** button is available to populate example questions (5 business-oriented questions with full rubrics) for quick testing.

#### Bounding Box Setup

Upload a reference (blank or sample) answer sheet image. For each defined question, draw a bounding box over the region where the student's answer will appear. These coordinates are used during annotation to place marks and feedback on the graded image.

---

### Step 2 — Grading

Upload or capture student answer sheet images. Each image is added to a serial processing queue and graded automatically:

> **Sample image:** A sample student answer sheet is provided at `public/data/ai-exam-marking/sample.png`. Use it together with the demo marking scheme (loaded via **Load Demo Data**) to try the full grading pipeline without needing a real exam paper.

1. **OCR** — The image is sent to the VLM with the OCR prompt. The model returns a structured JSON array:
   ```json
   {
     "1": { "question": "1. ...", "answer": "..." },
     "2": { "question": "2. ...", "answer": "..." }
   }
   ```
2. **LLM Grading** — For each extracted question-answer pair, the grading prompt is populated with the question, max marks, and marking scheme, then sent to the LLM. The model returns:
   ```json
   {
     "student_answer": "...",
     "feedback": "10-word summary",
     "marks_awarded": 2,
     "human_review": false
   }
   ```
3. **Annotation** — Marks, a result icon (✓ / ✗ / neutral), and feedback text are drawn onto the original image at the bounding box coordinates for each question.

The annotated image is displayed in the results grid. Each card shows the live processing step (`Queued → Extracting text → Grading question N of M → Annotating`).

#### Multiple Images

Multiple images can be uploaded or captured. They are processed **one at a time** (serial queue) to avoid overloading the model service. Images waiting their turn show a "Queued" state.

#### Prompt Customisation

Click **Edit Prompts** in the card header to customise the OCR and LLM grading prompts. Changes apply to all subsequent gradings. Both prompts can be reset to their defaults.

**OCR Prompt** — Plain text instructions for the vision model. No template variables.

**LLM Grading Prompt** — Supports three template variables substituted automatically per question:

| Variable | Replaced with |
|---|---|
| `{question}` | Question text from the marking scheme |
| `{marks}` | Maximum marks for the question |
| `{marking_scheme}` | Full rubric text |

---

### Step 3 — History

All graded records are automatically saved to an in-memory store (persists for the session). The history view shows:

- Timestamp of each grading run
- Defined questions and marking schemes
- OCR output
- LLM grading responses per question
- Annotated image preview

Records can be exported as a **PDF report** or deleted individually. A **Delete All** option clears the entire history.

---

## API Routes

### `POST /api/ai-exam-marking/ocr`

Sends an answer sheet image to the VLM and extracts structured question-answer pairs.

**Request**
```json
{
  "image": "<base64-encoded image>",
  "prompt": "(optional) custom OCR instruction"
}
```

**Response**
```json
{
  "1": { "question": "1. ...", "answer": "..." },
  "2": { "question": "2. ...", "answer": "..." }
}
```

---

### `POST /api/ai-exam-marking/grading`

Grades a single student answer against a marking scheme using the LLM.

**Request**
```json
{
  "prompt": "<filled grading prompt with question, marks, and scheme>",
  "answer": "<student answer text>"
}
```

**Response**
```json
{
  "student_answer": "...",
  "feedback": "concise 10-word summary",
  "marks_awarded": 2,
  "human_review": false
}
```

---
