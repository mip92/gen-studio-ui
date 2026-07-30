// Single source of truth for talking to the gen-studio NestJS backend.
// All endpoints documented in the corresponding controllers.

// API base differs by execution context:
//  - browser → '/api' (relative). next.config rewrites proxy it to the backend,
//    so it works from any device on the LAN with no hardcoded host and no CORS.
//  - server  → absolute backend URL. Node fetch (RSC, middleware) needs it.
export const API_BASE =
  typeof window === 'undefined'
    ? process.env.INTERNAL_API_BASE ?? 'http://localhost:4000'
    : process.env.NEXT_PUBLIC_API_BASE ?? '/api';

// Media (img/video/audio/href) is ALWAYS loaded by the browser, never fetched
// server-side — so it must use the relative public path even during SSR, where
// API_BASE points at localhost (unreachable from other devices on the LAN).
// Using this for every <... src> URL is what makes images work from a phone.
export const MEDIA_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api';

// Long-running endpoints (the comic export renders for 10+ minutes) must BYPASS
// the Next.js `/api` rewrite proxy: that proxy waits for the upstream response
// with a fixed internal timeout (~5 min, not configurable via rewrites) and drops
// the request with a socket hang-up. The browser instead talks straight to the
// backend on :4000 (CORS is enabled) — no proxy in the middle, and fetch has no
// client-side timeout, so the request lives as long as the backend needs.
export const DIRECT_API_BASE =
  typeof window === 'undefined'
    ? process.env.INTERNAL_API_BASE ?? 'http://localhost:4000'
    : `${window.location.protocol}//${window.location.hostname}:4000`;

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return undefined as T;
  // Some endpoints (notably /generation/jobs/:id when ComfyUI hasn't recorded
  // the prompt yet) return 200 with an empty body. Treat that as null.
  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

export interface DashboardResponse {
  project: { id: string; slug: string; name: string };
  profiles: ProfileSummary[];
}

export interface ProfileSummary {
  profileId:     string;
  characterId:   string;
  characterCode: string;
  displayName:   string | null;
  profileCode:   string;
  ageLabel:      string | null;
  targetImages:  number | null;
  triggerToken:  string | null;
  datasetCount:  number;
  loraReady:     boolean;
  loraPath:      string | null;
  loraSizeMB:    number | null;
  phase:         'idle' | 'queued' | 'generating' | 'has_dataset' | 'training' | 'ready';
  lastDatasetJob: {
    id: string; status: string;
    dependsOnProfileId: string | null;
    referenceProfileId: string | null;
    error: string | null;
    queuedAt: string;
  } | null;
  lastTrainingJob: {
    id: string; status: string; error: string | null;
    startedAt: string | null; completedAt: string | null;
  } | null;
}

export interface DatasetImage { filename: string; size: number; mtime: number; }

export interface LoraVariant {
  filename:  string;
  fullPath:  string;
  /** epoch index parsed from `<name>-NNNNNN.safetensors`; null = final. */
  epoch:     number | null;
  sizeBytes: number;
  mtime:     string;
  /** Human-readable label: "final" or "epoch 3". */
  label:     string;
}

export interface ProfileFull {
  id:             string;
  profileCode:    string;
  ageLabel:       string | null;
  targetImages:   number | null;
  promptBase:     string;
  negative:       string | null;
  promptAngles:   string | null;
  promptVariety:  string | null;
  datasetPath:    string | null;
  loraPath:       string | null;
  /** All LoRA checkpoints (final + intermediate) saved by the last training run. */
  loraVariants:   LoraVariant[] | null;
  triggerToken:   string | null;
  characterId:    string;
  character?: {
    id:          string;
    code:        string;
    displayName: string | null;
    project?:    { id: string; slug: string; name: string } | null;
    projectLinks?: Array<{
      projectId: string;
      attachedAt: string;
      project: { id: string; slug: string; name: string };
    }>;
  };
}

export interface UpdateProfileBody {
  ageLabel?:      string;
  targetImages?:  number;
  promptBase?:    string;
  negative?:      string;
  promptAngles?:  string;
  promptVariety?: string;
  triggerToken?:  string;
}

export interface ShotParticipant {
  id:          string;
  label:       string;
  characterId: string | null;
  profileId:   string | null;
  character?:  {
    id: string;
    code: string;
    displayName: string | null;
    profiles?: Array<{ id: string; profileCode: string; loraPath: string | null; ageLabel: string | null; promptBase: string | null; triggerToken: string | null }>;
  } | null;
  profile?:    { id: string; profileCode: string; loraPath: string | null; ageLabel: string | null; promptBase: string | null; triggerToken: string | null } | null;
}

/** promptFields is freeform JSON, but these are the conventional keys. */
export interface ShotPromptFields {
  narrativeBeat?:          string;
  storyFunction?:          string;
  frameDescription?:       string;
  location?:               { label?: string; interiorExterior?: string };
  lightingMood?:           string;
  positive?:               string;
  negative?:               string;
  positiveCharacterLocks?: string;
  positiveEnvironment?:    string;
  camera?:                 { framing?: string; movement?: string };
  production?:             { notes?: string; promptStatus?: string; assetRefs?: string[] };
  workflowParams?:         { seedPolicy?: string; faceswapRef?: string };
  captionGenerator?:       string;
  /** Per-shot override for the Wan2.2 (i2v) negative. When empty, the renderer
   *  falls back to `Project.defaultVideoNegative`, then the workflow JSON's
   *  hardcoded negative. Wired into node 10 of the i2v workflow. */
  motionNegative?:         string;
  /** Per-shot baked motion-direction override. Wins over the project-level
   *  defaultMotionPrompt / defaultStaticMotionPrompt fallback. Use it for
   *  shots where the project fallback is wrong — e.g. static camera but
   *  subject (train, water) should move. Per-render VideoRender.motionPrompt
   *  set at queue time still beats this. */
  motionPrompt?:           string;
  [key: string]: unknown;
}

export interface RenderedImage {
  filename:    string;
  promptId?:   string;
  seed?:       number;
  strategyId?: string;
  createdAt?:  string;
}

export interface Location {
  id:          string;
  projectId:   string;
  slug:        string;
  name:        string;
  description: string;
  createdAt?:  string;
  updatedAt?:  string;
}

/** Object anchor — a key story prop (separate from characters). */
export interface Prop {
  id:          string;
  projectId:   string;
  code:        string;
  name:        string;
  description: string;
  anchorPath?: string | null;
  createdAt?:  string;
  updatedAt?:  string;
}

export interface ShotFull {
  id:                  string;
  projectId:           string;
  sceneId:             string;
  shotCode:            string;
  promptFields:        ShotPromptFields | null;
  workflowRouteKey:    string | null;
  referenceProfileId:  string | null;
  referenceImagePool:  unknown;
  renderedImages:      RenderedImage[] | null;
  chosenRender:        string | null;
  chosenVideoId:       string | null;
  /** FK to a Location row. SceneRenderService prepends location.description into positive. */
  locationId:          string | null;
  /** 'animated' (default) → renders a Wan clip; 'static' → still only, video disabled. */
  renderMode:          string | null;
  participants:        ShotParticipant[];
  /** Image-validation verdicts (newest first). validationJobs[0] is the latest
   *  vision-model pass that scored the candidates and auto-picked chosenRender. */
  validationJobs?:     ImageValidationJob[];
  scene?: {
    id:              string;
    sceneKey:        string;
    title:           string | null;
    sortOrder:       number;
    /** Scene-level voiceover text (the slice of script.md this scene covers). */
    narrationText:   string | null;
    /** Inclusive line range in the project's script.md. */
    scriptStartLine: number | null;
    scriptEndLine:   number | null;
  };
  project?: { id: string; slug: string; name: string; visualStyle?: string };
}

/** One candidate's verdict from the Ollama vision model. */
export interface CandidateVerdict {
  filename:      string;
  score:         number;    // 0-100 (prompt match + technical quality); -1 = scoring error
  matchesPrompt: boolean;
  severe?:       boolean;   // unusable: anatomy horror / wrong-or-missing subject / intruder
  issues:        string[];  // concrete defects the model saw
  error?:        string;
  /** Verdict carried over from an earlier validation run (file was not re-scored). */
  cached?:       boolean;
}

/** Structured suggestion — each part targets its own promptFields key. */
export interface SuggestedFields {
  positive: string | null;  // full rewritten positive prompt
  negative: string | null;  // defect tokens to APPEND to the negative
}

export interface ImageValidationJob {
  id:              string;
  status:          string;   // pending | running | completed | failed
  result:          CandidateVerdict[] | null;
  chosenFilename:  string | null;
  /** LEGACY flat positive-only suggestion — new jobs fill suggestedFields. */
  suggestedPrompt: string | null;
  /** When no candidate passed: structured {positive, negative} suggestion. */
  suggestedFields: SuggestedFields | null;
  /** Comparative judge's one-line reason for picking chosenFilename. */
  judgeReason:     string | null;
  errorMessage:    string | null;
  completedAt:     string | null;
}

/** One anchor-portrait candidate's verdict (character-portrait analogue of CandidateVerdict). */
export interface AnchorVerdict {
  filename:      string;
  score:         number;    // 0-100; -1 = scoring error
  matchesPrompt: boolean;
  severe?:       boolean;   // unusable: anime / multiple faces / wrong person / deformed
  issues:        string[];
  error?:        string;
}

export interface AnchorValidationJob {
  id:              string;
  status:          string;   // pending | running | completed | failed
  result:          AnchorVerdict[] | null;
  chosenFilename:  string | null;
  /** When no candidate passed: the vision model's proposed improved promptBase. */
  suggestedPrompt: string | null;
  errorMessage:    string | null;
  completedAt:     string | null;
}

/** One anchor candidate on disk, merged with its verdict and selection state. */
export interface AnchorCandidate {
  filename:   string;
  size:       number;
  mtime:      number;
  verdict:    AnchorVerdict | null;
  /** the validator's own automatic pick */
  chosenByAI: boolean;
  /** this candidate's bytes are the currently installed anchor.png */
  selected:   boolean;
}

export interface AnchorCandidatesResponse {
  profileId:        string;
  profileCode:      string;
  anchorExists:     boolean;
  /** installed anchor matches none of the candidates (manual upload / older render) */
  anchorIsExternal: boolean;
  validationActive: boolean;
  validation: {
    jobId:           string;
    completedAt:     string | null;
    chosenFilename:  string | null;
    suggestedPrompt: string | null;
  } | null;
  candidates: AnchorCandidate[];
}

export interface UpdateShotBody {
  shotCode?:           string;
  sceneId?:            string;
  promptFields?:       ShotPromptFields;
  workflowRouteKey?:   string;
  referenceProfileId?: string;
  participants?:       Array<{ label: string; characterId?: string | null; profileId?: string | null }>;
  /** 'animated' → Wan i2v clip; 'static' → still only, video disabled. Per-shot
   *  override of the act-level render mode. */
  renderMode?:         string;
}

export interface CreateShotBody {
  shotCode:           string;
  sceneId:            string;
  promptFields?:      ShotPromptFields;
  workflowRouteKey?:  string;
  referenceProfileId?: string;
}

export interface ProjectListItem {
  id:        string;
  slug:      string;
  name:      string;
  settings?: unknown;
  /**
   * Visual style id (FK to visual_styles). Drives workflow routing + LoRA
   * pipeline + style-block injection. Defaults to 'photoreal_cinematic' for
   * legacy projects. See docs/VISUAL_STYLE_ARCHITECTURE.md.
   */
  visualStyle?: string;
  /**
   * Published YouTube URL of the finished video. Set ⇒ the project is DONE and
   * treated as archived (hidden from the sidebar, shown under /projects/archived).
   * GET /projects already returns this column; see isProjectArchived().
   */
  youtubeUrl?: string | null;
}

/**
 * A project is "done" / archived once it has a published YouTube link. This is
 * the single, shared definition of archived-ness — mirrors the backend rule in
 * ActionsService (youtubeUrl truthy ⇒ skip pipeline gates). Pure and isomorphic
 * so both the server data layer and the client sidebar can use it.
 */
export const isProjectArchived = (p: Pick<ProjectListItem, 'youtubeUrl'>): boolean =>
  Boolean(p.youtubeUrl && p.youtubeUrl.trim());

/** A row from the visual_styles registry. */
export interface VisualStyle {
  id:            string;
  displayName:   string;
  identityStack: string;
  loraPipeline:  string;
}

/** Output of GET /profiles/:id/style-readiness — per-style identity asset state. */
export interface ProfileStyleReadiness {
  profileId:        string;
  profileCode:      string;
  characterCode:    string;
  attachedProjects: Array<{ slug: string; visualStyle: string }>;
  styles: Record<string, {
    ready:         boolean;
    identityStack: string;
    loraPipeline:  string;
    assets:        { loraPath: string | null; anchorPath: string | null };
  }>;
}

/**
 * A row from anchor_render_jobs (queue-managed render job).
 *
 * Lifecycle: pending → running → completed (with outputPath) | failed (with errorMessage).
 * PipelineQueueService picks pending rows, auto-starts ComfyUI if needed,
 * submits the workflow, polls for completion, copies the PNG into
 * data/<slug>/reference/<profileCode>_anchor.png.
 */
export interface AnchorRenderJob {
  id:             string;
  profileId:      string;
  status:         'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  comfyPromptId?: string | null;
  outputPath?:    string | null;
  errorMessage?:  string | null;
  queuedAt:       string;
  startedAt?:     string | null;
  completedAt?:   string | null;
}

/** Full project row including the required prompt-content fields. */
export interface ProjectFull extends ProjectListItem {
  scriptText:                string | null;
  defaultNegative:           string;
  defaultVideoNegative:      string;
  defaultMotionPrompt:       string;
  defaultStaticMotionPrompt: string;
  targetPlatform?:           string | null;
  safetyTier?:               string | null;
  /** 'silero' | 'indextts2'; null = treated as 'silero'. */
  ttsEngine?:                string | null;
  /** Project-relative path to the voice reference wav (mirror of the assigned
   *  voiceover's shared path; voice-clone engines only). */
  ttsVoiceRefPath?:          string | null;
  /** FK to the assigned shared Voiceover (закадровая озвучка), or null. */
  ttsVoiceoverId?:           string | null;
  /** Visual style id — see ProjectListItem.visualStyle. */
  visualStyle?:              string;
  /** Published YouTube URL of the finished video. When set the project is DONE
   *  and /actions hides all pipeline gates for it. Null = still in production. */
  youtubeUrl?:               string | null;
  createdAt?:                string;
  updatedAt?:                string;
}

export type TTSEngine = 'silero' | 'xtts2' | 'f5' | 'qwen3';
export const TTS_ENGINES: readonly TTSEngine[] = ['silero', 'xtts2', 'f5', 'qwen3'];

export interface ProjectTTSEmotionRef {
  id:        string;
  name:      string;
  filePath:  string;
  createdAt: string;
}

/** A shared, reusable voice-clone reference (закадровая озвучка). Stored once
 *  in the library and assigned to any number of projects. */
/** A project this voice is assigned to (compact form for the voices table/detail). */
export interface VoiceoverProjectRef {
  id:   string;
  slug: string;
  name: string;
}

export interface Voiceover {
  id:            string;
  slug:          string;
  name:          string;
  filePath:      string;
  ext:           string;
  bytes:         number;
  checksum:      string;
  /** Optional provenance link (e.g. the YouTube clip the ref was taken from). */
  sourceUrl:     string | null;
  /** True when the full untrimmed source was retained → this voice can be re-trimmed. */
  hasSource:     boolean;
  /** Trim window (ms into the source) that produced the current clip; null if unknown. */
  trimStartMs:   number | null;
  trimEndMs:     number | null;
  /** How many projects currently reference this voice. */
  assignedCount: number;
  /** The projects that reference this voice. */
  projects:      VoiceoverProjectRef[];
  createdAt:     string;
}

/** A source clip fetched/uploaded into staging, awaiting trim + save. */
export interface VoiceSource {
  token:       string;
  streamUrl:   string;
  durationSec: number | null;
  title:       string;
}

export interface UpdateProjectBody {
  name?:                       string;
  slug?:                       string;
  /** Visual style / render pipeline id (e.g. 'graphic_novel_flux'). Changeable
   *  post-creation; affects future renders only. Backend PATCH accepts it. */
  visualStyle?:                string;
  defaultNegative?:            string;
  defaultVideoNegative?:       string;
  defaultMotionPrompt?:        string;
  defaultStaticMotionPrompt?:  string;
  scriptText?:                 string;
  /**
   * Free-form project settings (JSONB). Replaces the whole object on PATCH —
   * callers must send the full merged settings, not a partial. Holds e.g.
   * { styleLora: { name } } for the per-project comic style-LoRA override.
   */
  settings?:                   Record<string, unknown>;
  /** Published YouTube URL of the finished video. Non-empty marks the project
   *  DONE (hides /actions gates); empty string clears it (back to production). */
  youtubeUrl?:                 string;
}

/** One graphic-novel style LoRA on disk (GET /projects/style-loras). */
export interface StyleLoraItem {
  /** Exact ComfyUI lora_name, e.g. "style\\EldritchComicsXL1.2.safetensors". */
  name:  string;
  /** Human-readable stem without extension. */
  label: string;
}

export interface SceneShotParticipant {
  id:                   string;
  label:                string;
  characterId:          string | null;
  characterCode:        string | null;
  characterDisplayName: string | null;
  profileId:            string | null;
  profileCode:          string | null;
  profileAgeLabel:      string | null;
  loraReady:            boolean;
  chosenExplicitly:     boolean;
}

export interface SceneShot {
  id:                   string;
  shotCode:             string;
  beat:                 string | null;
  location:             string | null;
  cameraFraming:        string | null;
  participants:         SceneShotParticipant[];
  rendersCount:         number;
  chosenRender:         string | null;
  activeRenderPromptId: string | null;
  /** Most recent pending|running pipeline render job for this shot, or null. */
  pipelineRender:       { id: string; status: string; queuedAt: string } | null;

  // ── Video state (mirrors chosenRender for the animation pass) ──────────────
  /** How many VideoRender rows exist for the shot (any status). */
  videosCount:    number;
  /** VideoRender.id approved as the canonical motion clip, or null. */
  chosenVideoId:  string | null;
  /** Summary of the chosen video (status info needed to render the right button). */
  chosenVideo:    {
    id:               string;
    outputFilename:   string | null;
    upscaleStatus:    'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | null;
    upscaledFilename: string | null;
    interpStatus?:    'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | null;
    interpFilename?:  string | null;
  } | null;
  /** Oldest pending|running video render — used to badge "⚙ video" in the row. */
  pipelineVideo:   { id: string; status: string; queuedAt: string } | null;
  /** Pending|running upscale on the chosen video, if any. */
  pipelineUpscale: { id: string; status: string } | null;
  /** Pending|running FPS interpolation on the chosen video, if any. */
  pipelineInterp?: { id: string; status: string } | null;

  // ── Per-shot narration (new in 2026-05) ───────────────────────────────────
  /** ~5s Russian voiceover text for this shot. Per-shot TTS replaces the
   *  legacy whole-scene narration on projects that opted in. */
  narrationText?:    string | null;
  /** TTSJob.id approved as the canonical voiceover for this shot, or null. */
  approvedTTSJobId?: string | null;
  /** Status of the most recent NON-terminal TTSJob for this shot
   *  (pending/running), or null when nothing is in flight. */
  ttsLatestStatus?:  'pending' | 'running' | null;
  /** How many completed TTSJobs exist for this shot but aren't approved yet
   *  — these are takes waiting for the user to pick one. */
  ttsCompletedUnapproved?: number;
  /** id of the most recent completed-but-not-approved TTSJob — the row the
   *  quick "✓ утвердить" button on the scenes list approves directly. */
  ttsLatestCompletedUnapprovedId?: string | null;
  /** Exact wav duration of the approved narration take in milliseconds —
   *  probed from the RIFF header. Null when nothing approved or the wav has
   *  no measurable header; UI falls back to a text-length heuristic. */
  approvedTTSDurationMs?: number | null;
}

export interface SceneSummary {
  id:              string;
  sceneKey:        string;
  title:           string | null;
  sortOrder:       number;
  /** Scene-level voiceover script — used by the TTS narration modal. */
  narrationText:    string | null;
  /** id of the TTSJob the user approved as the canonical narration, or null. */
  approvedTTSJobId: string | null;
  /** Which lines in <slug>_script.md this scene covers (inclusive). */
  scriptStartLine:  number | null;
  scriptEndLine:    number | null;
  shots:           SceneShot[];
}

/** `video_post` is the combined one-pass upscale->RIFE job. It replaced the old
 *  `video_upscale` + `video_interp` pair, which were two queue jobs for what is
 *  a single ComfyUI workflow. */
export type QueueJobType = 'training' | 'dataset' | 'scene' | 'video' | 'video_post' | 'tts' | 'bgm' | 'anchor' | 'validation' | 'anchor_validation' | 'caption' | 'thumbnail' | 'thumbnail_ideas';

/** Caption drawn by scripts/render_caption.py — every field is a real parameter
 *  of the overlay, not a wish addressed to a diffusion model. */
export interface CaptionSpec {
  lines:         string[];      // 1-2 lines, ALL CAPS
  accent_word?:  string;        // the ONE word that burns
  accent_color?: string;        // #RRGGBB
  position?:     'top' | 'center' | 'bottom';
  align?:        'left' | 'center' | 'right';
  width_pct?:    number;
  font?:         string;
  fill?:         string;
  outline?:      string;
  line_scale?:   number;
  shadow?:       boolean;
}

export interface ThumbnailIdeaInput {
  idea?:             string;
  prompt:            string;
  negative?:         string;
  /** Whose anchors go in as image1..image3 — the model picks, max 3. */
  refProfileCodes?:  string[];
  /** Why those faces and that age, in the model's words. */
  refReason?:        string;
  batchSize?:        number;
  /** Keep the anchor's pixel channel (likeness) — default true. */
  referenceLatents?: boolean;
  /** Caption the model proposed alongside the art. */
  captionSpec?:      CaptionSpec;
}

/** One round of "let the model invent covers from the screenplay". */
export interface ThumbnailIdeaJob {
  id:           string;
  projectId:    string;
  count:        number;
  status:       'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result:       ThumbnailIdeaInput[] | null;
  errorMessage: string | null;
  queuedAt:     string;
  completedAt:  string | null;
}

/** One IDEA rendered as a batch of candidates. A project accumulates many. */
export interface ThumbnailJob {
  id:              string;
  projectId:       string;
  status:          'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  idea:            string | null;
  prompt:          string;
  negative:        string | null;
  batchSize:       number;
  candidates:      string[] | null;
  chosenFilename:  string | null;
  refProfileCodes: string[];
  referenceLatents: boolean | null;
  captionSpec:     CaptionSpec | null;
  artPath:         string | null;
  outputPath:      string | null;
  errorMessage:    string | null;
  queuedAt:        string;
  completedAt:     string | null;
}

/** Wire format from /pipeline/queue rows - one row per attempt at one unit of
 *  work, straight out of the queue ledger. Backend pairs slug + UUID so
 *  Link-builders can always go straight to the canonical /projects/<uuid>/
 *  form without a slug->uuid middleware bounce. */
export interface QueueRow {
  /** Queue entry id - what the reorder and cancel endpoints take. */
  entryId:       string;
  type:          QueueJobType;
  /** Id of the row in the type-specific table (VideoRender.id, TTSJob.id, ...). */
  jobId:         string;
  attemptNumber: number;
  status:        string;
  /** What is being worked on ("SH014B FHD+FPS", "act_03"). */
  label:         string;
  /** Where it sits - scene key, character code, or music block. */
  context:       string | null;
  projectSlug:   string | null;
  /** Canonical project UUID; prefer over slug for hrefs. */
  projectId:     string | null;
  /** Shot UUID for shot-anchored jobs (scene/video/video_post/shot-TTS); null otherwise. */
  shotId:        string | null;
  profileCode:   string | null;
  /** Batching group (workflow/model identity) - jobs sharing it run back-to-back. */
  groupKey:      string;
  rank:          number;
  /** 1-based place in the pending queue; null for anything not pending. */
  position:      number | null;
  /** Owning project priority tier (0 = normal). */
  projectTier:   number;
  queuedAt:      string;
  startedAt:     string | null;
  completedAt:   string | null;
  /** Real elapsed ms; live value while running. */
  durationMs:    number | null;
  errorMessage:  string | null;
  /** 'useful' | 'wasted' | null (not decided yet). */
  outcome:       string | null;
  outcomeReason: string | null;
  workflowFilename: string | null;
  outputFilename:   string | null;
  /** Server-computed: head of the pending queue. Used to disable the up arrow. */
  isFirstPending: boolean;
  /** Server-computed: tail of the pending queue. Used to disable the down arrow. */
  isLastPending:  boolean;
}

/** 'queue' = true dispatch order (project priority tier, then rank). */
export type QueueSortField = 'queue' | 'queuedAt' | 'startedAt' | 'completedAt' | 'status' | 'type' | 'project' | 'duration';

export interface QueueListParams {
  id?:       string;
  status?:   string[];
  type?:     QueueJobType[];
  /** Comma-separated list of project slugs to filter by. */
  project?:  string[];
  finished?: boolean;
  sort?:     QueueSortField;
  order?:    'asc' | 'desc';
  page?:     number;
  limit?:    number;
}

export interface QueueListResponse {
  rows:  QueueRow[];
  total: number;
  page:  number;
  limit: number;
  sort:  QueueSortField;
  order: 'asc' | 'desc';
}

export interface ScenesResponse {
  project: { id: string; slug: string; name: string; visualStyle?: string };
  scenes:  SceneSummary[];
}

/** One row of the global character library (listLibraryCharacters / …Page). */
export interface LibraryCharacter {
  id: string;
  code: string;
  displayName: string | null;
  projectId: string | null;
  profiles: Array<{
    id: string;
    profileCode: string;
    ageLabel: string | null;
    targetImages: number | null;
    triggerToken: string | null;
    loraPath: string | null;
  }>;
  projectLinks: Array<{
    projectId: string;
    attachedAt: string;
    /** visualStyle exposed so character cards can render the right
     *  identity-pipeline badge (LoRA for photoreal, anchor for cartoon). */
    project: { id: string; slug: string; name: string; visualStyle?: string };
  }>;
}

export const api = {
  listProjects: () =>
    http<ProjectListItem[]>(`/projects`),

  // ── Visual styles registry + per-profile readiness ─────────────────────────

  /** List all registered visual styles (for project-creation dropdown). */
  listVisualStyles: () =>
    http<VisualStyle[]>(`/projects/visual-styles`),

  /** Per-style readiness for one character profile. */
  profileStyleReadiness: (profileId: string) =>
    http<ProfileStyleReadiness>(`/profiles/${profileId}/style-readiness`),

  /**
   * Enqueue anchor portrait render via the gen-studio queue. Returns the new
   * (or existing pending/running) anchor_render_jobs row immediately. Caller
   * polls listAnchorJobs() to learn completion. PipelineQueueService auto-starts
   * ComfyUI if it's not running.
   */
  generateAnchor: (profileId: string) =>
    http<AnchorRenderJob>(`/profiles/${profileId}/generate-anchor`, { method: 'POST' }),

  /** Recent anchor-render jobs for a profile (newest first, 50 max). */
  listAnchorJobs: (profileId: string) =>
    http<AnchorRenderJob[]>(`/profiles/${profileId}/anchor-jobs`),

  /** Probe whether an anchor PNG exists for this profile. */
  getAnchor: (profileId: string) =>
    http<{ profileId: string; anchorPath: string | null; exists: boolean }>(
      `/profiles/${profileId}/anchor`,
    ),

  /**
   * Raw PNG URL for <img src=...>. Pass a cache-bust integer (e.g. Date.now())
   * to force the browser to refetch after a fresh render.
   */
  anchorRawUrl: (profileId: string, cacheBust?: number) =>
    `${MEDIA_BASE}/profiles/${profileId}/anchor/raw${cacheBust ? `?t=${cacheBust}` : ''}`,

  /** Delete the anchor portrait PNG (returns deleted paths). */
  deleteAnchor: (profileId: string) =>
    http<{ profileId: string; deleted: string[]; count: number }>(
      `/profiles/${profileId}/anchor`,
      { method: 'DELETE' },
    ),

  /** Upload an external file (PNG/JPG) as the anchor for this profile. */
  uploadAnchor: async (profileId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_BASE}/profiles/${profileId}/upload-anchor`, {
      method: 'POST',
      body:   fd,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as { profileId: string; anchorPath: string; sizeBytes: number };
  },

  // ── Anchor neural validation (Ollama vision QC of anchor candidates) ─────────

  /** Recent anchor-validation jobs (newest first). Poll for status + verdicts. */
  listAnchorValidationJobs: (profileId: string) =>
    http<AnchorValidationJob[]>(`/profiles/${profileId}/anchor-validation-jobs`),

  /** Re-run vision validation over the candidate portraits on disk. */
  validateAnchor: (profileId: string) =>
    http<{ queued: boolean; jobId: string | null; reason?: string }>(
      `/profiles/${profileId}/validate-anchor`, { method: 'POST' }),

  /** Apply an improved promptBase (from validation) to the profile; optionally re-render. */
  applySuggestedAnchorPrompt: (profileId: string, prompt: string, rerender = false) =>
    http<{ profile: unknown; rerenderJob: AnchorRenderJob | null }>(
      `/profiles/${profileId}/apply-suggested-anchor-prompt`,
      { method: 'POST', body: JSON.stringify({ prompt, rerender }) }),

  // ── Anchor candidates (best-of-N gallery + manual selection) ─────────────────

  /** All candidate portraits from the last render, with verdicts + selection. */
  listAnchorCandidates: (profileId: string) =>
    http<AnchorCandidatesResponse>(`/profiles/${profileId}/anchor-candidates`),

  /** Raw image URL of one candidate (immutable per render batch). */
  anchorCandidateRawUrl: (profileId: string, filename: string) =>
    `${MEDIA_BASE}/profiles/${profileId}/anchor-candidates/${encodeURIComponent(filename)}/raw`,

  /** Manually install a candidate as the profile's anchor (user's final say). */
  selectAnchorCandidate: (profileId: string, filename: string) =>
    http<{ anchorPath: string }>(
      `/profiles/${profileId}/anchor/select`,
      { method: 'POST', body: JSON.stringify({ filename }) }),

  dashboard: (slug: string) =>
    http<DashboardResponse>(`/projects/${slug}/dashboard`),

  listScenes: (slug: string) =>
    http<ScenesResponse>(`/projects/${slug}/scenes`),

  listImages: (profileId: string) =>
    http<{ profileCode: string; count: number; images: DatasetImage[] }>(
      `/datasets/profiles/${profileId}/images`,
    ),

  deleteImage: (profileId: string, filename: string) =>
    http<{ deleted: string }>(
      `/datasets/profiles/${profileId}/images/${encodeURIComponent(filename)}`,
      { method: 'DELETE' },
    ),

  imageUrl: (profileId: string, filename: string) =>
    `${MEDIA_BASE}/datasets/profiles/${profileId}/images/${encodeURIComponent(filename)}/raw`,

  // Reference image (used as ComfyUI LoadImage source for dataset gen)
  referenceInfo: (profileId: string) =>
    http<
      | { exists: false; profileCode: string }
      | { exists: true;  profileCode: string; filename: string; size: number; mtime: number }
    >(`/datasets/profiles/${profileId}/reference`),

  referenceUrl: (profileId: string, cacheBust?: number) =>
    `${MEDIA_BASE}/datasets/profiles/${profileId}/reference/raw${cacheBust ? `?t=${cacheBust}` : ''}`,

  uploadReference: async (profileId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_BASE}/datasets/profiles/${profileId}/reference`, {
      method: 'POST',
      body:   fd,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json() as Promise<{ uploaded: true; path: string; size: number; mime: string }>;
  },

  deleteReference: (profileId: string) =>
    http<{ deleted: string }>(`/datasets/profiles/${profileId}/reference`, { method: 'DELETE' }),

  enqueueDataset: (
    profileId: string,
    body: {
      dependsOnProfileId?:     string;
      referenceProfileId?:     string;
      referenceImageFilename?: string;
    } = {},
  ) =>
    http<{ id: string; status: string }>(
      `/dataset-queue/profiles/${profileId}/enqueue`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  cancelDatasetJob: (jobId: string) =>
    http(`/dataset-queue/jobs/${jobId}`, { method: 'DELETE' }),

  // ── Persona library (Phase 1 of character library refactor) ──────────
  // Characters live independently of projects. The library list returns
  // every character with its profiles + which projects each is attached to.

  listLibraryCharacters: () =>
    http<LibraryCharacter[]>(`/library/characters`),

  /** Paginated library page for the infinite-scroll grid. */
  listLibraryCharactersPage: (skip = 0, take = 24) =>
    http<{ rows: LibraryCharacter[]; total: number }>(
      `/library/characters/page?skip=${skip}&take=${take}`,
    ),

  attachCharacter: (projectIdOrSlug: string, characterId: string) =>
    http<{ projectId: string; characterId: string; code: string }>(
      `/projects/${projectIdOrSlug}/characters/${characterId}/attach`,
      { method: 'POST' },
    ),

  detachCharacter: (projectIdOrSlug: string, characterId: string) =>
    http<{ projectId: string; characterId: string }>(
      `/projects/${projectIdOrSlug}/characters/${characterId}/attach`,
      { method: 'DELETE' },
    ),

  // Profile read/edit
  getProfile: (profileId: string) =>
    http<ProfileFull>(`/profiles/${profileId}`),

  /** Per-profile readiness summary. Project-independent — drives the persona
   * detail page badges (phase, datasetCount, loraReady, last jobs) without
   * relying on any project context. */
  getProfileSummary: (profileId: string) =>
    http<ProfileSummary>(`/profiles/${profileId}/summary`),

  updateProfile: (profileId: string, body: UpdateProfileBody) =>
    http<ProfileFull>(`/profiles/${profileId}`, {
      method: 'PATCH',
      body:   JSON.stringify(body),
    }),

  // ── LoRA library (manage all checkpoints saved by training) ─────────────
  // Backend endpoints (added in profiles.controller.ts) — require Nest restart
  // to take effect. Until then these calls return 404 and the UI surfaces it.

  /** Rescan disk for new/missing files and return the up-to-date variants list. */
  listLoraVariants: (profileId: string) =>
    http<{ active: string | null; variants: LoraVariant[] }>(
      `/profiles/${profileId}/loras`,
    ),

  /** Mark one variant as active (sets profile.loraPath). */
  setActiveLora: (profileId: string, filename: string) =>
    http<ProfileFull>(`/profiles/${profileId}/loras/active`, {
      method: 'POST',
      body:   JSON.stringify({ filename }),
    }),

  /** Delete a variant from disk and from the variants list. */
  deleteLoraVariant: (profileId: string, filename: string) =>
    http<{ deleted: string; variants: LoraVariant[] }>(
      `/profiles/${profileId}/loras/${encodeURIComponent(filename)}`,
      { method: 'DELETE' },
    ),

  // Create character (with optional first profile)
  createCharacter: (
    projectIdOrSlug: string,
    body: {
      code: string;
      displayName?: string;
      profile?: {
        profileCode:    string;
        promptBase:     string;
        negative?:      string;
        ageLabel?:      string;
        targetImages?:  number;
        promptAngles?:  string;
        promptVariety?: string;
        triggerToken?:  string;
      };
    },
  ) =>
    http<{ id: string; code: string; displayName: string | null; profiles: ProfileFull[] }>(
      `/projects/${projectIdOrSlug}/characters`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // Project characters list (used by shot editor for participant dropdown)
  listCharacters: (projectIdOrSlug: string) =>
    http<Array<{
      id:          string;
      code:        string;
      displayName: string | null;
      profiles:    Array<{ id: string; profileCode: string; loraPath: string | null; ageLabel: string | null; promptBase: string | null; triggerToken: string | null }>;
    }>>(`/projects/${projectIdOrSlug}/characters`),

  characterUsage: (projectIdOrSlug: string, characterId: string) =>
    http<{
      character:        { id: string; code: string; displayName: string | null };
      profileCount:     number;
      participantCount: number;
      shotCount:        number;
      sceneCount:       number;
      shots:            Array<{ id: string; shotCode: string; sceneId: string }>;
    }>(`/projects/${projectIdOrSlug}/characters/${characterId}/usage`),

  deleteCharacter: (projectIdOrSlug: string, characterId: string) =>
    http<{ deleted: { characterId: string; code: string; profileCodes: string[] }; filesRemoved: number; paths: string[] }>(
      `/projects/${projectIdOrSlug}/characters/${characterId}`,
      { method: 'DELETE' },
    ),

  // Shot rendering — queues a ComfyUI job, returns prompt_id
  renderShot: (shotId: string, body: { dryRun?: boolean; scenePrompt?: string; seed?: number; loraStrength?: number; batchSize?: number } = {}) =>
    http<{
      shotId:        string;
      shotCode:      string;
      strategyId:    string;
      participants:  Array<{ profileCode: string; displayName: string; loraPath: string }>;
      job?:          { promptId: string; number: number };
      workflow?:     unknown;
    }>(`/generation/shots/${shotId}/render${body.dryRun ? '?dryRun=true' : ''}`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  // Enqueue scene render via the pipeline (preferred — coordinates with training/dataset queues)
  enqueueShotRender: (
    shotId: string,
    body: {
      scenePrompt?:  string;
      seed?:         number;
      loraStrength?: number;
      batchSize?:    number;
      steps?:        number;
      /** Flux only — FluxGuidance value (cfg stays 1.0 on Flux). */
      guidance?:     number;
      /** Per-generation pipeline/visual-style override. Locked once the shot
       *  has any render (backend rejects a mismatching style). */
      visualStyle?:  string;
      /** Queue a vision-QC pass after the batch lands (checkbox; default off). */
      validate?:     boolean;
    } = {},
  ) =>
    http<{ id: string; shotId: string; status: string; queuedAt: string }>(
      `/generation/shots/${shotId}/enqueue`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // Bulk-enqueue every not-yet-rendered, not-queued shot in a project (one click).
  // Additive only — never wipes; skips rendered/approved/awaiting-approval/already-queued.
  enqueueProjectPending: (projectId: string, validate = false) =>
    http<{ enqueued: number }>(
      `/generation/shots/project/${projectId}/enqueue-pending`,
      { method: 'POST', body: JSON.stringify({ validate }) },
    ),

  // ComfyUI live queue — list of running + pending prompt_ids
  comfyQueue: () =>
    http<{ running: string[]; pending: string[] }>(`/generation/comfy-queue`),

  // ComfyUI history — proxied through gen-studio (CORS-safe)
  comfyHistory: (promptId: string) =>
    http<{
      status?:  { status_str: string; completed: boolean };
      outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
    } | null>(`/generation/jobs/${promptId}`),

  // ComfyUI /view proxied through gen-studio (CORS-safe + works in img tags).
  // Prefer shotImageUrl() for shot renders — it reads from the project tree and
  // does not depend on ComfyUI being alive.
  comfyViewUrl: (filename: string, subfolder = '', type = 'output') =>
    `${MEDIA_BASE}/generation/comfy-image?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`,

  /**
   * Stream a rendered shot image directly from disk
   * (data/<slug>/shots/<shotCode>/<filename>, falls back to COMFY_OUTPUT).
   * Doesn't depend on ComfyUI running — survives engine restarts.
   */
  shotImageUrl: (shotId: string, filename: string) =>
    `${MEDIA_BASE}/shots/${shotId}/renders/${encodeURIComponent(filename)}/raw`,

  // Shots
  getShot: (shotId: string) =>
    http<ShotFull>(`/shots/${shotId}`),

  updateShot: (shotId: string, body: UpdateShotBody) =>
    http<ShotFull>(`/shots/${shotId}`, {
      method: 'PATCH',
      body:   JSON.stringify(body),
    }),

  deleteShot: (shotId: string) =>
    http(`/shots/${shotId}`, { method: 'DELETE' }),

  addShotRender: (shotId: string, body: { filename: string; promptId?: string; seed?: number; strategyId?: string }) =>
    http<ShotFull>(`/shots/${shotId}/renders`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  removeShotRender: (shotId: string, filename: string) =>
    http<ShotFull>(`/shots/${shotId}/renders/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    }),

  // Locations — project-scoped reusable setting descriptions. Renderer prepends
  // location.description to shot.positive so editing the description once
  // updates every shot tagged with this location.
  listLocations: (projectId: string) =>
    http<Location[]>(`/projects/${projectId}/locations`),

  getLocation: (locationId: string) =>
    http<Location>(`/locations/${locationId}`),

  createLocation: (projectId: string, body: { slug: string; name: string; description: string }) =>
    http<Location>(`/projects/${projectId}/locations`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  updateLocation: (locationId: string, body: { slug?: string; name?: string; description?: string }) =>
    http<Location>(`/locations/${locationId}`, {
      method: 'PATCH',
      body:   JSON.stringify(body),
    }),

  deleteLocation: (locationId: string) =>
    http<{ id: string; deleted: boolean }>(`/locations/${locationId}`, {
      method: 'DELETE',
    }),

  assignShotLocation: (shotId: string, locationId: string | null) =>
    http<{ id: string; shotCode: string; locationId: string | null }>(
      `/shots/${shotId}/location`,
      { method: 'PATCH', body: JSON.stringify({ locationId }) },
    ),

  // Props — project-scoped OBJECT anchors, separate from characters. A prop is the
  // reusable description of a key story object (token, scarf, thermos, tiles…). On a
  // prop-hero shot the renderer makes the object dominate the frame so it actually
  // gets drawn instead of "just a room".
  // ── Thumbnail workshop ─────────────────────────────────────────────────────
  // A POOL of cover concepts, not one cover: each job is one idea rendered as a
  // batch of candidates, `enqueueThumbnailIdeas` can be called repeatedly to top
  // the pool up, and exactly one candidate is finally chosen and captioned.
  listThumbnailJobs: (projectId: string) =>
    http<ThumbnailJob[]>(`/projects/${projectId}/thumbnail`),

  /** Ask the local model for concepts. Queued (Ollama needs the whole card), so
   *  this returns a job — the proposals arrive in `listThumbnailProposals`. */
  proposeThumbnailIdeas: (projectId: string, count = 6) =>
    http<ThumbnailIdeaJob>(`/projects/${projectId}/thumbnail/propose`, {
      method: 'POST',
      body:   JSON.stringify({ count }),
    }),

  listThumbnailProposals: (projectId: string) =>
    http<ThumbnailIdeaJob[]>(`/projects/${projectId}/thumbnail/proposals`),

  /** Drop one proposed concept. Rounds accumulate; nothing else removes them. */
  deleteProposedIdea: (projectId: string, jobId: string, index: number) =>
    http<ThumbnailIdeaJob>(`/projects/${projectId}/thumbnail/proposals/${jobId}/ideas/${index}`, {
      method: 'DELETE',
    }),

  enqueueThumbnailIdeas: (projectId: string, ideas: ThumbnailIdeaInput[]) =>
    http<ThumbnailJob[]>(`/projects/${projectId}/thumbnail/ideas`, {
      method: 'POST',
      body:   JSON.stringify({ ideas }),
    }),

  /** Promote one candidate to the cover and draw the caption on it. No GPU —
   *  safe to call again and again while wording the hook. */
  chooseThumbnail: (
    projectId: string,
    body: { jobId: string; filename: string; captionSpec?: CaptionSpec },
  ) =>
    http<ThumbnailJob>(`/projects/${projectId}/thumbnail/choose`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  /** Render more frames for an idea, appended to the ones it already has. */
  addMoreThumbnails: (projectId: string, jobId: string, count = 5) =>
    http<ThumbnailJob>(`/projects/${projectId}/thumbnail/jobs/${jobId}/more`, {
      method: 'POST',
      body:   JSON.stringify({ count }),
    }),

  /** Stop a queued/rendering idea — keeps the row and whatever it produced. */
  cancelThumbnailJob: (projectId: string, jobId: string) =>
    http<ThumbnailJob>(`/projects/${projectId}/thumbnail/jobs/${jobId}/cancel`, { method: 'POST' }),

  /** Delete an idea outright: the prompt and every frame it produced. */
  deleteThumbnailJob: (projectId: string, jobId: string) =>
    http<{ deleted: string; files: number }>(`/projects/${projectId}/thumbnail/jobs/${jobId}`, { method: 'DELETE' }),

  /** Delete one frame from the pool. */
  deleteThumbnailCandidate: (projectId: string, jobId: string, filename: string) =>
    http<ThumbnailJob>(
      `/projects/${projectId}/thumbnail/jobs/${jobId}/candidates/${encodeURIComponent(filename)}`,
      { method: 'DELETE' },
    ),

  thumbnailCandidateUrl: (projectId: string, jobId: string, filename: string) =>
    `${MEDIA_BASE}/projects/${projectId}/thumbnail/jobs/${jobId}/candidates/${encodeURIComponent(filename)}/raw`,

  /** Cache-busted: recaptioning rewrites the same path. */
  thumbnailCoverUrl: (projectId: string, bust?: string | number) =>
    `${MEDIA_BASE}/projects/${projectId}/thumbnail/cover/raw${bust ? `?v=${bust}` : ''}`,

  listProps: (projectId: string) =>
    http<Prop[]>(`/projects/${projectId}/props`),

  getProp: (propId: string) =>
    http<Prop>(`/props/${propId}`),

  createProp: (projectId: string, body: { code: string; name: string; description: string }) =>
    http<Prop>(`/projects/${projectId}/props`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateProp: (propId: string, body: { code?: string; name?: string; description?: string }) =>
    http<Prop>(`/props/${propId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteProp: (propId: string) =>
    http<{ id: string; deleted: boolean }>(`/props/${propId}`, {
      method: 'DELETE',
    }),

  assignShotProp: (shotId: string, propId: string | null) =>
    http<{ id: string; shotCode: string; propId: string | null }>(
      `/shots/${shotId}/prop`,
      { method: 'PATCH', body: JSON.stringify({ propId }) },
    ),

  // Pipeline timing + waste statistics for the Overview page.
  getProjectStats: (idOrSlug: string) =>
    http<{
      project: { id: string; slug: string; name: string };
      /** Real measured machine time on this film, split by what shipped. */
      spent: {
        totalSeconds:      number;
        usefulSeconds:     number;
        wastedSeconds:     number;
        unresolvedSeconds: number;
        wastePercent:      number | null;
      };
      byType: Array<{
        type:              string;
        attempts:          number;
        totalSeconds:      number;
        usefulSeconds:     number;
        wastedSeconds:     number;
        unresolvedSeconds: number;
        wastePercent:      number | null;
        avgSeconds:        number | null;
      }>;
      /** Where the wasted time went: failed / cancelled / superseded / rejected / deleted / orphaned. */
      byReason: Array<{ reason: string; count: number; seconds: number }>;
      forecast: {
        exclusiveSeconds: number;
        realisticSeconds: number;
        breakdown: {
          queuedOwnJobs:           number;
          queuedOwnSeconds:        number;
          jobsAheadOfIt:           number;
          queueAheadSeconds:       number;
          notQueuedSeconds:        number;
          notQueuedStages:         Record<string, number>;
          notQueuedBgmSegments:    number;
          runningRemainderSeconds: number;
        };
        stageCosts: Array<{
          type:               string;
          samples:            number;
          avgSeconds:         number | null;
          defectPercent:      number | null;
          expectedSeconds:    number | null;
          usedGlobalFallback: boolean;
        }>;
        calendar: {
          secondsOfWorkPerDay: number;
          exclusiveDays:       number;
          realisticDays:       number;
          basis:               string;
        } | null;
        excludes: string[];
      };
      caveats: {
        backfilledEntries:       number;
        truncatedHistoryEntries: number;
        note:                    string;
      };
    }>(`/projects/${idOrSlug}/stats`),

  setChosenRender: (shotId: string, filename: string | null) =>
    http<ShotFull>(`/shots/${shotId}/chosen-render`, {
      method: 'PATCH',
      body:   JSON.stringify({ filename }),
    }),

  setChosenVideo: (shotId: string, videoId: string | null) =>
    http<ShotFull>(`/shots/${shotId}/chosen-video`, {
      method: 'PATCH',
      body:   JSON.stringify({ videoId }),
    }),

  /** Queue a vision-model validation. INCREMENTAL: only never-scored candidates
   *  are sent to the model; earlier verdicts are reused. No-op when everything
   *  is already scored (queued:false + reason). */
  validateShot: (shotId: string) =>
    http<{ queued: boolean; jobId: string | null; reason: string | null }>(`/shots/${shotId}/validate`, {
      method: 'POST',
    }),

  /** Approve the vision model's structured suggestion: positive replaces
   *  promptFields.positive, negative tokens append to promptFields.negative.
   *  rerender queues an ADDITIVE batch (old candidates + verdicts survive). */
  applySuggestedPrompt: (shotId: string, fields: { positive?: string; negative?: string; rerender?: boolean; validate?: boolean }) =>
    http<ShotFull>(`/shots/${shotId}/apply-suggested-prompt`, {
      method: 'POST',
      body:   JSON.stringify(fields),
    }),

  createShot: (projectIdOrSlug: string, body: CreateShotBody) =>
    http<ShotFull>(`/projects/${projectIdOrSlug}/shots`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  // Create scene
  createScene: (
    projectIdOrSlug: string,
    body: {
      sceneKey:                     string;
      title?:                       string;
      sortOrder?:                   number;
      defaultReferenceProfileCode?: string;
    },
  ) =>
    http<{ id: string; sceneKey: string; title: string | null; sortOrder: number }>(
      `/projects/${projectIdOrSlug}/scenes`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  trainingProgress: (jobId: string) =>
    http<{
      phase:      string;
      step:       number | null;
      totalSteps: number | null;
      percent:    number | null;
      avgLoss:    number | null;
      eta:        string | null;
      elapsed?:   string;
      elapsedMs:  number | null;
      lastLine:   string | null;
    }>(`/training/jobs/${jobId}/progress`),

  /** Full step series parsed from train.log — every kohya step line decimated. */
  trainingHistory: (jobId: string, maxPoints = 500) =>
    http<{
      phase:      string;
      totalSteps: number | null;
      samples:    Array<{
        step:       number;
        totalSteps: number;
        percent:    number;
        avgLoss:    number;
        elapsedSec: number;
        etaSec:     number | null;
        secPerIt:   number;
      }>;
    }>(`/training/jobs/${jobId}/history?maxPoints=${maxPoints}`),

  listTrainingJobs: (profileId: string) =>
    http<Array<{
      id:           string;
      profileId:    string;
      status:       string;
      logPath:      string | null;
      outputLoraPath: string | null;
      errorMessage: string | null;
      startedAt:    string | null;
      completedAt:  string | null;
      createdAt:    string;
    }>>(`/training/jobs?profileId=${profileId}`),

  cancelTraining: (jobId: string) =>
    http(`/training/jobs/${jobId}`, { method: 'DELETE' }),

  startTraining: (profileId: string, body: Record<string, unknown> = {}) =>
    http<{ id: string; status: string }>(
      `/training/profiles/${profileId}/start`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // ── Pipeline queue (unified across every job type) ───────────────────────
  /** Paginated + filterable + sortable queue list. Single endpoint for the
   *  /queue page AND for any caller looking up a job by id. */
  pipelineQueue: (params: QueueListParams = {}) => {
    const qs = new URLSearchParams();
    if (params.id)                            qs.set('id',       params.id);
    if (params.status?.length)                qs.set('status',   params.status.join(','));
    if (params.type?.length)                  qs.set('type',     params.type.join(','));
    if (params.project?.length)               qs.set('project',  params.project.join(','));
    if (params.finished !== undefined)        qs.set('finished', String(params.finished));
    if (params.sort)                          qs.set('sort',     params.sort);
    if (params.order)                         qs.set('order',    params.order);
    if (params.page)                          qs.set('page',     String(params.page));
    if (params.limit)                         qs.set('limit',    String(params.limit));
    const q = qs.toString();
    return http<QueueListResponse>(`/pipeline/queue${q ? `?${q}` : ''}`);
  },

  /** Reorder a pending entry. `reason: 'tier-boundary'` means the neighbour
   *  belongs to a prioritised project, so rank alone cannot express the move. */
  pipelineMove: (entryId: string, direction: 'up' | 'down' | 'top') =>
    http<{ moved: boolean; swappedWith?: string; reason?: string }>(
      `/pipeline/queue/${entryId}/move`,
      { method: 'POST', body: JSON.stringify({ direction }) },
    ),

  /** Drag and drop: put `entryId` immediately before `beforeEntryId`
   *  (null = drop at the end of the queue). */
  pipelineMoveTo: (entryId: string, beforeEntryId: string | null) =>
    http<{ moved: boolean; reason?: string }>(
      `/pipeline/queue/${entryId}/move-to`,
      { method: 'POST', body: JSON.stringify({ beforeEntryId }) },
    ),

  /** Push a whole film to the front of the queue (tier 1) or let it back down
   *  (tier 0). Sticky: jobs the project queues later inherit the boost. */
  pipelinePrioritizeProject: (projectId: string, tier: number) =>
    http<{ projectId: string; tier: number }>(
      `/pipeline/queue/projects/${projectId}/prioritize`,
      { method: 'POST', body: JSON.stringify({ tier }) },
    ),

  pipelineCancel: (entryId: string) =>
    http(`/pipeline/queue/${entryId}/cancel`, { method: 'POST' }),

  // ── Video renders (Wan2.2 i2v from the shot's chosen render) ──────────────
  startVideoRender: (
    shotId: string,
    body: { motionPrompt?: string; seed?: number; width?: number; height?: number; length?: number; fps?: number; count?: number; mode?: 'fast' | 'cfg' } = {},
  ) =>
    http<VideoRender[]>(`/generation/shots/${shotId}/videos`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  listVideosForShot: (shotId: string) =>
    http<VideoRender[]>(`/generation/shots/${shotId}/videos`),

  getVideo: (videoId: string) =>
    http<VideoRender>(`/generation/videos/${videoId}`),

  // For <video src> — backend streams the mp4 with proper content-type.
  videoFileUrl: (videoId: string) =>
    `${MEDIA_BASE}/generation/videos/${videoId}/file`,

  videoFhdFileUrl: (videoId: string) =>
    `${MEDIA_BASE}/generation/videos/${videoId}/file-fhd`,

  videoSmoothFileUrl: (videoId: string) =>
    `${MEDIA_BASE}/generation/videos/${videoId}/file-smooth`,

  upscaleVideo: (videoId: string) =>
    http<VideoRender>(`/generation/videos/${videoId}/upscale`, { method: 'POST' }),

  /** Queue the mandatory FPS interpolation (RIFE/FILM → 2× framerate) on the
   *  upscaled clip. Backend rejects with 400 if the upscale isn't completed. */
  interpolateVideo: (videoId: string, multiplier?: number) =>
    http<VideoRender>(`/generation/videos/${videoId}/interpolate`, {
      method: 'POST',
      body:   JSON.stringify(multiplier ? { multiplier } : {}),
    }),

  deleteVideo: (videoId: string) =>
    http<{ deleted: true; id: string }>(`/generation/videos/${videoId}`, { method: 'DELETE' }),

  // ── TTS (Silero ru) ───────────────────────────────────────────────────────
  startTTS: (
    sceneId: string,
    body: {
      text?:             string;
      voice?:            TTSVoice;
      sampleRate?:       TTSSampleRate;
      rate?:             number;
      modelFilename?:    string;
      /** Silence after every sentence (seconds). 0 = off. */
      sentencePauseSec?: number;
    } = {},
  ) =>
    http<TTSJob>(`/tts/scenes/${sceneId}`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  listTTSJobs: (sceneId: string) =>
    http<TTSJob[]>(`/tts/scenes/${sceneId}/jobs`),

  /** List Silero .pt models found in .silero_cache/ with their voice sets. */
  listTTSModels: () =>
    http<Array<{ filename: string; sizeBytes: number; voices: TTSVoice[] }>>(`/tts/models`),

  setSceneNarrationText: (sceneId: string, text: string) =>
    http<{ id: string; narrationText: string | null }>(`/tts/scenes/${sceneId}/narration`, {
      method: 'PATCH',
      body:   JSON.stringify({ text }),
    }),

  getTTSJob: (jobId: string) =>
    http<TTSJob>(`/tts/jobs/${jobId}`),

  ttsFileUrl: (jobId: string) =>
    `${MEDIA_BASE}/tts/jobs/${jobId}/file`,

  /** Mark a TTS job as the approved narration for its scene. Idempotent. */
  approveTTSJob: (jobId: string) =>
    http<{ id: string; approvedTTSJobId: string | null }>(`/tts/jobs/${jobId}/approve`, {
      method: 'POST',
    }),

  /** Clear the scene's TTS approval — rare; usually you approve a different take instead. */
  clearTTSApproval: (sceneId: string) =>
    http<{ id: string; approvedTTSJobId: string | null }>(`/tts/scenes/${sceneId}/approve/clear`, {
      method: 'POST',
    }),

  /** Hard-delete a TTS job (DB row + .wav on disk). Refuses if status='running'. */
  deleteTTSJob: (jobId: string) =>
    http<{ deleted: true; id: string }>(`/tts/jobs/${jobId}`, { method: 'DELETE' }),

  /** Trim the leading "понь" reference-bleed artifact off a completed narration.
   *  Reversible (original backed up). trimmed:false means no artifact was found. */
  trimTTSArtifact: (jobId: string) =>
    http<{ trimmed: boolean; reason?: string; cutMs?: number; durationMs?: number | null }>(
      `/tts/jobs/${jobId}/trim-artifact`, { method: 'POST' }),

  /** Undo trimTTSArtifact — restore the narration wav from its pre-trim backup. */
  revertTTSArtifact: (jobId: string) =>
    http<{ reverted: boolean; durationMs?: number | null }>(
      `/tts/jobs/${jobId}/trim-artifact/revert`, { method: 'POST' }),

  /** Bulk-purge failed + cancelled jobs for a scene. */
  purgeFailedTTSJobs: (sceneId: string) =>
    http<{ deleted: number }>(`/tts/scenes/${sceneId}/jobs`, { method: 'DELETE' }),

  // ── Shot-level TTS (per-shot ~5s voiceover) ───────────────────────────────
  startShotTTS: (
    shotId: string,
    body: {
      text?:             string;
      voice?:            TTSVoice;
      sampleRate?:       TTSSampleRate;
      rate?:             number;
      modelFilename?:    string;
      sentencePauseSec?: number;
      /** Voice-clone (xtts2/f5) only — ignored when project is on silero. */
      emotionPreset?:    string;
      emotionIntensity?: number;
      emotionRefName?:   string;
      /** true = jump to the front of the TTS queue; false/undefined = end (FIFO). */
      front?:            boolean;
    } = {},
  ) =>
    http<TTSJob>(`/tts/shots/${shotId}`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  listShotTTSJobs: (shotId: string) =>
    http<TTSJob[]>(`/tts/shots/${shotId}/jobs`),

  setShotNarrationText: (shotId: string, text: string) =>
    http<{ id: string; narrationText: string | null }>(`/tts/shots/${shotId}/narration`, {
      method: 'PATCH',
      body:   JSON.stringify({ text }),
    }),

  /** Clear the shot's TTS approval. */
  clearShotTTSApproval: (shotId: string) =>
    http<{ id: string; approvedTTSJobId: string | null }>(`/tts/shots/${shotId}/approve/clear`, {
      method: 'POST',
    }),

  /**
   * Bulk-queue TTS for every shot in a scene. mode='missing' skips shots that
   * already have an approved completed wav (default); mode='all' re-renders.
   */
  queueAllShotTTS: (sceneId: string, body: { mode?: 'missing' | 'all'; voice?: TTSVoice } = {}) =>
    http<{ queued: number; skipped: number; total: number }>(
      `/tts/scenes/${sceneId}/shots/queue-all`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /** Per-scene aggregate of shot-level TTS progress (live badge on scenes list).
   *  Shot-bucketed: approved + waitingApprove + inFlight + needsQueueing ≤ total. */
  sceneShotsTTSSummary: (sceneId: string) =>
    http<{
      total:          number;
      withText:       number;
      approved:       number;
      waitingApprove: number;
      inFlight:       number;
      needsQueueing:  number;
      pendingJobs:    number;
      runningJobs:    number;
      failedJobs:     number;
    }>(`/tts/scenes/${sceneId}/shots/summary`),

  /** Bulk-approve every shot in the scene that has a completed wav waiting.
   *  Picks the latest completed take per shot. Returns counts. */
  approveAllCompletedTTS: (sceneId: string) =>
    http<{ approved: number; skipped: number; total: number }>(
      `/tts/scenes/${sceneId}/shots/approve-all-completed`,
      { method: 'POST' },
    ),

  // ── Actions (pipeline gates waiting for user action) ─────────────────────
  // Backend endpoint requires Nest restart to take effect — until then this
  // returns 404 and the UI surfaces it as an error state.

  listActions: (projectSlug?: string) =>
    http<{ items: ActionItem[] }>(
      `/actions${projectSlug ? `?project=${encodeURIComponent(projectSlug)}` : ''}`,
    ),

  /** Generic "fire the action attached to this ActionItem" wrapper. The path
   *  + method come from the server so the UI doesn't need to know which gate
   *  maps to which controller. Empty body if action.body is undefined. */
  runAction: (action: NonNullable<ActionItem['action']>) =>
    http(action.path, {
      method: action.method,
      body:   JSON.stringify(action.body ?? {}),
    }),

  // ── CapCut export ─────────────────────────────────────────────────────────
  capcutReadiness: (idOrSlug: string) =>
    http<CapcutReadiness>(`/projects/${idOrSlug}/export/capcut/readiness`),

  /** Linear CapCut export. Can hang for minutes when the backend is busy with
   *  renders, so hit the backend DIRECTLY (bypass the Next /api proxy whose ~5-min
   *  timeout drops the request with a socket hang-up). Browser fetch has no timeout;
   *  the nest server timeout is disabled. */
  exportCapcut: async (idOrSlug: string): Promise<{ draftPath: string; sceneCount: number; shotCount: number }> => {
    const res = await fetch(`${DIRECT_API_BASE}/projects/${idOrSlug}/export/capcut`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(await res.text()) as { draftPath: string; sceneCount: number; shotCount: number };
  },

  /** Comic export (film → comic spreads with camera fly-through + page flips).
   *  Slow — runs for MINUTES — and writes the draft straight into CapCut's drafts
   *  folder, so CapCut must be closed. Hits the backend DIRECTLY (DIRECT_API_BASE),
   *  bypassing the /api rewrite proxy whose ~5-min timeout would drop the request;
   *  browser fetch has no timeout so the long POST runs to completion. */
  exportComic: async (idOrSlug: string): Promise<{ draft_name: string; spreads: number; status: string }> => {
    const res = await fetch(`${DIRECT_API_BASE}/projects/${idOrSlug}/export/comic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(await res.text()) as { draft_name: string; spreads: number; status: string };
  },

  /** Start the CHUNKED comic build: the film is sliced into several small drafts
   *  (~4 spreads each) so CapCut can actually open them, rendered detached. Same
   *  DIRECT_API_BASE reasoning as exportComic — the manifest+slice step is quick but
   *  still beyond the proxy's comfort zone on a long film. */
  exportComicChunks: async (idOrSlug: string, perChunk?: number): Promise<{
    chunks: ComicChunk[]; status: string;
  }> => {
    const res = await fetch(`${DIRECT_API_BASE}/projects/${idOrSlug}/export/comic/chunks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(perChunk ? { perChunk } : {}),
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(await res.text()) as { chunks: ComicChunk[]; status: string };
  },

  /** Poll the chunked build: the plan plus, per chunk, whether its draft exists yet
   *  (which is what makes that chunk exportable to mp4). */
  comicChunksStatus: (idOrSlug: string) =>
    http<{
      chunks: (ComicChunk & { drafted: boolean })[];
      building: boolean; done: boolean; drafted: number; total: number;
    }>(`/projects/${idOrSlug}/export/comic/chunks/status`),

  /** Assemble the final draft from the mp4s rendered out of each chunk. Quick — it
   *  only measures durations and writes JSON, so the proxy timeout is not a concern. */
  assembleComicChunks: (idOrSlug: string, files: { part: number; path: string }[]) =>
    http<{ draft_name: string; draft_path: string }>(
      `/projects/${idOrSlug}/export/comic/assemble`,
      { method: 'POST', body: JSON.stringify({ files }) },
    ),

  /** Poll a comic build. `done` flips true once the draft is written into CapCut.
   *  `name` is optional: without it the backend reports the CURRENT build from the
   *  manifest, so a page that did not start the build still sees its progress.
   *  Quick call — goes through the /api proxy. */
  comicStatus: (idOrSlug: string, name?: string) =>
    http<{
      done: boolean; building: boolean; rendered: number; total: number; draftName: string;
      /** Two render phases: spreads, then one page turn per boundary. */
      spreads: number; spreadsTotal: number; turns: number; turnsTotal: number;
      phase: 'spreads' | 'turns' | 'draft' | 'done';
      /** Across BOTH phases — spreads alone reach 100% at roughly half the work. */
      percent: number;
    }>(
      `/projects/${idOrSlug}/export/comic/status${name ? `?name=${encodeURIComponent(name)}` : ''}`,
    ),

  // ── YouTube-Shorts export ───────────────────────────────────────────────────
  /** The project's curated shorts plan (which shots go into each teaser reel). */
  shortsPlan: (idOrSlug: string) =>
    http<ShortsPlan>(`/projects/${idOrSlug}/export/shorts/plan`),

  /** Add a short to the versioned plan (same slug → replaces title/shots).
   *  Creates the plan file when the project doesn't have one yet. */
  upsertShortPlan: (idOrSlug: string, body: { slug: string; title?: string; shots: string[] }) =>
    http<ShortsPlan>(`/projects/${idOrSlug}/export/shorts/plan`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  /** Remove a short from the plan (its packaging texts are dropped too). */
  deleteShortPlan: (idOrSlug: string, shortSlug: string) =>
    http<ShortsPlan>(
      `/projects/${idOrSlug}/export/shorts/plan/${encodeURIComponent(shortSlug)}`,
      { method: 'DELETE' },
    ),

  /** Build the vertical (9:16) shorts CapCut drafts. Optional body carries a
   *  plan directly (future LLM curator); omitted → server uses the versioned
   *  scripts/<slug>_shorts_plan.json. */
  exportShorts: (
    idOrSlug: string,
    body?: {
      shorts?: Array<{ slug: string; title?: string; shots: string[] }>;
      only?: string;          // build just this short (per-short export)
      background_fill?: string;
      width?: number;
      height?: number;
      fps?: number;
    },
  ) =>
    http<{ shorts: ShortResult[] }>(
      `/projects/${idOrSlug}/export/shorts`,
      { method: 'POST', body: JSON.stringify(body ?? {}) },
    ),

  // ── YouTube packaging ───────────────────────────────────────────────────────
  /** Read the project's YouTube title/description(s)/tags (main + per short). */
  getYoutube: (idOrSlug: string) =>
    http<YoutubePackage>(`/projects/${idOrSlug}/youtube`),

  /** Merge-update the packaging (only the keys sent change). */
  patchYoutube: (
    idOrSlug: string,
    body: { main?: Partial<YoutubeMain>; shorts?: Record<string, Partial<YoutubeShort>> },
  ) =>
    http<YoutubePackage>(`/projects/${idOrSlug}/youtube`, {
      method: 'PATCH',
      body:   JSON.stringify(body),
    }),

  /** Is the YouTube channel connected? (Global — one channel for all projects.) */
  getYoutubeAuthStatus: () =>
    http<YoutubeAuthStatus>(`/youtube/auth/status`),

  /** Path (via the /api proxy) the browser opens to start the OAuth consent flow. */
  youtubeOAuthUrl: () => `${MEDIA_BASE}/youtube/oauth/url`,

  /** The connected channel's playlists (upload-target dropdown). */
  getYoutubePlaylists: () =>
    http<YoutubePlaylist[]>(`/youtube/playlists`),

  /** Next Tue/Thu publish slot after the last scheduled video (16:00 Kyiv for
   *  main, 16:05 for short). Server-computed from the channel's schedule. */
  getYoutubeNextSlot: (kind: 'main' | 'short' = 'main') =>
    http<{ publishAt: string; basedOn: string | null; reason: string }>(
      `/youtube/next-slot?kind=${kind}`),

  /** Open a native file dialog on the server (=this) machine, return the chosen
   *  absolute path. Blocks until the user picks/cancels. kind=video|image. */
  pickYoutubeFile: (kind: 'video' | 'image') =>
    http<{ path: string | null }>(`/youtube/pick-file?kind=${kind}`),

  /** Upload the project's MAIN video. `videoPath`/`thumbnailPath` are exported by
   *  the user from CapCut (thumbnail is mandatory). `publishAt` (RFC3339) schedules
   *  it — forces private; only fires post-audit. Google forces `private` until the
   *  API project is audited regardless. */
  uploadYoutubeMain: (
    idOrSlug: string,
    body: {
      videoPath:      string;
      thumbnailPath:  string;
      privacyStatus?: 'private' | 'unlisted' | 'public';
      publishAt?:     string;
      containsSyntheticMedia?: boolean;
      playlistId?:    string;
      categoryId?:    string;
      madeForKids?:   boolean;
      generateCaptions?: boolean;
    },
  ) =>
    http<{ jobId: string }>(`/projects/${idOrSlug}/youtube/upload`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  /** Poll a background upload job (main or short). */
  getYoutubeUploadJob: (jobId: string) =>
    http<YoutubeUploadJob | null>(`/youtube/jobs/${jobId}`),

  /** Upload one SHORT. Reads packaging from settings.youtube.shorts[shortSlug],
   *  defaults the playlist to «шорты», stores the resulting link in the short. */
  uploadYoutubeShort: (
    idOrSlug: string,
    shortSlug: string,
    body: {
      videoPath:      string;
      thumbnailPath:  string;
      privacyStatus?: 'private' | 'unlisted' | 'public';
      publishAt?:     string;
      containsSyntheticMedia?: boolean;
      playlistId?:    string;
      generateCaptions?: boolean;
    },
  ) =>
    http<{ jobId: string }>(`/projects/${idOrSlug}/youtube/shorts/${shortSlug}/upload`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  /** Enqueue subtitle generation + upload for an already-uploaded video. */
  enqueueYoutubeCaptions: (
    idOrSlug: string,
    body: { videoId: string; videoPath: string; language?: string },
  ) =>
    http<YoutubeCaptionJob>(`/projects/${idOrSlug}/youtube/captions`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  /** Latest caption job for the project (poll for status). */
  getYoutubeCaptions: (idOrSlug: string) =>
    http<YoutubeCaptionJob | null>(`/projects/${idOrSlug}/youtube/captions`),

  // ── «Связка-запуск» (launch stepper) ────────────────────────────────────────
  getLaunch: (idOrSlug: string) =>
    http<LaunchView>(`/projects/${idOrSlug}/youtube/launch`),
  /** Step 2: save prepared files + transcribe every mp4. */
  prepareLaunch: (
    idOrSlug: string,
    items: Array<{ key: string; kind: 'main' | 'short'; slug?: string; videoPath: string; thumbPath: string }>,
  ) =>
    http<LaunchView>(`/projects/${idOrSlug}/youtube/launch/prepare`, { method: 'POST', body: JSON.stringify({ items }) }),
  /** Step 3: upload all as Unlisted (attaching subtitles). */
  uploadLaunch: (idOrSlug: string) =>
    http<LaunchView>(`/projects/${idOrSlug}/youtube/launch/upload`, { method: 'POST' }),
  /** Per-asset: add/replace ONE item (main or short) + transcribe it. */
  prepareLaunchItem: (
    idOrSlug: string,
    item: { key: string; kind: 'main' | 'short'; slug?: string; videoPath: string; thumbPath: string },
  ) =>
    http<LaunchView>(`/projects/${idOrSlug}/youtube/launch/prepare-item`, { method: 'POST', body: JSON.stringify(item) }),
  /** Per-asset: upload ONE item as Unlisted. */
  uploadLaunchItem: (idOrSlug: string, key: string) =>
    http<LaunchView>(`/projects/${idOrSlug}/youtube/launch/upload-item/${encodeURIComponent(key)}`, { method: 'POST' }),
  /** Confirm the cover was set by hand in Studio (the only path for a cover over
   *  the API's 2MB cap — we don't re-encode the artwork). On trust. */
  confirmLaunchThumbnailManual: (idOrSlug: string, key: string) =>
    http<LaunchView>(`/projects/${idOrSlug}/youtube/launch/thumbnail-manual/${encodeURIComponent(key)}`, { method: 'POST' }),
  /** Send the cover of an already-uploaded item through the API (needs ≤2MB).
   *  Pass `thumbPath` to swap in a different image. */
  retryLaunchThumbnail: (idOrSlug: string, key: string, thumbPath?: string) =>
    http<LaunchView>(`/projects/${idOrSlug}/youtube/launch/thumbnail/${encodeURIComponent(key)}`, {
      method: 'POST',
      body:   JSON.stringify(thumbPath ? { thumbPath } : {}),
    }),
  /** Remove ONE item from the bundle. */
  removeLaunchItem: (idOrSlug: string, key: string) =>
    http<LaunchView>(`/projects/${idOrSlug}/youtube/launch/remove-item/${encodeURIComponent(key)}`, { method: 'POST' }),
  /** Step 4: confirm the manual Studio linking is done. */
  confirmLaunchLinked: (idOrSlug: string) =>
    http<LaunchView>(`/projects/${idOrSlug}/youtube/launch/confirm-linked`, { method: 'POST' }),
  /** Step 5: schedule all (main 16:00, shorts 16:05). */
  scheduleLaunch: (idOrSlug: string) =>
    http<{ mainPublishAt: string; shortsPublishAt: string; view: LaunchView }>(
      `/projects/${idOrSlug}/youtube/launch/schedule`, { method: 'POST' }),
  /** Step 5 alt: publish all PUBLIC now instead of scheduling. */
  publishLaunchNow: (idOrSlug: string) =>
    http<LaunchView>(`/projects/${idOrSlug}/youtube/launch/publish-now`, { method: 'POST' }),
  resetLaunch: (idOrSlug: string) =>
    http<LaunchView>(`/projects/${idOrSlug}/youtube/launch/reset`, { method: 'POST' }),

  /**
   * Read the project's full narration script (stored in Project.scriptText).
   * Used by the TTS modal to show the user the full story they're voicing —
   * they then copy/paste relevant chunks per scene.
   */
  getProjectScript: (idOrSlug: string) =>
    http<{ text: string | null }>(`/projects/${idOrSlug}/script`),

  /** Overwrite Project.scriptText. Empty string clears the field. */
  patchProjectScript: (idOrSlug: string, text: string) =>
    http<{ text: string | null }>(`/projects/${idOrSlug}/script`, {
      method: 'PATCH',
      body:   JSON.stringify({ text }),
    }),

  /** Fetch the full project row (incl. required prompt fields) for the Settings page. */
  getProject: (idOrSlug: string) =>
    http<ProjectFull>(`/projects/${idOrSlug}`),

  /**
   * Update editable project fields. Sending an empty string to a required
   * prompt field is rejected by the backend (NOT NULL + CHECK constraint).
   * Omit the field to keep its current value.
   */
  updateProject: (id: string, body: UpdateProjectBody) =>
    http<ProjectFull>(`/projects/${id}`, {
      method: 'PATCH',
      body:   JSON.stringify(body),
    }),

  /** List comic style-LoRAs on disk for the per-project style picker. */
  listStyleLoras: () =>
    http<StyleLoraItem[]>(`/projects/style-loras`),

  // ── Project TTS (engine + voice/emotion refs) ──────────────────────────

  setProjectTTSEngine: (projectId: string, engine: TTSEngine) =>
    http<{ id: string; slug: string; ttsEngine: string | null; ttsVoiceRefPath: string | null }>(
      `/projects/${projectId}/tts/engine`, {
        method: 'PATCH',
        body:   JSON.stringify({ engine }),
      },
    ),

  /** Upload a NEW clip: lands it in the shared library (dedup by md5) AND
   *  assigns it to this project. To reuse an existing voice, call
   *  assignProjectVoiceover instead — no upload. */
  uploadProjectVoiceRef: async (projectId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_BASE}/projects/${projectId}/tts/voice-reference`, {
      method: 'POST',
      body:   fd,
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json() as Promise<{ ok: true; path: string; bytes: number; voiceoverId: string }>;
  },

  /** Assign an existing library voiceover to a project (or unassign with null). */
  assignProjectVoiceover: (projectId: string, voiceoverId: string | null) =>
    http<{ id: string; slug: string; ttsEngine: string | null; ttsVoiceRefPath: string | null; ttsVoiceoverId: string | null }>(
      `/projects/${projectId}/tts/voiceover`, {
        method: 'PUT',
        body:   JSON.stringify({ voiceoverId }),
      },
    ),

  /** Unassign the project's voice (keeps the shared library file intact). */
  deleteProjectVoiceRef: (projectId: string) =>
    http<{ id: string; ttsVoiceRefPath: string | null; ttsVoiceoverId: string | null }>(
      `/projects/${projectId}/tts/voice-reference`, { method: 'DELETE' }),

  // ── Voiceover library (shared закадровая озвучка) ──────────────────────────

  listVoiceovers: () => http<Voiceover[]>(`/voiceovers`),

  /** One voiceover with the projects it's assigned to (detail page). */
  getVoiceover: (id: string) => http<Voiceover>(`/voiceovers/${id}`),

  /** Add a clip to the library directly (dedup by md5). */
  createVoiceover: async (file: File, opts?: { name?: string; slug?: string; sourceUrl?: string }) => {
    const fd = new FormData();
    fd.append('file', file);
    if (opts?.name)      fd.append('name', opts.name);
    if (opts?.slug)      fd.append('slug', opts.slug);
    if (opts?.sourceUrl) fd.append('sourceUrl', opts.sourceUrl);
    const res = await fetch(`${API_BASE}/voiceovers`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json() as Promise<Voiceover>;
  },

  /** Edit a voiceover's label / slug / source link. sourceUrl='' clears it. */
  renameVoiceover: (id: string, body: { name?: string; slug?: string; sourceUrl?: string | null }) =>
    http<Voiceover>(`/voiceovers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  /** Set the EXACT list of projects assigned to this voice (bidirectional assign). */
  setVoiceoverProjects: (id: string, projectIds: string[]) =>
    http<Voiceover>(`/voiceovers/${id}/projects`, { method: 'PUT', body: JSON.stringify({ projectIds }) }),

  deleteVoiceover: (id: string, force = false) =>
    http<{ ok: true }>(`/voiceovers/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' }),

  /** URL to stream a voiceover clip for an <audio> preview. Uses MEDIA_BASE so
   *  the browser loads it over the LAN (works from a tablet/phone), like every
   *  other <audio>/<img>/<video> src. */
  voiceoverRawUrl: (id: string) => `${MEDIA_BASE}/voiceovers/${id}/raw`,

  // ── Import from YouTube / upload + waveform trim ───────────────────────────

  /** Fetch a YouTube URL's audio into server staging; returns a source to trim. */
  extractYoutubeSource: (url: string) =>
    http<VoiceSource>(`/voiceovers/source/youtube`, { method: 'POST', body: JSON.stringify({ url }) }),

  /** Upload a local audio file into server staging; returns a source to trim. */
  uploadVoiceSource: async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_BASE}/voiceovers/source/upload`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json() as Promise<VoiceSource>;
  },

  /** Media URL for the waveform to load a staged source (LAN-safe, browser-loaded). */
  voiceSourceStreamUrl: (token: string) => `${MEDIA_BASE}/voiceovers/source/${token}/raw`,

  /** Commit a staged source at [startMs,endMs] into a new library voice. */
  saveVoiceFromSource: (token: string, body: { name?: string; startMs: number; endMs: number }) =>
    http<Voiceover>(`/voiceovers/source/${token}/save`, { method: 'POST', body: JSON.stringify(body) }),

  /** Discard a staged source (cancel the import). */
  discardVoiceSource: (token: string) =>
    http<{ ok: true }>(`/voiceovers/source/${token}`, { method: 'DELETE' }),

  /** Media URL for the retained untrimmed source of a saved voice (for re-trim). */
  voiceSavedSourceUrl: (id: string) => `${MEDIA_BASE}/voiceovers/${id}/source/raw`,

  /** Re-cut an existing voice from its retained source at a new window. */
  retrimVoiceover: (id: string, body: { startMs: number; endMs: number }) =>
    http<Voiceover>(`/voiceovers/${id}/trim`, { method: 'PATCH', body: JSON.stringify(body) }),

  listProjectEmotionRefs: (projectId: string) =>
    http<ProjectTTSEmotionRef[]>(`/projects/${projectId}/tts/emotion-refs`),

  uploadProjectEmotionRef: async (projectId: string, name: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_BASE}/projects/${projectId}/tts/emotion-refs/${encodeURIComponent(name)}`, {
      method: 'POST',
      body:   fd,
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json() as Promise<ProjectTTSEmotionRef>;
  },

  deleteProjectEmotionRef: (projectId: string, name: string) =>
    http<{ ok: true }>(`/projects/${projectId}/tts/emotion-refs/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // ── BGM (ACE-Step background music) ────────────────────────────────────

  /** Valid ACE-Step metadata values, straight from the ComfyUI node's combo
   *  options. Fetch instead of hardcoding: an unknown keyscale fails the whole
   *  ComfyUI prompt, and the render queue is single-slot. */
  bgmMetaOptions: () =>
    http<{
      bpm:            { min: number; max: number };
      keyscales:      string[];
      timesignatures: string[];
    }>(`/bgm/meta-options`),

  listBlocks: (projectId: string) =>
    http<NarrativeBlock[]>(`/bgm/projects/${projectId}/blocks`),

  createBlock: (projectId: string, body: {
    slug:        string;
    title?:      string;
    sortOrder?:  number;
    moodPrompt?: string;
    shotIds:     string[];
  } & MusicMetas) =>
    http<NarrativeBlock>(`/bgm/projects/${projectId}/blocks`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  getBlock: (blockId: string) =>
    http<NarrativeBlock>(`/bgm/blocks/${blockId}`),

  updateBlock: (blockId: string, body: {
    title?:      string | null;
    sortOrder?:  number;
    moodPrompt?: string | null;
    shotIds?:    string[];
    status?:     'filling' | 'filled' | 'manual';
  } & MusicMetas) =>
    http<NarrativeBlock>(`/bgm/blocks/${blockId}`, {
      method: 'PATCH',
      body:   JSON.stringify(body),
    }),

  deleteBlock: (blockId: string) =>
    http<{ deleted: true; id: string }>(`/bgm/blocks/${blockId}`, { method: 'DELETE' }),

  recomputeBlockTarget: (blockId: string) =>
    http<NarrativeBlock>(`/bgm/blocks/${blockId}/recompute-target`, { method: 'POST' }),

  /** Auto-tile the act into 150s main tiles (ceil(actLength/150)) + 2 spare
   *  tiles, all on the act mood prompt. Idempotent top-up; recomputes the act
   *  length from voiceover first. */
  fillBlock: (blockId: string) =>
    http<{ created: number; existing: number; targetSeconds: number; mainTiles: number; spareTiles: number }>(
      `/bgm/blocks/${blockId}/fill`,
      { method: 'POST' },
    ),

  createSegment: (body: {
    blockId:      string;
    prompt?:      string | null;
    durationSec?: number;
    sortOrder?:   number;
  } & MusicMetas) =>
    http<MusicSegment>(`/bgm/segments`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  /** Patch one tile. Each meta: a value overrides the block, `null` inherits it.
   *  Changing `prompt` clears the segment's approval server-side — the approved
   *  flac no longer matches the prompt. */
  updateSegment: (segmentId: string, body: {
    prompt?:      string | null;
    durationSec?: number;
    sortOrder?:   number;
    spare?:       boolean;
  } & MusicMetas) =>
    http<MusicSegment>(`/bgm/segments/${segmentId}`, {
      method: 'PATCH',
      body:   JSON.stringify(body),
    }),

  deleteSegment: (segmentId: string) =>
    http<{ deleted: true; id: string }>(`/bgm/segments/${segmentId}`, { method: 'DELETE' }),

  approveBgmJob: (segmentId: string, jobId: string) =>
    http<MusicSegment>(`/bgm/segments/${segmentId}/approve/${jobId}`, { method: 'POST' }),

  unapproveBgmJob: (segmentId: string) =>
    http<MusicSegment>(`/bgm/segments/${segmentId}/approve`, { method: 'DELETE' }),

  /** Queue an ACE-Step take (or N takes) for a segment. */
  startBgmRender: (segmentId: string, body: {
    prompt?:      string;
    durationSec?: number;
    seed?:        number;
    steps?:       number;
    cfg?:         number;
    samplerName?: string;
    scheduler?:   string;
    count?:       number;
  } & MusicMetas = {}) =>
    http<AudioRenderJob[]>(`/bgm/segments/${segmentId}/render`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  listBgmJobs: (segmentId: string) =>
    http<AudioRenderJob[]>(`/bgm/segments/${segmentId}/jobs`),

  getBgmJob: (jobId: string) =>
    http<AudioRenderJob>(`/bgm/jobs/${jobId}`),

  deleteBgmJob: (jobId: string) =>
    http<{ deleted: true; id: string }>(`/bgm/jobs/${jobId}`, { method: 'DELETE' }),

  /** Direct URL for the <audio> element to stream the rendered flac. */
  bgmJobFileUrl: (jobId: string) =>
    `${MEDIA_BASE}/bgm/jobs/${jobId}/file`,

  /** File size + computed bitrate for the rendered flac. Null when missing on disk. */
  getBgmJobMeta: (jobId: string) =>
    http<{ bytes: number; durationSec: number; bitrateKbps: number } | null>(
      `/bgm/jobs/${jobId}/meta`,
    ),
};

export type TTSVoice      = 'aidar' | 'baya' | 'kseniya' | 'xenia' | 'eugene' | 'ruslan' | 'random';
export type TTSSampleRate = 8000 | 24000 | 48000;

/** One chunk of the film in the `comic_chunks` export. */
export interface ComicChunk {
  part: number;
  of: number;
  draft_name: string;
  spread_from: number;
  spread_to: number;
  spreads: number;
  /** Where the chunk starts on the FILM timeline (µs) — the anchor the assembler
   *  uses to re-place audio once the real mp4 durations are known. */
  film_offset_us: number;
  expected_us: number;
  ends_on_turn: boolean;
}

export interface CapcutReadiness {
  ready: boolean;
  totals: { scenes: number; shots: number };
  missingShots:  Array<{
    shotCode: string;
    shotId:   string;
    reason:   'no_chosen_video' | 'no_upscale' | 'no_interp' | 'no_chosen_render';
  }>;
  missingScenes: Array<{
    sceneKey: string;
    sceneId:  string;
    title:    string | null;
    reason:   'no_shots';
  }>;
  /** Music is required for export: every act (block) needs its main tiles
   *  approved. Absent on older backends — treat undefined as an empty list. */
  missingMusic?: Array<{
    blockSlug: string | null;
    reason:    'no_blocks' | 'no_tiles' | 'unapproved';
    count?:    number;
  }>;
}

/** GET /projects/:id/export/shorts/plan — the curated shorts plan for the UI. */
export interface ShortsPlanItem {
  slug:    string;
  title:   string;
  shots:   number;
  /** Planned shots in plan order; `image` is the shot's chosenRender filename
   *  (feed it to api.shotImageUrl) or null while the shot isn't rendered yet. */
  preview: Array<{ shotId: string | null; shotCode: string; image: string | null }>;
}
export interface ShortsPlan {
  hasPlan: boolean;
  shorts:  ShortsPlanItem[];
}

/** One built short returned by POST /projects/:id/export/shorts. */
export interface ShortResult {
  slug?:       string;
  title?:      string;
  draft_name:  string;
  draft_path?: string;
  shots:       number;
  seconds:     number;
}

// ── YouTube packaging (title / description(s) / tags) ────────────────────────
export interface YoutubeMain {
  title:       string;
  description: string;
  tags:        string[];
  /** Set after a successful upload — points at the video even while it's private. */
  videoId?:    string;
  url?:        string;
}

/** Whether the single YouTube channel is connected (GET /youtube/auth/status). */
export interface YoutubeAuthStatus {
  connected:    boolean;
  channelTitle: string | null;
  /** False when YT_CLIENT_ID/SECRET are missing from the backend .env. */
  configured:   boolean;
}

/** Result of POST /projects/:id/youtube/upload. */
export interface YoutubeUploadResult {
  videoId:          string;
  url:              string;
  requestedPrivacy: string;
  /** What Google ACTUALLY applied — 'private' while the project is unaudited. */
  actualPrivacy:    string | null;
  publishAt:        string | null;
  containsSyntheticMedia: boolean;
  thumbnailSet:     boolean;
  /** Why the cover didn't stick (null when it did / none was given). */
  thumbnailError:   string | null;
  /** null = no playlist requested; true/false = add outcome. */
  playlistAdded:    boolean | null;
  markedPublished:  boolean;
}

/** One of the connected channel's playlists (upload target). */
export interface YoutubePlaylist {
  id:        string;
  title:     string;
  itemCount: number;
}

/** A background upload job (POST returns { jobId }; poll for status). */
export interface YoutubeUploadJob {
  jobId:     string;
  kind:      'main' | 'short';
  status:    'uploading' | 'done' | 'error';
  result?:   YoutubeUploadResult;
  error?:    string;
  startedAt: number;
}

/** One video in a «Связка-запуск» bundle. */
export interface LaunchItemView {
  key:              string;
  kind:             'main' | 'short';
  slug?:            string;
  videoPath:        string;
  thumbPath:        string;
  videoId?:         string;
  uploadJobId?:     string;
  transcribeStatus: string | null;   // pending|running|completed|failed|null
  uploaded:         boolean;
  uploadError:      string | null;
  /** Uploaded with a cover given, but it isn't on YouTube yet — fix before publishing. */
  thumbnailMissing: boolean;
  thumbnailError:   string | null;
  /** Cover exceeds the API's 2MB cap — Studio (50MB) is the only path for it. */
  thumbnailTooBig:  boolean;
}
export interface LaunchView {
  items:           LaunchItemView[];
  linkedConfirmed: boolean;
  allTranscribed:  boolean;
  allUploaded:     boolean;
  hasShorts:       boolean;
  step:            number;            // 1 files · 2 subs · 3 upload · 4 link · 5 schedule
  published:       boolean;           // schedule/publishNow already ran — publish is locked
  publishMode:     'scheduled' | 'public' | null;
  mainPublishAt:   string | null;
  shortsPublishAt: string | null;
}

/** A subtitle/caption job (transcribe final mp4 → captions.insert). */
export interface YoutubeCaptionJob {
  id:           string;
  videoId:      string;
  status:       string;   // pending | running | completed | failed
  uploaded:     boolean;
  srtPath:      string | null;
  errorMessage: string | null;
  queuedAt:     string;
  completedAt:  string | null;
}
export interface YoutubeShort {
  title:      string;
  descBefore: string;   // while the main video isn't published yet
  descAfter:  string;   // after — references the main video ({{main_url}})
  tags:       string[];
  /** The short's own published YouTube link ('' until posted). */
  url?:       string;
}
export interface YoutubePackage {
  youtubeUrl: string | null;
  main:       YoutubeMain;
  shorts:     Record<string, YoutubeShort>;
}

export interface TTSJob {
  id:             string;
  sceneId:        string;
  text:           string;
  voice:          TTSVoice;
  sampleRate:     TTSSampleRate;
  /** Playback rate, 1.0 = normal, <1 slower, >1 faster (range [0.5, 2.0]). */
  rate:           number;
  /** Extra silence (seconds) inserted after every sentence boundary. 0 = off. */
  sentencePauseSec: number;
  /** Which Silero .pt was used (null = backend default). */
  modelFilename:  string | null;
  status:         'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  outputFilename: string | null;
  errorMessage:   string | null;
  queuedAt:       string;
  startedAt:      string | null;
  completedAt:    string | null;
  /** Shot-job listings only: true when the leading "понь" artifact has been
   *  trimmed (a pre-trim backup exists) — i.e. the trim is revertable. */
  trimmedArtifact?: boolean;
}

export interface VideoRender {
  id:                  string;
  shotId:              string;
  sourceImageFilename: string;
  motionPrompt:        string;
  status:              'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  comfyPromptId:       string | null;
  params:              { seed?: number; width?: number; height?: number; length?: number; fps?: number } | null;
  outputFilename:      string | null;
  workflowFilename:    string;
  errorMessage:        string | null;
  queuedAt:            string;
  startedAt:           string | null;
  completedAt:         string | null;
  // Upscale-on-demand (4x-UltraSharp → 1920×1080). Populated after the user clicks "upscale".
  upscaleStatus:        'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | null;
  upscaledFilename:     string | null;
  upscalePromptId:      string | null;
  upscaleStartedAt:     string | null;
  upscaleCompletedAt:   string | null;
  upscaleErrorMessage:  string | null;
  // FPS interpolation (RIFE/FILM → 2× framerate). MANDATORY step after upscale;
  // the smoothed clip is what CapCut export ships. Only queueable once
  // upscaleStatus='completed'.
  interpStatus:         'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | null;
  interpFilename:       string | null;
  interpPromptId:       string | null;
  interpMultiplier:     number | null;
  interpStartedAt:      string | null;
  interpCompletedAt:    string | null;
  interpErrorMessage:   string | null;
}

// ── BGM (ACE-Step background music) ──────────────────────────────────────

/**
 * ACE-Step 1.5 metadata conditioning. These are NOT cosmetic: the ComfyUI
 * tokenizer appends them to the model prompt as a labelled `# Metas` block, so
 * a caption that also names its own tempo or key contradicts them and the beat
 * ends up belonging to neither — the cause of the reported «битый ритм».
 *
 * Tempo/key/metre live here; the caption stays prose. Every field is nullable:
 * null = inherit (segment → block → workflow template default).
 * Prompt-writing rules: Skill(gen-studio-acestep).
 */
export interface MusicMetas {
  /** 10–300. Slow 60–80, mid 90–120, fast 130–180. */
  bpm?:           number | null;
  /** "<Root> major|minor", lowercase quality: "A minor", "Eb major". Not "Am". */
  keyscale?:      string | null;
  /** Bare digit: '2' | '3' | '4' | '6'. Not "4/4". */
  timesignature?: string | null;
}

export interface NarrativeBlock extends MusicMetas {
  id:            string;
  projectId:     string;
  slug:          string;
  title:         string | null;
  sortOrder:     number;
  moodPrompt:    string | null;
  /** Ordered list of Shot.id that this block covers — drives targetSeconds. */
  shotIds:       string[];
  /** Sum of covered shots' chosen-video durations (length / fps), in seconds. */
  targetSeconds: number | null;
  status:        'filling' | 'filled' | 'manual';
  createdAt:     string;
  updatedAt:     string;
  segments?:     MusicSegment[];
}

export interface MusicSegment extends MusicMetas {
  id:            string;
  blockId:       string;
  sortOrder:     number;
  /** Per-segment ACE-Step tags override; null = inherit block.moodPrompt. */
  prompt:        string | null;
  durationSec:   number;
  /** Spare tile: manual-editing material laid raw on its own export lane.
   *  Optional — absent on older backends (treat undefined as false). */
  spare?:        boolean;
  /** AudioRenderJob.id approved as the canonical take, or null. */
  approvedJobId: string | null;
  createdAt:     string;
  jobs?:         AudioRenderJob[];
}

// ── Actions (pipeline-gate todo list) ─────────────────────────────────────

export type ActionGateKey =
  | 'upload_dataset_images'
  | 'start_dataset'
  | 'start_training'
  | 'generate_anchor'
  | 'render_scene'
  | 'approve_render'
  | 'create_video'
  | 'approve_video'
  | 'upscale_video'
  | 'interpolate_video'
  | 'render_tts'
  | 'approve_tts'
  | 'approve_bgm';

export interface ActionItem {
  gate:    1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  gateKey: ActionGateKey;
  project: { id: string; slug: string; name: string };
  character?: { id: string; code: string; displayName: string | null };
  profile?:   { id: string; code: string };
  scene?:     { id: string; sceneKey: string; title: string | null };
  shot?:      { id: string; code: string };
  /** Segment-anchored gates (BGM approval, gate 10). */
  segment?: {
    id:          string;
    sortOrder:   number;
    durationSec: number;
    prompt:      string | null;
    block:       { id: string; slug: string; title: string | null };
  };
  /** Frontend path the "Open" button navigates to (relative to API_BASE host). */
  link:   string;
  /** Optional one-click action. Present on gates 2, 3, 8 only. */
  action?: {
    method: 'POST' | 'PATCH';
    path:   string;
    body?:  Record<string, unknown>;
  };
}

export interface AudioRenderJob {
  id:               string;
  segmentId:        string;
  status:           'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  comfyPromptId:    string | null;
  params: {
    prompt?:      string;
    durationSec?: number;
    seed?:        number;
    steps?:       number;
    cfg?:         number;
    samplerName?: string;
    scheduler?:   string;
  } | null;
  workflowFilename: string;
  outputFilename:   string | null;
  errorMessage:     string | null;
  queuedAt:         string;
  startedAt:        string | null;
  completedAt:      string | null;
}
