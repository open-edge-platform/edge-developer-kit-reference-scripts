/*
 * Copyright (C) 2025 Intel Corporation
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import type { RobotConfig } from "@/pages/Utils";

export interface ConfigureRobotProps {
  initialConfig: RobotConfig;
  onSave: (config: RobotConfig, configName: string) => void;
  loadedConfigName: string;
}

interface CameraDetail {
  name: string;
  type: string;
  id: string;
  backend_api: string;
  default_stream_profile: {
    format: number;
    width: number;
    height: number;
    fps: number;
  };
}

interface ComPort {
  port: string;
}

interface CameraItem {
  name: string;
  id: string;
  type: string;
  tag: string;
  fps: number;
  checked: boolean;
}

const ConfigureRobotPage = ({ initialConfig, onSave, loadedConfigName }: ConfigureRobotProps) => {
  // New states for API fetch
  const [fetchedCameraDetails, setFetchedCameraDetails] = useState<{ name: string; id: string; type: string }[]>([]);
  const [fetchedComPorts, setFetchedComPorts] = useState<{ port: string }[]>([]);

  const [isLoadingCameras, setIsLoadingCameras] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // States are initialized using the prop passed from the parent
  const [cameras, setCameras] = useState(initialConfig.cameras);
  const [selectedPorts, setSelectedPorts] = useState(initialConfig.selectedPorts);
  const [framerate, setFramerate] = useState(initialConfig.framerate);
  const [episodes, setEpisodes] = useState(initialConfig.episodes);
  const [instruction, setInstruction] = useState(initialConfig.instruction);
  const [configSaveName, setConfigSaveName] = useState("");
  const [submissionStatus, setSubmissionStatus] = useState<string | null>(null);

  useEffect(() => {
    const fetchCameraData = async (retries = 3) => {
      setIsLoadingCameras(true);
      setCameraError(null);
      try {
        const response = await fetch(`${import.meta.env.VITE_API_SERVER_URL}/camera/info`);
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data: CameraDetail[] = await response.json();
        if (!Array.isArray(data) || data.some((item) => typeof item.name !== "string")) {
          throw new Error("Invalid data format received from api. Expected an array of objects with a 'name' property.");
        }

        const cameraDetails = data.map((camera) => ({
          name: camera.name,
          id: camera.id,
          type: camera.type,
        }));

        setFetchedCameraDetails(cameraDetails);
        setIsLoadingCameras(false);
      } catch (error) {
        console.error("Failed to fetch camera list:", error);
        if (retries > 0) {
          const delay = (4 - retries) * 1000; // 1s, 2s, 3s delay
          console.log(`Retrying camera fetch in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(() => resolve(undefined), delay));
          fetchCameraData(retries - 1);
        } else {
          setCameraError(`Failed to load cameras after 3 retries. Error: ${error instanceof Error ? error.message : "Unknown error"}. Check API endpoint.`);
          setIsLoadingCameras(false);
        }
      }
    };
    fetchCameraData();
  }, []);

  useEffect(() => {
    const fetchComPortData = async (retries = 3) => {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_SERVER_URL}/serial/info`);
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data: ComPort[] = await response.json();
        setFetchedComPorts(data);
      } catch (error) {}
    };
    fetchComPortData();
  }, []);

  useEffect(() => {
    if (isLoadingCameras) return;

    const savedMap = new Map(initialConfig.cameras.map((c) => [c.name, c]));
    const mergedCameras: CameraItem[] = fetchedCameraDetails.map((detail) => {
      const saved = savedMap.get(detail.name);
      return {
        name: detail.name,
        id: detail.id,
        type: detail.type,
        tag: saved ? saved.tag : "",
        fps: saved ? saved.fps : 25,
        checked: saved ? saved.checked : false,
      };
    });

    setCameras(mergedCameras);

    setSelectedPorts(initialConfig.selectedPorts);
    setFramerate(initialConfig.framerate);
    setEpisodes(initialConfig.episodes);
    setInstruction(initialConfig.instruction);
    setConfigSaveName(loadedConfigName);

    if (loadedConfigName) {
      setSubmissionStatus(`Configuration '${loadedConfigName}' loaded successfully!`);
      setTimeout(() => setSubmissionStatus(null), 3000);
    }
  }, [initialConfig, fetchedCameraDetails, isLoadingCameras, loadedConfigName]);

  const handleCameraCheck = (index: number, isChecked: boolean) => {
    setCameras((prevCameras) => {
      const newCameras = [...prevCameras];
      newCameras[index].checked = isChecked;
      return newCameras;
    });      
  };

  const handleCameraTagChange = (index: number, value: string) => {
    setCameras((prevCameras) => {
      const newCameras = [...prevCameras];
      newCameras[index].tag = value;
      return newCameras;
    });
  };

  const handleCameraFPSChange = (index: number, value: number) => {
    setCameras((prevCameras) => {
      const newCameras = [...prevCameras];
      newCameras[index].fps = value;
      return newCameras;
    });
  };

  const handlePortChange = (robotName: string, value: string) => {
    // @ts-ignore
    setSelectedPorts((prevPorts) => {
      const otherRobotName = robotName === "teleop" ? "robot" : "teleop";
      if (prevPorts[otherRobotName as "teleop" | "robot"] === value) {
        const remainingPort = value === "/dev/ttyACM0" ? "/dev/ttyACM1" : "/dev/ttyACM0";

        return {
          [robotName]: value,
          [otherRobotName]: remainingPort,
        };
      }

      return {
        ...prevPorts,
        [robotName]: value,
      };
    });
  };

  const handleSubmit = () => {
    if (!configSaveName.trim()) {
      setSubmissionStatus("Error: Please enter a name for this configuration before saving.");
      return;
    }

    const selectedCameras = cameras.filter((camera) => camera.checked == true);

    const fullConfigToSave: RobotConfig = {
      cameras: selectedCameras,
      selectedPorts,
      framerate,
      episodes,
      instruction,
    };
    onSave(fullConfigToSave, configSaveName.trim());
    setSubmissionStatus(`Configuration '${configSaveName.trim()}' saved successfully!`);
    setConfigSaveName("");
    setTimeout(() => setSubmissionStatus(null), 3000);
  };

  const robotNames = ["teleop", "robot"];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
        {robotNames.map((robotName, index) => (
          <div key={index} className="flex-1">
            <label htmlFor={`robot-${index}`} className="block text-sm font-medium text-gray-700">
              {robotName.charAt(0).toUpperCase() + robotName.slice(1)}
            </label>
            <select
              id={`robot-${index}`}
              className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-2 border-gray-300 rounded-md shadow-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              value={selectedPorts[robotName as "teleop" | "robot"]}
              onChange={(e) => handlePortChange(robotName, e.target.value)}
            >
              {fetchedComPorts.map((port, index) => (
                <option key={index} value={port.port}>
                  {port.port}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="border border-gray-300 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Camera</h3>

        {isLoadingCameras && (
          <div className="text-center p-4">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-500 inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            <span className="text-blue-500">Loading cameras from /api/camera...</span>
          </div>
        )}

        {cameraError && (
          <div className="p-3 text-sm rounded-lg bg-red-100 text-red-700 border border-red-300">
            <p className="font-bold">Camera Load Error:</p>
            <p>{cameraError}</p>
          </div>
        )}

        {!isLoadingCameras && !cameraError && (
          <>
            <div className="grid grid-cols-4 gap-2 text-gray-500 text-sm font-medium border-b pb-2">
              <span>Select</span>
              <span>Name</span>
              <span>Tag</span>
              <span>FPS</span>
            </div>
            {cameras.length === 0 ? (
              <p className="text-gray-500 mt-2 p-2 bg-yellow-50 rounded-md">No cameras were detected by the system.</p>
            ) : (
              cameras.map((camera, index) => (
                <div key={camera.name} className="grid grid-cols-4 gap-2 mt-2 items-center">
                  <input
                    type="checkbox"
                    checked={camera.checked}
                    onChange={(e) => handleCameraCheck(index, e.target.checked)}
                    className="form-checkbox h-4 w-4 text-blue-600 rounded-md"
                  />
                  <span title={camera.name}>{camera.name}</span>
                  <input
                    type="text"
                    value={camera.tag}
                    onChange={(e) => handleCameraTagChange(index, e.target.value)}
                    placeholder="e.g., 'front_rgb'"
                    className="border-2 border-gray-300 rounded-md shadow-md p-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                  <input
                    type="number"
                    value={camera.fps}
                    onChange={(e) => handleCameraFPSChange(index, e.target.valueAsNumber)}
                    defaultValue={camera.fps}
                    className="border-2 border-gray-300 rounded-md shadow-md p-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
              ))
            )}
          </>
        )}
      </div>
      <div className="border border-gray-300 rounded-lg p-4 space-y-4">
        <h3 className="text-lg font-semibold text-gray-800">Dataset Configuration</h3>
        <div className="flex flex-col md:flex-row md:space-x-4 space-y-4 md:space-y-0">
          <div className="flex-1">
            <label htmlFor="framerate" className="block text-sm font-medium text-gray-700">
              Camera Framerate
            </label>
            <div className="mt-1 flex rounded-md shadow-md">
              <input
                type="number"
                id="framerate"
                value={framerate}
                onChange={(e) => setFramerate(Number(e.target.value))}
                className="flex-1 block w-full border-2 border-gray-300 rounded-l-md focus:ring-blue-500 focus:border-blue-500 sm:text-sm p-2"
              />
              <span className="inline-flex items-center px-3 rounded-r-md border-t-2 border-r-2 border-b-2 border-gray-300 bg-gray-50 text-gray-500 text-sm">
                FPS
              </span>
            </div>
          </div>
          <div className="flex-1">
            <label htmlFor="episodes" className="block text-sm font-medium text-gray-700">
              Number of Episodes
            </label>
            <input
              type="number"
              id="episodes"
              value={episodes}
              onChange={(e) => setEpisodes(Number(e.target.value))}
              className="mt-1 block w-full border-2 border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm p-2"
            />
          </div>
        </div>
        <div>
          <label htmlFor="instruction" className="block text-sm font-medium text-gray-700">
            Instruction
          </label>
          <textarea
            id="instruction"
            rows={1}
            value={instruction}
            placeholder="e.g., 'Pickup the orange cube'"
            onChange={(e) => setInstruction(e.target.value)}
            className="mt-1 block w-full border-2 border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm p-2"
          ></textarea>
        </div>
      </div>

      {/* Grouped Save Configuration Block */}
      <div className="mt-4 p-4 border-2 border-blue-200 rounded-xl bg-blue-50 space-y-4">
        <div>
          <label htmlFor="save-name" className="block text-sm font-medium text-gray-700">
            Save Configuration As
          </label>
          <input
            type="text"
            id="save-name"
            placeholder="e.g., 'Experiment 1'"
            value={configSaveName}
            onChange={(e) => setConfigSaveName(e.target.value)}
            className="mt-1 block w-full border-2 border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm p-2"
          />
        </div>
        {submissionStatus && (
          <div className={`p-3 text-sm rounded-lg ${submissionStatus.startsWith("Error") ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
            {submissionStatus}
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={isLoadingCameras || !!cameraError}
          className="w-full px-4 py-2 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          Submit and Save Configuration
        </button>
      </div>
    </div>
  );
};

export default ConfigureRobotPage;
