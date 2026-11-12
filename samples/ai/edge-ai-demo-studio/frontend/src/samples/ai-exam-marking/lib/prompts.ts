// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export const DEFAULT_OCR_PROMPT = `Given an image of a student answer sheet, extract the content and return exactly one JSON object.

Required JSON shape:
1. Student information (usually found in the header or top section of the sheet):
- 'student_name': The student's full name as a string (empty string if not found)
- 'student_id': The student's ID or registration number as a string (empty string if not found)

2. One object per detected question number, for example "1", "2", "3". Each question object must contain:
   - question: string
   - answer: string

If a question does not have an answer, set the answer field to an empty string. If the question number is missing, skip that question. Do not include any additional text or formatting outside of the JSON structure.
Transcribe exactly as drawn/written without correcting it even if scientifically or mathematically wrong.
Do NOT infer meaning. Do NOT correct mistakes. Do NOT use scientific knowledge. Do NOT complete missing labels. Do NOT guess hidden text. Do NOT explain. Do NOT summarize. Never calculate, simplify, solve, verify, or validate any equation/value. Never replace a visible number/symbol/sign with a corrected one.

Example output:
{
'student_name': 'John Smith',
'student_id': 'S12345',
'1': {
'question': 'Explain one way a business could increase its gross profit margin.',
'answer': 'increase selling price'
}

Extraction rules by special answer type:
MATHEMATICAL / FORMULA:
- Transcribe symbols and steps faithfully.
- Use LaTeX-style notation where useful (for example: \\frac{a}{b}, x^2, \\sqrt{x}, \\int_a^b f(x)dx).
- Preserve order of working steps separated by "; ".

Diagrams/Graphs:
- Describe only what is visibly drawn. Do not compare against the equation, prompt text, expected graph, or correct mathematical result.
Store in answer as:
"VISUAL: labels=[...]; arrows=[source->target,...]; axes=[...]; scale=[...]; key_points=[...]; shape=[...]; orientation=[...]; notes=[...]."

For curved graphs also include:
- concavity (concave up/down)
- opening direction (up/down/left/right)
- vertex/extremum (minimum or maximum)

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

Text grading:
- Match key ideas and required terms from the scheme.
- Award partial marks when only some required points are present.

Math/formula grading:
- Accept equivalent forms and valid alternative methods.
- Award follow-through marks when later steps are consistent with earlier work.

Graph/diagram/drawing grading:
- Evaluate orientation and concavity strictly: If the scheme requires a curve opening upwards (U-shape / local min) and the visual evidence string indicates opening downwards (N-shape / inverted / local max), award 0 marks for the shape criterion.
- Verify vertical and horizontal placement against axes: If the scheme requires a vertex above the x-axis at positive y, and the evidence shows a vertex below the x-axis or at a negative y-value, award 0 marks for that intercept/vertex criterion.
- Use directional evidence strictly: Treat "A->B" as an arrow from A to B. Compare this literally against scheme requirements.
- If the scheme says "1 mark for each correct label and arrow direction", both label and direction must be correct for that item; if either is wrong, absent, or reversed, award 0 for that item.
- For plotted graphs, evaluate these dimensions against the scheme when relevant:
  a) axis names and units
  b) scale/range and equal intervals
  c) key plotted points/coordinates
  d) curve or line shape, concavity, and orientation
  e) intercepts, turning points, asymptotes, and legends/annotations
- Do not award a point when the feature is missing, orientation/position is wrong, or the evidence string does not mention it.

Return a JSON with the following fields:
student_answer: Student answer extracted based on question above. Do not include the question. 
feedback: A summary of the evaluation (max 10 words).
marks_awarded: The total marks given.
human_review: A boolean (true or false) indicating if the answer needs human review.`
