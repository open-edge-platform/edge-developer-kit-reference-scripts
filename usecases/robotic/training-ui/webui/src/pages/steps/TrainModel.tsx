/*
 * Copyright (C) 2025 Intel Corporation
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { getAllSavedConfigs } from "@/pages/Utils";

const LOCAL_STORAGE_KEY = "roboticsTrainingSessions";

// Safe storage shims to avoid persisting sensitive content
const memStore: Record<string, string> = {};
const safeGetItem = (key: string): string | null => {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage.getItem(key) : memStore[key] ?? null;
  } catch {
    return memStore[key] ?? null;
  }
};
const safeSetItem = (key: string, value: string): void => {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, value);
    } else {
      memStore[key] = value;
    }
  } catch {
    memStore[key] = value;
  }
};

// Sanitize session content before persistence: drop training logs and transient flags
const sanitizeSession = (s: SessionData): SessionData => {
  return {
    ...s,
    trainingLog: [],
  };
};
const DRAFT_ID = "DRAFT_SESSION_ID";

const generateUniqueId = (): string => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: use crypto.getRandomValues for better entropy than Math.random
  const arr = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
    return (
      "sess-" +
      Array.from(arr)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    );
  }
  return "sess-" + Date.now().toString(36) + "-fallback";
};

type SessionStatus = "Running" | "Paused" | "Complete";
type AcceleratorType = "XPU" | "CUDA";

interface CommonParams {
  steps: number;
  saveStepFreq: number;
  logStepFreq: number;
  dataset: string;
}

interface ACTParams {
  actionChunks: number;
  chunkSize: number;
}

interface SmolVLAParams {
  visualEncoder: "TinyViT" | "MobileNetV2" | "EfficientNet";
  modelWidth: "Small" | "Medium" | "Large";
}

interface GrootN1Params {
  controlFrequency: number;
  actionSpace: "Joint" | "Cartesian" | "Hybrid";
}

type TrainingParams = CommonParams & {
  act?: ACTParams;
  smolVla?: SmolVLAParams;
  grootN1?: GrootN1Params;
};

interface SessionData {
  sessionId: string;
  selectedModel: "ACT" | "SmolVLA" | "GrootN1";
  params: TrainingParams;
  selectedConfigName: string;
  acceleratorType: AcceleratorType;
  deviceId: number;
  status: SessionStatus;
  progress: number;
  trainingLog: string[];
  startTime: number | null;
  lastUpdated: number;
}

type SessionMap = Record<string, SessionData>;

interface ActiveState extends SessionData {
  isTraining: boolean;
}

interface ConfigFieldProps {
  label: string;
  type: "number" | "text" | "select";
  value: string | number;
  onChange: (value: string | number) => void;
  min?: number;
  max?: number;
  options?: string[];
  unit?: string;
  step?: number;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const ConfigField = ({ label, type, value, onChange, min, max, options, unit, step = 1, placeholder, className = "", disabled = false }: ConfigFieldProps) => {
  const isNumber = type === "number";
  const displayValue = isNumber && typeof value === "number" ? value.toString() : (value as string);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const newValue = isNumber ? parseFloat(e.target.value) : e.target.value;
    if (isNumber) {
      if (isNaN(newValue as number) || (min !== undefined && (newValue as number) < min) || (max !== undefined && (newValue as number) > max)) {
        return;
      }
    }
    onChange(newValue);
  };

  const inputClasses =
    "w-full border border-gray-300 rounded-lg p-3 text-gray-800 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm transition duration-150 disabled:bg-gray-100 disabled:text-gray-500";

  return (
    <div className={`space-y-1 ${className}`}>
      <label className="text-sm font-medium text-gray-700 block">{label}</label>
      <div className="flex items-center">
        {type === "select" ? (
          <select value={displayValue} onChange={handleChange} className={inputClasses} disabled={disabled}>
            {options?.map((option) => (
              <option key={option} value={option === "--- Select Dataset ---" ? "" : option} disabled={option === "--- Select Dataset ---" && value === ""}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input type={type} value={displayValue} onChange={handleChange} min={min} max={max} step={step} placeholder={placeholder} className={inputClasses} disabled={disabled} />
        )}
        {unit && <span className="ml-2 text-sm text-gray-500">{unit}</span>}
      </div>
    </div>
  );
};

const loadInitialActiveState = (): ActiveState => {
  const defaultSteps = 20000;
  const defaultParams: TrainingParams = {
    steps: defaultSteps,
    saveStepFreq: Math.max(1, Math.round(defaultSteps * 0.1)),
    logStepFreq: Math.max(1, Math.round(defaultSteps * 0.1)),
    dataset: "",
    act: { actionChunks: 5, chunkSize: 50 },
    smolVla: { visualEncoder: "MobileNetV2", modelWidth: "Medium" },
    grootN1: { controlFrequency: 100, actionSpace: "Joint" },
  };

  return {
    sessionId: DRAFT_ID,
    selectedModel: "ACT",
    params: defaultParams,
    isTraining: false,
    trainingLog: [],
    progress: 0,
    selectedConfigName: "",
    acceleratorType: "XPU",
    deviceId: 0,
    startTime: null,
    status: "Paused",
    lastUpdated: Date.now(),
  };
};

const TrainModelPage = () => {
  const [state, setState] = useState<ActiveState>(loadInitialActiveState);
  const [allSessions, setAllSessions] = useState<SessionMap>({});
  const [availableConfigs, setAvailableConfigs] = useState<string[]>([]);
    // Prevent CWE-22: disallow path-like dataset values
    const isValidDataset = useCallback(
      (name: string): boolean => {
        if (!name) return false;
        const illegalPatterns = [/\.\./, /\//, /\\/, /^~/, /^\./];
        if (illegalPatterns.some((re) => re.test(name))) return false;
        // Must be one of known config names
        return availableConfigs.includes(name) && name !== "--- Select Dataset ---";
      },
      [availableConfigs]
    );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const { sessionId, selectedModel, params, isTraining, trainingLog, progress, status } = state;
  const isSessionAvailable = progress > 0 && status !== "Complete";

  const sessionKeys = Object.keys(allSessions).sort((a, b) => {
    const sessionA = allSessions[a];
    const sessionB = allSessions[b];
    if (sessionA.status === "Running" && sessionB.status !== "Running") return -1;
    if (sessionA.status !== "Running" && sessionB.status === "Running") return 1;
    return (sessionB.lastUpdated || 0) - (sessionA.lastUpdated || 0);
  });

  const formatSessionId = useCallback((id: string) => {
    return id === DRAFT_ID ? "[Draft]" : id.slice(0, 8);
  }, []);

  const saveCurrentSession = useCallback((newState: ActiveState) => {
    const { sessionId } = newState;

    if (sessionId === DRAFT_ID && newState.progress === 0) {
      return;
    }

    const sessionData: SessionData = {
      ...newState,
      isTraining: undefined,
      selectedConfigName: "",
      lastUpdated: Date.now(),
    } as unknown as SessionData;

    setAllSessions((prev) => {
      const newSessions = {
        ...prev,
        [sessionId]: sessionData,
      };
      try {
        // Only store non-sensitive session metadata; avoid credentials or tokens
        const sanitized: SessionMap = Object.fromEntries(
          Object.entries(newSessions).map(([k, v]) => [k, sanitizeSession(v)])
        );
        safeSetItem(LOCAL_STORAGE_KEY, JSON.stringify(sanitized));
      } catch (error) {
        console.error("Could not save sessions to local storage:", error);
      }
      return newSessions;
    });
  }, []);

  const getStatusColor = (s: SessionStatus) => {
    switch (s) {
      case "Running":
        return "bg-blue-100 text-blue-800";
      case "Paused":
        return "bg-yellow-100 text-yellow-800";
      case "Complete":
        return "bg-green-100 text-green-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const resetTrainingProgress = useCallback(() => {
    setState((prev) => {
      const currentId = prev.sessionId;
      const hasProgress = prev.progress > 0;
      const isCriticalChange = currentId !== DRAFT_ID && hasProgress;
      const newSessionId = isCriticalChange ? DRAFT_ID : currentId;
      const newTrainingLog = isCriticalChange ? [...prev.trainingLog, `[CONFIG CHANGE] Configuration changed. Progress reset. Old session saved to history. Editing new DRAFT configuration.`] : [];

      const newState = {
        ...prev,
        isTraining: false,
        progress: 0,
        startTime: null,
        status: "Paused" as SessionStatus,
        sessionId: newSessionId,
        trainingLog: newTrainingLog,
      };

      return newState;
    });
  }, []);

  const updateCommonParam = useCallback(
    (key: keyof CommonParams, value: string | number) => {
      setState((prev) => {
        let newParams = { ...prev.params, [key]: value } as TrainingParams;
        if (key === "steps" && typeof value === "number") {
          const calculatedInterval = Math.max(1, Math.round(value * 0.1));
          newParams = {
            ...newParams,
            saveStepFreq: calculatedInterval,
          };
        }
        if (key === "saveStepFreq" && typeof value === "number") {
          newParams = {
            ...newParams,
            saveStepFreq: Math.max(1, value),
          };
        }

        return { ...prev, params: newParams };
      });

      resetTrainingProgress();
    },
    [resetTrainingProgress]
  );

  const updateModelSpecificParam = useCallback(
    (model: "act" | "smolVla" | "grootN1", key: keyof ACTParams | keyof SmolVLAParams | keyof GrootN1Params, value: string | number) => {
      setState((prev) => {
        const currentModelParams = prev.params[model] || {};
        const newParams = {
          ...prev.params,
          [model]: {
            ...currentModelParams,
            [key]: value,
          } as ACTParams & SmolVLAParams & GrootN1Params,
        } as TrainingParams;

        return { ...prev, params: newParams };
      });

      resetTrainingProgress();
    },
    [resetTrainingProgress]
  );

  const updateDeviceParam = useCallback((key: "acceleratorType" | "deviceId", value: string | number) => {
    setState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleLoadSession = useCallback(
    (idToLoad: string) => {
      if (isTraining) return;

      const sessionToLoad = allSessions[idToLoad];
      if (sessionToLoad) {
        setState({
          ...sessionToLoad,
          isTraining: sessionToLoad.status === "Running",
        });
        console.log(`Session loaded: ${idToLoad}`);
      } else {
        console.error(`Session ID ${idToLoad} not found.`);
      }
    },
    [isTraining, allSessions]
  );

  const handleClearCurrentSessionFromHistory = () => {
    const idToDelete = sessionId;

    setAllSessions((prev) => {
      const newSessions = { ...prev };
      if (idToDelete !== DRAFT_ID) {
        delete newSessions[idToDelete];
      }
      try {
        safeSetItem(LOCAL_STORAGE_KEY, JSON.stringify(newSessions));
      } catch (e) {
        console.error("Error clearing session from storage:", e);
      }
      return newSessions;
    });
    const newSessionState = loadInitialActiveState();
    setState(newSessionState);
    console.log(`Session ${formatSessionId(idToDelete)} reset and cleared from history. Starting new draft.`);
  };

  const handleTrain = async () => {
    if (params.dataset === "" || !isValidDataset(params.dataset)) {
      setState((prev) => ({
        ...prev,
        trainingLog: [
          ...prev.trainingLog,
          `[VALIDATION ERROR] Please select a valid Dataset Source before starting training. Path-like values are not allowed.`,
        ],
      }));
      return;
    }

    if (isTraining || isSubmitting) return;

    if (params.dataset === "" || !isValidDataset(params.dataset)) {
      alert("Please select a dataset");
      return;
    }

    setIsSubmitting(true);

    let finalStatus = "Running" as SessionStatus;
    let finalStartTime = state.startTime || Date.now();
    let logMessage: string;
    let newSessionId = sessionId;
    let newProgress = progress;
    let newTrainingLog = trainingLog;

    if (progress === 0 || status === "Complete") {
      newSessionId = generateUniqueId();
    }

    let selectedModelHyperParam;
    if (selectedModel == "ACT") {
      selectedModelHyperParam = params.act;
    } else if (selectedModel == "GrootN1") {
      selectedModelHyperParam = params.grootN1;
    } else if (selectedModel == "SmolVLA") {
      selectedModelHyperParam = params.smolVla;
    }

    const payload = {
      sessionId: newSessionId,
      model: selectedModel,
      dataset: params.dataset,
      accelerator: state.acceleratorType,
      deviceId: state.deviceId,
      hyperparameters: {
        modelHyperparameters: selectedModelHyperParam,
        steps: params.steps,
        logFreq: params.logStepFreq,
        saveFreq: params.saveStepFreq,
      },
      status: finalStatus,
    };

    let apiSuccess = false;
    try {
      setState((prev) => ({
        ...prev,
        trainingLog: [...prev.trainingLog, `[INFO] Attempting to send configuration to Training Server`],
      }));

      console.log(payload);

      const response = await fetch(`${import.meta.env.VITE_API_SERVER_URL}/train/model`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`API response failed: ${response.statusText} (${response.status})`);
      }
      // const result = await response.json();
      setState((prev) => ({
        ...prev,
        trainingLog: [...prev.trainingLog, `[INFO] Training request accepted by server. Session ID: ${newSessionId}`],
      }));

      apiSuccess = true;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        trainingLog: [...prev.trainingLog, `[ERROR] Failed to send config: ${(error as Error).message}. Local simulation aborted.`],
      }));
    } finally {
      setIsSubmitting(false);
    }

    if (!apiSuccess) return;

    if (progress > 0 && status !== "Complete") {
      logMessage = `[RESUME] Training resumed for ${params.dataset} (ID: ${formatSessionId(newSessionId)}) from ${progress.toFixed(2)}%...`;
      newTrainingLog = [...trainingLog, logMessage];
    } else {
      newProgress = 0;
      finalStartTime = Date.now();
      logMessage = "[START] Initializing training process...";

      if (status === "Complete") {
        newTrainingLog = [`[NEW RUN] Previous session completed. Starting new run with ID ${formatSessionId(newSessionId)}...`, logMessage];
      } else {
        newTrainingLog = [`[NEW RUN] Starting new session with ID ${formatSessionId(newSessionId)}...`, logMessage];
      }
    }

    setState((prev) => ({
      ...prev,
      sessionId: newSessionId,
      isTraining: true,
      progress: newProgress,
      startTime: finalStartTime,
      status: finalStatus,
      trainingLog: newTrainingLog,
    }));
  };

  const handleStop = async () => {
    setIsSubmitting(true);

    const stopProgress = progress;

    let finalStatus = "Paused" as SessionStatus;
    let newSessionId = sessionId;

    let selectedModelHyperParam;
    if (selectedModel == "ACT") {
      selectedModelHyperParam = params.act;
    } else if (selectedModel == "GrootN1") {
      selectedModelHyperParam = params.grootN1;
    } else if (selectedModel == "SmolVLA") {
      selectedModelHyperParam = params.smolVla;
    }

    const payload = {
      sessionId: newSessionId,
      model: selectedModel,
      dataset: isValidDataset(params.dataset) ? params.dataset : "",
      accelerator: state.acceleratorType,
      deviceId: state.deviceId,
      hyperparameters: {
        modelHyperparameters: selectedModelHyperParam,
        steps: params.steps,
        logFreq: params.logStepFreq,
        saveFreq: params.saveStepFreq,
      },
      status: finalStatus,
    };

    try {
      setState((prev) => ({
        ...prev,
        trainingLog: [...prev.trainingLog, `[INFO] Attempting to stop training ...`],
      }));

      console.log(payload);

      const response = await fetch(`${import.meta.env.VITE_API_SERVER_URL}/train/model`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`API response failed: ${response.statusText} (${response.status})`);
      }

      setState((prev) => ({
        ...prev,
        trainingLog: [...prev.trainingLog, `[INFO] Stop Training request accepted by server. Session ID: ${newSessionId}`],
      }));
    } catch (error) {
      console.error("Failed to post training configuration:", error);
      setState((prev) => ({
        ...prev,
        trainingLog: [...prev.trainingLog, `[ERROR] Failed to stop training: ${(error as Error).message}.`],
      }));
    } finally {
      setIsSubmitting(false);
    }

    setState((prev) => ({
      ...prev,
      isTraining: false,
      status: finalStatus,
      trainingLog: [...prev.trainingLog, `[PAUSED] Training paused by user at ${stopProgress.toFixed(2)}%.`],
    }));
  };

  useEffect(() => {
    if (isTraining) {
      const logMessages = [
        `[SESSION] ID: ${formatSessionId(sessionId)}`,
        `[DEVICE] Accelerator: ${state.acceleratorType} (ID: ${state.deviceId})`,
        `[INFO] Model: ${selectedModel}, Config: Custom`,
        `[CONFIG] Dataset: ${params.dataset}, Steps: ${params.steps}`,
      ];
      setState((prev) => ({ ...prev, trainingLog: [...prev.trainingLog, ...logMessages] }));

      const eventSource = new EventSource(`${import.meta.env.VITE_API_SERVER_URL}/train/status`);

      eventSource.addEventListener("metric_update", (event) => {
        try {
          const newLog = JSON.parse(event.data);
          console.log(newLog["status"]);

          setState((prev) => ({
            ...prev,
            trainingLog: [...prev.trainingLog, `${newLog["status"]}`],
          }));

          const currentProgress = (newLog["steps"] / params.steps) * 100;
          setState((prev) => ({ ...prev, progress: currentProgress }));

          if (currentProgress >= 100) {
            // Finalize the run
            setState((prev) => ({
              ...prev,
              isTraining: false,
              progress: 100,
              startTime: null,
              status: "Complete",
              trainingLog: [...prev.trainingLog, "[FINISH] Training completed successfully. Model saved."],
            }));
            return;
          }
        } catch (e) {
          console.error("Error parsing metric update:", e, event.data);
        }
      });

      eventSource.addEventListener("status", (event) => {
        try {
          const data = JSON.parse(event.data);
          setState((prev) => ({
            ...prev,
            trainingLog: [...prev.trainingLog, `[STATUS] ${data["status"]}`],
          }));
        } catch (e) {
          console.error("Error parsing status:", e, event.data);
        }
      });

      eventSource.addEventListener("end", (event) => {
        eventSource.close();
        try {
          const data = JSON.parse(event.data);
          setState((prev) => ({
            ...prev,
            trainingLog: [...prev.trainingLog, `[STATUS] ${data["status"]}`],
          }));
        } catch (e) {
          console.error("Error parsing status:", e, event.data);
        }
      });

      eventSource.onerror = (error) => {
        console.error("EventSource failed:", error);
        eventSource.close();
      };

      return () => {
        eventSource.close();
      };
    }
  }, [isTraining]);

  useEffect(() => {
    const configs = getAllSavedConfigs();
    const configNames = Object.keys(configs);
    setAvailableConfigs(["--- Select Dataset ---", ...configNames]);
  }, []);

  useEffect(() => {
    try {
      const storedSessions = safeGetItem(LOCAL_STORAGE_KEY);
      if (storedSessions) {
        const parsedSessions = JSON.parse(storedSessions);
        if (parsedSessions[DRAFT_ID]) {
          delete parsedSessions[DRAFT_ID];
        }

        setAllSessions(parsedSessions);

        const sessionKeys = Object.keys(parsedSessions);
        const lastSessionId = sessionKeys.sort((a, b) => (parsedSessions[b].lastUpdated || 0) - (parsedSessions[a].lastUpdated || 0))[0];

        if (lastSessionId) {
          const lastSession = parsedSessions[lastSessionId];
          setState({
            ...lastSession,
            isTraining: lastSession.status === "Running",
          });
          console.log(`Loaded last active session: ${lastSessionId}`);
        } else {
          setState(loadInitialActiveState());
        }
      } else {
        setState(loadInitialActiveState());
      }
    } catch (error) {
      console.error("Could not load sessions from local storage:", error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const shouldSave = isTraining || progress > 0 || status === "Complete";
    if (shouldSave) {
      saveCurrentSession(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTraining, progress, state.status, saveCurrentSession]);

  useEffect(() => {
    // logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [trainingLog]);

  return (
    <div className="p-4 sm:p-8 bg-gray-50 min-h-[80vh] rounded-xl shadow-lg border border-gray-200 font-sans">
      <div className="flex space-x-2 p-1 bg-white rounded-xl shadow-md mb-6 max-w-lg mx-auto">
        {["ACT"].map((model) => (
          <button
            key={model}
            onClick={() => setState((prev) => ({ ...prev, selectedModel: model as "ACT" | "SmolVLA" | "GrootN1" }))}
            disabled={isTraining}
            className={`flex-1 py-3 px-4 rounded-lg font-semibold text-lg transition-all duration-300 ${
              selectedModel === model ? "bg-indigo-600 text-white shadow-lg" : "bg-white text-gray-700 hover:bg-gray-100 disabled:bg-gray-200 disabled:text-gray-500"
            }`}
          >
            {model}
          </button>
        ))}
      </div>

      <div className="bg-white p-4 rounded-xl border border-indigo-200 mb-6 shadow-sm">
        <h3 className="text-xl font-bold text-indigo-700 mb-2">{selectedModel} Model</h3>
        <p className="text-gray-600 text-sm">
          {selectedModel === "ACT"
            ? "The Action Chunking Transformer (ACT) is optimized for long-horizon planning by predicting sequences of actions (chunks) instead of individual actions."
            : selectedModel === "SmolVLA"
            ? "The SmolVLA (Small Vision-Language-Action) model is a highly efficient variant designed for low-latency robotics."
            : "The Groot N1 model is a large-scale, general-purpose foundation model for robotics, supporting high-frequency control and complex hybrid action spaces."}
        </p>
      </div>

      <div
        className={`py-3 px-6 rounded-xl mb-6 transition-all duration-500 font-medium shadow-sm border ${
          status === "Running"
            ? "bg-blue-100 text-blue-800 border-blue-300"
            : status === "Complete"
            ? "bg-green-100 text-green-800 border-green-300"
            : isSessionAvailable
            ? "bg-yellow-100 text-yellow-800 border-yellow-300"
            : "bg-indigo-100 text-indigo-700 border-indigo-300"
        }`}
      >
        <p className="text-center font-bold">
          {status === "Running" && `▶️ Currently Training: ${params.dataset} (ID: ${formatSessionId(sessionId)}) at ${progress.toFixed(2)}%`}
          {status === "Paused" && isSessionAvailable && `⏸️ Session Paused: ${params.dataset} (ID: ${formatSessionId(sessionId)}) saved at ${progress.toFixed(2)}%`}
          {status === "Complete" && `✅ Session Complete: ${params.dataset} (ID: ${formatSessionId(sessionId)}) is fully trained!`}
          {status === "Paused" && !isSessionAvailable && `✨ New Configured Session (ID: ${formatSessionId(sessionId)}) ready to start training on ${params.dataset}.`}
        </p>
      </div>

      <div className="flex flex-col lg:flex-row lg:space-x-6 space-y-6 lg:space-y-0">
        <div className="lg:w-1/2">
          <div className="bg-white p-6 rounded-xl shadow-md border border-gray-200 h-full">
            <h3 className="text-xl font-bold text-gray-800 mb-4">1. Configure Session & Hyperparameters</h3>
            <p className="text-gray-600 mb-4 text-sm">Select a data source to start fine tuning</p>

            <div className="grid grid-cols-1 gap-4">
              <ConfigField label="Dataset Source" type="select" value={params.dataset} onChange={(v) => updateCommonParam("dataset", v as string)} options={availableConfigs} disabled={isTraining} />
            </div>

            <div className="mt-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Common Hyperparameters</h3>
              <div className="mb-2 gap-4">
                <ConfigField label="Training Steps" type="number" value={params.steps} onChange={(v) => updateCommonParam("steps", v as number)} min={1} disabled={isTraining} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ConfigField label="Save Step Interval" type="number" value={params.saveStepFreq} onChange={(v) => updateCommonParam("saveStepFreq", v as number)} min={1} disabled={isTraining} />
                <ConfigField label="Log Step Interval" type="number" value={params.logStepFreq} onChange={(v) => updateCommonParam("logStepFreq", v as number)} min={1} disabled={isTraining} />
              </div>
            </div>
          </div>
        </div>

        <div className="lg:w-1/2">
          <div className="bg-white p-6 rounded-xl shadow-md border border-gray-200 h-full">
            <h3 className="text-xl font-bold text-gray-800 mb-4">2. {selectedModel} Model Specifics</h3>
            <p className="text-gray-600 mb-4 text-sm">Adjust parameters specific to the selected model architecture.</p>

            {selectedModel === "ACT" && params.act && (
              <div className="space-y-4">
                <ConfigField
                  label="Action Chunk Size (A)"
                  type="number"
                  value={params.act.chunkSize}
                  onChange={(v) => updateModelSpecificParam("act", "chunkSize", v as number)}
                  min={1}
                  unit="timesteps"
                  placeholder="50"
                  disabled={true}
                />
                <ConfigField
                  label="Number of Action Chunks (K)"
                  type="number"
                  value={params.act.actionChunks}
                  onChange={(v) => updateModelSpecificParam("act", "actionChunks", v as number)}
                  min={1}
                  unit="chunks"
                  placeholder="5"
                  disabled={true}
                />
              </div>
            )}

            {/* SmolVLA Parameters */}
            {selectedModel === "SmolVLA" && params.smolVla && (
              <div className="space-y-4">
                <ConfigField
                  label="Visual Encoder Backbone"
                  type="select"
                  value={params.smolVla.visualEncoder}
                  onChange={(v) => updateModelSpecificParam("smolVla", "visualEncoder", v as SmolVLAParams["visualEncoder"])}
                  options={["TinyViT", "MobileNetV2", "EfficientNet"]}
                  disabled={isTraining}
                />
                <ConfigField
                  label="Model Hidden State Width"
                  type="select"
                  value={params.smolVla.modelWidth}
                  onChange={(v) => updateModelSpecificParam("smolVla", "modelWidth", v as SmolVLAParams["modelWidth"])}
                  options={["Small", "Medium", "Large"]}
                  disabled={isTraining}
                />
              </div>
            )}

            {/* Groot N1 Parameters */}
            {selectedModel === "GrootN1" && params.grootN1 && (
              <div className="space-y-4">
                <ConfigField
                  label="Control Frequency"
                  type="number"
                  value={params.grootN1.controlFrequency}
                  onChange={(v) => updateModelSpecificParam("grootN1", "controlFrequency", v as number)}
                  min={10}
                  unit="Hz"
                  placeholder="100"
                  disabled={isTraining}
                />
                <ConfigField
                  label="Action Space Type"
                  type="select"
                  value={params.grootN1.actionSpace}
                  onChange={(v) => updateModelSpecificParam("grootN1", "actionSpace", v as GrootN1Params["actionSpace"])}
                  options={["Joint", "Cartesian", "Hybrid"]}
                  disabled={isTraining}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 p-6 bg-white rounded-xl shadow-2xl border border-indigo-300 space-y-4">
        <h3 className="text-xl font-bold text-gray-800">3. Select Hardware & Start Training</h3>
        <div className="grid grid-cols-2 gap-4">
          <ConfigField
            label="Accelerator Type"
            type="select"
            value={state.acceleratorType}
            onChange={(v) => updateDeviceParam("acceleratorType", v as "XPU" | "CUDA")}
            options={["XPU", "CUDA"]}
            disabled
          />
          <ConfigField label="Device ID" type="number" value={state.deviceId} onChange={(v) => updateDeviceParam("deviceId", v as number)} min={0} unit="ID" disabled={isTraining} />
        </div>

        {!isTraining && (
          <button
            onClick={handleTrain}
            disabled={isSubmitting || params.dataset === ""} // Disable if dataset is not selected
            className={`w-full py-4 px-6 text-white text-xl font-bold rounded-xl shadow-lg transition duration-300 flex items-center justify-center 
                            ${
                              isSubmitting || params.dataset === ""
                                ? "bg-gray-500 cursor-not-allowed"
                                : progress === 0 || status === "Complete"
                                ? "bg-indigo-600 hover:bg-indigo-700"
                                : "bg-green-600 hover:bg-green-700"
                            }`}
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin h-6 w-6 mr-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Sending Configuration...
              </>
            ) : isSessionAvailable ? (
              <>
                <svg className="h-6 w-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.26a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                Resume Training ({progress.toFixed(0)}%)
              </>
            ) : status === "Complete" ? (
              "Start New Run (Generate New ID)"
            ) : (
              `Start Training (Generate New ID)`
            )}
          </button>
        )}

        {isTraining && (
          <div className="space-y-4">
            <button
              onClick={handleStop}
              className="w-full py-4 px-6 bg-red-600 text-white text-xl font-bold rounded-xl shadow-lg hover:bg-red-700 transition duration-300 flex items-center justify-center"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin h-6 w-6 mr-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Stopping Training ...
                </>
              ) : (
                <>
                  <svg className="h-6 w-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                  </svg>
                  Pause Training
                </>
              )}
            </button>
          </div>
        )}

        <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden mt-4">
          <div className="h-full bg-green-500 rounded-full transition-all duration-500 ease-out" style={{ width: `${progress}%` }}></div>
        </div>
        {(isTraining || progress > 0) && (
          <div className="text-center text-sm font-medium text-indigo-600">
            Training Status: {status} ({progress.toFixed(2)}%)
          </div>
        )}
      </div>

      <div className="mt-6">
        <div className="bg-gray-800 p-4 rounded-lg h-40 sm:h-64 overflow-y-scroll font-mono text-sm text-green-300 shadow-md">
          <h3 className="text-lg font-bold text-gray-100 mb-2 border-b border-gray-700 pb-1">Training Log Console</h3>
          {trainingLog.map((log, index) => (
            <p key={index} className={log.includes("FINISH") ? "text-yellow-300 font-bold" : ""}>
              {log}
            </p>
          ))}
          {trainingLog.length === 0 && <p className="text-gray-500">Training log will appear here...</p>}
          <div ref={logEndRef} />
        </div>
      </div>

      <div className="pt-8 mt-8 border-t border-gray-300">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Session History (Local Storage)</h2>

        <div className="overflow-x-auto shadow-md rounded-xl">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Session ID (Partial)</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Dataset / Model</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Progress</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Last Updated</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sessionKeys.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-gray-500 italic">
                    No saved sessions found. Click "Start Training" above to begin!
                  </td>
                </tr>
              ) : (
                sessionKeys.map((idKey) => {
                  const session = allSessions[idKey];
                  const isActive = idKey === sessionId;

                  return (
                    <tr key={idKey} className={`hover:bg-indigo-50 transition duration-150 ${isActive ? "bg-indigo-100 font-bold" : ""}`}>
                      <td
                        className={`px-6 py-4 whitespace-nowrap text-center text-sm ${isActive ? "text-indigo-700" : "text-gray-900"} cursor-pointer hover:underline`}
                        onClick={() => !isTraining && handleLoadSession(idKey)}
                      >
                        {formatSessionId(idKey)}...
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">
                        {session.params.dataset} / {session.selectedModel}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">
                        {session.progress.toFixed(1)}% ({session.params.steps} steps)
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center text-sm">
                        <span className={`inline-flex items-center px-3 py-0.5 rounded-full text-xs font-medium ${getStatusColor(session.status)}`}>{session.status}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">{new Date(session.lastUpdated).toLocaleTimeString()}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="pt-4 text-center mt-4">
          <button onClick={handleClearCurrentSessionFromHistory} className="text-sm text-gray-500 hover:text-red-600 transition duration-150" disabled={isTraining}>
            {sessionId === DRAFT_ID ? "Clear Current Draft Configuration" : `Clear Session ${formatSessionId(sessionId)}... from History`}
          </button>
          <p className="text-xs text-gray-400 mt-1">Note: All session data is stored locally in your browser and is keyed by a unique ID.</p>
        </div>
      </div>
    </div>
  );
};

export default TrainModelPage;
