# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

from fastapi import FastAPI

from ai_chatbot import get_response

app = FastAPI()

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.post("/query")
def query_endpoint(message: str):
    if not message:
        return {"error": "Message is required"}, 400
    try:
        response = get_response(message)
        return {"response": str(response)}
    except Exception as e:
        return {"error": str(e)}, 500
