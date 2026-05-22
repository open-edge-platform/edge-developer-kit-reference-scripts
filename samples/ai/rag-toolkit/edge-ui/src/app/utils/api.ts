// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type APIResponse } from "@/types/api";

interface RequestConfig {
  headers?: Record<string, any>;
  data?: any;
  tags?: string[];
  revalidate?: number;
}

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const apiVersion = "v1";

class FetchAPI {
  private baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = new URL(`${apiVersion}/path`, baseURL).toString();
  }

  private async request(
    method: HttpMethod,
    url: string,
    config: RequestConfig = {}
  ): Promise<APIResponse> {
    try {
      const { data, tags, revalidate, headers } = config;
      const fullURL = new URL(url, this.baseURL).toString();
      const options: RequestInit = {
        method,
        headers: headers ?? { "Content-Type": "application/json" },
        next: {
          ...(tags && { tags }),
          ...((revalidate || revalidate === 0) && { revalidate }),
        },
      };

      const request = new Request(fullURL, options);
      if (data && request.headers.get("Content-Type") === "application/json") {
        options.body = JSON.stringify(data);
      } else {
        options.body = data;
      }
      const response = await fetch(fullURL, options);
      return this.handleResponse(response);
    } catch (err) {
      console.log(err);
      return {
        status: false,
        message: "Error communicating with backend",
      } as APIResponse;
    }
  }

  private async handleResponse(response: Response): Promise<APIResponse> {
    const data = await response.json();
    if (!response.ok) {
      console.log(data);
      return {
        status: false,
        message: "Error communicating with backend",
      } as APIResponse;
    }
    return { status: true, data } as APIResponse;
  }

  public async get(url: string, config?: RequestConfig): Promise<APIResponse> {
    return await this.request("GET", url, config);
  }

  public async post(
    url: string,
    data?: Record<string, any>,
    config?: RequestConfig
  ): Promise<APIResponse> {
    return await this.request("POST", url, { ...config, data });
  }

  public async put(
    url: string,
    data?: Record<string, any>,
    config?: RequestConfig
  ): Promise<APIResponse> {
    return await this.request("PUT", url, { ...config, data });
  }

  public async patch(
    url: string,
    data?: Record<string, any>,
    config?: RequestConfig
  ): Promise<APIResponse> {
    return await this.request("PATCH", url, { ...config, data });
  }

  public async delete(
    url: string,
    config?: RequestConfig
  ): Promise<APIResponse> {
    return await this.request("DELETE", url, config);
  }
}

export const API = new FetchAPI(
  `http://${process.env.NEXT_PUBLIC_API_URL || "localhost"}:8011`
);
