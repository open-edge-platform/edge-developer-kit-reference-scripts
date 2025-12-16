/*
 * Copyright (C) 2025 Intel Corporation
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import type { RobotConfig } from "@/pages/Utils";
import { getAllSavedConfigs } from "@/pages/Utils";

interface ModalProps {
  title: string;
  content: React.ReactNode;
  onClose: () => void;
  isDismissible?: boolean;
}

const Modal = ({ title, content, onClose, isDismissible = true }: ModalProps) => {
  const handleOverlayClick = () => {
    if (isDismissible) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/75 flex items-center justify-center p-4" onClick={handleOverlayClick}>
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-6xl max-h-[90vh] overflow-y-auto transform transition-all" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center border-b pb-3 mb-4">
          <h3 className="text-2xl font-bold text-gray-800">{title}</h3>
          {isDismissible && (
            <button onClick={onClose} className="text-gray-500 hover:text-gray-800 transition-colors duration-200 p-2 rounded-full hover:bg-gray-100" aria-label="Close modal">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div>{content}</div>
      </div>
    </div>
  );
};

const StreamActivityIcon = (props: any) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

interface DataCollectionPageProps { }

export interface DataCollectionPageHandles {
  deactivateConfig: () => Promise<void>;
}

const DataCollectionPage = forwardRef<DataCollectionPageHandles, DataCollectionPageProps>((_props, ref) => {
  const [episodes, setEpisodes] = useState<number[]>([]);
  const [savedConfigs, setSavedConfigs] = useState<Record<string, RobotConfig>>({});
  const [selectedConfigName, setSelectedConfigName] = useState<string>("");
  const [selectedConfigEpisodes, setSelectedConfigEpisodes] = useState(0);
  const [currentEpisode, setCurrentEpisode] = useState(-1);
  const [isRecording, setIsRecording] = useState(false);
  const [isConfigActivated, setIsConfigActivated] = useState(false);
  const [videoFeedUrl, setVideoFeedUrl] = useState<string>("");
  const [videoFeedRefreshKey, setVideoFeedRefreshKey] = useState(0);
  const [replayEpisodeUrl, setReplayEpisodeUrl] = useState<string>("");

  const [showModal, setShowModal] = useState(false);
  const [modalContent, setModalContent] = useState<{ episode: number; configName: string } | null>(null);
  const [isModalLoading, setIsModalLoading] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [isSimulation, setIsSimulation] = useState(false);
  const [isSavingEpisode, setIsSavingEpisode] = useState(false);

  const disabledButtonStyles = "bg-gray-300 text-gray-500 cursor-not-allowed";

  useEffect(() => {
    const configs = getAllSavedConfigs();
    setSavedConfigs(configs);
    const configNames = Object.keys(configs);
    if (configNames.length > 0) {
      setSelectedConfigName(configNames[0]);
    }
  }, []);

  const selectedConfig = selectedConfigName ? savedConfigs[selectedConfigName] : null;
  const activeCameraTags = selectedConfig ? selectedConfig.cameras.filter((c) => c.checked && c.tag.trim()).map((c) => c.tag.trim()) : [];

  const activateConfig = useCallback(async () => {
    if (isConfigActivated) {
      return;
    }

    setIsConfigActivated(true);

    const endpoint = isSimulation ? "simulation" : "physical";
    try {
      await fetch(`${import.meta.env.VITE_API_SERVER_URL}/config/activate/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configName: selectedConfigName,
          configActivated: true,
          configData: selectedConfig,
        }),
      });
    } catch (error) {
      console.error("Failed to activate configuration", error);
    }

    setVideoFeedUrl(`${import.meta.env.VITE_API_SERVER_URL}/video/feed`);
  setVideoFeedRefreshKey((prevKey) => prevKey + 1);

    try {
      const response = await fetch(`${import.meta.env.VITE_API_SERVER_URL}/episode/metadata`);
      if (response.ok) {
        const data = await response.json();
        const newRange = Array.from({ length: data["episodes"] }, (_, index) => index + 1);
        setEpisodes(newRange);
      } else {
        setEpisodes([]);
      }
    } catch (error) {
      console.error("Failed to load episode metadata", error);
      setEpisodes([]);
    }

    setSelectedConfigEpisodes(selectedConfig?.episodes || 0);
  }, [isConfigActivated, isSimulation, selectedConfig, selectedConfigName]);

  const deactivateConfig = useCallback(async () => {
    if (!isConfigActivated && !videoFeedUrl && episodes.length === 0) {
      setSelectedConfigEpisodes(0);
      return;
    }

    setIsConfigActivated(false);
    setIsRecording(false);
    setVideoFeedUrl("");
  setVideoFeedRefreshKey((prevKey) => prevKey + 1);
    setEpisodes([]);
    setSelectedConfigEpisodes(0);

    const endpoint = isSimulation ? "simulation" : "physical";
    try {
      await fetch(`${import.meta.env.VITE_API_SERVER_URL}/config/activate/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configName: selectedConfigName,
          configActivated: false,
          configData: selectedConfig,
        }),
      });
    } catch (error) {
      console.error("Failed to deactivate configuration", error);
    }
  }, [episodes.length, isConfigActivated, isSimulation, selectedConfig, selectedConfigName, videoFeedUrl]);

  useImperativeHandle(
    ref,
    () => ({
      deactivateConfig,
    }),
    [deactivateConfig]
  );

  const handleActivateConfig = async () => {
    if (isConfigActivated) {
      await deactivateConfig();
    } else {
      await activateConfig();
    }
  };

  const handleRecord = async () => {
    if (!isConfigActivated) {
      console.warn("Attempted to record while configuration inactive.");
      return;
    }
    if (isRecording) {
      setIsRecording(false);
      // @ts-ignore
      const response = await fetch(`${import.meta.env.VITE_API_SERVER_URL}/episode/stop`);
    } else {
      const response = await fetch(`${import.meta.env.VITE_API_SERVER_URL}/episode/start`);
      if (!response.ok) {
        const status = await response.json();
        alert(status["status"]);
        return;
      }

      const data = await response.json();
      setCurrentEpisode(data["episode"]);
      setIsRecording(true);
    }
  };

  const handleEpisodeClick = (ep: number) => {
    setCurrentEpisode(ep);
    setModalContent({
      episode: ep,
      configName: selectedConfigName || "No Configuration Selected",
    });
    setShowModal(true);
    setIsModalLoading(true);
  };

  const handleSaveEpisode = async () => {
    if (isRecording || isSavingEpisode) {
      if (isRecording) {
        console.warn("Cannot save episode while recording is active.");
      }
      return;
    }

    setIsSavingEpisode(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_SERVER_URL}/episode/save`);
      let data: Record<string, unknown> | null = null;

      try {
        data = await response.json();
      } catch (error) {
        console.error("Failed to parse episode save response", error);
      }

      if (!response.ok) {
        const message = (data && typeof data["status"] === "string") ? (data["status"] as string) : "Failed to save episode.";
        alert(message);
        return;
      }

      if (data && typeof data["episode"] === "number") {
        const totalEpisodes = data["episode"] as number;
        const newRange = Array.from({ length: totalEpisodes }, (_, index) => index + 1);
        setEpisodes(newRange);
      } else {
        console.warn("Unexpected episode save response payload", data);
      }
    } catch (error) {
      console.error("Failed to save episode", error);
      alert("Failed to save episode.");
    } finally {
      setIsSavingEpisode(false);
    }
  };

  const handleResetEpisode = async () => {
    if (isRecording || !isConfigActivated) {
      console.warn("Cannot reset episode while recording or configuration inactive.");
      return;
    }
    const response = await fetch(`${import.meta.env.VITE_API_SERVER_URL}/episode/reset`);
    console.log(response.json());
  };

  const handleReplay = (ep: number) => {
    setReplayEpisodeUrl(`${import.meta.env.VITE_API_SERVER_URL}/episode/replay/${ep}`);
    setReplayKey((prevKey) => prevKey + 1);
    setIsModalLoading(false);
  };

  const handleIsSimulation = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsSimulation(e.target.checked);
  };

  const getCacheBustingUrl = () => {
    if (!replayEpisodeUrl) return "";
    const separator = replayEpisodeUrl.includes("?") ? "&" : "?";
    return `${replayEpisodeUrl}${separator}cacheBuster=${replayKey}`;
  };

  const finalStreamUrl = getCacheBustingUrl();
  const liveFeedSrc = videoFeedUrl ? `${videoFeedUrl}${videoFeedUrl.includes("?") ? "&" : "?"}cacheBust=${videoFeedRefreshKey}` : "";

  return (
    <div className="w-full h-full mx-auto px-4">
      <div className="flex flex-col md:flex-row w-full space-y-6 md:space-y-0 md:space-x-6 mt-4 h-[70vh]">
        <div className="md:w-2/5 flex flex-col space-y-6">
          <div className="border border-gray-300 rounded-lg p-4 shadow-md bg-white">
            <h3 className="text-lg font-bold text-gray-800 border-b pb-2 mb-4 shrink-0">Available Configurations</h3>

            {Object.keys(savedConfigs).length === 0 ? (
              <p className="text-sm text-gray-500 p-2 bg-gray-50 rounded-lg border">No configurations found. Save one on **Step 1: Configure Robot**.</p>
            ) : (
              <select
                id="config-select"
                value={selectedConfigName}
                onChange={(e) => setSelectedConfigName(e.target.value)}
                className={`mt-1 block w-full pl-3 pr-10 py-2 text-base border-2 border-gray-300 rounded-md shadow-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm
                    ${isConfigActivated ? "bg-gray-100 text-gray-800 hover:bg-gray-200 border-gray-200" : ""}`}
                disabled={isConfigActivated}
              >
                <option value="" disabled>
                  Select a configuration...
                </option>
                {Object.keys(savedConfigs).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )}

            <div className="flex w-full mt-4 ml-1">
              <div className="flex items-center h-5">
                <input
                  type="checkbox"
                  disabled={true}
                  checked={isSimulation}
                  onChange={handleIsSimulation}
                  className="focus:ring-indigo-500 h-5 w-5 text-indigo-600 border-gray-300 rounded-md shadow-sm disabled:opacity-50"
                />
              </div>
              <div className="ml-3 text-sm">
                <label className={`font-medium text-gray-700`}>Simulation Mode</label>
              </div>
            </div>
            <div className="flex space-x-4 shrink-0 justify-center flex-wrap gap-y-3 mt-4">
              <button
                onClick={handleActivateConfig}
                className={`flex items-center px-6 py-2 rounded-md font-bold text-white transition-colors shadow-lg focus:outline-none focus:ring-4 
                                ${isConfigActivated ? "bg-red-600 hover:bg-red-700 focus:ring-red-500" : "bg-green-600 hover:bg-green-700 focus:ring-green-500"}`}
              >
                {isConfigActivated ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 6h12v12H6z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                )}
                {isConfigActivated ? "Deactivate" : "Activate"}
              </button>
            </div>
          </div>

          <div className="border border-gray-300 rounded-lg p-4 shadow-md bg-white flex flex-col flex-grow overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-800 border-b pb-2 mb-4 shrink-0">
              Recorded Episodes
              {selectedConfigName && (
                <span className="font-normal text-sm text-gray-600 block mt-1">
                  Total Episodes : {episodes.length} / {selectedConfigEpisodes}
                </span>
              )}
            </h3>

            <div className="space-y-2 overflow-y-auto pr-1 flex-grow">
              {episodes.map((ep) => (
                <div key={ep} className="flex space-x-2 items-center">
                  <label
                    onClick={() => handleEpisodeClick(ep)}
                    className={`flex-1 m-1 p-2 rounded-md font-medium transition-colors duration-200 shadow-sm border text-left truncate cursor-pointer
                                            ${currentEpisode === ep
                        ? "bg-blue-600 text-white ring-2 ring-blue-500 ring-offset-1 border-blue-600"
                        : "bg-gray-100 text-gray-800 hover:bg-gray-200 border-gray-200"
                      }`}
                  >
                    Episode {ep}
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="md:w-3/5 border border-gray-300 rounded-lg p-6 shadow-md bg-white flex flex-col">
          <h2 className="text-2xl font-extrabold text-gray-800 mb-2 shrink-0">Episode {currentEpisode}</h2>
          <div className="text-sm text-gray-500 mb-4 pb-2 border-b shrink-0"></div>
          <div className="flex space-x-4 mb-6 shrink-0 justify-center flex-wrap gap-y-3">
            <button
              onClick={handleRecord}
              disabled={!isConfigActivated}
              className={`flex items-center px-6 py-2 rounded-md font-bold transition-colors shadow-lg focus:outline-none focus:ring-4 
                                ${!isConfigActivated
                  ? disabledButtonStyles
                  : isRecording
                    ? "bg-red-600 hover:bg-red-700 focus:ring-red-500 text-white"
                    : "bg-green-600 hover:bg-green-700 focus:ring-green-500 text-white"}`}
            >
              {isRecording ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 6h12v12H6z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
              )}
              {isRecording ? "Stop Recording" : "Record"}
            </button>

            <button
              onClick={handleSaveEpisode}
              disabled={isRecording || !isConfigActivated || isSavingEpisode}
              className={`flex items-center px-6 py-2 rounded-md font-semibold transition-colors shadow-lg focus:outline-none focus:ring-4
                                ${(isRecording || !isConfigActivated || isSavingEpisode) ? disabledButtonStyles : "bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500"}`}
            >
              {isSavingEpisode ? (
                <div className="flex items-center">
                  <StreamActivityIcon className="h-5 w-5 mr-2 text-white animate-spin-y" />
                  Saving...
                </div>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m8 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Save Episode
                </>
              )}
            </button>

            <button
              onClick={handleResetEpisode}
              disabled={isRecording || !isConfigActivated}
              className={`flex items-center px-6 py-2 rounded-md font-semibold transition-colors shadow-lg focus:outline-none focus:ring-4 
        ${(isRecording || !isConfigActivated)
                  ? disabledButtonStyles
                  : "bg-yellow-400 text-white hover:bg-yellow-700 focus:ring-yellow-500"}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 0012 4.474v.286c.995 0 1.968.225 2.859.65L15 6m-5.485 13.578a8.001 8.001 0 008.203-9.524m-12.871 9.524A8.001 8.001 0 0012 19.526v-.286c-.995 0-1.968-.225-2.859-.65L9 18M20 20v-5h-.581"
                />
              </svg>
              Reset Episode
            </button>
          </div>

          <div className="flex-grow flex items-center justify-center w-full min-h-[200px]">
            <div className="w-full aspect-video flex items-center justify-center shadow-2xl rounded-xl border-4 border-blue-400 transition-all cursor-pointer bg-gray-800 text-green-400 font-mono font-bold text-4xl">
              {videoFeedUrl ? <img key={videoFeedRefreshKey} id="videoFeed" alt={activeCameraTags[0]} src={liveFeedSrc}></img> : activeCameraTags[0]}
            </div>
          </div>

          {activeCameraTags.length === 0 && selectedConfig && (
            <div className="text-center p-8 bg-yellow-100 border-yellow-400 border rounded-lg text-yellow-800 shadow-inner mt-4 shrink-0">
              No cameras were **selected or tagged** in the configuration **{selectedConfigName}**. Please ensure cameras are checked and tagged in Step 1.
            </div>
          )}
          {activeCameraTags.length === 0 && !selectedConfig && (
            <div className="text-center p-8 bg-yellow-100 border-yellow-400 border rounded-lg text-yellow-800 shadow-inner mt-4 shrink-0">
              Please save and select a configuration to view camera feeds here.
            </div>
          )}
        </div>
      </div>

      {showModal && modalContent && (
        <Modal
          title={`Preview Data for Episode ${modalContent.episode}`}
          onClose={() => setShowModal(false)}
          content={
            <div className="space-y-4">
              <div className="w-full aspect-video bg-gray-100 rounded-lg border-4 border-gray-300 flex flex-col items-center justify-center font-mono text-xl text-gray-700 shadow-inner p-4">
                {isModalLoading ? (
                  <>
                    <StreamActivityIcon className="mr-3 h-7 w-7 text-indigo-600 animate-spin-y" />
                    <span className="mt-2 text-base text-center">[Click Replay to load Episode {modalContent.episode}]</span>
                  </>
                ) : (
                  <img src={finalStreamUrl} />
                )}
              </div>

              <p className="text-xs text-gray-500">This feature allows quick inspection of recorded episodes before moving to training.</p>
              <div className="flex flex-col sm:flex-row gap-4 mt-4">
                <button
                  onClick={() => handleReplay(modalContent.episode)}
                  className={`flex-1 px-4 py-2 rounded-full font-semibold transition-colors duration-200 focus:outline-none focus:ring-4 bg-purple-600 text-white hover:bg-purple-700 focus:ring-purple-500"`}
                >
                  <div className="flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                    </svg>
                    Replay
                  </div>
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 rounded-full bg-gray-400 text-gray-800 font-semibold hover:bg-gray-500 transition-colors duration-200 focus:outline-none focus:ring-4 focus:ring-gray-500"
                >
                  Close Preview
                </button>
              </div>
            </div>
          }
        />
      )}
      {isSavingEpisode && (
        <Modal
          title="Saving Episode"
          onClose={() => { }}
          isDismissible={false}
          content={
            <div className="flex flex-col items-center justify-center space-y-4 py-6">
              <StreamActivityIcon className="h-12 w-12 text-indigo-600 animate-spin-y" />
              <p className="text-sm text-gray-600 text-center">Please wait while the episode is saved.</p>
            </div>
          }
        />
      )}
    </div>
  );
});

DataCollectionPage.displayName = "DataCollectionPage";

export default DataCollectionPage;
