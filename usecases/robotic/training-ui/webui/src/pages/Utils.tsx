/*
 * Copyright (C) 2025 Intel Corporation
 * SPDX-License-Identifier: Apache-2.0
 */
export interface RobotConfig {
  cameras: { name: string; tag: string; checked: boolean; fps: number }[];
  selectedPorts: { teleop: string; robot: string };
  framerate: number;
  episodes: number;
  instruction: string;
}

// Default initial config structure
export const getBaseDefaultConfig = (): RobotConfig => ({
  cameras: [],
  selectedPorts: { teleop: "/dev/ttyACM0", robot: "/dev/ttyACM1" },
  framerate: 25,
  episodes: 50,
  instruction: "",
});

// Function to get all saved configurations
const LOCAL_CONFIG_KEY = "savedRobotConfigs";

// Minimal safe storage wrapper to avoid persisting sensitive fields
const memoryStore: Record<string, string> = {};
const safeGetItem = (key: string): string | null => {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage.getItem(key) : memoryStore[key] ?? null;
  } catch {
    return memoryStore[key] ?? null;
  }
};
const safeSetItem = (key: string, value: string): void => {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, value);
    } else {
      memoryStore[key] = value;
    }
  } catch {
    memoryStore[key] = value;
  }
};

// Ensure we never persist potentially sensitive instruction text
const sanitizeConfig = (cfg: RobotConfig): RobotConfig => {
  const { instruction, ...rest } = cfg;
  return { ...rest, instruction: "" };
};

export const getAllSavedConfigs = (): Record<string, RobotConfig> => {
  try {
    const stored = safeGetItem(LOCAL_CONFIG_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error("Error loading all configs from localStorage:", error);
    return {};
  }
};

// Function to save a new configuration
export const saveNewConfig = (name: string, config: RobotConfig) => {
  const allConfigs = getAllSavedConfigs();
  // Ensure the name doesn't contain the default identifier
  if (name.toLowerCase() === "default") {
    name = `Default-${Date.now()}`;
  }
  const newConfigs = { ...allConfigs, [name]: config };
  try {
    // Only store non-sensitive configuration metadata; strip instruction
    const sanitizedConfigs = { ...allConfigs, [name]: sanitizeConfig(config) };
    safeSetItem(LOCAL_CONFIG_KEY, JSON.stringify(sanitizedConfigs));
  } catch (error) {
    console.error("Error saving new config to localStorage:", error);
  }
};

// Function to delete existing configuration
export const deleteConfig = (name: string) => {
  const allConfigs = getAllSavedConfigs();
  if (allConfigs[name]) {
    delete allConfigs[name];
    try {
      safeSetItem(LOCAL_CONFIG_KEY, JSON.stringify(allConfigs));
    } catch (error) {
      console.error("Error deleting config from localStorage:", error);
    }
  }
};
