/*
 * Copyright (C) 2025 Intel Corporation
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import WelcomePage from "@/pages/Welcome";
import type { PageName } from "@/pages/Welcome";
import LeRobotPage from "@/pages/LeRobot";

interface PageProps {
  title: string;
  children: React.ReactNode;
  onNavigateBack: () => void;
}

const Page = ({ title, children, onNavigateBack }: PageProps) => (
  <div className="flex flex-col w-full max-w-[80vw] h-full items-center justify-center p-8 text-center">
    {/* <h1 className="text-4xl font-bold text-blue-600 mb-4">{title}</h1> */}
    {children}
    {/* <button
      onClick={onNavigateBack}
      className="mt-8 px-6 py-2 rounded-full bg-gray-200 text-gray-800 font-semibold hover:bg-gray-300 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-500"
    >
      Go Back
    </button> */}
  </div>
);

type PageNameExtended = "home" | PageName;

const App = () => {
  const [currentPage, setCurrentPage] = useState("home");
  const [disabledState] = useState<Record<PageName, boolean>>({
    lerobot: false,
    ur5e: true,
    franka: true,
    unitreeg1: true,
  });

  const navigate = (pageName: PageNameExtended) => {
    setCurrentPage(pageName);
  };

  const renderContent = () => {
    switch (currentPage) {
      case "home":
        return <WelcomePage onNavigate={navigate} disabledState={disabledState} />;
      case "lerobot":
        return (
          <Page title="LeRobot" onNavigateBack={() => navigate("home")}>
            <LeRobotPage />
          </Page>
        );
      case "page2":
        return (
          <Page title="Page 2" onNavigateBack={() => navigate("home")}>
            <p className="text-gray-600 mb-8 max-w-lg">This is the content for Page 2.</p>
          </Page>
        );
      case "page3":
        return (
          <Page title="Page 3" onNavigateBack={() => navigate("home")}>
            <p className="text-gray-600 mb-8 max-w-lg">This is the content for Page 3.</p>
          </Page>
        );
      case "page4":
        return (
          <Page title="Page 4" onNavigateBack={() => navigate("home")}>
            <p className="text-gray-600 mb-8 max-w-lg">This is the content for Page 4.</p>
          </Page>
        );
      default:
        return <WelcomePage onNavigate={navigate} disabledState={disabledState} />;
    }
  };

  return <div className="bg-white min-h-screen flex flex-col items-center justify-center text-gray-900 p-4 font-sans">{renderContent()}</div>;
};

export default App;
