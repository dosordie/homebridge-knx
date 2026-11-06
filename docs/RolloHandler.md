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
                        "FeedbackTimeoutMs": 5000,
                        "CommandDebounceMs": 500
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
| `FeedbackTimeoutMs` | `5000` | Reserve nach einer vollen Richtungsfahrzeit; zugleich Wartezeit auf die einmalige gezielte Nachabfrage. |
| `CommandDebounceMs` | `500` | Ruhezeit in Millisekunden vor dem Senden des letzten HomeKit-Ziels. `0` sendet unmittelbar. |

Booleans als `true`/`false`, Zeiten als positive Zahlen in Millisekunden bis maximal
86400000 angeben. Nur `CommandDebounceMs` darf auch `0` sein. Ungültige Konstanten führen zu einem klaren Konfigurationsfehler.
Für das Beispiel sind 17000 Millisekunden jeweils 17 Sekunden.

Beispiel mit **aktiver** optionaler Schätzung und 500 ms Bündelung:

```yaml
LocalConstants:
  InvertPosition: true
  TravelTimeUpMs: 17000
  TravelTimeDownMs: 17000
  EstimatePosition: true
  FeedbackTimeoutMs: 5000
  CommandDebounceMs: 500
```

Die Schätzung bleibt standardmäßig ausgeschaltet; das JSON-Beispiel lässt sie aus.
Die 17000 ms sind weiterhin die konfigurierten vollen Fahrzeiten. Ein Log mit etwa
19 Sekunden zwischen Befehl und Endmeldung belegt die Meldungszeitpunkte, aber
keine gesicherte neue Motorlaufzeit und führt zu keiner automatischen Kalibrierung.

## HomeKit-Ziele bündeln

Jeder gültige HomeKit-Zielwert wird auf ganze Prozent gerundet, ersetzt das
vorgemerkte Ziel und beginnt die Ruhezeit erneut, auch bei identischen Werten.
Nach `CommandDebounceMs` ohne neuen Zielwert wird nur der letzte Wert einmal auf
`3/0/6` geschrieben. Ein mit der bereits laufenden Fahrt identisches Ziel erfordert
keinen weiteren KNX-Auftrag. `0` erhält das frühere unmittelbare Senden.

HomeKit-Schreibzugriffe werden sofort im selben Aufruf bestätigt, **nicht** erst
nach der Wartezeit, KNX-Zustellung oder Ankunft. Es gibt keinen verlässlichen
„Slider losgelassen“- oder „Siri“-Hinweis: Auch einzelne Sprachbefehle warten die
konfigurierte Zeit. Jeder Handler besitzt einen eigenen Timer; acht gleichzeitig
bediente Rollos warten parallel 500 ms, nicht insgesamt achtmal 500 ms.

HomeKit sieht das vorgemerkte Ziel sofort. Eine alte Fahrt samt Schätzung läuft
während der Wartezeit weiter. Erst beim tatsächlichen Absenden werden Ausgangs-
position, Richtung und Überwachung der neuen Fahrt festgelegt. Eine Endmeldung
der alten Fahrt korrigiert die Istposition, löscht aber kein vorgemerktes Ziel.
Ein erkanntes externes Ziel verwirft einen ausstehenden lokalen Befehl. Eigene
Echos sind davon ausgenommen; nur tatsächlich gesendete Befehle gehen in die
Echoerkennung ein. Shutdown verwirft auch noch nicht gesendete Befehle.

Erkannte Transportfehler werden protokolliert; die Überwachung wird dann beendet.
Ohne Transportfehler ist trotzdem keine physische Ausführung garantiert. Es gibt
keine automatische Wiederholungsfahrt.

## Rückmeldung und Bewegungsmodell

Alle Handlerwerte sind Prozent von 0 bis 100. Der vorhandene Datenpfad verarbeitet
`knxjs` direkt in Prozent und skaliert `knxd`-Bytes (0–255) genau einmal. Der Handler
skaliert nicht zusätzlich, sondern invertiert bei Bedarf einmal. Das gilt für
Ziele, externe Befehle und Istpositionen gleichermaßen.

Eine spontane Positionsmeldung (`GroupValue_Write`) hat Vorrang: Die alte Fahrt
samt Timer/Schätzung wird beendet, `CurrentPosition` und normalerweise auch
`TargetPosition` mit der Rückmeldung synchronisiert und `PositionState` auf
`STOPPED` gesetzt. Ein inzwischen vorgemerktes lokales Ziel bleibt dabei erhalten.
Für Leseantworten während einer aktiven Fahrt gilt die unten beschriebene Prüfung. Eine Abweichung ab zwei Prozentpunkten vom
angeforderten Ziel wird protokolliert. Auch eine abweichende Endposition ist gültig.
Doppelte Statusmeldungen sind unschädlich und lösen keine KNX-Schreibbefehle aus.

Ohne Schätzung bleibt die angezeigte Istposition während der Fahrt bei der letzten
Rückmeldung; die Richtung wird beim tatsächlichen Senden aktualisiert. Ein
zeitbasiertes Modell wird bei bekannter Ausgangsposition auch für die Richtung
nach neuen Zielen verwendet. Die Überwachungsfrist verwendet unabhängig davon
eine volle Fahrzeit. Bei eingeschalteter Schätzung aktualisiert es zusätzlich
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

Die erste Nachabfrage erfolgt frühestens nach **einer vollen richtungsabhängigen
Fahrzeit plus `FeedbackTimeoutMs`**, gerechnet ab dem tatsächlichen Absenden
beziehungsweise einem empfangenen externen Ziel. Bei unbekannter Richtung gilt
die längere volle Fahrzeit. Die lineare Teilwegschätzung verkürzt diese Frist
nicht mehr. Fehlt die Endmeldung, wird **einmal** `CurrentPosition` gelesen.
Die anschließende Wartezeit bleibt auf weitere `FeedbackTimeoutMs` begrenzt.

Beispiel mit 58 % offen und Ziel 0 %: Das Modell erreicht 0 % nach rund 9,86 s,
meldet aber weiterhin `CLOSING`. Bei 17000 ms Schließzeit und 5000 ms Reserve wird
erst nach 22 s gelesen. Kommt die echte Endmeldung schon nach 19 s, entfällt die
Nachabfrage. Liefert eine Nachabfrage noch 58 %, springt die Schätzung nicht zurück.

### Leseantwort oder spontane Endmeldung?

Beide Empfangspfade (`knxjs` und `knxd`) unterscheiden Schreibtelegramme und
Leseantworten. Diese Information wird rückwärtskompatibel als optionales
`metadata.event` bis zum Handler weitergereicht. Während einer aktiven Fahrt
(auch vor der Nachabfrage, etwa bei einer verzögerten Start-Leseantwort) wird eine
`GroupValue_Response` nur dann als Bestätigung
angenommen, wenn sie weniger als zwei Prozentpunkte vom Ziel abweicht. Eine
abweichende Antwort könnte noch einen alten oder Zwischenwert liefern: Sie beendet
die Fahrt nicht und verlängert auch nicht die Frist. Eine spätere echte Endmeldung
hat weiterhin Vorrang. Schreibtelegramme bleiben auch im Nachabfragefenster
autoritativ, selbst wenn sie die unveränderte Ausgangsposition melden, etwa nach
einem Abbruch oder einer erfolglosen Fahrt.

Leseantworten tragen keine Auftrags-ID. Eine exakte Zuordnung zu unserer Abfrage
oder ein unabhängiger Nachweis der Frische ist deshalb nicht möglich. Die Prüfung
für eindeutig gekennzeichnete Leseantworten gilt nur während aktiver Fahrten;
sie ist keine allgemeine Filterung gleicher Positionswerte. Falls eine ältere
Integration keine Metadaten liefert, wird nur im Nachabfragefenster ein mit der letzten bestätigten Position identischer
Wert als mehrdeutig zurückgehalten. Ohne Metadaten werden andere Werte und
Meldungen außerhalb dieses Fensters weiterhin verarbeitet. Eine echte, aber
ausschließlich als abweichende Leseantwort gemeldete Endposition kann daher erst nach dem Timeout
oder durch eine spontane Schreibmeldung bestätigt werden.

Bleibt eine verwertbare Endmeldung aus, folgt nach insgesamt voller Fahrzeit plus
zweimal Reserve eine klare Warnung:

- Schätzung und Timer enden; `PositionState` wird `STOPPED`.
- `CurrentPosition` friert beim zuletzt angezeigten Wert ein, auch wenn dieser nur
  geschätzt ist. Kein künstlicher Rücksprung auf eine ältere Position. Die letzte
  echte Bestätigung bleibt intern getrennt und wird nicht als aktueller Zustand
  ausgegeben. Ohne Schätzung bleibt der bisherige Anzeigewert stehen.
- `TargetPosition` bleibt das angeforderte beziehungsweise neu vorgemerkte Ziel.
  Es wird nie zur bestätigten Istposition erklärt.
- Der physische Zustand ist **unbekannt**: `STOPPED` bedeutet das Ende der lokalen
  Überwachung, keinen nachgewiesenen Motorstopp. HomeKit besitzt hier kein Merkmal
  für „unbestätigt“. Vor einer neuen genauen Schätzung ist wieder eine echte
  Rückmeldung nötig. Apples Home-App kann den eingefrorenen Wert als „Geschlossen“
  darstellen; dies ist kein Nachweis der tatsächlichen Position.

Eine verspätete Istmeldung korrigiert die Anzeige sofort. Es gibt weder eine
Wiederholungsfahrt noch eine erfundene Hindernismeldung. Eine ausbleibende oder
fehlgeschlagene Transportquittung kann ebenfalls nur durch die Endmeldung geklärt
werden. Shutdown räumt alle Timer auf; neue lokale Ziele ersetzen zunächst nur
die Vormerkung. Beim tatsächlichen Senden werden die alten Fahrttimer ersetzt.
Veraltete Timer oder Schreibfehler abgelöster Aufträge beenden keine spätere Fahrt.

## HAP-Werte und Darstellung in Apples Home-App

Die Tests prüfen echte HAP-Characteristics und Change-Events, nicht nur Handler-
Variablen. `TargetPosition` wird nicht als `CurrentPosition` übernommen. Beim
unmittelbaren Senden wird die Bewegungsrichtung vor dem neuen Ziel veröffentlicht.
`RolloHandler` aktualisiert dafür Zustand und Wertecache synchron vor der sofortigen
Schreibbestätigung; andere Handler behalten die bisherige Reihenfolge. Beim
Bündeln darf das neue Ziel bereits sichtbar sein, während die alte Fahrt noch
läuft oder vor dem tatsächlichen Senden noch `STOPPED` gilt.

Bei aktiver Schätzung werden zum Beispiel 58 → 52 → 46 → … → 0 % angezeigt,
während `PositionState` weiterhin `CLOSING` ist. Erst eine angenommene Endmeldung
oder der endgültige Timeout setzt `STOPPED`. Das passt zum beobachteten Log mit
bereits eingeschalteter Schätzung; eine ausgeschaltete Schätzung erklärt diesen
Fall nicht. Die Home-App kann dennoch anhand von Ziel oder geschätzter Endposition
früh „Geschlossen“ anzeigen. Eine korrekte HAP-Ereignisfolge garantiert keine
bestimmte Animation. Es werden weder künstliche Restpositionen noch wiederholte
Fahrbefehle erzeugt, um die Anzeige zu erzwingen. Diese clientabhängige Darstellung
bleibt an der realen Anlage und in Apples Home-App zu prüfen.

## Externe Befehle und Grenzen der Erkennung

Absolute Ziele auf der Steueradresse werden wie Fahrziele überwacht, ohne sie
zurück auf KNX zu schreiben. Ein wiederholtes identisches Ziel während einer Fahrt
startet die Timer nicht neu. Auch ein Ziel gleich der bestätigten Ruheposition
startet keine neue Fahrt. Ein erkanntes externes Ziel verwirft eine lokale
Vormerkung auch dann, wenn es mit dem bereits laufenden Ziel übereinstimmt.
Eigene tatsächlich gesendete Zielwerte werden für zwei Sekunden als mögliche Echos gemerkt, auch bei rasch aufeinanderfolgenden Befehlen und nach einer
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
Schätzung, konservative Timeouts, alte Leseantworten, HAP-Ereignisreihenfolge,
Bündelung, parallele Gruppenbefehle, Schreib-/Lesefehler und Timerbereinigung.
Die Callback-Einmaligkeitsprüfungen für beide Transportpfade bleiben erhalten.

An der realen Anlage und in Apples Home-App bleiben insbesondere Leseantworten,
physische Orientierung, Laufzeiten, Zwischenziele, Richtungswechsel, Rückmeldungen
nur am Fahrtende und die clientabhängige Timeout-Anzeige zu prüfen. Die Tests
bestätigen keine reale Motorfahrt oder HomeKit-Kopplung.
