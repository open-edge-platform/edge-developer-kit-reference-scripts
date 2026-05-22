# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

VLM_USER_PROMPT="""
  Analyze the video and pay attention to suspicious behaviors by human subject in the video. Use the guidance below to generate response.
  
  Response generation guidance:
  1.No need to provide description of the scene
  2.Some examples of suspicious behaviors to look-out for are provided below:
  -A person appears to pick up an item from shelf and place it in their pocket, bag or clothes.
  -person looking around 
  
  3.Record your finding in JSON format. Only one JSON should be generated with only the following fields: 
  
  camera_name: (string field),
  date: (string field), 
  time_span: (string format: 'hh:mm:ss - hh:mm:ss'), 
  description: (text field), 
  anomaly_score: (floating-point number field)
  alert: (boolean field). 
  
  4.Use following guidance for setting the JSON field:
  -camera_name, date, and time_span field - extract them from the text overlay at the top left corner of the video, and set the field to "unspecified" if it is not provided. 
  -Do not generate any nested json within any of the field. 
  -description field - provide video summary only focusing towards potential suspicious behavior and refer to any human subject appear in the video by their attributes (gender, color/pattern of the clothes they wear) as detail possible. 
  -anomaly_score field - make a wild prediction given no evidence of suspicious behaviors detected and score your prediction from the scale of 0.0 to 1.0 with 0.0 representing a standard scene and 1.0 denoting a scene with suspicious behaviors. Set anomaly score > 0.5 to indicate human expert examination is desired. 
  -alert field - set the alert field to 'true' if anomaly_score is > 0.5.
  """

VLM_USER_PROMPT1="""
  Describe the video and look out for the following:
  
  Some examples of suspicious behaviors to look-out for are provided below:
   -Potential theft: A person appears to pick up an item from shelf and place it in their pocket, bag or clothes.
   -Environment Scanning: person looking around 
  
  Record your finding in JSON format. The JSON should include only the following fields: 
  
  camera_name: (string field),
  date: (string field), 
  time_span: (string format: 'hh:mm:ss - hh:mm:ss'), 
  description: (text field), 
  anomaly_score: (floating-point number field)
  alert: (boolean field). 
  
  
  Instruction for setting the JSON field:
  -camera_name, date, and time_span field - extract them from the text overlay at the top left corner of the video, and set the field to "unspecified" if it is not provided. 
  -Do not generate any nested json within any of the field. 
  -description field - video summary with sensitivity towards potential suspicious behavior as detail possible. 
  -anomaly_score field - make a wild prediction given no evidence of suspicious behaviors detected and score your prediction from the scale of 0.0 to 1.0 with 0.0 representing a standard scene and 1.0 denoting a scene with suspicious behaviors.
  -alert field - set the alert field to 'true' if anomaly_score is > 0.7.
  """

VLM_SYSTEM_PROMPT = "You are an AI assistant to help with monitoring live video feed for suspicious behavior in a shop. Provide your response in journalist writing style, be brief and avoid verbosity such as sharing unnecessary details like your own thoughts and decision process."


