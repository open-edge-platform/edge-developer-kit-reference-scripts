// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable @typescript-eslint/no-explicit-any */

import path from 'path'

interface RequestConfig {
  headers?: Record<string, any>
  data?: any
  tags?: string[]
  revalidate?: number
  raw_response?: boolean
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export class FetchAPI {
  private baseURL: string

  constructor(baseURL?: string, apiVersion?: string) {
    if (!baseURL) {
      this.baseURL = `/${apiVersion ?? ''}`
    } else if (!baseURL.startsWith('/')) {
      if (!baseURL.match(/^https?:\/\//)) {
        baseURL = 'http://' + baseURL
      }
      this.baseURL = new URL(`${apiVersion ?? ''}/path`, baseURL).toString()
    } else {
      this.baseURL = `${baseURL}/${apiVersion ?? ''}`
    }
  }

  private async request(
    method: HttpMethod,
    url: string,
    config: RequestConfig = {},
  ): Promise<any | Response> {
    try {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { data, tags, revalidate, headers, raw_response } = config
      let fullURL: URL
      if (!this.baseURL.startsWith('/')) {
        fullURL = new URL(url, this.baseURL)
      } else {
        fullURL = new URL(path.join(this.baseURL, url), window.location.origin)
      }
      const options: RequestInit = {
        method,
        headers: headers ?? { 'Content-Type': 'application/json' },
        next: {
          ...(tags && { tags }),
          ...((revalidate || revalidate === 0) && { revalidate }),
        },
      }

      const request = new Request(fullURL, options)
      if (data && request.headers.get('Content-Type') === 'application/json') {
        options.body = JSON.stringify(data)
      } else {
        options.body = data
      }
      const response = await fetch(fullURL, options)
      return raw_response ? response : this.handleResponse(response)
    } catch (err) {
      console.log(err)
      throw new Error('Error communicating with backend')
    }
  }

  private async handleResponse(response: Response): Promise<any> {
    const data = await response.json()
    if (!response.ok) {
      throw new Error('Error communicating with backend')
    }
    // If the response has a status property and it's false, throw an error
    if ('status' in data && data.status === false) {
      throw new Error(data.message || 'Request failed')
    }
    return data
  }

  public async get(url: string, config?: RequestConfig): Promise<any> {
    return (await this.request('GET', url, config)) as any
  }

  public async post(
    url: string,
    data?: Record<string, any>,
    config?: RequestConfig,
  ): Promise<any> {
    return (await this.request('POST', url, { ...config, data })) as Record<
      string,
      unknown
    >
  }

  public async put(
    url: string,
    data?: Record<string, any>,
    config?: RequestConfig,
  ): Promise<any> {
    return (await this.request('PUT', url, { ...config, data })) as Record<
      string,
      unknown
    >
  }

  public async patch(
    url: string,
    data?: Record<string, any>,
    config?: RequestConfig,
  ): Promise<any> {
    return (await this.request('PATCH', url, {
      ...config,
      data,
    })) as any
  }

  public async delete(url: string, config?: RequestConfig): Promise<any> {
    return (await this.request('DELETE', url, config)) as Record<
      string,
      unknown
    >
  }

  public async file(
    url: string,
    data?: Record<string, any>,
    config?: RequestConfig,
  ): Promise<Response> {
    return (await this.request('POST', url, {
      ...config,
      raw_response: true,
      data,
    })) as Response
  }
}

export const API = new FetchAPI(
  `http://${process.env.NEXT_PUBLIC_API_URL ?? 'localhost'}:5999`,
)
