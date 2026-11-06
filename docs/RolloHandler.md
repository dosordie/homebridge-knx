# Rollo-Händler (`RolloHandler`)

Allgemeiner Handler für `WindowCovering` mit absoluten Zielpositionen und einer
Positionsrückmeldung erst am Fahrtende. Dateiname, Klasse und `Handler` heißen
immer **`RolloHandler`** (mit zwei „l“). Kein eigener Stop-, Bewegungs- oder
Hindernis-Datenpunkt wird vorausgesetzt.

## Direkt verwendbares Beispiel: Rollo Büro

Die Datei [examples/rollo-buero.json](../examples/rollo-buero.json) kann als externe
KNX-Konfiguration verwendet werden (`config_path` der Homebridge-KNX-Platform
auf diese Datei setzen). Für eine bestehende Konfiguration den `Services`-Eintrag
in das betreffende Gerät übernehmen und dessen vorhandene `UUID`, Service-
`subtype` und Seriennummer behalten. Keine neue Kopplung oder Migration nötig.
Nicht denselben Aktor gleichzeitig über zwei Homebridge-Plugins ansteuern.

```json
{
    "Devices": [
        {
            "DeviceName": "Rollo Büro",
            "HKCategory": "WINDOW_COVERING",
            "Services": [
                {
                    "ServiceType": "WindowCovering",
                    "ServiceName": "Rollo Büro",
                    "Handler": "RolloHandler",
                    "Characteristics": [
                        {
                            "Type": "CurrentPosition",
                            "Listen": "3/0/7",
                            "DPT": "DPT5.001"
                        },
                        {
                            "Type": "TargetPosition",
                            "Set": "3/0/6",
                            "Listen": "3/0/6",
                            "DPT": "DPT5.001"
                        },
                        {
                            "Type": "PositionState"
                        }
                    ],
                    "KNXReadRequests": ["3/0/7"],
                    "LocalConstants": {
                        "InvertPosition": true,
                        "TravelTimeUpMs": 17000,
                        "TravelTimeDownMs": 17000,
                        "EstimatePosition": false,
                        "FeedbackTimeoutMs": 5000
                    }
                }
            ]
        }
    ]
}
```

`3/0/6` ist die absolute Steueradresse, DPT 5.001; `Listen` auf derselben Adresse
erkennt auch absolute Befehle anderer Teilnehmer. `3/0/7` ist ausschließlich die
Istposition. `KNXReadRequests` fragt sie beim Start über die vorhandene zeitversetzte
Lese-Warteschlange ab. Dazu muss der Aktor auf Leseanforderungen antworten können.
`CurrentPosition` bekommt keine `Set`-Adresse. `PositionState` hat keine KNX-Adresse.
Keine zusätzliche `Reverse`-Option setzen: Die Invertierung übernimmt der Handler.

## LocalConstants

| Name | Standard | Bedeutung |
| --- | --- | --- |
| `InvertPosition` | `true` | KNX 0 = offen / 100 = geschlossen in HomeKit 100 = offen / 0 = geschlossen umrechnen. `false` bei gleicher Orientierung auf beiden Seiten. |
| `TravelTimeUpMs` | `17000` | Volle Öffnungsfahrt in Millisekunden. |
| `TravelTimeDownMs` | `17000` | Volle Schließfahrt in Millisekunden. |
| `EstimatePosition` | `false` | Geänderte, ganzzahlige Modellpositionen etwa jede Sekunde in HomeKit anzeigen. |
| `FeedbackTimeoutMs` | `5000` | Reserve nach der erwarteten Fahrtdauer; zugleich Wartezeit auf die einmalige gezielte Nachabfrage. |

Booleans als `true`/`false`, Zeiten als positive Zahlen in Millisekunden bis maximal
86400000 angeben. Ungültige Konstanten führen zu einem klaren Konfigurationsfehler.
Für das Beispiel sind 17000 Millisekunden jeweils 17 Sekunden.

Um die optionale Schätzung zu aktivieren, nur diese Konstante ändern:

```json
"EstimatePosition": true
```

## Rückmeldung und Bewegungsmodell

Ein gültiges HomeKit-Ziel wird auf ganze Prozent gerundet und einmal auf `3/0/6`
geschrieben. Der HomeKit-Schreibaufruf bestätigt den Empfang des Auftrags sofort,
**nicht** die KNX-Zustellung oder das Fahrtende. Erkannte Transportfehler werden
protokolliert; die Überwachung wird dann beendet. Ohne Transportfehler ist trotzdem
keine physische Ausführung garantiert. Es gibt keine automatische Wiederholungsfahrt.

Alle Handlerwerte sind Prozent von 0 bis 100. Der vorhandene Datenpfad verarbeitet
`knxjs` direkt in Prozent und skaliert `knxd`-Bytes (0–255) genau einmal. Der Handler
skaliert nicht zusätzlich, sondern invertiert bei Bedarf einmal. Das gilt für
Ziele, externe Befehle und Istpositionen gleichermaßen.

Jede echte Positionsrückmeldung hat Vorrang: Timer/Schätzung werden beendet,
`CurrentPosition` und `TargetPosition` mit der Rückmeldung synchronisiert und
`PositionState` auf `STOPPED` gesetzt. Eine Abweichung ab zwei Prozentpunkten vom
angeforderten Ziel wird protokolliert. Auch eine abweichende Endposition ist gültig.
Doppelte Statusmeldungen sind unschädlich und lösen keine KNX-Schreibbefehle aus.

Ohne Schätzung bleibt die angezeigte Istposition während der Fahrt bei der letzten
Rückmeldung; Richtung und Ziel werden sofort aktualisiert. Ein zeitbasiertes Modell
wird bei bekannter Ausgangsposition auch für Richtung und Überwachungsdauer nach
neuen Zielen verwendet. Bei eingeschalteter Schätzung aktualisiert es zusätzlich
die sichtbare Position. Ausgangsposition, verstrichene Zeit, Ziel und die volle
Fahrzeit der jeweiligen Richtung bestimmen das Modell. Es zählt keine Timeraufrufe:
Verzögerte Ausführung wird anhand der verstrichenen Zeit berücksichtigt. Das Modell
überschreitet weder 0–100 noch das Ziel; neue Ziele/Richtungswechsel beginnen an der
zum Befehlszeitpunkt berechneten Position.

Die letzte bestätigte Position und das Modell bleiben getrennt. HAP-Standardwerte
und ein alter Cachewert gelten beim Start nicht als frische Rückmeldung. Bis zur
ersten Rückmeldung wird keine genaue Position geschätzt. Nur bei Endzielen lässt
sich dann die Richtung ableiten; bei einem Teilziel bleibt `PositionState` auf
`STOPPED`, weil die Richtung unbekannt ist. Die Überwachung rechnet konservativ
mit der längeren vollen Fahrzeit. Eine erste Rückmeldung synchronisiert Ziel/Ist.

**Grenzen:** HomeKit besitzt kein Kennzeichen „geschätzt“. Laufzeiten, Anfahrverzug,
mechanische Unterschiede oder eine Unterbrechung können das Modell verfälschen.
Das rechnerische Erreichen des Ziels bestätigt die Fahrt nicht; bis zur echten
Rückmeldung oder zum Überwachungsende wird keine bestätigte Ankunft behauptet.
Die Schätzung sendet keinerlei zusätzliche KNX-Schreibtelegramme.

## Fehlende Rückmeldung und Timeout

Die Überwachungsfrist ist `Positionsdifferenz / 100 × volle Richtungsfahrzeit +
FeedbackTimeoutMs`. Bei unbekannter Position gilt die längere volle Fahrzeit plus
Reserve. Fehlt die Endmeldung, wird **einmal** gezielt `CurrentPosition` gelesen.
Bleibt sie weitere `FeedbackTimeoutMs` aus, folgt eine klare Warnung:

- Schätzung und Timer enden; `PositionState` wird `STOPPED`.
- `CurrentPosition` zeigt wieder die letzte tatsächlich empfangene Position. Gab es
  noch keine Rückmeldung, bleibt der bisherige HAP-Anzeigewert unbestätigt stehen.
- `TargetPosition` bleibt das angeforderte Ziel. Es wird nie zur bestätigten
  Istposition erklärt. Home-App-Darstellung kann je nach Client davon abweichen.
- Der physische Zustand ist unbekannt: `STOPPED` ist hier das Ende der lokalen
  Überwachung und kein nachgewiesener Motorstopp. Vor einer neuen genauen Schätzung
  ist wieder eine echte Rückmeldung nötig.

Eine verspätete Istmeldung korrigiert die Anzeige sofort. Es gibt weder eine
Wiederholungsfahrt noch eine erfundene Hindernismeldung. Eine ausbleibende oder
fehlgeschlagene Transportquittung kann ebenfalls nur durch die Endmeldung geklärt
werden. Shutdown und neue Ziele räumen die Timer auf; alte Timer oder Schreibfehler
bereits abgelöster Aufträge können spätere Fahrten nicht beenden.

## Externe Befehle und Grenzen der Erkennung

Absolute Ziele auf der Steueradresse werden wie Fahrziele überwacht, ohne sie
zurück auf KNX zu schreiben. Ein wiederholtes identisches Ziel während einer Fahrt
startet die Timer nicht neu. Auch ein Ziel gleich der bestätigten Ruheposition
startet keine neue Fahrt. Eigene Zielwerte werden zusätzlich für zwei Sekunden als
mögliche Echos gemerkt, auch bei rasch aufeinanderfolgenden Befehlen und nach einer
Endmeldung. Die Handler-API liefert keine Telegrammidentität: Ein gleichwertiger
externer Befehl innerhalb dieses Fensters ist von einem Echo nicht unterscheidbar
und wird ebenfalls ignoriert; sehr spät eintreffende, überholte Zieltelegramme
können ohne weitere Signale nicht sicher zugeordnet werden.

Wandtasterfahrten über **andere** Gruppenadressen werden ohne zusätzliche Signale
erst durch die Istmeldung am Fahrtende erkannt. Es wird dafür keine Bewegung
vorhergesagt. Ohne passende zusätzliche Adresse gibt es **keine echte Stoppfunktion**.
Dieser Handler behandelt weder Lamellen noch Hindernisse und steuert keine
Garagentorlogik.

## Tests und Inbetriebnahme

`npm test` behält die Syntaxprüfung bei und prüft den Handler mit kontrollierter
Zeit, echten HAP-Klassen und isolierten KNX-Transporten. Enthalten sind die
Beispielkonfiguration, Neuanlage mit `WINDOW_COVERING`, Cache-Wiederherstellung,
beide DPT-Datenpfade, Endmeldungen, externe Ziele/Echos, neue Ziele/Richtungswechsel,
Schätzung, Timeouts, Schreib-/Lesefehler und Timerbereinigung.

An der realen Anlage und in Apples Home-App bleiben insbesondere Leseantworten,
physische Orientierung, Laufzeiten, Zwischenziele, Richtungswechsel, Rückmeldungen
nur am Fahrtende und die clientabhängige Timeout-Anzeige zu prüfen. Die Tests
bestätigen keine reale Motorfahrt oder HomeKit-Kopplung.
