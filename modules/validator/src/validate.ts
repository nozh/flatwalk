import {
  IdSchema,
  PathSchema,
  RevisionSchema,
  SCHEMA_VERSION,
  ValidationReportSchema,
  listMetaOwners,
  metaPathForOwner,
  readPath,
  validateFlatModel,
  type FlatModel,
  type Meta,
  type ValidationReport,
} from "@flatwalk/contract";
import {
  GeometryError,
  adjacency,
  faces,
  path as roomPath,
  roomPolygon,
  startPoint,
  wallSide,
} from "@flatwalk/geometry";

type ReportCheck = ValidationReport["checks"][number];

export type AvatarProfile = {
  radius: number;
  height: number;
};

export const DEFAULT_AVATAR: AvatarProfile = { radius: 0.25, height: 1.7 };

const LAYERS = ["sources", "contract", "geometry", "consistency", "navigation", "scale", "assets", "evidence"] as const;
type Layer = (typeof LAYERS)[number];

const DOOR_WIDTH = { min: 0.6, max: 1.4 };
const WINDOW_WIDTH = { min: 0.4, max: 4 };
/** Same 1 cm coincidence used in architecture for wall graph; not a copy of Geometry Core internals. */
const PLACE_TOL = 0.01;

const WALK_PREFIXES = [
  "contract.schema",
  "geometry.graph",
  "geometry.room-polygon",
  "geometry.opening-inside",
  "geometry.opening-width",
  "geometry.opening-overlap",
  "consistency.entrance",
  "consistency.interior-door",
  "navigation.reachable",
  "navigation.start",
];

function check(
  checkId: string,
  layer: Layer,
  status: ReportCheck["status"],
  severity: ReportCheck["severity"],
  entities: string[],
  message: string,
): ReportCheck {
  return { checkId, layer, status, severity, entities, message };
}

function identity(input: unknown): { modelId: string; revision: number } {
  if (!input || typeof input !== "object") return { modelId: "unknown", revision: 0 };
  const rec = input as { id?: unknown; revision?: unknown };
  const id = IdSchema.safeParse(rec.id);
  const revision = RevisionSchema.safeParse(rec.revision);
  return {
    modelId: id.success ? id.data : "unknown",
    revision: revision.success ? revision.data : 0,
  };
}

function asPath(parts: readonly unknown[]): string | null {
  const joined = parts.map(String).join(".");
  return PathSchema.safeParse(joined).success ? joined : null;
}

function confirmationOf(model: FlatModel): number {
  const owners = listMetaOwners(model);
  let total = 0;
  let confirmed = 0;
  for (const owner of owners) {
    const metaPath = metaPathForOwner(owner);
    if (!metaPath) continue;
    const meta = readPath(model, metaPath);
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) continue;
    total += 1;
    const slot = meta as Meta;
    if (slot.reviewed === true || (typeof slot.confidence === "number" && slot.confidence >= 0.6)) {
      confirmed += 1;
    }
  }
  return total === 0 ? 0 : confirmed / total;
}

function wallLength(model: FlatModel, wallId: string): number | null {
  const wall = model.walls[wallId];
  if (!wall) return null;
  const a = model.vertices[wall.a];
  const b = model.vertices[wall.b];
  if (!a || !b) return null;
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function isInteriorPassableDoor(opening: FlatModel["openings"][string]): boolean {
  return opening.kind === "door" && opening.entrance !== true && opening.passable !== false;
}

function roomsOnWall(model: FlatModel, wallId: string): string[] {
  const ids: string[] = [];
  for (const roomId of Object.keys(model.rooms)) {
    try {
      wallSide(model, wallId, roomId);
      ids.push(roomId);
    } catch {
      continue;
    }
  }
  return ids;
}

function intervalsOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 - PLACE_TOL && b0 < a1 - PLACE_TOL;
}

function catchGeometry(run: () => void): GeometryError | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof GeometryError) return error;
    throw error;
  }
}

function walkReadyOf(checks: ReportCheck[]): boolean {
  const blocking = checks.filter(item => WALK_PREFIXES.some(prefix => item.checkId === prefix || item.checkId.startsWith(`${prefix}.`)));
  return blocking.length > 0 && blocking.every(item => item.status === "pass");
}

function sortChecks(checks: ReportCheck[]): ReportCheck[] {
  const layerRank = new Map(LAYERS.map((layer, i) => [layer, i]));
  return [...checks].sort((a, b) => {
    const layer = (layerRank.get(a.layer) ?? 99) - (layerRank.get(b.layer) ?? 99);
    return layer !== 0 ? layer : a.checkId.localeCompare(b.checkId);
  });
}

const PHOTO_CONFIDENCE_REVIEW = 0.6;

type ReviewItem = ValidationReport["review"]["items"][number];

function photoQuestion(meta: Meta): string | null {
  if (typeof meta.question !== "string") return null;
  const question = meta.question.trim();
  return question.length > 0 ? question : null;
}

function photoReviewReason(id: string, question: string | null, confidence: number | undefined): string {
  const low = typeof confidence === "number" && confidence < PHOTO_CONFIDENCE_REVIEW;
  if (low && question) {
    return `Photo ${id} match confidence is ${confidence} (below ${PHOTO_CONFIDENCE_REVIEW}). Question: ${question}`;
  }
  if (low) {
    return `Photo ${id} match confidence is ${confidence} (below ${PHOTO_CONFIDENCE_REVIEW}).`;
  }
  return `Photo ${id} needs review: ${question}`;
}

function photoReviewItems(model: FlatModel): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const id of Object.keys(model.assets).sort((a, b) => a.localeCompare(b))) {
    const asset = model.assets[id];
    if (!asset || asset.kind !== "photo") continue;
    const meta = asset.meta;
    if (meta.reviewed === true) continue;
    const question = photoQuestion(meta);
    const confidence = typeof meta.confidence === "number" ? meta.confidence : undefined;
    const low = confidence !== undefined && confidence < PHOTO_CONFIDENCE_REVIEW;
    if (!question && !low) continue;
    items.push({
      id: `photo_${id}`,
      path: `assets.${id}`,
      severity: "warning",
      reason: photoReviewReason(id, question, confidence),
      suggestion: "Confirm this photo placement as-is if it is correct.",
    });
  }
  return items;
}

function unverifiedLayers(): ReportCheck[] {
  return [
    check(
      "sources.files",
      "sources",
      "unverified",
      "warning",
      [],
      "План и исходные файлы объявления в этот вызов не передавались; читаемость файлов не проверена.",
    ),
    check(
      "scale.evidence",
      "scale",
      "unverified",
      "warning",
      [],
      "Потери векторизации и сверка масштаба с areaDeclared не выполнялись: нет diagnostics Parser и нет отдельного независимого обмера.",
    ),
    check(
      "assets.files",
      "assets",
      "unverified",
      "warning",
      [],
      "Наличие и читаемость файлов ассетов по url не проверялись.",
    ),
    check(
      "evidence.sources",
      "evidence",
      "unverified",
      "warning",
      [],
      "Соответствие источникам (confidence, assumed, question) не сверялось со страницей объявления.",
    ),
  ];
}

function clearanceCheck(avatar: AvatarProfile): ReportCheck {
  return check(
    "navigation.clearance",
    "navigation",
    "skipped",
    "info",
    [],
    `Проход ≥ 0.6 м с учётом радиуса аватара ${avatar.radius} м и коллизии внутри комнаты не проверялись. ` +
      "walkReady в этом срезе означает связность графа по проходимым дверям, полигоны комнат, допустимые проёмы и допустимый старт — не полную физическую проходимость.",
  );
}

function contractChecks(input: unknown): { model: FlatModel | null; checks: ReportCheck[] } {
  const parsed = validateFlatModel(input);
  if (parsed.success) {
    return {
      model: parsed.data,
      checks: [check("contract.schema", "contract", "pass", "error", [], "Модель проходит Contract 0.1, ссылки разрешаются.")],
    };
  }
  const entities = [
    ...new Set(
      parsed.error.issues
        .map(issue => asPath(issue.path))
        .filter((path): path is string => path !== null),
    ),
  ];
  const message = parsed.error.issues
    .slice(0, 5)
    .map(issue => `${issue.path.join(".") || "model"}: ${issue.message}`)
    .join("; ");
  return {
    model: null,
    checks: [check("contract.schema", "contract", "fail", "error", entities, message || "Модель не проходит Contract 0.1.")],
  };
}

function openingChecks(model: FlatModel): ReportCheck[] {
  const checks: ReportCheck[] = [];
  const insideFails: ReportCheck[] = [];
  const widthFails: ReportCheck[] = [];
  const byWall = new Map<string, string[]>();

  for (const [id, opening] of Object.entries(model.openings)) {
    const entity = `openings.${id}`;
    const length = wallLength(model, opening.wall);
    const list = byWall.get(opening.wall) ?? [];
    list.push(id);
    byWall.set(opening.wall, list);
    if (length === null) {
      insideFails.push(check(`geometry.opening-inside.${id}`, "geometry", "fail", "error", [entity], `Стена ${opening.wall} для проёма не найдена.`));
      continue;
    }
    if (opening.at < -PLACE_TOL || opening.at + opening.width > length + PLACE_TOL) {
      insideFails.push(
        check(
          `geometry.opening-inside.${id}`,
          "geometry",
          "fail",
          "error",
          [entity, `walls.${opening.wall}`],
          `Проём ${id} выходит за концы стены ${opening.wall}: at=${opening.at.toFixed(3)}, width=${opening.width.toFixed(3)}, длина стены ${length.toFixed(3)} м.`,
        ),
      );
    }
    const range = opening.kind === "door" ? DOOR_WIDTH : WINDOW_WIDTH;
    const label = opening.kind === "door" ? "двери" : "окна";
    if (opening.width < range.min - PLACE_TOL || opening.width > range.max + PLACE_TOL) {
      widthFails.push(
        check(
          `geometry.opening-width.${id}`,
          "geometry",
          "fail",
          "error",
          [entity],
          `Ширина ${label} ${id} = ${opening.width.toFixed(3)} м вне допуска ${range.min}–${range.max} м.`,
        ),
      );
    }
  }

  checks.push(
    ...(insideFails.length
      ? insideFails
      : [check("geometry.opening-inside", "geometry", "pass", "error", Object.keys(model.openings).map(id => `openings.${id}`), "Все проёмы лежат на своих стенах.")]),
  );
  checks.push(
    ...(widthFails.length
      ? widthFails
      : [check("geometry.opening-width", "geometry", "pass", "error", Object.keys(model.openings).map(id => `openings.${id}`), `Ширины дверей ${DOOR_WIDTH.min}–${DOOR_WIDTH.max} м и окон ${WINDOW_WIDTH.min}–${WINDOW_WIDTH.max} м.`)]),
  );

  const overlapFails: ReportCheck[] = [];
  for (const [wallId, ids] of byWall) {
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length; i += 1) {
      const a = model.openings[ids[i]!];
      if (!a) continue;
      for (let j = i + 1; j < ids.length; j += 1) {
        const b = model.openings[ids[j]!];
        if (!b) continue;
        if (intervalsOverlap(a.at, a.at + a.width, b.at, b.at + b.width)) {
          overlapFails.push(
            check(
              `geometry.opening-overlap.${wallId}`,
              "geometry",
              "fail",
              "error",
              [`openings.${ids[i]}`, `openings.${ids[j]}`, `walls.${wallId}`],
              `Проёмы ${ids[i]} и ${ids[j]} пересекаются на стене ${wallId}.`,
            ),
          );
        }
      }
    }
  }
  checks.push(
    overlapFails.length
      ? overlapFails[0]!
      : check("geometry.opening-overlap", "geometry", "pass", "error", [], "Проёмы одной стены не пересекаются."),
  );
  return checks;
}

function polygonChecks(model: FlatModel): ReportCheck[] {
  const fails: ReportCheck[] = [];
  for (const id of Object.keys(model.rooms)) {
    let polygon: ReturnType<typeof roomPolygon>;
    try {
      polygon = roomPolygon(model, id);
    } catch (error) {
      const geo = error instanceof GeometryError ? error : null;
      fails.push(
        check(
          `geometry.room-polygon.${id}`,
          "geometry",
          "fail",
          "error",
          geo?.entities.length ? geo.entities : [`rooms.${id}`],
          geo ? `${geo.code}: ${geo.message}` : `Не удалось вычислить полигон комнаты ${id}.`,
        ),
      );
      continue;
    }
    if (!polygon) {
      fails.push(
        check(
          `geometry.room-polygon.${id}`,
          "geometry",
          "fail",
          "error",
          [`rooms.${id}`],
          `У комнаты ${id} нет полигона: якорь на стене, снаружи грани или грань не сопоставлена.`,
        ),
      );
    }
  }
  if (fails.length) return fails;
  return [
    check(
      "geometry.room-polygon",
      "geometry",
      "pass",
      "error",
      Object.keys(model.rooms).map(id => `rooms.${id}`),
      "У каждой комнаты есть полигон грани.",
    ),
  ];
}

function consistencyChecks(model: FlatModel): { checks: ReportCheck[]; review: ValidationReport["review"]["items"] } {
  const checks: ReportCheck[] = [];
  const review: ValidationReport["review"]["items"] = [];
  const entrances = Object.entries(model.openings).filter(([, opening]) => opening.kind === "door" && opening.entrance === true);

  if (entrances.length !== 1) {
    checks.push(
      check(
        "consistency.entrance",
        "consistency",
        "fail",
        "error",
        entrances.map(([id]) => `openings.${id}`),
        entrances.length === 0
          ? "Допустимый вход не задан: нет двери с entrance=true."
          : `Вход должен быть ровно один, найдено ${entrances.length}.`,
      ),
    );
  } else {
    const [id, opening] = entrances[0]!;
    const wall = model.walls[opening.wall];
    if (!wall?.exterior) {
      checks.push(
        check(
          "consistency.entrance",
          "consistency",
          "fail",
          "error",
          [`openings.${id}`],
          `Вход ${id} должен стоять на внешней стене.`,
        ),
      );
    } else {
      const beside = roomsOnWall(model, opening.wall);
      if (beside.length !== 1) {
        checks.push(
          check(
            "consistency.entrance",
            "consistency",
            "fail",
            "error",
            [`openings.${id}`, ...beside.map(roomId => `rooms.${roomId}`)],
            `Вход ${id} должен граничить ровно с одной комнатой, найдено ${beside.length}.`,
          ),
        );
      } else {
        checks.push(check("consistency.entrance", "consistency", "pass", "error", [`openings.${id}`], `Единственный вход: ${id}.`));
      }
    }
  }

  for (const [id, opening] of Object.entries(model.openings)) {
    if (opening.kind !== "door") continue;
    const wall = model.walls[opening.wall];
    if (!wall?.exterior || opening.entrance === true || opening.passable === false) continue;
    checks.push(
      check(
        `consistency.exterior-door-unmarked.${id}`,
        "consistency",
        "fail",
        "warning",
        [`openings.${id}`],
        `Наружная дверь ${id} не помечена как вход и не запрещена (passable:false). Нужно выбрать назначение.`,
      ),
    );
    review.push({
      id: `unmarked_${id}`,
      path: `openings.${id}`,
      severity: "warning",
      reason: `Наружная дверь ${id} без entrance=true и без passable:false.`,
      suggestion: "Пометьте единственный вход или запретите проход (passable:false).",
    });
  }

  const edges = adjacency(model);
  const connected = new Set(edges.map(edge => edge.opening));
  const interiorFails: ReportCheck[] = [];
  for (const [id, opening] of Object.entries(model.openings)) {
    if (!isInteriorPassableDoor(opening)) continue;
    if (model.walls[opening.wall]?.exterior) continue;
    if (!connected.has(id)) {
      interiorFails.push(
        check(
          `consistency.interior-door.${id}`,
          "consistency",
          "fail",
          "error",
          [`openings.${id}`],
          `Проходимая дверь ${id} не соединяет две смежные комнаты по графу Geometry Core.`,
        ),
      );
    }
  }
  checks.push(
    ...(interiorFails.length
      ? interiorFails
      : [check("consistency.interior-door", "consistency", "pass", "error", [...connected].map(id => `openings.${id}`), "Внутренние проходимые двери совпадают с adjacency.")]),
  );

  return { checks, review };
}

function navigationChecks(model: FlatModel, entranceRoom: string | null): ReportCheck[] {
  const checks: ReportCheck[] = [];
  const roomIds = Object.keys(model.rooms);
  if (!entranceRoom) {
    checks.push(
      ...roomIds.map(id =>
        check(
          `navigation.reachable.${id}`,
          "navigation",
          "skipped",
          "error",
          [`rooms.${id}`],
          "Достижимость не считалась: нет единственного допустимого входа.",
        ),
      ),
    );
  } else {
    const fails: ReportCheck[] = [];
    for (const id of roomIds) {
      const route = roomPath(model, entranceRoom, id);
      if (!route) {
        fails.push(
          check(
            `navigation.reachable.${id}`,
            "navigation",
            "fail",
            "error",
            [`rooms.${id}`],
            `Комната ${id} недостижима от входа по проходимым дверям. Это связность графа, не ширина прохода.`,
          ),
        );
      }
    }
    checks.push(
      ...(fails.length
        ? fails
        : [check("navigation.reachable", "navigation", "pass", "error", roomIds.map(id => `rooms.${id}`), `Все комнаты достижимы от ${entranceRoom} по проходимым дверям.`)]),
    );
  }

  const startError = catchGeometry(() => {
    startPoint(model);
  });
  if (startError) {
    checks.push(
      check(
        "navigation.start",
        "navigation",
        "fail",
        "error",
        startError.entities,
        `Стартовая точка недопустима (${startError.code}): ${startError.message}`,
      ),
    );
  } else {
    checks.push(check("navigation.start", "navigation", "pass", "error", [], "Старт 1 м внутрь от входа лежит в комнате и не на коллизии стены."));
  }
  return checks;
}

function fallbackReport(input: unknown, error: unknown): ValidationReport {
  const { modelId, revision } = identity(input);
  return ValidationReportSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    modelId,
    revision,
    walkReady: false,
    confirmation: 0,
    checks: [
      check(
        "contract.schema",
        "contract",
        "fail",
        "error",
        [],
        error instanceof Error ? error.message : "Неожиданная ошибка Validator.",
      ),
      ...unverifiedLayers(),
    ],
    review: { items: [] },
  });
}

export function validate(input: unknown, avatar: AvatarProfile = DEFAULT_AVATAR): ValidationReport {
  try {
    const { modelId, revision } = identity(input);
    const { model, checks: contract } = contractChecks(input);
    const checks: ReportCheck[] = [...unverifiedLayers(), ...contract];

    if (!model) {
      checks.push(
        check("geometry.graph", "geometry", "skipped", "error", [], "Геометрия не считалась из-за ошибки Contract."),
        check("consistency.entrance", "consistency", "skipped", "error", [], "Согласованность не считалась из-за ошибки Contract."),
        check("navigation.start", "navigation", "skipped", "error", [], "Навигация не считалась из-за ошибки Contract."),
        clearanceCheck(avatar),
      );
      return ValidationReportSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        modelId,
        revision,
        walkReady: false,
        confirmation: 0,
        checks: sortChecks(checks),
        review: { items: [] },
      });
    }

    const graphError = catchGeometry(() => {
      faces(model);
    });
    if (graphError) {
      checks.push(
        check(
          "geometry.graph",
          "geometry",
          "fail",
          "error",
          graphError.entities,
          `Geometry Core: ${graphError.code}. ${graphError.message}`,
        ),
        check("geometry.room-polygon", "geometry", "skipped", "error", [], "Полигоны не считались: граф стен не построен."),
        check("consistency.entrance", "consistency", "skipped", "error", [], "Согласованность не считалась: граф стен не построен."),
        check("navigation.start", "navigation", "skipped", "error", [], "Навигация не считалась: граф стен не построен."),
        ...openingChecks(model),
        clearanceCheck(avatar),
      );
      return ValidationReportSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        modelId: model.id,
        revision: model.revision,
        walkReady: false,
        confirmation: confirmationOf(model),
        checks: sortChecks(checks),
        review: { items: [] },
      });
    }

    checks.push(check("geometry.graph", "geometry", "pass", "error", [], "Граф стен планарный, Geometry Core построил грани."));
    checks.push(...openingChecks(model));
    checks.push(...polygonChecks(model));

    const consistency = consistencyChecks(model);
    checks.push(...consistency.checks);

    const entrance = Object.entries(model.openings).find(([, opening]) => opening.kind === "door" && opening.entrance === true);
    const entranceRooms = entrance ? roomsOnWall(model, entrance[1].wall) : [];
    const entranceRoom = entranceRooms.length === 1 ? entranceRooms[0]! : null;
    checks.push(...navigationChecks(model, entranceRoom));
    checks.push(clearanceCheck(avatar));

    const sorted = sortChecks(checks);
    return ValidationReportSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      modelId: model.id,
      revision: model.revision,
      walkReady: walkReadyOf(sorted),
      confirmation: confirmationOf(model),
      checks: sorted,
      review: { items: [...consistency.review, ...photoReviewItems(model)] },
    });
  } catch (error) {
    return fallbackReport(input, error);
  }
}
