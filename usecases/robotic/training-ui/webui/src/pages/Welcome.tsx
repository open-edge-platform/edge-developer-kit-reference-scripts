/*
 * Copyright (C) 2025 Intel Corporation
 * SPDX-License-Identifier: Apache-2.0
 */

import lerobotpng from '@/assets/lerobot.png'
import frankapng from '@/assets/franka.png'
import unitreeg1 from '@/assets/unitreeg1.png'
import ur5epng from '@/assets/ur5e.png'

export type PageName = 'lerobot' | 'franka' | 'ur5e' | 'unitreeg1';

interface WelcomePageProps {
  onNavigate: (pageName: PageName) => void;
  disabledState: Record<PageName, boolean>;
}

const WelcomePage = ({ onNavigate, disabledState  } : WelcomePageProps) => (
  <div className="flex flex-col items-center justify-center p-8 text-center">
    <h1 className="text-4xl font-bold text-blue-600 mb-6">Welcome to Embodied AI</h1>
    <p className="text-gray-600 mb-8 max-w-lg">
      Choose your robot to start your robot training
    </p>
    <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-6">
      <div className="flex flex-col items-center">
        <button 
          disabled={disabledState.lerobot}
          onClick={() => onNavigate('lerobot')}
          className={`group transform transition-transform duration-300 ${disabledState.lerobot ? 'cursor-not-allowed' : 'hover:scale-105'} focus:outline-none focus:ring-4 focus:ring-blue-500 rounded-xl overflow-hidden shadow-lg`}
        >
          <div className="w-84 h-84 relative">
            <img
              src={lerobotpng}
              alt="Link to Page 1"
              className={`w-full h-full object-contain transition-opacity duration-300 group-hover:opacity-80 ${disabledState.lerobot ? 'filter grayscale' : ''}`}
            />
          </div>
        </button>
        <p className={`mt-2 text-sm font-semibold ${disabledState.lerobot ? 'text-gray-400' : 'text-gray-700'}`}>{disabledState.lerobot ? 'LeRobot (Coming Soon)' : 'LeRobot'}</p>
      </div>
    <div className="flex flex-col items-center">
        <button 
          disabled={disabledState.ur5e}
          onClick={() => onNavigate('ur5e')}
          className={`group transform transition-transform duration-300 ${disabledState.ur5e ? 'cursor-not-allowed' : 'hover:scale-105'} focus:outline-none focus:ring-4 focus:ring-blue-500 rounded-xl overflow-hidden shadow-lg`}
        >
          <div className="w-84 h-84 relative">
            <img
              src={ur5epng}
              alt="Link to Page 1"
              className={`w-full h-full object-contain transition-opacity duration-300 group-hover:opacity-80 ${disabledState.ur5e ? 'filter grayscale' : ''}`}
            />
          </div>
        </button>
        <p className={`mt-2 text-sm font-semibold ${disabledState.ur5e ? 'text-gray-400' : 'text-gray-700'}`}>{disabledState.ur5e ? 'UR5e (Coming Soon)' : 'UR5e'}</p>
      </div>
      <div className="flex flex-col items-center">
        <button 
          disabled={disabledState.franka}
          onClick={() => onNavigate('franka')}
          className={`group transform transition-transform duration-300 ${disabledState.franka ? 'cursor-not-allowed' : 'hover:scale-105'} focus:outline-none focus:ring-4 focus:ring-blue-500 rounded-xl overflow-hidden shadow-lg`}
        >
          <div className="w-84 h-84 relative">
            <img
              src={frankapng}
              alt="Link to Page 1"
              className={`w-full h-full object-contain transition-opacity duration-300 group-hover:opacity-80 ${disabledState.franka ? 'filter grayscale' : ''}`}
            />
          </div>
        </button>
        <p className={`mt-2 text-sm font-semibold ${disabledState.franka ? 'text-gray-400' : 'text-gray-700'}`}>{disabledState.franka ? 'Franka Emika (Coming Soon)' : 'Franka Emika'}</p>
      </div>
      <div className="flex flex-col items-center">
        <button 
          disabled={disabledState.unitreeg1}
          onClick={() => onNavigate('unitreeg1')}
          className={`group transform transition-transform duration-300 ${disabledState.unitreeg1 ? 'cursor-not-allowed' : 'hover:scale-105'} focus:outline-none focus:ring-4 focus:ring-red-500 rounded-xl overflow-hidden shadow-lg`}
        >
          <div className="w-84 h-84 relative">
            <img
              src={unitreeg1}
              alt="Link to Page 1"
              className={`w-full h-full object-contain transition-opacity duration-300 group-hover:opacity-80 ${disabledState.unitreeg1 ? 'filter grayscale' : ''}`}
            />
          </div>
        </button>
        <p className={`mt-2 text-sm font-semibold ${disabledState.unitreeg1 ? 'text-gray-400' : 'text-gray-700'}`}>{disabledState.unitreeg1 ? 'Unitree G1 (Coming Soon)' : 'Unitree G1'}</p>
      </div>
      
    </div>
  </div>
);

export default WelcomePage