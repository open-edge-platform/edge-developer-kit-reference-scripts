# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import zmq
import sys
import numpy as np
import cv2

# Define the connection details
ZMQ_ADDRESS = "tcp://10.158.108.112:5556"
# The topic we want to subscribe to (e.g., 'STATUS'). 
# Use b'' or b' ' for all topics.
SUBSCRIPTION_TOPIC = b"live_data" 

# 1. Get the ZeroMQ context
context = zmq.Context()

# 2. Create the SUB socket
socket = context.socket(zmq.SUB)

# 3. Connect to the publisher server
print(f"Connecting to ZMQ publisher at {ZMQ_ADDRESS}...")
socket.connect(ZMQ_ADDRESS)

# 4. Set the subscription filter
# The socket receives only messages starting with this topic byte string.
# An empty string (b'') subscribes to ALL messages.
socket.subscribe("NUMPY_DATA")
print(f"Subscribed to topic: {SUBSCRIPTION_TOPIC.decode()}")

try:
    # 5. Start the message receiving loop
    while True:
        # zmq.SUB sockets often send messages in two parts (multipart):
        # [Topic, Message]
        topic = socket.recv_string() 

        # Use recv_multipart() to get both parts
        received_array = socket.recv_pyobj() 
        
        for k, v in received_array['pixels'].items():
            if isinstance(v, np.ndarray):
                cv2.imshow("frame", v)
        
        cv2.waitKey(10)

        # print(f"Received topic: {topic}")
        # print(f"Received array:\n{received_array}")


except KeyboardInterrupt:
    print("\nShutting down SUB client...")
finally:
    # 6. Clean up
    socket.close()
    context.term()