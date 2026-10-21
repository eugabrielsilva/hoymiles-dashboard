import { useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  LogOut,
  Monitor,
  Moon,
  PiggyBank,
  Settings2,
  Sun,
  XCircle,
} from "lucide-react";
import {
  clearToken,
  getEnergyOfMonth,
  getMicroinverters,
  getModuleDayData,
  getPlants,
  getPowerOfDay,
  getPriceConfig,
  getRealData,
  getUser,
  type Plant,
  type Microinverter,
  type RealData,
  type UserInfo,
} from "./api/hoymiles";
import type { LineChart, ModuleDayData } from "./api/protobuf";
import {
  analyze,
  daysFromChart,
  expectedPowerKw,
  hourOf,
  plantClock,
  type DayEnergy,
  type Level,
} from "@/lib/insights";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import type { ThemePreference } from "@/lib/theme";

const num = (v: number, d = 1) =>
  v.toLocaleString("pt-BR", { maximumFractionDigits: d });
const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const PURPLE = "#863bff";
const MODULE_COLORS = [
  PURPLE,
  "#38bdf8",
  "#34d399",
  "#fb7185",
  "#a78bfa",
  "#f97316",
  "#2dd4bf",
  "#f472b6",
];

const LEVEL = {
  good: {
    badge: "bg-emerald-500/15 text-emerald-400",
    bar: "[&>div]:bg-emerald-400",
    icon: CheckCircle2,
    box: "border-emerald-500/30",
    text: "text-emerald-400",
  },
  info: {
    badge: "bg-sky-500/15 text-sky-400",
    bar: "[&>div]:bg-sky-400",
    icon: Info,
    box: "border-sky-500/30",
    text: "text-sky-400",
  },
  warn: {
    badge: "bg-amber-500/15 text-amber-400",
    bar: "[&>div]:bg-amber-400",
    icon: AlertTriangle,
    box: "border-amber-500/30",
    text: "text-amber-400",
  },
  bad: {
    badge: "bg-red-500/15 text-red-400",
    bar: "[&>div]:bg-red-400",
    icon: XCircle,
    box: "border-red-500/30",
    text: "text-red-400",
  },
} satisfies Record<Level, object>;

const tooltipStyle = {
  background: "#111",
  border: "1px solid #333",
  borderRadius: 8,
  color: "#fff",
};

type ModuleStatus = {
  level: Level;
  ratio: number | null;
  powerW: number | null;
  peerMedianW: number | null;
  time: string;
  reason: "no-reading" | "low-generation" | null;
};

function assessModules(data: ModuleDayData | null) {
  const modules = data?.modules ?? [];
  const times = [
    ...new Set(
      modules.flatMap((module) =>
        module.samples
          .filter((sample) => sample.powerW !== null)
          .map((sample) => sample.time),
      ),
    ),
  ].sort();
  const comparableTimes = times.filter(
    (time) =>
      modules.filter((module) => {
        const power = module.samples.find(
          (sample) => sample.time === time,
        )?.powerW;
        return power !== null && power !== undefined;
      }).length >= 3,
  );
  const time = comparableTimes.at(-1) ?? "";
  const statuses: Record<string, ModuleStatus> = {};

  for (const module of modules) {
    const powerW = time
      ? (module.samples.find((sample) => sample.time === time)?.powerW ?? null)
      : null;
    const peers = modules
      .filter(
        (other) =>
          other.deviceId !== module.deviceId || other.port !== module.port,
      )
      .map(
        (other) => other.samples.find((sample) => sample.time === time)?.powerW,
      )
      .filter(
        (value): value is number => value !== null && value !== undefined,
      );
    const sorted = peers.sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const peerMedianW =
      sorted.length >= 2
        ? sorted.length % 2
          ? sorted[middle]
          : (sorted[middle - 1] + sorted[middle]) / 2
        : null;
    const reason =
      !time || powerW === null || peerMedianW === null
        ? "no-reading"
        : peerMedianW < 20
          ? "low-generation"
          : null;
    const ratio =
      reason === null && powerW !== null && peerMedianW !== null
        ? powerW / peerMedianW
        : null;
    const level: Level =
      ratio === null
        ? "info"
        : ratio < 0.5
          ? "bad"
          : ratio < 0.7
            ? "warn"
            : "good";
    statuses[`${module.deviceId}-${module.port}`] = {
      level,
      ratio,
      powerW,
      peerMedianW,
      time,
      reason,
    };
  }

  return statuses;
}

export default function Dashboard({
  onLogout,
  themePreference,
  onCycleTheme,
}: {
  onLogout: () => void;
  themePreference: ThemePreference;
  onCycleTheme: () => void;
}) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [sid, setSid] = useState<number | null>(null);
  const [real, setReal] = useState<RealData | null>(null);
  const [power, setPower] = useState<LineChart | null>(null);
  const [moduleDay, setModuleDay] = useState<ModuleDayData | null>(null);
  const [microinverters, setMicroinverters] = useState<Microinverter[]>([]);
  const [moduleError, setModuleError] = useState("");
  const [history, setHistory] = useState<DayEnergy[]>([]);
  const [error, setError] = useState("");
  const [tariff, setTariff] = useState(0.95);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tick, setTick] = useState(0);

  const plant = plants.find((p) => p.id === sid);

  useEffect(() => {
    getUser()
      .then(setUser)
      .catch(() => {});
    getPlants()
      .then((l) => {
        setPlants(l);
        setSid(l[0]?.id ?? null);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!sid || !plant) return;
    const saved = localStorage.getItem(`tariff_${sid}`);
    if (saved) setTariff(Number(saved));
    else
      getPriceConfig(sid)
        .then((p) => p.in > 0 && setTariff(p.in))
        .catch(() => {});
  }, [sid, plant]);

  useEffect(() => {
    if (!sid || !plant) return;
    let alive = true;
    const clock = plantClock(plant.tz_name, "2000-01-01 00:00:00");
    const [y, m] = clock.date.split("-").map(Number);
    const cur = clock.date.slice(0, 7);
    const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
    getRealData(sid)
      .then((r) => alive && setReal(r))
      .catch((e) => alive && setError(e.message));
    getPowerOfDay(sid, clock.date)
      .then((c) => alive && setPower(c))
      .catch(() => {});
    setModuleError("");
    getModuleDayData(sid, clock.date)
      .then((data) => alive && setModuleDay(data))
      .catch((e) => alive && setModuleError(e.message));
    getMicroinverters(sid)
      .then((items) => alive && setMicroinverters(items))
      .catch(() => {});
    Promise.all([
      getEnergyOfMonth(sid, prev + "-01"),
      getEnergyOfMonth(sid, cur + "-01"),
    ])
      .then(
        ([a, b]) =>
          alive &&
          setHistory([...daysFromChart(a, prev), ...daysFromChart(b, cur)]),
      )
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sid, plant, tick]);

  const view = useMemo(() => {
    if (!real || !plant) return null;
    const clock = plantClock(plant.tz_name, real.data_time);
    const a = analyze({
      todayKwh: Number(real.today_eq) / 1000,
      powerW: Number(real.real_power),
      monthKwh: Number(real.month_eq) / 1000,
      capacityKwp: Number(plant.capacitor) || 0,
      history,
      today: clock.date,
      hour: clock.hour,
      ageMin: clock.ageMin,
    });
    return { a, clock };
  }, [real, plant, history]);

  const curve = useMemo(() => {
    const s = power?.series[0];
    if (!power || !s || !view) return [];
    return power.labels.map((l, i) => ({
      hora: l,
      real: (s.values[i] ?? 0) / 1000,
      esperado: Number(
        expectedPowerKw(hourOf(l), view.a.expectedDay).toFixed(2),
      ),
    }));
  }, [power, view]);

  const moduleLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const module of moduleDay?.modules ?? []) {
      const sn = microinverters.find(
        (device) => device.id === module.deviceId,
      )?.sn;
      labels[`${module.deviceId}-${module.port}`] =
        `${sn ? `Micro ${sn.slice(-4)}` : "Microinversor"} · Entrada ${module.port}`;
    }
    return labels;
  }, [moduleDay, microinverters]);

  const moduleStatuses = useMemo(() => assessModules(moduleDay), [moduleDay]);

  const moduleCards = useMemo(
    () =>
      (moduleDay?.modules ?? []).map((module, index) => {
        const latest = [...module.samples]
          .reverse()
          .find((sample) => sample.powerW !== null || sample.energyWh !== null);
        const key = `${module.deviceId}-${module.port}`;
        return {
          key,
          label: moduleLabels[key] ?? `Entrada ${module.port}`,
          status: moduleStatuses[key] ?? {
            level: "info" as Level,
            ratio: null,
            powerW: null,
            peerMedianW: null,
            time: "",
            reason: "no-reading",
          },
          color: MODULE_COLORS[index % MODULE_COLORS.length],
          time: moduleStatuses[key]?.time || latest?.time || "",
          powerKw:
            moduleStatuses[key]?.powerW !== null &&
            moduleStatuses[key]?.powerW !== undefined
              ? moduleStatuses[key].powerW / 1000
              : latest?.powerW === null || latest?.powerW === undefined
                ? null
                : latest.powerW / 1000,
          energyKwh:
            latest?.energyWh === null || latest?.energyWh === undefined
              ? null
              : latest.energyWh / 1000,
        };
      }),
    [moduleDay, moduleLabels, moduleStatuses],
  );

  const moduleCurve = useMemo(() => {
    const rows = new Map<string, Record<string, number | string | null>>();
    for (const module of moduleDay?.modules ?? []) {
      const key = `${module.deviceId}-${module.port}`;
      for (const sample of module.samples) {
        if (!sample.time) continue;
        const row = rows.get(sample.time) ?? { time: sample.time };
        row[key] = sample.powerW === null ? null : sample.powerW / 1000;
        rows.set(sample.time, row);
      }
    }
    return [...rows.values()].sort((a, b) =>
      String(a.time).localeCompare(String(b.time)),
    );
  }, [moduleDay]);

  const moduleWarnings = moduleCards.filter(
    (module) => module.status.level === "warn" || module.status.level === "bad",
  );
  const moduleNeedsMoreData = moduleCards.some(
    (module) => module.status.reason === "no-reading",
  );
  const moduleLowGeneration = moduleCards.some(
    (module) => module.status.reason === "low-generation",
  );

  const days = useMemo(
    () =>
      history.slice(-30).map((d) => ({
        dia: d.date.slice(8) + "/" + d.date.slice(5, 7),
        kwh: Number(d.kwh.toFixed(2)),
      })),
    [history],
  );

  const changeTariff = (v: number) => {
    setTariff(v);
    if (sid) localStorage.setItem(`tariff_${sid}`, String(v));
  };
  const logout = () => {
    clearToken();
    onLogout();
  };

  const today = real ? Number(real.today_eq) / 1000 : 0;
  const level = view ? LEVEL[view.a.level] : LEVEL.info;
  const pct =
    view && view.a.expectedDay > 0
      ? Math.min((today / view.a.expectedDay) * 100, 100)
      : 0;
  const nowMark =
    view && view.a.expectedDay > 0
      ? Math.min((view.a.expectedNow / view.a.expectedDay) * 100, 100)
      : 0;
  const kw = real ? Number(real.real_power) / 1000 : 0;
  const capacityKwp = plant ? Number(plant.capacitor) || 0 : 0;
  const capacityPercent = capacityKwp > 0 ? (kw / capacityKwp) * 100 : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 pb-10">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div
            className={`grid size-10 place-items-center rounded-full bg-[${PURPLE}] text-white`}
          >
            <Sun className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">
              {plant?.name ?? "Minha Usina Solar"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Olá, {user?.name?.split(" ")[0] ?? ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {plants.length > 1 && (
            <select
              className="h-8 rounded-lg border bg-card px-2 text-sm"
              value={sid ?? ""}
              onChange={(e) => setSid(Number(e.target.value))}
            >
              {plants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Tema ${themePreference === "system" ? "automático" : themePreference === "light" ? "claro" : "escuro"}`}
            title={`Tema ${themePreference === "system" ? "automático" : themePreference === "light" ? "claro" : "escuro"} · clique para alternar`}
            onClick={onCycleTheme}
          >
            {themePreference === "system" ? (
              <Monitor />
            ) : themePreference === "light" ? (
              <Sun />
            ) : (
              <Moon />
            )}
          </Button>
          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Configurações"
                title="Configurações"
              >
                <Settings2 />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Configurações da usina</DialogTitle>
                <DialogDescription>
                  Ajuste a tarifa usada para estimar sua economia na conta de
                  luz.
                </DialogDescription>
              </DialogHeader>
              <label
                htmlFor="energy-tariff"
                className="flex flex-col gap-2 text-sm font-medium"
              >
                Valor do kWh (R$/kWh)
                <Input
                  id="energy-tariff"
                  type="number"
                  step="0.01"
                  min="0"
                  value={tariff}
                  onChange={(e) => changeTariff(Number(e.target.value))}
                />
              </label>
              <p className="text-sm text-muted-foreground">
                Confira o valor na sua fatura. A configuração é salva para esta
                usina.
              </p>
            </DialogContent>
          </Dialog>
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut /> Sair
          </Button>
        </div>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {real && view && (
        <>
          <Card className={`border ${level.box}`}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardDescription>Sua usina agora</CardDescription>
                <Badge className={level.badge}>{view.a.headline}</Badge>
              </div>
              <CardTitle className="flex items-baseline gap-2 text-5xl font-bold tracking-tight">
                {num(kw, 2)}{" "}
                <span className="text-xl font-normal text-muted-foreground">
                  kW gerando
                </span>
              </CardTitle>
              <CardDescription>
                {capacityKwp > 0
                  ? `${num(kw, 2)} kW de ${num(capacityKwp, 2)} kWp · ${capacityPercent === null ? "—" : `${num(capacityPercent, 0)}% da capacidade total`}`
                  : "Capacidade total não informada pela API."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-end justify-between text-sm">
                <span>
                  Produzido hoje:{" "}
                  <strong className="text-base">{num(today, 1)} kWh</strong>
                </span>
                <span className="text-muted-foreground">
                  Meta do dia: ~{num(view.a.expectedDay, 1)} kWh
                </span>
              </div>
              <div className="relative">
                <Progress value={pct} className={`h-3 bg-muted ${level.bar}`} />
                <div
                  className="absolute -top-1 h-5 w-0.5 bg-white/70"
                  style={{ left: `${nowMark}%` }}
                  title="Esperado até agora"
                />
              </div>
              <p className="text-sm text-muted-foreground">
                A marca branca mostra quanto já deveria ter sido produzido neste
                horário (~{num(view.a.expectedNow, 1)} kWh).
                {view.a.ratio !== null &&
                  ` Você está em ${Math.round(view.a.ratio * 100)}% do esperado.`}
              </p>
            </CardContent>
          </Card>

          {view.a.insights.length > 0 && (
            <div className="flex flex-col gap-2">
              {view.a.insights.map((n) => {
                const L = LEVEL[n.level];
                return (
                  <Alert key={n.title} className={`border ${L.box}`}>
                    <L.icon className={L.text} />
                    <AlertTitle>{n.title}</AlertTitle>
                    <AlertDescription>{n.text}</AlertDescription>
                  </Alert>
                );
              })}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <CardDescription className="flex items-center gap-1">
                  <PiggyBank className="size-4" /> Economia hoje
                </CardDescription>
                <CardTitle className="text-2xl">
                  {brl(today * tariff)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription className="flex items-center gap-1">
                  <PiggyBank className="size-4" /> Economia no mês
                </CardDescription>
                <CardTitle className="text-2xl">
                  {brl((Number(real.month_eq) / 1000) * tariff)}
                </CardTitle>
                <CardDescription>
                  Previsão até o fim do mês:{" "}
                  {brl(view.a.projectedMonth * tariff)}
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription className="flex items-center gap-1">
                  <PiggyBank className="size-4" /> Economia total
                </CardDescription>
                <CardTitle className="text-2xl">
                  {brl((Number(real.total_eq) / 1000) * tariff)}
                </CardTitle>
                <CardDescription>
                  {num(Number(real.total_eq) / 1000, 0)} kWh gerados desde o
                  início
                </CardDescription>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Hoje: produzido x esperado</CardTitle>
              <CardDescription>
                A linha tracejada é o desempenho normal para um dia como a sua
                média.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={curve}>
                  <CartesianGrid stroke="#222" vertical={false} />
                  <XAxis
                    dataKey="hora"
                    minTickGap={50}
                    stroke="#666"
                    fontSize={12}
                  />
                  <YAxis stroke="#666" fontSize={12} unit=" kW" width={60} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v) => num(Number(v), 2) + " kW"}
                  />
                  <Area
                    type="monotone"
                    dataKey="real"
                    name="Produzido"
                    stroke={PURPLE}
                    fill={PURPLE}
                    fillOpacity={0.7}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="esperado"
                    name="Esperado"
                    stroke="#a3a3a3"
                    strokeDasharray="5 4"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Últimos dias</CardTitle>
              <CardDescription>
                Energia produzida por dia (kWh). A linha mostra sua média
                habitual.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={days}>
                  <CartesianGrid stroke="#222" vertical={false} />
                  <XAxis
                    dataKey="dia"
                    stroke="#666"
                    fontSize={12}
                    minTickGap={20}
                  />
                  <YAxis stroke="#666" fontSize={12} width={40} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: "#ffffff10" }}
                    formatter={(v) => num(Number(v), 1) + " kWh"}
                  />
                  <Bar
                    dataKey="kwh"
                    name="Produzido"
                    fill={PURPLE}
                    radius={[4, 4, 0, 0]}
                  />
                  <ReferenceLine
                    y={view.a.expectedDay}
                    stroke="#a3a3a3"
                    strokeDasharray="5 4"
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Geração por módulo</CardTitle>
              <CardDescription>
                Potência instantânea por entrada (
                {moduleDay?.date ?? view.clock.date}). Diferenças grandes podem
                indicar sujeira, sombra ou falha.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {moduleError ? (
                <p className="text-sm text-muted-foreground">
                  Não foi possível carregar os dados dos módulos: {moduleError}
                </p>
              ) : moduleCards.length ? (
                <>
                  {moduleWarnings.length ? (
                    moduleWarnings.map((module) => {
                      const status = LEVEL[module.status.level];
                      return (
                        <Alert
                          key={module.key}
                          className={`border ${status.box}`}
                        >
                          <status.icon className={status.text} />
                          <AlertTitle>
                            {module.label}: geração abaixo dos demais
                          </AlertTitle>
                          <AlertDescription>
                            Às {module.status.time}, esta entrada gerou{" "}
                            {num(module.status.powerW ?? 0, 0)} W; as demais
                            geraram uma mediana de{" "}
                            {num(module.status.peerMedianW ?? 0, 0)} W. Se a
                            diferença persistir em dias ensolarados, procure o
                            instalador.
                          </AlertDescription>
                        </Alert>
                      );
                    })
                  ) : moduleNeedsMoreData ? (
                    <Alert className={`border ${LEVEL.info.box}`}>
                      <Info className={LEVEL.info.text} />
                      <AlertTitle>
                        Comparação instantânea indisponível
                      </AlertTitle>
                      <AlertDescription>
                        Não há pelo menos três entradas com leitura no mesmo
                        horário para comparar a geração agora.
                      </AlertDescription>
                    </Alert>
                  ) : moduleLowGeneration ? (
                    <Alert className={`border ${LEVEL.info.box}`}>
                      <Info className={LEVEL.info.text} />
                      <AlertTitle>
                        Geração baixa para uma comparação confiável
                      </AlertTitle>
                      <AlertDescription>
                        As entradas têm leitura, mas a potência geral está
                        abaixo de 20 W por módulo. A comparação fica mais útil
                        quando a geração aumentar.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Alert className={`border ${LEVEL.good.box}`}>
                      <CheckCircle2 className={LEVEL.good.text} />
                      <AlertTitle>
                        Geração dentro da faixa dos demais módulos
                      </AlertTitle>
                      <AlertDescription>
                        As entradas estão produzindo de forma semelhante nas
                        leituras recentes.
                      </AlertDescription>
                    </Alert>
                  )}
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={moduleCurve}>
                      <CartesianGrid stroke="#222" vertical={false} />
                      <XAxis
                        dataKey="time"
                        minTickGap={50}
                        stroke="#666"
                        fontSize={12}
                      />
                      <YAxis
                        stroke="#666"
                        fontSize={12}
                        unit=" kW"
                        width={60}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(v) => num(Number(v), 2) + " kW"}
                      />
                      {moduleCards.map((module) => (
                        <Line
                          key={module.key}
                          type="monotone"
                          dataKey={module.key}
                          name={module.label}
                          stroke={module.color}
                          dot={false}
                          connectNulls={false}
                        />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {moduleCards.map((module) => (
                      <div
                        key={module.key}
                        className="rounded-lg border bg-background/40 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: module.color }}
                            />
                            <span className="truncate">{module.label}</span>
                          </div>
                          <Badge className={LEVEL[module.status.level].badge}>
                            {module.status.level === "good"
                              ? "Normal"
                              : module.status.level === "warn" ||
                                  module.status.level === "bad"
                                ? "Verificar"
                                : module.status.reason === "low-generation"
                                  ? "Potência baixa"
                                  : "Sem comparação"}
                          </Badge>
                        </div>
                        <p className="mt-2 text-xl font-semibold">
                          {module.powerKw === null
                            ? "—"
                            : `${num(module.powerKw, 2)} kW`}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            {module.time}
                          </span>
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Hoje:{" "}
                          {module.energyKwh === null
                            ? "—"
                            : `${num(module.energyKwh, 2)} kWh`}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Ainda não há dados de geração por módulo para esta usina.
                </p>
              )}
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground">
            Última atualização da usina: {real.data_time}. O valor esperado é
            uma estimativa baseada no seu histórico.
          </p>
        </>
      )}
    </div>
  );
}
