// Decoder mínimo para a mensagem protobuf "LineChart" usada pelos endpoints de gráfico.
// Estrutura inferida: 1=rótulos (string repetido), 2=séries {1=nome, 2=floats empacotados}, 3=data.
export interface ChartSeries {
  name: string
  values: number[]
}
export interface LineChart {
  labels: string[]
  series: ChartSeries[]
  date: string
}

export interface ModuleSample {
  time: string
  powerW: number | null
  energyWh: number | null
}

export interface ModuleDaySeries {
  deviceId: number
  port: number
  samples: ModuleSample[]
}

export interface ModuleDayData {
  date: string
  modules: ModuleDaySeries[]
}

interface Field {
  no: number
  wire: number
  num?: number
  bytes?: Uint8Array
}

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0
  let shift = 0
  for (;;) {
    const b = buf[pos++]
    result += (b & 0x7f) * 2 ** shift
    if (!(b & 0x80)) break
    shift += 7
  }
  return [result, pos]
}

function readFields(buf: Uint8Array): Field[] {
  const fields: Field[] = []
  let pos = 0
  while (pos < buf.length) {
    let tag: number
    ;[tag, pos] = readVarint(buf, pos)
    const no = tag >>> 3
    const wire = tag & 7
    if (wire === 0) {
      let v: number
      ;[v, pos] = readVarint(buf, pos)
      fields.push({ no, wire, num: v })
    } else if (wire === 2) {
      let len: number
      ;[len, pos] = readVarint(buf, pos)
      fields.push({ no, wire, bytes: buf.subarray(pos, pos + len) })
      pos += len
    } else if (wire === 5) {
      fields.push({ no, wire, bytes: buf.subarray(pos, pos + 4) })
      pos += 4
    } else if (wire === 1) {
      fields.push({ no, wire, bytes: buf.subarray(pos, pos + 8) })
      pos += 8
    } else {
      throw new Error(`wire type não suportado: ${wire}`)
    }
  }
  return fields
}

const dec = new TextDecoder()

function floats(bytes: Uint8Array): number[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: number[] = []
  for (let i = 0; i + 4 <= bytes.byteLength; i += 4) out.push(dv.getFloat32(i, true))
  return out
}

export function decodeLineChart(data: ArrayBuffer): LineChart {
  const chart: LineChart = { labels: [], series: [], date: '' }
  for (const f of readFields(new Uint8Array(data))) {
    if (!f.bytes) continue
    if (f.no === 1) chart.labels.push(dec.decode(f.bytes))
    else if (f.no === 2) {
      const s: ChartSeries = { name: '', values: [] }
      for (const g of readFields(f.bytes)) {
        if (!g.bytes) continue
        if (g.no === 1) s.name = dec.decode(g.bytes)
        else if (g.no === 2) s.values.push(...floats(g.bytes))
      }
      chart.series.push(s)
    } else if (f.no === 3) chart.date = dec.decode(f.bytes)
  }
  return chart
}

export function decodeModuleDay(data: ArrayBuffer): ModuleDayData {
  const result: ModuleDayData = { date: '', modules: [] }
  for (const field of readFields(new Uint8Array(data))) {
    if (field.no === 2 && field.bytes) {
      result.date = dec.decode(field.bytes)
      continue
    }
    if (field.no !== 3 || !field.bytes) continue

    const entry = readFields(field.bytes)
    const deviceId = entry.find((part) => part.no === 1)?.num ?? 0
    const deviceData = entry.find((part) => part.no === 2)?.bytes
    if (!deviceData) continue
    const deviceFields = readFields(deviceData)
    const times = deviceFields.filter((part) => part.no === 2 && part.bytes).map((part) => dec.decode(part.bytes!))

    for (const portField of deviceFields.filter((part) => part.no === 4 && part.bytes)) {
      const portEntry = readFields(portField.bytes!)
      const port = portEntry.find((part) => part.no === 1)?.num ?? 0
      const samplesField = portEntry.find((part) => part.no === 2)?.bytes
      if (!samplesField) continue
      const sampleFields = readFields(samplesField).filter((part) => part.no === 1 && part.bytes)
      result.modules.push({
        deviceId,
        port,
        samples: sampleFields.map((sample, index) => {
          const values = readFields(sample.bytes!)
          const power = values.find((part) => part.no === 3)?.bytes
          const energy = values.find((part) => part.no === 4)?.bytes
          return {
            time: times[index] ?? '',
            powerW: power ? new DataView(power.buffer, power.byteOffset, power.byteLength).getFloat32(0, true) : null,
            energyWh: energy ? new DataView(energy.buffer, energy.byteOffset, energy.byteLength).getFloat32(0, true) : null,
          }
        }),
      })
    }
  }
  return result
}
