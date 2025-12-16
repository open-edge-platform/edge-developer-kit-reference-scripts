# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import zmq
import time
import gymnasium as gym
import numpy as np
import json
import gym_hil  # noqa: F401

context = zmq.Context()
socket = context.socket(zmq.PUB)
socket.bind("tcp://*:5556")

def main():
    env_id = "gym_hil/PandaPickCubeKeyboard-v0"
    env = gym.make(
        env_id,
        render_mode="human",
        image_obs=True,
        use_gamepad=False,
        max_episode_steps=1000,  # 100 seconds * 10Hz
    )

    # Print observation space for the wrapped environment
    print("Wrapped observation space:", env.observation_space)

    # Reset and check wrapped observation structure
    obs, _ = env.reset()
    print("Wrapped observation keys:", list(obs.keys()))

    # Reset environment
    obs, _ = env.reset()
    dummy_action = np.zeros(4, dtype=np.float32)
    dummy_action[-1] = 1

    topic = "live_data"

    try:
        while True:
            # Step the environment
            obs, reward, terminated, truncated, info = env.step(dummy_action)
            
            try:
                socket.send_string("NUMPY_DATA", zmq.SNDMORE)
                socket.send_pyobj(obs)
                # socket.send_multipart([topic.encode('utf-8'), message.encode('utf-8')])
            except:
                pass
            
            # Print some feedback
            if info.get("succeed", False):
                print("\nSuccess! Block has been picked up.")

            # If auto-reset is disabled, manually reset when episode ends
            if terminated or truncated:
                print("Episode ended, resetting environment")
                obs, _ = env.reset()

            time.sleep(0.1)

    except KeyboardInterrupt:
        print("Interrupted by user")
    finally:
        env.close()
        print("Session ended")


if __name__ == "__main__":
    main()