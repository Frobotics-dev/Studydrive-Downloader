# StudyDrive Blob Image Downloader

Eine Chrome Extension (Manifest V3), die automatisch alle sichtbaren Bilder mit Blob-URLs von StudyDrive.net herunterlädt.

## Features

- ✅ Automatisches Sammeln von Blob-URLs aus:
  - `<img>` Elementen (src und currentSrc)
  - CSS `background-image` Eigenschaften
  - `<source>` Elementen (für `<picture>` Tags)
- ✅ Deduplizierung von Blob-URLs
- ✅ Parallele Downloads (max. 3 gleichzeitig)
- ✅ Automatische Dateinamen mit korrekter Endung basierend auf MIME-Type
- ✅ Optional: Auto-Scroll für lazy-loaded Bilder
- ✅ MutationObserver für dynamisch geladene Inhalte

## Installation

### Schritt 1: Extension-Dateien vorbereiten

Stelle sicher, dass alle Dateien im gleichen Ordner liegen:
- `manifest.json`
- `background.js`
- `content.js`
- `options.html`
- `options.js`
- `icon16.png`, `icon48.png`, `icon128.png` (optional, für Icons)

### Schritt 2: Extension in Chrome laden

1. Öffne Chrome und navigiere zu `chrome://extensions/`
2. Aktiviere den **Developer Mode** (Entwicklermodus) oben rechts
3. Klicke auf **"Load unpacked"** (Entpackt laden)
4. Wähle den Ordner aus, in dem sich die Extension-Dateien befinden
5. Die Extension sollte nun in der Liste erscheinen

### Schritt 3: Extension verwenden

1. Navigiere zu einer StudyDrive-Seite (z.B. `https://www.studydrive.net/...`)
2. Die Extension sammelt automatisch alle sichtbaren Blob-Bilder
3. Klicke auf das Extension-Icon, um die Einstellungen zu öffnen:
   - **Auto-Scroll aktivieren**: Scrollt automatisch bis ans Ende der Seite
   - **Sammlung jetzt starten**: Startet die Sammlung manuell
   - **Auto-Scroll jetzt starten/stoppen**: Steuert das Auto-Scrolling

## Technische Details

### Permissions

- `downloads`: Zum Herunterladen der Bilder
- `storage`: Zum Speichern der Einstellungen
- `scripting`: Zum Injizieren des Content Scripts
- `https://www.studydrive.net/*`: Host Permission für StudyDrive

### Funktionsweise

1. **Content Script** (`content.js`):
   - Wird automatisch auf StudyDrive-Seiten geladen
   - Sammelt Blob-URLs aus verschiedenen Quellen
   - Konvertiert Blobs zu ArrayBuffers
   - Sendet Daten an den Service Worker

2. **Service Worker** (`background.js`):
   - Empfängt Download-Anfragen
   - Verwaltet eine Download-Queue
   - Begrenzt parallele Downloads auf 3
   - Dedupliziert bereits heruntergeladene URLs

3. **Options Page** (`options.html/js`):
   - Konfiguration der Extension
   - Manuelle Steuerung der Sammlung
   - Auto-Scroll Einstellungen

## Dateistruktur

```
studydrive/
├── manifest.json      # Extension Manifest (Manifest V3)
├── background.js      # Service Worker für Downloads
├── content.js         # Content Script zum Sammeln von Blob-URLs
├── options.html       # Options Page UI
├── options.js         # Options Page Logik
└── README.md          # Diese Datei
```

## Hinweise

- Die Extension lädt nur Bilder, die bereits sichtbar sind
- Für lazy-loaded Bilder: Aktiviere Auto-Scroll oder scrolle manuell
- Downloads werden im Standard-Download-Ordner gespeichert
- Dateinamen enthalten Timestamp und Hash für Eindeutigkeit

## Fehlerbehebung

- **Extension lädt keine Bilder**: Stelle sicher, dass du auf einer StudyDrive-Seite bist
- **Keine Blob-URLs gefunden**: Scrolle durch die Seite, um lazy-loaded Bilder zu laden
- **Downloads funktionieren nicht**: Prüfe die Chrome-Download-Einstellungen
