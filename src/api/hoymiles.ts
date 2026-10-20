import { argon2id } from 'hash-wasm'
import { decodeLineChart, decodeModuleDay, type LineChart, type ModuleDayData } from './protobuf'

// Reproduz o cliente web oficial (global.hoymiles.com/website): POST JSON, header `authorization` com o token cru.
const BASE = '/api'
const TOKEN_KEY = 'hoymiles_token'

export class ApiError extends Error {
  status?: string
  constructor(message: string, status?: string) {
    super(message)
    this.status = status
  }
}

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

interface Envelope<T> {
  status: string
  message: string
  data: T
}

async function send(path: string, body: unknown, auth = true): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' }
  const token = getToken()
  if (auth && token) headers.authorization = token
  const res = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`)
  return res
}

function check<T>(env: Envelope<T>): T {
  // status "0" = sucesso; "100" = token inválido/expirado
  if (env.status === '100') {
    clearToken()
    window.dispatchEvent(new Event('hoymiles:logout'))
  }
  if (env.status !== '0') throw new ApiError(env.message || 'Erro na API', env.status)
  return env.data
}

async function request<T>(path: string, body: unknown = {}, auth = true): Promise<T> {
  const res = await send(path, body, auth)
  return check<T>((await res.json()) as Envelope<T>)
}

// Endpoints de gráfico respondem em protobuf; em caso de erro, vêm em JSON.
async function requestChart(path: string, body: Record<string, unknown>): Promise<LineChart> {
  const res = await send(path, { ...body, pb_ver: 0 })
  const buf = await res.arrayBuffer()
  const head = new Uint8Array(buf)[0]
  if (head === 0x7b) check(JSON.parse(new TextDecoder().decode(buf)) as Envelope<unknown>)
  return decodeLineChart(buf)
}

const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16))

export async function login(username: string, password: string): Promise<string> {
  const pre = await request<{ n: string; a: string; v: number }>('/iam/pub/3/auth/pre-insp', { u: username }, false)
  if (pre.v !== 3) throw new ApiError('Versão de hash de senha não suportada: ' + pre.v)
  const ch = await argon2id({
    password,
    salt: hexToBytes(pre.a),
    parallelism: 1,
    iterations: 3,
    memorySize: 32768,
    hashLength: 32,
    outputType: 'hex',
  })
  const { token } = await request<{ token: string }>('/iam/pub/3/auth/login', { u: username, ch, n: pre.n }, false)
  localStorage.setItem(TOKEN_KEY, token)
  return token
}

export interface UserInfo {
  id: number
  name: string
  email: string
}
export const getUser = () => request<UserInfo>('/iam/api/1/user/me', { authorization: getToken() })

export interface Plant {
  id: number
  name: string
  capacitor: string
  status: number
  tz_name: string
  create_at: string
}
export const getPlants = async () =>
  (await request<{ list: Plant[] }>('/pvm/api/0/station/select_by_page', { page: 1, page_size: 100 })).list

export interface RealData {
  today_eq: string
  month_eq: string
  year_eq: string
  total_eq: string
  real_power: string
  co2_emission_reduction: string
  plant_tree: string
  data_time: string
  is_load: number
  is_balance: number
}
export const getRealData = (sid: number) => request<RealData>('/pvm-data/api/0/station/data/count_station_real_data', { sid })

export const getPriceConfig = (sid: number) => request<{ type: number; in: number }>('/pvm/api/0/station/price/find', { sid })

export interface Microinverter {
  id: number
  sn: string
  model_no: string
  port_array: number[]
}

export const getMicroinverters = async (sid: number) =>
  (await request<{ list: Microinverter[] }>('/pvm/api/0/dev/micro/select_by_station', { sid, page: 1, page_size: 100 })).list

export async function getModuleDayData(sid: number, date: string): Promise<ModuleDayData> {
  const res = await send('/pvm-data/api/0/module/data/down_module_day_data', { sid, date, pb_ver: 1 })
  const buf = await res.arrayBuffer()
  if (new Uint8Array(buf)[0] === 0x7b) check(JSON.parse(new TextDecoder().decode(buf)) as Envelope<unknown>)
  return decodeModuleDay(buf)
}

const D = '/pvm-data/api/0/station/data'
export const getPowerOfDay = (sid: number, date: string) => requestChart(`${D}/count_power_by_day`, { sid, date })
export const getEnergyOfMonth = (sid: number, date: string) => requestChart(`${D}/count_eq_by_day_of_month`, { sid, date })
export const getEnergyOfYear = (sid: number, date: string) => requestChart(`${D}/count_eq_by_month_of_year`, { sid, date })
export const getEnergyTotal = (sid: number, date: string) => requestChart(`${D}/count_eq_by_total_of_year`, { sid, date })
