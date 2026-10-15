import path from "node:path"
import type { NextConfig } from "next"
import { loadEnvConfig } from "@next/env"

loadEnvConfig(path.resolve(process.cwd(), ".."), process.env.NODE_ENV === "development", undefined, true)
const backendUrl = process.env.HUMANOID_RL_API_URL ?? "http://127.0.0.1:8000"
const playbackPort = process.env.NEXT_PUBLIC_HUMANOID_RL_PLAYBACK_PORT
const tensorBoardPort = process.env.NEXT_PUBLIC_HUMANOID_RL_TENSORBOARD_PORT

if (!playbackPort) {
	throw new Error("NEXT_PUBLIC_HUMANOID_RL_PLAYBACK_PORT is not configured.")
}

if (!tensorBoardPort) {
	throw new Error("NEXT_PUBLIC_HUMANOID_RL_TENSORBOARD_PORT is not configured.")
}

const nextConfig: NextConfig = {
	output: "standalone",
	env: {
		NEXT_PUBLIC_HUMANOID_RL_PLAYBACK_PORT: playbackPort,
		NEXT_PUBLIC_HUMANOID_RL_TENSORBOARD_PORT: tensorBoardPort,
	},
	turbopack: {},
	experimental: {
		proxyClientMaxBodySize: "1gb",
	},
	async rewrites() {
		return [
			{
				source: "/playback/:path*",
				destination: `http://127.0.0.1:${playbackPort}/:path*`,
			},
			{
				source: "/tensorboard",
				destination: `http://127.0.0.1:${tensorBoardPort}/tensorboard/`,
			},
			{
				source: "/tensorboard/:path*",
				destination: `http://127.0.0.1:${tensorBoardPort}/tensorboard/:path*`,
			},
			{
				source: "/api/:path*",
				destination: `${backendUrl}/:path*`,
			},
		]
	},
}

export default nextConfig
