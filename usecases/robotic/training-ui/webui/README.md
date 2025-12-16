# Robotic EmbodiedAI Web UI

This is the web-based user interface for the Robotic EmbodiedAI project. It provides an interactive frontend for configuring robots, collecting data, training models, and visualizing results.

## Features
- Modern React + TypeScript + Vite stack
- Multi-step workflow for robot setup, data collection, and model training
- Integration with backend server and Tauri for desktop features
- Modular page structure for easy extension

## Directory Structure
```
webui/
├── public/                # Static assets
├── src/                   # Main frontend source code
│   ├── App.tsx            # Main app component
│   ├── pages/             # Page components (LeRobot, Utils, Welcome, steps/)
│   └── ...                # Styles, assets, entry points
├── src-tauri/             # Tauri desktop integration (Rust)
├── package.json           # NPM dependencies and scripts
├── vite.config.ts         # Vite configuration
├── tsconfig*.json         # TypeScript configuration
├── README.md              # This file
```

## Setup

1. Follow the [link](https://nodejs.org/en/download) to install `node.js v24`

2. **Install dependencies**
   
   After nodejs installation, open a new terminal and run the following command to install the frontend dependencies.

   ```bash
   npm install
   ```

## Run

1. **Run the development server**

   ```bash
   npm run dev
   ```
   The app will be available at `http://localhost:5173` by default.

## Key Pages
- `pages/LeRobot.tsx`: Robot configuration and control
- `pages/steps/CollectData.tsx`: Data collection workflow
- `pages/steps/ConfigureRobot.tsx`: Robot setup
- `pages/steps/TrainModel.tsx`: Model training interface

## Development
- Uses ESLint and TypeScript for code quality
- Easily extendable with new pages and components

## Contributing
Pull requests and issues are welcome. Please follow the project coding standards and document your code.

## License
See the root project for license information.