"""Разбор задания на русском языке в структурированную спецификацию.

Основной разбор — детерминированный, по словарю формулировок: он бесплатный,
мгновенный, работает без интернета и всегда даёт одинаковый результат.
Фрагменты, которые не удалось понять, возвращаются отдельно, чтобы интерфейс
честно показал их пользователю, а не молча проигнорировал.

Необязательный локальный LLM (Ollama) может дополнить разбор непонятых
фрагментов — см. llm_assist(); фотографии ему не передаются, только текст.
"""
from __future__ import annotations

import json
import re
import urllib.request
from dataclasses import dataclass, field

COLORS = {
    "темно-син": "navy blue", "темно син": "navy blue", "черн": "black", "бел": "white",
    "син": "blue", "красн": "red", "зелен": "green", "сер": "gray", "бордов": "burgundy",
    "бежев": "beige", "голуб": "light blue", "розов": "pink", "желт": "yellow",
    "коричнев": "brown", "золот": "gold", "серебр": "silver", "фиолетов": "purple", "оранжев": "orange",
}
GARMENTS = [
    (r"выпускн\w*\s+мант|мант\w*\s+выпускн", "graduation gown (academic robe)"),
    (r"мант", "academic graduation gown"),
    (r"конфедератк|выпускн\w*\s+шапочк|академическ\w*\s+шапочк", "graduation cap (mortarboard)"),
    (r"школьн\w*\s+форм", "school uniform"),
    (r"деловой\s+костюм|классическ\w*\s+костюм", "formal business suit"),
    (r"костюм", "suit"),
    (r"пиджак|жакет", "blazer"),
    (r"рубашк|сорочк", "shirt"),
    (r"блузк", "blouse"),
    (r"вечерн\w*\s+плать", "evening dress"),
    (r"плать", "dress"),
    (r"футболк", "t-shirt"),
    (r"свитер|джемпер", "sweater"),
    (r"водолазк", "turtleneck"),
    (r"куртк", "jacket"),
    (r"пальто", "coat"),
    (r"жилет", "vest"),
    (r"галстук", "necktie"),
    (r"бабочк", "bow tie"),
    (r"юбк", "skirt"),
    (r"брюк", "trousers"),
    (r"форм[уаы]\b", "uniform"),
]
MATERIALS = {"атлас": "satin", "шелк": "silk", "бархат": "velvet", "кожан": "leather",
             "джинс": "denim", "шерст": "wool", "хлопк": "cotton", "льнян": "linen"}

FORMATS = {"jpg": "jpeg", "jpeg": "jpeg", "джипег": "jpeg", "png": "png", "пнг": "png",
           "tif": "tiff", "tiff": "tiff", "тифф": "tiff", "webp": "webp"}

BG_COLORS = {"бел": "white", "черн": "black", "сер": "gray", "светло-сер": "light_gray",
             "син": "blue", "бежев": "beige"}


@dataclass
class TaskSpec:
    text: str
    ops: dict[str, dict] = field(default_factory=dict)  # id операции -> параметры
    preserve: dict[str, bool] = field(default_factory=lambda: {
        "face": True, "hair": True, "pose": True, "hands": True, "composition": True})
    export: dict = field(default_factory=lambda: {"format": "", "resolution": "original", "transparent": False,
                                                  "quality": 95})
    understood: list[str] = field(default_factory=list)  # что понято (по-русски)
    unrecognized: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"text": self.text, "ops": self.ops, "preserve": self.preserve, "export": self.export,
                "understood": self.understood, "unrecognized": self.unrecognized, "notes": self.notes}

    @staticmethod
    def from_dict(d: dict) -> "TaskSpec":
        s = TaskSpec(text=d.get("text", ""))
        s.ops = dict(d.get("ops", {}))
        s.preserve.update(d.get("preserve", {}))
        s.export.update(d.get("export", {}))
        s.understood = list(d.get("understood", []))
        s.unrecognized = list(d.get("unrecognized", []))
        s.notes = list(d.get("notes", []))
        return s


def normalize(text: str) -> str:
    t = text.lower().replace("ё", "е")
    t = re.sub(r"[«»\"“”]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def split_clauses(text: str) -> list[str]:
    parts = re.split(r"[.;!?\n]+|,\s*(?=[а-я])|\s+и\s+(?=(?:затем|потом|после|ещ)?\s*[а-я]+(?:и|й|те|ть|ай|уй|ни|ди|ри|ви|ли|си|ми|зи|ци)\b)", text)
    return [p.strip(" ,") for p in parts if p and p.strip(" ,")]


def _has(pattern: str, t: str) -> bool:
    return re.search(pattern, t) is not None


def _color_in(t: str) -> str | None:
    for k, v in COLORS.items():
        if re.search(r"\b" + k, t):
            return v
    return None


def clothes_prompt(clause: str) -> tuple[str, bool]:
    """Английское описание одежды для модели редактирования. Второе значение — найден ли предмет одежды."""
    t = normalize(clause)
    items = []
    for pat, en in GARMENTS:
        m = re.search(pat, t)
        if m:
            # цвет ищем в 3 словах перед названием одежды
            before = t[max(0, m.start() - 40):m.start()]
            color = _color_in(before) or ""
            mat = next((v for k, v in MATERIALS.items() if k in before), "")
            desc = " ".join(x for x in (color, mat, en) if x)
            if not any(en in it for it in items):
                items.append(desc)
            t = t[:m.start()] + " " * (m.end() - m.start()) + t[m.end():]
    if not items:
        return clause, False
    return ", ".join(items), True


RULES: list[tuple[str, str]] = []  # заполняется ниже для документации


def interpret(text: str) -> TaskSpec:
    spec = TaskSpec(text=text.strip())
    clauses = split_clauses(normalize(text))
    prev = ""
    for c in clauses:
        hit = _apply_rules(c, spec)
        if not hit and prev:
            # Продолжение перечисления: «сохрани лицо, причёску, позу» — глагол в предыдущей части
            hit = _apply_rules(prev + ", " + c, spec)
            if hit:
                prev = prev + ", " + c
                continue
        if not hit:
            spec.unrecognized.append(c)
        prev = c
    _finalize(spec)
    return spec


def _set(spec: TaskSpec, op: str, understood: str, **params) -> None:
    spec.ops.setdefault(op, {}).update(params)
    if understood not in spec.understood:
        spec.understood.append(understood)


def _apply_rules(c: str, spec: TaskSpec) -> bool:
    hit = False
    # --- удаление фона / хромакей
    if (_has(r"(удал|убер|убра|выре[зж]|отдел|сотр|стер)\w*.{0,25}фон", c) or _has(r"без фона|хромаке|прозрачн\w* фон|кеинг|кеи", c)
            or _has(r"выре[зж]\w* (человек|ребенк|объект|фигур|модел)", c)):
        params = {}
        if _has(r"зелен", c):
            params["screen"] = "green"
            params["method"] = "chroma"
        elif _has(r"\bсин\w* фон|синего|синий", c):
            params["screen"] = "blue"
            params["method"] = "chroma"
        _set(spec, "remove_background", "Удалить фон" + (" (хромакей)" if params.get("method") == "chroma" else ""), **params)
        if _has(r"прозрачн", c):
            spec.export["transparent"] = True
            spec.export["format"] = spec.export["format"] or "png"
        hit = True
    if _has(r"прозрачн\w*", c) and not hit:
        spec.export["transparent"] = True
        spec.export["format"] = "png"
        _set(spec, "remove_background", "Удалить фон (прозрачный PNG)")
        hit = True
    # --- волосы и ореол
    if _has(r"волос|прич[её]с|пряд", c) and not _has(r"сохран", c):
        spec.ops.setdefault("remove_background", {}).update(ai_assist=True, hair=True)
        spec.understood.append("Аккуратная обработка волос")
        hit = True
    if _has(r"ореол|кайм|окантовк|зелен\w* (край|кромк|отсвет|оттенок по краю)|засвет\w* зелен", c):
        spec.ops.setdefault("remove_background", {}).update(despill=0.9)
        spec.understood.append("Убрать цветной ореол по краям")
        hit = True
    # --- новый фон / интерьер
    m_color_bg = re.search(r"(?:на|сделай|замени\w*.{0,10}на)\s+(светло-сер|бел|черн|сер|син|бежев)\w*\s+фон", c)
    if m_color_bg:
        key = m_color_bg.group(1)
        _set(spec, "replace_background", "Однотонный фон: " + BG_COLORS[key], color=BG_COLORS[key])
        spec.ops.setdefault("remove_background", {})
        hit = True
    elif (_has(r"(замен|помест|перенес|постав|посад|вставь|встав|налож|размест|добав)\w*.{0,40}(фон|интерьер|локац|сцен|комнат|зал|студи|помещен|пейзаж|кабинет|класс)", c)
          or _has(r"(в|на) (предоставленн|загруженн|приложенн|данн|этот|мой|наш)\w* (интерьер|фон|локац|зал|помещен)", c)
          or _has(r"нов\w* фон", c)):
        _set(spec, "replace_background", "Перенести на загруженный фон/интерьер")
        spec.ops.setdefault("remove_background", {})
        hit = True
    if _has(r"(соглас|подстро|подгон|совмест|сочета|выровн|адаптир)\w*.{0,30}(свет|освещ|цвет|тон|оттен)", c):
        spec.ops.setdefault("replace_background", {})["harmonize"] = 0.7
        spec.understood.append("Согласовать свет и цвет с фоном")
        hit = True
    if _has(r"\bтен[ьи]\b|тень под|контактн\w* тен", c) and not _has(r"(убер|удал)\w*.{0,10}тен", c):
        spec.ops.setdefault("replace_background", {})["shadow"] = 0.35
        spec.understood.append("Добавить мягкую тень")
        hit = True
    if _has(r"(размо|размыт|размыв|боке)\w*.{0,15}фон|фон.{0,15}(размыт|размыть|боке)", c):
        spec.ops.setdefault("replace_background", {})["bg_blur"] = 4.0
        spec.understood.append("Размыть фон")
        hit = True
    # --- одежда (ИИ-редактирование)
    if _has(r"переод|одень|наден|смени\w*.{0,15}одежд|замени\w*.{0,15}(одежд|костюм|плать|рубашк|наряд)|одежд\w* на|наряд", c):
        prompt, found = clothes_prompt(c)
        params = {"prompt_ru": c, "prompt": prompt}
        _set(spec, "change_clothes", "Заменить одежду: " + (prompt if found else c), **params)
        if not found:
            spec.notes.append("Не удалось точно распознать предмет одежды — модель получит описание как есть.")
        hit = True
    # --- сохранение
    if _has(r"сохран|не (меня|трога|измен)|остав", c):
        local = False
        for key, pat in (("face", r"лиц|черт|внешн|личн|возраст"), ("hair", r"прич[её]с|волос"),
                         ("pose", r"поз[ау]?\b|поз[уы]|положени"), ("hands", r"рук|пальц|кист"),
                         ("composition", r"композиц|кадрир")):
            if _has(pat, c):
                spec.preserve[key] = True
                local = True
        if _has(r"исходн\w* (разрешен|размер)|оригинальн\w* (разрешен|размер)|разрешени\w* (оригинал|исходн)|прежн\w* (разрешен|размер)", c):
            spec.export["resolution"] = "original"
            spec.understood.append("Сохранить исходное разрешение")
            local = True
        if local:
            if any(spec.preserve.values()):
                spec.understood.append("Сохранить лицо, причёску, позу и руки")
            hit = True
    # --- цвет и тон
    if _has(r"баланс\w* белого|цветов\w* температур|(убер|убра|исправ)\w*.{0,20}(желт|син|зелен|красн)\w*.{0,10}(оттен|цвет)|(желтизн|синев)", c):
        _set(spec, "white_balance", "Баланс белого")
        hit = True
    if _has(r"тепл(ее|ый|ые|ого)", c):
        _set(spec, "white_balance", "Сделать теплее", temperature=0.5)
        hit = True
    if _has(r"холодн(ее|ый|ые|ого)", c):
        _set(spec, "white_balance", "Сделать холоднее", temperature=-0.5)
        hit = True
    if _has(r"экспозиц|яркост|светле|осветл|темне|затемн|пересвет|недосвет|темн\w* фото|темн\w* кадр", c):
        p = {}
        if _has(r"светле|осветл|недосвет|темн\w* (фото|кадр)", c):
            p["exposure"] = 0.3
        if _has(r"темне|затемн|пересвет", c):
            p["exposure"] = -0.3
        _set(spec, "exposure_contrast", "Экспозиция", **p)
        hit = True
    if _has(r"контраст", c):
        p = {"contrast": -0.3 if _has(r"(уменьш|сниз|мягч)\w*.{0,10}контраст|контраст\w*.{0,10}(уменьш|сниз)", c) else 0.25}
        _set(spec, "exposure_contrast", "Контраст", **p)
        hit = True
    if _has(r"цветокор|коррекц\w* цвет|(исправ|поправ|выровн|улучш)\w*.{0,15}(цвет|тон)", c) and not _has(r"кож", c):
        _set(spec, "white_balance", "Цветокоррекция")
        _set(spec, "exposure_contrast", "Цветокоррекция")
        hit = True
    if _has(r"насыщ|сочн|ярче цвет|цвет\w* ярче|приглуш", c):
        _set(spec, "saturation", "Насыщенность", amount=-0.4 if _has(r"приглуш|уменьш|сниз", c) else 0.4)
        hit = True
    # --- кожа и ретушь
    if _has(r"кож", c) and _has(r"цвет|тон|оттен|естеств|румян|покрасн", c):
        _set(spec, "skin_tone", "Естественный цвет кожи")
        hit = True
    if _has(r"прыщ|дефект|пятн|покраснен|высыпан|ретуш|недостат|пылинк|точк\w* на кож", c):
        _set(spec, "blemishes", "Убрать мелкие дефекты кожи")
        hit = True
    # --- улучшение
    if _has(r"шум|зерн", c):
        _set(spec, "denoise", "Шумоподавление", force=True)
        hit = True
    if _has(r"артефакт", c):
        _set(spec, "denoise", "Убрать артефакты сжатия", force=True, strength=0.7)
        hit = True
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:раз|x|х)\b|в (два|три|четыре) раза|\bx(\d)\b", c)
    if _has(r"(увелич|повыс|подним|улучш)\w*.{0,20}(разрешен|размер|качеств)|апскейл|upscale|\b4k\b|\b8k\b", c) and not _has(r"исходн|оригинал|прежн", c):
        p: dict = {"factor": 2.0}
        if m:
            num = m.group(1) or m.group(2) or m.group(3)
            p["factor"] = float({"два": 2, "три": 3, "четыре": 4}.get(num, str(num).replace(",", ".")))
        if _has(r"\b4k\b", c):
            p = {"long_side": 3840}
        if _has(r"\b8k\b", c):
            p = {"long_side": 7680}
        mpx = re.search(r"до (\d{3,5})\s*(?:px|пикс|точек)", c)
        if mpx:
            p = {"long_side": int(mpx.group(1))}
        _set(spec, "upscale", "Увеличить разрешение", **p)
        spec.export["resolution"] = "as_processed"
        hit = True
    if _has(r"резкост|четкост|четче|резче", c):
        _set(spec, "sharpen", "Повысить резкость", amount=0.5)
        hit = True
    # --- формат
    for word, fmt in FORMATS.items():
        if re.search(r"\b" + word + r"\b", c):
            spec.export["format"] = fmt
            spec.understood.append(f"Формат {fmt.upper()}")
            hit = True
            break
    if _has(r"16[ -]?бит", c):
        spec.export["bit_depth"] = 16
        hit = True
    if _has(r"(сохран|экспорт|выгруз)\w*", c) and not hit:
        # «сохрани фотографии» без деталей — это не ошибка разбора
        hit = True
    return hit


def _finalize(spec: TaskSpec) -> None:
    if not spec.export["format"]:
        spec.export["format"] = "png" if spec.export["transparent"] else "jpeg"
    if spec.export["transparent"] and spec.export["format"] in ("jpeg",):
        spec.notes.append("JPEG не поддерживает прозрачность — результат будет сохранён в PNG.")
        spec.export["format"] = "png"
    if "replace_background" in spec.ops:
        spec.export["transparent"] = False
    seen = set()
    spec.understood = [u for u in spec.understood if not (u in seen or seen.add(u))]


# ---------------------------------------------------------------- необязательный LLM

LLM_SCHEMA_HINT = """Ты помогаешь разобрать задание на обработку фото. Верни ТОЛЬКО JSON:
{"ops": {"<id>": {параметры}}, "understood": ["..."]}
Допустимые id: remove_background, replace_background, change_clothes{prompt: английское описание одежды},
white_balance{temperature:-1..1}, exposure_contrast{exposure:-1..1, contrast:-1..1}, skin_tone, blemishes,
denoise, upscale{factor}, sharpen, saturation{amount:-1..1}. Ничего не выдумывай."""


def llm_assist(spec: TaskSpec, ollama_url: str, model: str, timeout: float = 60.0) -> TaskSpec:
    """Дополняет разбор непонятых фрагментов локальной моделью Ollama (если она установлена)."""
    if not spec.unrecognized or not model:
        return spec
    body = json.dumps({
        "model": model, "stream": False, "format": "json",
        "messages": [{"role": "system", "content": LLM_SCHEMA_HINT},
                     {"role": "user", "content": "; ".join(spec.unrecognized)}],
        "options": {"temperature": 0},
    }).encode()
    req = urllib.request.Request(ollama_url.rstrip("/") + "/api/chat", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        content = json.loads(r.read())["message"]["content"]
    data = json.loads(content)
    from .ops import OPERATIONS  # локальный импорт, чтобы не тянуть numpy в разбор текста
    added = []
    for op, params in (data.get("ops") or {}).items():
        if op in OPERATIONS and isinstance(params, dict):
            spec.ops.setdefault(op, {}).update(params)
            added.append(op)
    if added:
        spec.understood += [f"(локальная модель) {u}" for u in data.get("understood", [])][:5]
        spec.notes.append("Часть задания разобрана локальной языковой моделью — проверьте план.")
        spec.unrecognized = []
    _finalize(spec)
    return spec
