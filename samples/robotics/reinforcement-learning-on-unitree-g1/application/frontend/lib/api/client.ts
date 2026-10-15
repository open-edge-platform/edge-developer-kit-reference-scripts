import createFetchClient from "openapi-fetch"
import createClient from "openapi-react-query"

import type { paths } from "../api-schema"

export const API_BASE_URL = "/api"
const apiOrigin = typeof window === "undefined" ? "http://localhost" : window.location.origin

export const fetchClient = createFetchClient<paths>({ baseUrl: `${apiOrigin}${API_BASE_URL}` })
export const $api = createClient(fetchClient)