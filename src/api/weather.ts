export interface StationLocation {
  name: string;
  latitude: number;
  longitude: number;
}

interface GeocodingResult {
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
}

export interface WeatherDay {
  date: string;
  cloudCover: number;
  precipitationChance: number;
  code: number;
}

const WEATHER_BASELINE_CLOUD = 35;

const weatherYield = (cloudCover: number) =>
  Math.max(0.2, 1 - (cloudCover / 100) * 0.75);

export const weatherFactor = (cloudCover: number) =>
  Math.min(1.25, weatherYield(cloudCover) / weatherYield(WEATHER_BASELINE_CLOUD));

export async function searchLocations(query: string): Promise<StationLocation[]> {
  const params = new URLSearchParams({
    name: query,
    count: "6",
    language: "pt",
    format: "json",
  });
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!response.ok) throw new Error("Não foi possível buscar essa localização.");
  const data = (await response.json()) as { results?: GeocodingResult[] };
  return (data.results ?? []).map((result) => ({
    name: [result.name, result.admin1, result.country].filter(Boolean).join(", "),
    latitude: result.latitude,
    longitude: result.longitude,
  }));
}

export async function getWeatherForecast(location: StationLocation): Promise<WeatherDay[]> {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    daily: "weather_code,precipitation_probability_max",
    hourly: "cloud_cover,is_day",
    forecast_days: "7",
    timezone: "auto",
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) throw new Error("Não foi possível carregar a previsão do tempo.");
  const data = (await response.json()) as {
    daily: { time: string[]; weather_code: number[]; precipitation_probability_max: number[] };
    hourly: { time: string[]; cloud_cover: number[]; is_day: number[] };
  };

  return data.daily.time.map((date, index) => {
    const daylightClouds = data.hourly.time.flatMap((time, hourIndex) =>
      time.startsWith(date) && data.hourly.is_day[hourIndex]
        ? [data.hourly.cloud_cover[hourIndex]]
        : [],
    );
    const cloudCover = daylightClouds.length
      ? daylightClouds.reduce((sum, value) => sum + value, 0) / daylightClouds.length
      : WEATHER_BASELINE_CLOUD;
    return {
      date,
      cloudCover,
      precipitationChance: data.daily.precipitation_probability_max[index] ?? 0,
      code: data.daily.weather_code[index] ?? 0,
    };
  });
}

export function weatherDescription(code: number) {
  if (code === 0) return "Céu limpo";
  if (code <= 3) return "Parcialmente nublado";
  if (code <= 48) return "Neblina";
  if (code <= 67) return "Chuva";
  if (code <= 77) return "Neve";
  if (code <= 82) return "Pancadas de chuva";
  if (code <= 86) return "Pancadas de neve";
  return "Trovoadas";
}