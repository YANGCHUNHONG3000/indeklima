# Changelog — Indeklima v2.5.2

**Dato:** 2026-06-26
**Type:** Patch — robusthed, hastighed, UI-fix, tests

---

## Backend (`__init__.py`)

### Robusthed
- **Per-rum exception isolation** (`_process_room`): Hvert rum behandles nu i sin egen metode omgivet af `try/except`. En fejlende sensor i ét rum afbryder ikke længere hele opdateringscyklussen — rummet skippes med en warning i loggen.
- **Korrekt tidshåndtering**: `datetime.now()` og `datetime.utcnow()` erstattet med `dt_util.now()` og `dt_util.utcnow()` alle tre steder (sæson, natperiode-tjek, trend-historik). Sikrer korrekthed ved tidszoneændringer.

### Hastighed / kode-kvalitet
- **Class-level lookup tables**: `_MOLD_SCORE`, `_MOLD_FROM_SCORE`, `_DEHUM_SCORE`, `_DEHUM_FROM_SCORE` er nu class-attributter — defineres én gang ved klasseinitialisering i stedet for ved hvert 30s-kald.
- **`_process_room()` refaktorering**: Sensor-indsamling samlet i én loop over en tuple frem for 6 næsten-identiske blokke.
- **Type hints**: Alle list-variabler i `_async_do_update()` har nu eksplicitte type hints.
- **`_avg()` helper**: Eliminerer gentaget `sum(x)/len(x)` pattern i global-average-beregning.

## Frontend (`indeklima-panel.js`)

### Encoding-fix (kritisk)
- Alle brækkede emoji og danske tegn erstattet med korrekte JS Unicode-escapes. Panelet viste hidtil `ð¡ï¸` i stedet for 🌡️, `ð§` i stedet for 💧 osv. Berørte metoder: `_trendIcon`, `_circIcon`, `_ventIcon`, `_dehumIcon`, `_moldIcon`, `_fmt`.

### Logik-fix
- **Temperatur-trend**: Viste `trends.humidity` som pil på temperatur-kortet — rettet til `showTrend: false` (ingen pil for temperatur).
- **`_ventExpanded` reset**: Lukkes automatisk ved tab-skift — forhindrer at udluftnings-accordionen sidder åben ved tab-skift.
- **Sparkline minimumsgrænse**: Hævet fra 2 til 5 datapunkter — eliminerer meningsløse 2-punkt-grafer lige efter opstart.

### Øvrige
- Version-fallback opdateret fra `"2.5.11"` til `"2.5.2"`.

## Tests

### Ny fil: `tests/test_coordinator.py`
37 nye tests der dækker hidtil utestet kode:
- `TestCalculateMoldRisk` (10 tests): tærskler, temperatur-range, `None`-håndtering, custom tærskler
- `TestCalculateDehumidifierRecommendation` (9 tests): nat-suppression, mold-niveauer, humidity-tærskel, vindues-logik
- `TestProcessRoom` (12 tests): sensor-indsamling, gennemsnit, mold fallback, vinduer/døre, dehumidifier, legacy string-format, `None` entity_id
- `TestAsyncDoUpdate` (6 tests): tom rum-liste, exception isolation, global mold worst-room, cirkulationsbonus, global dehumidifier worst-room

### Rettede tests: `tests/test_const.py`
- `test_version_value`: opdateret til `"2.5.2"`
- `test_empty_string`: rettet assertion til `"unknown"` (matcher faktisk adfærd i `normalize_room_id`)

## Versioner
- `const.py` `__version__`: `2.5.2`
- `manifest.json` `version`: `2.5.2`
