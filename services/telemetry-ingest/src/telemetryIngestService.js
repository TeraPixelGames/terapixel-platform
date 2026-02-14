import { InMemoryTelemetrySink } from "./telemetrySink.js";

export function createTelemetryIngestService(options = {}) {
  const sink = options.sink || new InMemoryTelemetrySink();
  const maxEventsPerRequest = parsePositiveInt(options.maxEventsPerRequest, 100);

  return {
    sink,
    ingestEvents: async (input) => {
      if (!input || typeof input !== "object") {
        throw new Error("input is required");
      }
      const gameId = requiredString(input.gameId, "gameId");
      const profileId = optionalString(input.profileId);
      const sessionId = optionalString(input.sessionId);
      const now = normalizeNow(input.nowSeconds);
      const events = normalizeEvents(input.events, {
        now,
        maxEventsPerRequest
      });

      const batch = {
        game_id: gameId,
        profile_id: profileId,
        session_id: sessionId,
        received_at: now,
        request_id: optionalString(input.requestId),
        client_ip: optionalString(input.clientIp),
        events
      };
      await sink.appendBatch(batch);
      return {
        game_id: gameId,
        profile_id: profileId,
        accepted_events: events.length
      };
    }
  };
}

function normalizeEvents(events, config) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("events must be a non-empty array");
  }
  if (events.length > config.maxEventsPerRequest) {
    throw new Error(
      `events length exceeds maxEventsPerRequest (${config.maxEventsPerRequest})`
    );
  }
  return events.map((event, index) => normalizeEvent(event, index, config.now));
}

function normalizeEvent(event, index, now) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error(`events[${index}] must be an object`);
  }
  const eventName = optionalString(event.event_name);
  if (!eventName) {
    throw new Error(`events[${index}].event_name is required`);
  }
  const eventTime = parsePositiveInt(event.event_time, now);
  const normalized = {
    event_name: eventName,
    event_time: eventTime
  };
  if (event.seq !== undefined) {
    const seq = Number(event.seq);
    if (!Number.isFinite(seq) || seq < 0) {
      throw new Error(`events[${index}].seq must be >= 0`);
    }
    normalized.seq = Math.floor(seq);
  }
  const properties = normalizeProperties(event.properties, index);
  if (properties) {
    normalized.properties = properties;
  }
  return normalized;
}

function normalizeProperties(properties, index) {
  if (properties === undefined) {
    return null;
  }
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    throw new Error(`events[${index}].properties must be an object`);
  }
  return JSON.parse(JSON.stringify(properties));
}

function requiredString(value, fieldName) {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}

function optionalString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  const normalized = String(value).trim();
  return normalized || "";
}

function normalizeNow(nowSeconds) {
  if (Number.isFinite(Number(nowSeconds)) && Number(nowSeconds) > 0) {
    return Math.floor(Number(nowSeconds));
  }
  return Math.floor(Date.now() / 1000);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}
