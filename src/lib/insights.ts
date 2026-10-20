import type { LineChart } from '@/api/protobuf'

export interface DayEnergy {
  date: string // YYYY-MM-DD
  kwh: number
}

export type Level = 'good' | 'info' | 'warn' | 'bad'
export interface Insight {
  level: Level
  title: string
  text: string
}

// Janela solar aproximada usada para estimar a curva do dia (Brasil, horário local da usina).
const SUNRISE = 5.5
const SUNSET = 18.5
const SPAN = SUNSET - SUNRISE

export const median = (v: number[]) => {
  if (!v.length) return 0
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Fração da energia diária acumulada até a hora h (0–24), assumindo potência em forma de sino. */
export const cumulativeShare = (h: number) => {
  const t = Math.min(Math.max((h - SUNRISE) / SPAN, 0), 1)
  return (1 - Math.cos(Math.PI * t)) / 2
}

/** Potência esperada (kW) na hora h para uma produção diária esperada em kWh. */
export const expectedPowerKw = (h: number, dayKwh: number) => {
  if (h <= SUNRISE || h >= SUNSET) return 0
  return ((dayKwh * Math.PI) / (2 * SPAN)) * Math.sin((Math.PI * (h - SUNRISE)) / SPAN)
}

export const hourOf = (label: string) => {
  const [h, m] = label.split(':').map(Number)
  return h + (m || 0) / 60
}

/** Interpreta "UTC-03" como deslocamento em horas. */
const tzOffset = (tz: string) => {
  const m = /UTC([+-]\d{1,2})(?::?(\d{2}))?/.exec(tz)
  return m ? Number(m[1]) + Math.sign(Number(m[1])) * (Number(m[2] ?? 0) / 60) : 0
}

/** Retorna data/hora atual da usina e idade (min) da última leitura. */
export function plantClock(tz: string, dataTime: string) {
  const off = tzOffset(tz)
  const plantNow = new Date(Date.now() + off * 3600_000)
  const hour = plantNow.getUTCHours() + plantNow.getUTCMinutes() / 60
  const date = plantNow.toISOString().slice(0, 10)
  const [d, t] = dataTime.split(' ')
  const [y, mo, da] = d.split('-').map(Number)
  const [hh, mi, ss] = t.split(':').map(Number)
  const dataTs = Date.UTC(y, mo - 1, da, hh, mi, ss) - off * 3600_000
  return { hour, date, ageMin: (Date.now() - dataTs) / 60_000 }
}

export function daysFromChart(chart: LineChart | null, ym: string): DayEnergy[] {
  const s = chart?.series[0]
  if (!chart || !s) return []
  return chart.labels.map((l, i) => ({ date: `${ym}-${l.padStart(2, '0')}`, kwh: (s.values[i] ?? 0) / 1000 }))
}

export interface Analysis {
  expectedDay: number
  expectedNow: number
  ratio: number | null
  level: Level
  headline: string
  projectedMonth: number
  insights: Insight[]
  usedHistory: boolean
}

interface Input {
  todayKwh: number
  powerW: number
  monthKwh: number
  capacityKwp: number
  history: DayEnergy[]
  today: string
  hour: number
  ageMin: number
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

export function analyze(i: Input): Analysis {
  const past = i.history.filter((d) => d.date < i.today && d.kwh > 0)
  const usedHistory = past.length >= 3
  const expectedDay = usedHistory ? median(past.slice(-30).map((d) => d.kwh)) : i.capacityKwp * 4.5
  const expectedNow = expectedDay * cumulativeShare(i.hour)
  const daytime = i.hour >= SUNRISE + 1 && i.hour <= SUNSET - 1
  const ratio = expectedNow >= 1 ? i.todayKwh / expectedNow : null

  const insights: Insight[] = []
  const stale = i.ageMin > 90 && i.hour > 6 && i.hour < 19

  if (stale) {
    insights.push({
      level: 'bad',
      title: 'Sem comunicação com a usina',
      text: `A última informação recebida foi há ${Math.round(i.ageMin / 60)} h. Verifique se o Wi-Fi da casa está funcionando e se o equipamento de monitoramento (DTU) está ligado.`,
    })
  } else if (daytime && i.powerW < 50 && i.hour >= 9 && i.hour <= 16) {
    insights.push({
      level: 'bad',
      title: 'Usina sem produzir',
      text: 'Está de dia, mas não há geração neste momento. Pode ser um dia muito nublado ou um problema no equipamento (inversor desligado ou disjuntor desarmado). Se persistir, chame o instalador.',
    })
  }

  let level: Level = 'info'
  let headline = 'Aguardando o sol'
  if (ratio !== null && !stale) {
    if (ratio >= 1.1) {
      level = 'good'
      headline = 'Acima do esperado'
    } else if (ratio >= 0.85) {
      level = 'good'
      headline = 'Dentro do esperado'
    } else if (ratio >= 0.6) {
      level = 'warn'
      headline = 'Um pouco abaixo do esperado'
    } else {
      level = 'bad'
      headline = 'Bem abaixo do esperado'
    }
    if (level === 'warn' || level === 'bad') {
      insights.push({
        level,
        title: 'Produção abaixo do esperado hoje',
        text: `Até agora foram gerados ${fmt(i.todayKwh)} kWh, e o normal para este horário é cerca de ${fmt(expectedNow)} kWh. Nuvens e chuva são a causa mais comum; se os próximos dias também ficarem abaixo, vale limpar os painéis ou chamar o instalador.`,
      })
    }
  } else if (stale) {
    level = 'bad'
    headline = 'Sem dados recentes'
  } else if (i.hour < SUNRISE + 1.5) {
    headline = 'O dia está começando'
  }

  const lastDays = past.slice(-3)
  if (lastDays.length === 3 && usedHistory && lastDays.every((d) => d.kwh < expectedDay * 0.6)) {
    insights.push({
      level: 'warn',
      title: 'Últimos 3 dias abaixo da média',
      text: 'A geração ficou bem abaixo do habitual por alguns dias seguidos. Se não foi chuva, considere limpar os painéis.',
    })
  }

  const best = [...past].sort((a, b) => b.kwh - a.kwh)[0]
  if (best && i.todayKwh > best.kwh && i.hour > 12) {
    insights.push({ level: 'good', title: 'Novo recorde de geração', text: `Hoje já superou seu melhor dia (${fmt(best.kwh)} kWh).` })
  }

  if (!usedHistory) {
    insights.push({
      level: 'info',
      title: 'Estimativa inicial',
      text: 'Ainda há poucos dias de histórico. O esperado foi calculado pelo tamanho da usina e ficará mais preciso nos próximos dias.',
    })
  }

  const [y, m] = i.today.split('-').map(Number)
  const dim = new Date(y, m, 0).getDate()
  const dayNum = Number(i.today.slice(8))
  const projectedMonth = i.monthKwh + expectedDay * Math.max(dim - dayNum, 0)

  return { expectedDay, expectedNow, ratio, level, headline, projectedMonth, insights, usedHistory }
}
