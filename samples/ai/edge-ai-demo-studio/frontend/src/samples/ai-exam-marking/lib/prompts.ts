// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { DashboardStats } from './dashboard-stats'
import { isPass, PASS_MARK_PCT } from './marks'

export const DEFAULT_OCR_PROMPT = `Given an image of a student answer sheet, extract the following information and return it as a single JSON object.

1. Student information (usually found in the header or top section of the sheet):
- 'student_name': The student's full name as a string (empty string if not found)
- 'student_id': The student's ID or registration number as a string (empty string if not found)

2. Each question and its corresponding answer(s) as numbered entries. Each entry should use the question number as the key and contain 'question' and 'answer' fields. The answer should be a single string combining all bullet points separated by semicolons.

If a question does not have an answer, set the answer field to an empty string. If the question number is missing, skip that question. Do not include any additional text or formatting outside of the JSON structure.

Example output:
{
'student_name': 'John Smith',
'student_id': 'S12345',
'1': {
'question': 'Explain one way a business could increase its gross profit margin.',
'answer': 'increase selling price'
},
'2': {
'question': 'Analyze the importance to Backyard Shoes of satisfying customer needs.',
'answer': 'lead to customer loyalty; build brand image'
},
'3': {
'question': 'Explain one method of above the line promotion a business could use. [3m]',
'answer': 'tv ads; promotes to large audience'
}
}
Your task is to generate the exact same structured JSON output based on the provided image content.`

export const DEFAULT_LLM_PROMPT = `You are an AI grading assistant tasked with evaluating student answers based on a provided marking scheme for each question.

This question is about: {question}, with a maximum of {marks} marks.

The student answer may consist of the question starting with numbering and the student's answer; ignore the question and only grade the answer provided.
Only evaluate the student answer based on the question stated above and ignore all other questions.
Do not generate or complete the student answer based on the marking scheme if the student answer is empty or not provided.

The marking scheme for this question is:
{marking_scheme}

Follow these steps for this question:

1. Understand the Question and Marking Scheme

Read the question and the marking scheme.
Identify the required references and acceptable alternatives (e.g., synonyms, minor typos).

2. Evaluate the Student Answer.

Check if the answer explicitly references the required elements from the marking scheme.
Look for implied references.
Note minor errors (e.g., typos, incorrect terminology) but decide if they hinder understanding.

3. Apply the Marking Guidance

Award mark per valid reference (up to the maximum available).
Do not deduct marks for minor errors if the student's reasoning is clear and correct.
For open-ended criteria, ensure the explanation logically follows from the question.

4. Handle Ambiguity or Unlisted Answers

If the student's answer is correct but not explicitly covered in the marking scheme (e.g., a valid alternative method, creative solution, or answer phrased differently but logically equivalent):
Assign marks only if the marking scheme explicitly allows for alternative answers (e.g., "any correct method accepted," "multiple valid approaches").
If the marking scheme does not allow alternative answers, flag the response for human review by stating 'True'.

5. Provide Feedback

List the references identified in the student answer and assign marks accordingly.
Highlight errors or omissions but only penalize if required by the marking scheme.
Disregard irrelevant information.
Provide the feedback in only 10 words.

6. Finalize the Score

Sum the marks based on the marking scheme's criteria.

Return a JSON with the following fields:
student_answer: Student answer extracted based on question above. Do not include the question. 
feedback: A summary of the evaluation.
marks_awarded: The total marks given.
human_review: A boolean (true or false) indicating if the answer needs human review.`

/** The class results as plain text for the chatbot, appended after the user's system prompt. */
export function buildResultsContext(stats: DashboardStats | null): string {
  if (!stats) {
    return 'You are an AI assistant helping with exam marking. No exam results have been graded yet. Answer general questions about exam marking.'
  }

  const lines: string[] = [
    "You are an AI assistant analyzing exam results. Answer the user's questions using the data below.",
    '',
    '=== DASHBOARD SUMMARY ===',
    `Total students: ${stats.totalStudents}`,
    `Class average: ${stats.averagePct !== null ? `${stats.averagePct}%` : 'N/A'}`,
    `Pass rate (≥${PASS_MARK_PCT}%): ${stats.passRate !== null ? `${stats.passRate}%` : 'N/A'}`,
    `Items flagged for human review: ${stats.humanReviewCount}`,
    '',
    '=== SCORE DISTRIBUTION ===',
    ...stats.buckets.map((b) => `${b.label}: ${b.count} student(s)`),
  ]

  if (stats.questionStats.length > 0) {
    lines.push('', '=== PER-QUESTION AVERAGES ===')
    for (const q of stats.questionStats) {
      lines.push(`${q.label}: avg ${q.avgAwarded}/${q.avgMax} (${q.avgPct}%)`)
    }
  }

  if (stats.scoredRecords.length > 0) {
    lines.push('', '=== STUDENT RESULTS ===')
    for (const { record, pct } of stats.scoredRecords) {
      const name =
        [
          record.studentName,
          record.studentId ? `(ID: ${record.studentId})` : null,
        ]
          .filter(Boolean)
          .join(' ') || 'Unknown'
      lines.push(
        `- ${name} | Score: ${pct}% | ${isPass(pct) ? 'Pass' : 'Fail'}`,
      )
    }
  }

  return lines.join('\n')
}
