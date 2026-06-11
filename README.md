# homebridge-knx v0.5.1-dosordie.beta.9

> Homebridge-KNX-Fork für Homebridge 2.x mit KNX/IP-Routing über `knxjs`, optionalem `knxd`-Betrieb und eigener Homebridge-Config-UI.

Dieses Repository ist ein gepflegter Fork von `homebridge-knx` für aktuelle Homebridge-Installationen. Der Fokus liegt aktuell auf Homebridge 2.x, sauberer Konfiguration über die Homebridge UI, Child-Bridge-Setups und KNX/IP-Routing per `knxjs`.

**Wichtig:** Das Plugin läuft nicht eigenständig mit `node`. Es wird ausschließlich von [Homebridge](https://homebridge.io/) geladen.

## Status dieses Forks

Dieser Fork wird zunächst direkt aus GitHub installiert:

```bash
sudo npm install -g git+https://github.com/dosordie/homebridge-knx.git
```

Sobald der Fork als reguläres npm-Paket veröffentlicht ist, kann die Installation entsprechend umgestellt werden. Bis dahin ist die GitHub-Installation der empfohlene Weg.

## Kompatibilität

| Komponente | Voraussetzung |
| --- | --- |
| Homebridge | `>= 2.0.0` |
| Node.js | `> 14.0.0` |
| Plugin-Typ | Homebridge Platform Plugin (`KNX`) |
| KNX-Zugriff | `knxjs` per KNX/IP-Routing oder `knxd` |

## Breaking Changes

Bitte vor dem Update von älteren Versionen lesen:

- **Nur noch Homebridge 2.x:** Dieser Fork ist nicht abwärtskompatibel zu Homebridge 1.x oder älter. Ein Update sollte erst nach der Migration auf Homebridge `>= 2.0.0` erfolgen.
- **Bus-Anbindung wird in Homebridge `config.json` konfiguriert:** Gateway-/Bus-Parameter liegen nicht mehr ausschließlich in der externen `knx_config.json`, sondern in der Homebridge-Platform-Konfiguration.
- **Explizite Auswahl zwischen `knxjs` und `knxd`:** Pro KNX-Platform-Instanz muss die Kommunikationsart gewählt werden:
  - `knxjs` für KNX/IP-Routing per Multicast.
  - `knxd` für bestehende Installationen mit laufendem knxd/eibd-Daemon.
- **`knxjs` benötigt einen KNX/IP-Router im Netzwerk:** Für `knxjs` ist ein KNX/IP-Router mit Routing/Multicast erforderlich. Ein reines KNX/IP-Interface im Tunneling-Modus reicht dafür in der Regel nicht aus.
- **`config_path` ist Pflicht:** Die Geräte-/GA-Konfiguration wird über einen externen JSON-/YAML-Pfad geladen. Der Pfad kann auf eine Datei oder auf ein Verzeichnis zeigen.
- **YAML und Verzeichnis-Setups:** KNX-Konfigurationen können neben JSON auch als `.yaml`/`.yml` gepflegt werden. Zeigt `config_path` auf ein Verzeichnis, werden JSON-/YAML-Dateien daraus geladen. Pro Child Bridge sollte nur eine Datei globale Inhalte außerhalb von `Devices` enthalten.
- **Homebridge Config UI statt alter Hilfs-Webserver:** Die frühere eingebaute Webserver-Dokumentation/Bedienung ist nicht mehr der empfohlene Weg. Konfiguration und Bearbeitung laufen über die Homebridge UI und die Custom UI dieses Plugins.
- **Child Bridges empfohlen:** Mehrere KNX-Instanzen lassen sich über die Homebridge UI als Child Bridges betreiben. Das ist für größere KNX-Installationen ausdrücklich empfohlen.

## Was ist neu in diesem Fork?

- Unterstützung für **Homebridge 2.x**.
- Eigene **Homebridge Config UI** für KNX-Platform-Instanzen.
- Editor zum Anzeigen, Validieren und Bearbeiten externer **JSON-/YAML-KNX-Konfigurationen**.
- Unterstützung für **Datei- oder Verzeichnis-Konfigurationen** über `config_path`.
- Auswahl der KNX-Kommunikation direkt in der UI: **`knxjs` oder `knxd`**.
- Verbesserungen und Fixes rund um **`knxjs`/KNX-Routing**.
- Homebridge-Metadaten inklusive Plugin-Icon für die Plugin-Liste.
- Child-Bridge-freundliche Struktur für getrennte KNX-Bereiche oder Etagen.

Details stehen zusätzlich im [CHANGELOG.md](CHANGELOG.md).

## KNX-Anbindung: `knxjs` oder `knxd`

### Variante A: `knxjs` / KNX/IP-Routing

Empfohlen für Installationen mit KNX/IP-Router im Netzwerk.

Voraussetzungen:

- KNX/IP-Router im selben Netzwerk/VLAN wie Homebridge.
- Routing/Multicast muss im Netzwerk funktionieren.
- Eine freie physikalische KNX-Adresse für Homebridge, z. B. `1.1.250`.

Typische Platform-Konfiguration:

```json
{
    "name": "KNX",
    "platform": "KNX",
    "config_path": "/home/pi/.homebridge/knx/eg.yaml",
    "knxconnection": "knxjs",
    "knx_phy_addr": "1.1.250"
}
```

### Variante B: `knxd`

Für bestehende Setups mit laufendem `knxd`/`eibd`-Dienst bleibt die Unterstützung erhalten.

Voraussetzungen:

- Installierter und erreichbarer `knxd`.
- IP-Adresse/Hostname und Port des knxd-Dienstes.

Typische Platform-Konfiguration:

```json
{
    "name": "KNX",
    "platform": "KNX",
    "config_path": "/home/pi/.homebridge/knx/eg.json",
    "knxconnection": "knxd",
    "knxd_ip": "127.0.0.1",
    "knxd_port": 6720
}
```

Probleme mit `knxd` selbst bitte direkt beim [knxd-Projekt](https://github.com/knxd/knxd/issues) prüfen/melden.

## Installation

1. Homebridge nach offizieller Anleitung installieren: <https://homebridge.io/>.
2. Sicherstellen, dass Homebridge mindestens Version `2.0.0` verwendet.
3. Diesen Fork global installieren:

   ```bash
   sudo npm install -g git+https://github.com/dosordie/homebridge-knx.git
   ```

4. Homebridge neu starten.
5. In der Homebridge UI eine neue Platform `KNX` anlegen oder eine bestehende KNX-Platform bearbeiten.
6. `config_path`, `knxconnection` und die passenden Bus-Parameter setzen.
7. Für größere Installationen die Instanz in eine **Child Bridge** verschieben.

## Konfiguration über die Homebridge UI

Die Plugin-Konfiguration besteht aus zwei Ebenen:

1. **Homebridge Platform-Konfiguration**  
   Enthält den Namen der Instanz, den `config_path` und die Bus-Anbindung (`knxjs`/`knxd`). Diese Daten stehen in der Homebridge `config.json`.

2. **KNX-Gerätekonfiguration**  
   Enthält Geräte, Services, Characteristics, Group Addresses und Handler. Diese Daten liegen extern als JSON oder YAML und werden über `config_path` referenziert.

Die Custom UI kann externe KNX-Konfigurationsdateien anzeigen, validieren und speichern. Dabei werden JSON, YAML und Verzeichnisse mit mehreren Konfigurationsdateien unterstützt.

## Beispiel: Child-Bridge-Setup

```json
{
    "bridge": {
        "name": "Homebridge",
        "username": "0E:0B:9B:24:17:AD",
        "port": 51485,
        "pin": "880-83-869",
        "advertiser": "avahi"
    },
    "accessories": [],
    "platforms": [
        {
            "name": "Config",
            "port": 8581,
            "auth": "form",
            "theme": "auto",
            "tempUnits": "c",
            "lang": "de",
            "platform": "config"
        },
        {
            "name": "KNX EG",
            "platform": "KNX",
            "config_path": "/home/pi/.homebridge/knx/eg.yaml",
            "knxconnection": "knxjs",
            "knx_phy_addr": "1.1.250",
            "_bridge": {
                "username": "1E:0B:9B:24:17:01",
                "port": 51490
            }
        },
        {
            "name": "KNX OG",
            "platform": "KNX",
            "config_path": "/home/pi/.homebridge/knx/og.yaml",
            "knxconnection": "knxjs",
            "knx_phy_addr": "1.1.251",
            "_bridge": {
                "username": "1E:0B:9B:24:17:02",
                "port": 51492
            }
        }
    ]
}
```

## Sicherheitshinweise

- Vor dem ersten Start alle Beispiel-Gruppenadressen entfernen oder an die eigene Anlage anpassen.
- Keine unbekannten Gruppenadressen schreibend testen.
- Besonders Alarm, Tür, Tor, Heizung und Zentralfunktionen vorsichtig behandeln.
- Vor Änderungen an produktiven KNX-Konfigurationen Backups anlegen.

## Annahmen ohne Handler/Add-in

Ohne speziellen Handler ordnet `homebridge-knx` HomeKit-Werte den folgenden KNX-DPTs zu:

| HomeKit-Typ | KNX-DPT |
| --- | --- |
| Boolean | DPT1 |
| Integer | DPT5 |
| Percentage | DPT5.001 |
| Float | DPT9 |

## KNX-Konfigurationsdatei

Die ausführliche Dokumentation zur KNX-Gerätekonfiguration steht in [knx_config.json.md](knx_config.json.md).

## Add-ins / Handler

Handler können das Standardverhalten einzelner Services oder Characteristics ändern. Details stehen in [handler-add-in.md](handler-add-in.md).

## Nützliche Links

- [Homebridge](https://homebridge.io/)
- [knxd](https://github.com/knxd/knxd)
- [Changelog](CHANGELOG.md)
- [KNX-Konfigurationsdokumentation](knx_config.json.md)
- [Handler/Add-ins](handler-add-in.md)

Happy testing!

[npm-url]: https://npmjs.org/package/homebridge-knx
[downloads-image]: http://img.shields.io/npm/dm/homebridge-knx.svg
[npm-image]: http://img.shields.io/npm/v/homebridge-knx.svg
[david-dm-url]: https://david-dm.org/snowdd1/homebridge-knx
[david-dm-image]: https://david-dm.org/snowdd1/homebridge-knx.svg
