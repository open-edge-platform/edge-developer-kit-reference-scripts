/*
 * Copyright (C) 2025 Intel Corporation
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";

import { getBaseDefaultConfig, getAllSavedConfigs, saveNewConfig, deleteConfig } from "@/pages/Utils";
import type { RobotConfig } from "@/pages/Utils";

import ConfigureRobotPage from "@/pages/steps/ConfigureRobot";
import DataCollectionPage, { type DataCollectionPageHandles } from "@/pages/steps/CollectData";
import TrainModelPage from "@/pages/steps/TrainModel";

const LeRobotPage = () => {
  const totalSteps = 3;
  const [currentStep, setCurrentStep] = useState(1);
  const [savedConfigs, setSavedConfigs] = useState<Record<string, RobotConfig>>({});
  const [currentConfig, setCurrentConfig] = useState<RobotConfig>(getBaseDefaultConfig());
  const [configToLoadName, setConfigToLoadName] = useState("");
  const [loadedConfigName, setLoadedConfigName] = useState("");
  const dataCollectionRef = useRef<DataCollectionPageHandles>(null);

  useEffect(() => {
    const configs = getAllSavedConfigs();
    setSavedConfigs(configs);
  }, []);

  const handleLoadConfig = () => {
    if (configToLoadName && savedConfigs[configToLoadName]) {
      setCurrentConfig(savedConfigs[configToLoadName]);
      setLoadedConfigName(configToLoadName);
    }
  };

  const handleDeleteConfig = async () => {
    if (configToLoadName && savedConfigs[configToLoadName]) {
      const postPayload = { configName: configToLoadName, configData: savedConfigs[configToLoadName] };

      try {
        const response = await fetch(`${import.meta.env.VITE_API_SERVER_URL}/config/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(postPayload),
        });

        if (!response.ok) {
          console.error("Config delete request failed", response.status, response.statusText);
          return;
        }

        try {
          await response.json();
        } catch (error) {
          console.error("Failed to parse config delete response", error);
          return;
        }
      } catch (error) {
        console.error("Failed to delete config via API", error);
        return;
      }

      deleteConfig(configToLoadName);
      const configs = getAllSavedConfigs();
      setSavedConfigs(configs);
      setConfigToLoadName("");
      if (loadedConfigName === configToLoadName) {
        setLoadedConfigName("");
      }
    }
  };

  const handleSaveConfig = async (config: RobotConfig, name: string) => {
    saveNewConfig(name, config);
    const configs = getAllSavedConfigs();
    const postPayload = {
      configName: name,
      configData: config,
    };

    const response = await fetch(`${import.meta.env.VITE_API_SERVER_URL}/config/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postPayload),
    });

    const jsondata = await response.json();
    console.log(jsondata);

    setSavedConfigs(configs);
    setLoadedConfigName("");
  };

  const handleNext = async () => {
    if (currentStep === 2 && dataCollectionRef.current) {
      try {
        await dataCollectionRef.current.deactivateConfig();
      } catch (error) {
        console.error("Failed to deactivate configuration before advancing", error);
      }
    }

    setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
  };

  const handlePrev = async () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const stepLabels = ["Configure Robot", "Collect Data", "Train Model"];

  const contentByStep: Record<number, React.ReactNode> = {
    1: <ConfigureRobotPage initialConfig={currentConfig} onSave={handleSaveConfig} loadedConfigName={loadedConfigName} />,
    2: <DataCollectionPage ref={dataCollectionRef} />,
    3: <TrainModelPage />,
  };

  return (
    <div className="flex flex-col items-center w-full h-full px-4">
      <div className="w-full mb-8">
        <div className="flex items-center space-x-2">
          <div className="flex-1 flex flex-col items-center">
            <button
              onClick={handlePrev}
              disabled={currentStep === 1}
              className={`w-32 py-2 rounded-full font-semibold transition-colors duration-200 ${currentStep === 1 ? "bg-gray-200 text-gray-400 cursor-not-allowed" : "bg-gray-200 text-gray-800 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500"
                }`}
            >
              Previous
            </button>
          </div>
          {stepLabels.map((label, i) => (
            <div key={i} className="flex-1 flex flex-col items-center">
              <div className="relative flex items-center w-full">
                <div className={`flex-1 h-2 rounded-full transition-all duration-300 ${i + 1 <= currentStep ? "bg-blue-500" : "bg-gray-300"}`}></div>
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${i + 1 <= currentStep ? "bg-blue-500 border-blue-500" : "bg-white border-gray-300"
                    }`}
                >
                  {i + 1 <= currentStep && (
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </div>
              <p className={`text-xs mt-2 transition-colors duration-300 ${i + 1 <= currentStep ? "text-blue-600 font-semibold" : "text-gray-500"}`}>{label}</p>
            </div>
          ))}
          <div className="flex-1 flex flex-col items-center">
            <button
              onClick={handleNext}
              disabled={currentStep === totalSteps}
              className={`w-32 py-2 rounded-full font-semibold transition-colors duration-200 ${currentStep === totalSteps ? "bg-gray-200 text-gray-400 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                }`}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {currentStep === 1 && Object.keys(savedConfigs).length > 0 && (
        <div className="w-full mt-4 mb-6 p-4 border border-dashed rounded-xl bg-gray-50 shadow-inner">
          <label htmlFor="load-config" className="block text-sm font-medium text-gray-700 mb-2">
            Load From Existing Configuration
          </label>
          <div className="flex space-x-2">
            <select
              id="load-config"
              value={configToLoadName}
              onChange={(e) => setConfigToLoadName(e.target.value)}
              className="flex-1 block pl-3 pr-10 py-2 text-base border-2 border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
            >
              <option value="" disabled>
                Select a configuration to load...
              </option>
              {Object.keys(savedConfigs).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              onClick={handleLoadConfig}
              disabled={!configToLoadName}
              className="px-4 py-2 rounded-md font-semibold text-white bg-green-600 hover:bg-green-700 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
            >
              Load
            </button>
            <button
              onClick={handleDeleteConfig}
              disabled={!configToLoadName}
              className="px-4 py-2 rounded-md font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      <div className="w-full mt-4 text-center">{contentByStep[currentStep]}</div>

      {/* <div className="flex space-x-4 mt-4">
        <button
          onClick={handlePrev}
          disabled={currentStep === 1}
          className={`px-4 py-2 rounded-full font-semibold transition-colors duration-200 ${
            currentStep === 1 ? "bg-gray-200 text-gray-400 cursor-not-allowed" : "bg-gray-200 text-gray-800 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500"
          }`}
        >
          Previous
        </button>
        <button
          onClick={handleNext}
          disabled={currentStep === totalSteps}
          className={`px-4 py-2 rounded-full font-semibold transition-colors duration-200 ${
            currentStep === totalSteps ? "bg-gray-200 text-gray-400 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          }`}
        >
          Next
        </button>
      </div> */}
    </div>
  );
};

export default LeRobotPage;
