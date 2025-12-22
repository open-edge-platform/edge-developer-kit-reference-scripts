// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { EndpointProps } from '../endpoint'

export const wakeWordDetectionEndpoints: EndpointProps[] = [
  {
    title: 'Health Check',
    description: 'Check the health status of the wake word detection service.',
    path: '/healthcheck',
    body: '',
    method: 'GET',
    headers: '',
    exampleResponse: `{
  "status": "running",
  "model_loaded": true,
  "models": ["hey_jarvis_v0.1"],
  "detection_active": false,
  "subscribers": 1
}`,
    parameters: [],
  },
  {
    title: 'Subscribe to Webhooks',
    description:
      'Register a webhook endpoint to receive wake word detection notifications. Your endpoint will receive POST requests when wake words are detected.',
    path: '/v1/wake-word-detection/webhooks/subscribe',
    body: `{
  "url": "https://your-server.com/webhook",
  "name": "My Webhook",
  "threshold": 0.6,
  "api_key": "your-optional-api-key"
}`,
    method: 'POST',
    headers: `Content-Type: application/json`,
    exampleResponse: `{
  "message": "Successfully subscribed to wake word detection webhooks",
  "subscription": {
    "id": 1,
    "name": "My Webhook",
    "url": "https://your-server.com/webhook",
    "threshold": 0.6,
    "api_key": "your-optional-api-key",
    "created_at": "2025-12-11T10:30:00.123456"
  },
  "total_subscribers": 1
}`,
    parameters: [
      {
        name: 'url',
        description:
          'The webhook URL that will receive POST requests when wake words are detected. Must be a valid HTTP/HTTPS URL.',
        required: true,
      },
      {
        name: 'name',
        description:
          'A friendly name for this webhook subscription (optional). Defaults to the provided URL string.',
        required: false,
      },
      {
        name: 'threshold',
        description:
          'Detection confidence threshold (0.0 to 1.0). Only detections above this threshold will trigger webhooks. Default: 0.6',
        required: false,
      },
      {
        name: 'api_key',
        description:
          'Optional API key that will be sent as Bearer token in the Authorization header when calling your webhook.',
        required: false,
      },
    ],
  },
  {
    title: 'Update Subscriber',
    description: 'Update an existing webhook subscriber configuration by URL.',
    path: '/v1/wake-word-detection/webhooks/subscriber',
    body: `{
  "url": "https://your-server.com/webhook",
  "name": "Updated Application Name",
  "threshold": 0.7,
  "api_key": "new-bearer-token"
}`,
    method: 'PATCH',
    headers: `Content-Type: application/json`,
    exampleResponse: `{
  "message": "Subscriber updated successfully",
  "subscription": {
    "id": 1,
    "name": "Updated Application Name",
    "url": "https://your-server.com/webhook",
    "threshold": 0.7,
    "api_key": "new-bearer-token",
    "created_at": "2025-12-11T10:30:00.123456"
  }
}`,
    parameters: [
      {
        name: 'url',
        description:
          'The webhook URL to update. This is used to identify which subscriber to update.',
        required: true,
      },
      {
        name: 'name',
        description: 'Updated friendly name for this webhook subscription.',
        required: false,
      },
      {
        name: 'threshold',
        description: 'Updated detection confidence threshold (0.0 to 1.0).',
        required: false,
      },
      {
        name: 'api_key',
        description: 'Updated API key for webhook authentication.',
        required: false,
      },
    ],
  },
  {
    title: 'Unsubscribe from Webhooks',
    description:
      'Remove a webhook subscription by providing the URL as a query parameter.',
    path: '/v1/wake-word-detection/webhooks/unsubscribe?url=https://your-server.com/webhook',
    body: '',
    method: 'DELETE',
    headers: '',
    exampleResponse: `{
  "message": "Successfully unsubscribed",
  "url": "https://your-server.com/webhook",
  "remaining_subscribers": 0
}`,
    parameters: [
      {
        name: 'url',
        description: 'The webhook URL to unsubscribe. Sent as query parameter.',
        required: true,
      },
    ],
  },
  {
    title: 'List Subscribers',
    description: 'Get a list of all active webhook subscribers.',
    path: '/v1/wake-word-detection/webhooks/subscribers',
    body: '',
    method: 'GET',
    headers: '',
    exampleResponse: `{
  "subscribers": [
    {
      "id": 1,
      "name": "My Webhook",
      "url": "https://your-server.com/webhook",
      "threshold": 0.6,
      "created_at": "2025-12-11T10:30:00.123456"
    }
  ],
  "total": 1
}`,
    parameters: [],
  },
  {
    title: 'Start Detection',
    description:
      "Start listening for wake words on the server's microphone. Detection will run until explicitly stopped.",
    path: '/v1/wake-word-detection/start',
    body: '',
    method: 'POST',
    headers: '',
    exampleResponse: `{
  "message": "Wake word detection started",
  "status": "running",
  "subscribers": 1,
  "models": ["hey_jarvis_v0.1"]
}`,
    parameters: [],
  },
  {
    title: 'Stop Detection',
    description: 'Stop listening for wake words.',
    path: '/v1/wake-word-detection/stop',
    body: '',
    method: 'POST',
    headers: '',
    exampleResponse: `{
  "message": "Wake word detection stopped",
  "status": "stopped"
}`,
    parameters: [],
  },
  {
    title: 'Upload Custom Model',
    description:
      'Upload a custom wake word model in ONNX format. The model will be saved to the models directory and can be loaded using the reload endpoint. Note: This endpoint expects multipart/form-data with a file field.',
    path: '/v1/wake-word-detection/models/upload',
    body: '',
    method: 'POST',
    headers: `Content-Type: multipart/form-data`,
    formData: ['file=@hey_jarvis_v0.1.onnx'],
    exampleResponse: `{
  "status": true,
  "message": "Model uploaded successfully",
  "filename": "custom_wake_word.onnx",
  "path": "/path/to/models/wake-word-detection/custom_wake_word.onnx"
}`,
    parameters: [
      {
        name: 'file',
        description:
          'The ONNX model file to upload. Must have .onnx extension.',
        required: true,
      },
    ],
  },
  {
    title: 'Reload Models',
    description:
      'Reload wake word models dynamically without restarting the server. Detection must be stopped before reloading.',
    path: '/v1/wake-word-detection/models/reload',
    body: `{
  "model_filenames": ["hey_jarvis_v0.1.onnx", "custom_wake_word.onnx"],
  "vad_threshold": 0.2
}`,
    method: 'POST',
    headers: `Content-Type: application/json`,
    exampleResponse: `{
  "message": "Models reloaded successfully",
  "loaded_models": ["hey_jarvis_v0.1", "custom_wake_word"],
  "model_paths": [
    "/path/to/models/hey_jarvis_v0.1.onnx",
    "/path/to/models/custom_wake_word.onnx"
  ]
}`,
    parameters: [
      {
        name: 'model_filenames',
        description:
          'Array of model filenames to load. Can be filenames in the models directory or absolute paths.',
        required: true,
      },
      {
        name: 'vad_threshold',
        description:
          'Voice Activity Detection threshold (0.0 to 1.0). Default: 0.2',
        required: false,
      },
    ],
  },
  {
    title: 'List Models',
    description:
      'Get a list of all available wake word models in the models directory.',
    path: '/v1/wake-word-detection/models/list',
    body: '',
    method: 'GET',
    headers: '',
    exampleResponse: `{
  "models": [
    {
      "filename": "hey_jarvis_v0.1.onnx",
      "path": "/path/to/models/wake-word-detection/hey_jarvis_v0.1.onnx"
    },
    {
      "filename": "custom_wake_word.onnx",
      "path": "/path/to/models/wake-word-detection/custom_wake_word.onnx"
    }
  ],
  "loaded_models": ["hey_jarvis_v0.1"]
}`,
    parameters: [],
  },
  {
    title: 'Delete Model',
    description:
      'Delete a wake word model from the models directory. The model must not be currently loaded.',
    path: '/v1/wake-word-detection/models/delete/{filename}',
    body: '',
    method: 'DELETE',
    headers: '',
    exampleResponse: `{
  "message": "Model deleted successfully",
  "filename": "custom_wake_word.onnx"
}`,
    parameters: [
      {
        name: 'filename',
        description:
          'The filename of the model to delete (e.g., "custom_wake_word.onnx"). Specified in the URL path.',
        required: true,
      },
    ],
  },
  {
    title: 'Test Webhook',
    description:
      'Send a test webhook notification to all registered subscribers to verify webhook configuration.',
    path: '/v1/wake-word-detection/webhooks/test-webhook',
    body: '',
    method: 'POST',
    headers: '',
    exampleResponse: `{
  "message": "Test webhooks sent",
  "results": [
    {
      "url": "https://your-server.com/webhook",
      "status": "success",
      "message": "Test webhook sent successfully"
    }
  ]
}`,
    parameters: [],
  },
]
