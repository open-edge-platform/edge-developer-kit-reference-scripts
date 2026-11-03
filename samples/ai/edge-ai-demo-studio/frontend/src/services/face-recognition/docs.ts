// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { DocsFactoryOptions, ServiceDocsData } from '@/services/types'

/** Per-preset match threshold, as `match_threshold` in models/registry.py. */
const MATCH_THRESHOLDS: Record<string, number> = {
  'omz-retail': 0.4,
  'omz-adas': 0.4,
  'yunet-sface': 0.363,
}

const DEFAULT_PRESET = 'omz-retail'

/** What the selected instance runs, when there is one. */
function instanceNote(preset: string): string {
  const threshold = MATCH_THRESHOLDS[preset]
  return threshold === undefined
    ? ` This instance runs the \`${preset}\` preset; its match threshold is in each /recognize answer (\`threshold\`).`
    : ` This instance runs the \`${preset}\` preset, which counts a face as matched from a similarity of ${threshold}.`
}

// Mirrors the worker's main.py (routes) and worker.py (response shapes and errors).
export const getDocsData = ({
  host,
  model,
  metadata,
}: DocsFactoryOptions): ServiceDocsData => {
  const preset = model || DEFAULT_PRESET
  return {
    quickStart: {
      steps: [
        'Enroll a person: `POST /gallery` with a `name` and one or more reference photos as `files` (multipart form data). The largest face in each photo is used.',
        'Recognize: `POST /recognize` with a probe image as `file`. Each entry of `faces` has its `box`, and `matched: true` with the person in `match` when it clears the threshold.',
        "The gallery lives in the instance's memory: it is empty again after a restart, and with an empty gallery every face comes back unmatched.",
      ],
      request: {
        language: 'cURL',
        languageCode: 'bash',
        code: `curl ${host}/gallery -F "name=Jane Doe" -F "files=@jane.jpg"

curl ${host}/recognize -F "file=@group.jpg"`,
      },
    },
    serviceDescription:
      'The Face Recognition service detects faces in an image and identifies each one against a reference gallery of enrolled people, with OpenVINO detection and embedding models running locally — no Internet connection needed.',
    overview:
      'Enroll each person with one or more reference photos (POST /gallery): the largest face in each photo is embedded by the active model and kept in the gallery, together with the original image so a model swap re-embeds it. POST /recognize then detects every face in a probe image and matches it against the gallery by cosine similarity; a face whose best similarity clears the model\'s threshold is "matched". GET/POST /models inspect or hot-swap the active model, and GET /devices lists the OpenVINO accelerators. The gallery lives in the worker\'s memory: it is empty again after a restart. Inside Edge AI Studio every endpoint below is reachable from the browser at the proxied path `/api/face-recognition@<instance>/<endpoint>`.' +
      (metadata ? instanceNote(preset) : ''),
    endpoints: [
      {
        method: 'GET',
        path: '/healthcheck',
        description:
          'Status of the worker: the active model, whether it is loaded (503 until it is), the device and the gallery size.',
      },
      {
        method: 'GET',
        path: '/devices',
        description: 'The OpenVINO devices available on this machine.',
      },
      {
        method: 'GET',
        path: '/models',
        description:
          'The model presets the worker can run, the active one and its device.',
      },
      {
        method: 'GET',
        path: '/models/active',
        description: 'The active model and whether it is loaded.',
      },
      {
        method: 'POST',
        path: '/models/load',
        description:
          'Load another model (and re-embed the gallery with it). JSON body.',
        params: [
          {
            name: 'model',
            type: 'string',
            required: true,
            desc: 'A preset key from GET /models (e.g. "omz-retail").',
          },
          {
            name: 'device',
            type: 'string',
            required: false,
            desc: 'OpenVINO device: AUTO, CPU, GPU or NPU. Defaults to the current one.',
          },
          {
            name: 'options',
            type: 'object',
            required: false,
            desc: 'Preset-specific options.',
          },
        ],
      },
      {
        method: 'GET',
        path: '/gallery',
        description:
          'The enrolled people: id, name, number of reference images and a thumbnail (JPEG data URL) of each enrolled face.',
      },
      {
        method: 'POST',
        path: '/gallery',
        description:
          'Enroll a person from one or more reference photos (multipart form). Re-using a name (in any case) adds the photos to that person. The answer is `{ person, files }`: the person with `id`, `name`, `num_images` and a thumbnail per photo, and one entry per uploaded file, with an `error` for each photo that could not be read or showed no face. Fails with 400 only when no photo had a face.',
        params: [
          {
            name: 'name',
            type: 'string',
            required: true,
            desc: "The person's name, shown on matches.",
          },
          {
            name: 'files',
            type: 'file[]',
            required: true,
            desc: 'Reference photos (JPG, PNG, BMP, TIFF or WEBP); the largest face in each is used.',
          },
        ],
      },
      {
        method: 'DELETE',
        path: '/gallery/{person_id}',
        description:
          'Remove one person from the gallery (404 for an unknown id). Returns the gallery.',
      },
      {
        method: 'DELETE',
        path: '/gallery',
        description: 'Remove everyone from the gallery. Returns the gallery.',
      },
      {
        method: 'POST',
        path: '/recognize',
        description:
          "Detect every face in an image (multipart form) and match each against the gallery by cosine similarity. Each face has its `box` ([x, y, width, height] in pixels), detection `score` and five `landmarks`; `match` is the closest enrolled person (`null` with an empty gallery) and `matched` says whether its similarity reached the answer's `threshold`; `similarities` ranks every enrolled person. The detect and embed time is also sent as a `Server-Timing` header.",
        params: [
          {
            name: 'file',
            type: 'file',
            required: true,
            desc: 'The probe image.',
          },
        ],
      },
    ],
    errors: {
      intro:
        'A failed request answers with a JSON body `{ "detail": "<reason>" }` and one of these statuses.',
      cases: [
        {
          status: 400,
          when: 'Enrollment with a blank name or no photo, no face found in any enrollment photo, an image that cannot be decoded, or an unknown device in POST /models/load.',
        },
        {
          status: 404,
          when: 'DELETE /gallery/{person_id} with an id not in the gallery, or POST /models/load with an unknown preset.',
        },
        {
          status: 422,
          when: 'A required form field or file is missing (name, files or file); detail then lists the missing fields.',
        },
        {
          status: 500,
          when: 'Inference failed, or the model could not be loaded.',
        },
        {
          status: 503,
          when: 'No model is loaded yet: GET /healthcheck answers 503 while the model loads, and gallery and recognition calls fail until it is.',
        },
      ],
    },
    sampleCodeIntro:
      'Enroll a person, then identify the faces in another photo. Both calls take multipart form data and go to this instance.',
    sampleCode: [
      {
        title: 'Enroll and recognize',
        codeSnippets: [
          {
            language: 'Python',
            languageCode: 'python',
            code: `import requests

base = "${host}"

# Enroll Jane from two reference photos
with open("jane-1.jpg", "rb") as a, open("jane-2.jpg", "rb") as b:
    enrolled = requests.post(
        f"{base}/gallery",
        data={"name": "Jane Doe"},
        files=[("files", a), ("files", b)],
    ).json()
print(enrolled["person"]["id"], enrolled["files"])

# Identify the faces in a probe image
with open("group.jpg", "rb") as f:
    result = requests.post(f"{base}/recognize", files={"file": f}).json()
for face in result["faces"]:
    name = face["match"]["name"] if face["matched"] else "Unknown"
    print(name, face["box"])`,
          },
          {
            language: 'cURL',
            languageCode: 'bash',
            code: `curl ${host}/gallery \\
  -F "name=Jane Doe" \\
  -F "files=@jane-1.jpg" \\
  -F "files=@jane-2.jpg"

curl ${host}/recognize -F "file=@group.jpg"`,
          },
        ],
      },
      {
        title: 'Manage the gallery',
        codeSnippets: [
          {
            language: 'cURL',
            languageCode: 'bash',
            code: `# Who is enrolled
curl ${host}/gallery

# Remove one person (the id comes from the list above)
curl -X DELETE ${host}/gallery/3f2a9c1e

# Remove everyone
curl -X DELETE ${host}/gallery`,
          },
        ],
      },
      {
        title: 'Switch the model',
        codeSnippets: [
          {
            language: 'cURL',
            languageCode: 'bash',
            code: `# The presets this worker can run, and the active one
curl ${host}/models

# Load another; the gallery is re-embedded with it
curl -X POST ${host}/models/load \\
  -H "Content-Type: application/json" \\
  -d '{"model": "yunet-sface", "device": "CPU"}'`,
          },
        ],
      },
    ],
    responseExample: `// POST /gallery
{
  "person": {
    "id": "3f2a9c1e",
    "name": "Jane Doe",
    "num_images": 2,
    "thumbnails": ["data:image/jpeg;base64,/9j/4AAQ…", "data:image/jpeg;base64,/9j/4AAQ…"]
  },
  "files": [
    { "file": "jane-1.jpg" },
    { "file": "jane-2.jpg", "error": "No face detected in this image" }
  ]
}

// POST /recognize
{
  "elapsed_ms": 41.37,
  "image": { "width": 1280, "height": 720 },
  "gallery_size": 1,
  "model": "omz-retail",
  "label": "OMZ face-detection-retail-0004",
  "runtime": "openvino:CPU",
  "threshold": 0.4,
  "detect_ms": 12.8,
  "embed_ms": 6.1,
  "num_faces": 1,
  "faces": [
    {
      "box": [412, 128, 164, 201],
      "score": 0.99,
      "landmarks": [[456, 205], [528, 203], [492, 246], [462, 282], [522, 280]],
      "match": { "person_id": "3f2a9c1e", "name": "Jane Doe", "similarity": 0.8123 },
      "matched": true,
      "similarities": [
        { "person_id": "3f2a9c1e", "name": "Jane Doe", "similarity": 0.8123 }
      ]
    }
  ]
}`,
  }
}
