# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import streamlit as st
import ast
import re
from retrieval.api import search_in_db

def play_video(video_path):
   video_file = open(video_path, 'rb')
   video_bytes = video_file.read()
   st.video(video_bytes)

logo_path = 'intel-logo-0.png'
st.logo(logo_path)   
   
st.set_page_config(page_title="Retrieval UI", layout='wide')

st.title("Video RAG Retrieval")

if 'prompt' not in st.session_state.keys():
    st.session_state['prompt'] = ''
    
with st.sidebar:
   top_k = st.slider("Top-K", 1, 10, 1)


query_options = st.selectbox(
        'Example Prompts',
        (
            'Enter Text', 
            #'Anomaly > 0.7',
            'Man wearing glasses', 
            'People reading item description',
            'Man holding red shopping basket',
            'Was there any person wearing a blue shirt seen today?',
            'Was there any person wearing a blue shirt seen in the last 6 hours?',
            'Was there any person wearing a blue shirt seen last Sunday?',
            'Was a person wearing glasses seen in the last 30 minutes?',
            'Was a person wearing glasses seen in the last 72 hours?',
        ),
        key='example_prompt'
    )
    
if st.session_state.example_prompt == 'Enter Text':
  if prompt := st.text_input("Enter your query:", disabled=False):
    st.session_state.prompt = prompt
    
else:
  prompt = st.session_state.example_prompt
  st.session_state.prompt = prompt
  

query = st.session_state.prompt

col1, col2 = st.columns([1, 1])

if st.button("Search"):
    with st.spinner("Searching..."):
        response = search_in_db(query, top_k)

    #print(response)
    
    if "error" in response:
        st.error(f"Search failed: {response['error']}")

    else:
        try:
            results = ast.literal_eval(response["result"])
            #print(results)
            st.success("Results received!")
            
            for result in results["results"]:
                chunk_summary = result["chunk_summary"]
                chunk_path = result["chunk_path"]
                start_time = result["time"]
                score = result["score"]

                with col2:
                    st.markdown("## Retrieved Summary")
                    #safe_summary = re.sub(
                    #    r"(Start time:\s*\d+\s*End time:\s*\d+)",
                    #    r"<strong>\1</strong>",
                    #    chunk_summary
                    #)
                    safe_summary = chunk_summary + f"\n\n*Similarity Score: {score}*" 
                    safe_summary = safe_summary.replace('\n', '<br>')
                    summary_placeholder = st.empty()
                    summary_placeholder.markdown(
                        f"""
                        <div id="scrollable" style='height:500px; overflow-y:auto;'>
                           <div style="white-space: pre-wrap;">{safe_summary}</div>
                        </div>
                        <script>
                            var container = document.getElementById('scrollable');
                            container.scrollTop = container.scrollHeight;
                        </script>
                        """,
                        unsafe_allow_html=True
                    )
                    #st.text_area(f"Summary of this segment:\n{chunk_summary}", height=300)
                with col1:
                    if chunk_path:
                        st.markdown("Video playback")
                        play_video(chunk_path)

        except Exception as e:
            st.error(f"Failed to parse response: {e}")
