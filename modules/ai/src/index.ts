export { AdapterError, type AdapterErrorCode } from "./errors.js";
export { resolveAdapterMode, type AdapterMode } from "./mode.js";
export {
  createGrokClient,
  DEFAULT_GROK_MODEL,
  DEFAULT_GROK_TIMEOUT_MS,
  XAI_CHAT_COMPLETIONS_URL,
  XAI_LANGUAGE_MODELS_URL,
  type GrokChatCompletion,
  type GrokChatRequest,
  type GrokChatResult,
} from "./grok.js";
export {
  createFalClient,
  DEFAULT_FAL_TIMEOUT_MS,
  FAL_HUNYUAN_WORLD_ENDPOINT,
  FAL_QUEUE_BASE_URL,
  type FalPanoramaRequest,
  type FalPanoramaResult,
} from "./fal.js";
export { defaultFixtureDir, readFixtureEnvelope } from "./fixtures.js";
export { fetchTransport, type HttpTransport } from "./transport.js";
export {
  GROK_RECTS_CONFIDENCE,
  GROK_RECTS_FALLBACK_WHEN,
  GROK_RECTS_FIXTURE_ID,
  GROK_RECTS_MODULE,
  GROK_RECTS_PROMPT_VERSION,
  grokRectsPrompt,
  grokRectsResultSchema,
  parseGrokRectsResult,
  rectsToGraph,
  runGrokRects,
  GROK_RECTS_TIMEOUT_MS,
  GROK_RECTS_CHAT_EXTRA,
  type GrokRectsInput,
  type GrokRectsOutput,
} from "./grok-rects.js";
export {
  GEOMETRY_REPAIR_FIXTURE_ID,
  GEOMETRY_REPAIR_MAX_ATTEMPTS,
  GEOMETRY_REPAIR_MODULE,
  runGeometryRepair,
  type GeometryRepairInput,
  type GeometryRepairOutput,
} from "./geometry-repair.js";
export {
  PHOTO_MATCHER_54541_FIXTURE_ID,
  PHOTO_MATCHER_FIXTURE_ID,
  PHOTO_MATCHER_LIVE_TIMEOUT_MS,
  PHOTO_MATCHER_LOW_CONFIDENCE,
  PHOTO_MATCHER_MODULE,
  PHOTO_MATCHER_PROMPT_VERSION,
  parseGrokPhotoMatcherResult,
  photoMatcherPrompt,
  photoMatcherResultSchema,
  runPhotoMatcher,
  type PhotoMatcherInput,
  type PhotoMatcherOutput,
} from "./photo-matcher.js";
