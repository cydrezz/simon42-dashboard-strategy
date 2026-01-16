// ====================================================================
// CORE STRATEGY - 2D EXPERIMENT
// ====================================================================

class Simon422DStrategy {
  static async generateDashboard(info) {
    const config = info.config || {};
    
    // Standard-Bild, falls keines konfiguriert ist
    const floorplanImage = config.image || "https://demo.home-assistant.io/stub_config/floorplan.png";
    
    return {
      views: [
        {
          title: "2D Overview",
          path: "default_view",
          type: "panel", // Panel Mode ist ideal für bildschirmfüllende Floorplans
          cards: [
            {
              type: "vertical-stack",
              cards: [
                {
                  type: "markdown",
                  content: "## 🏗️ 2D Floorplan Experiment\nDies ist eine isolierte Test-Umgebung. Definiere `image` in der Dashboard-Konfiguration, um dein eigenes Bild zu nutzen."
                },
                {
                  type: "picture-elements",
                  image: floorplanImage,
                  elements: [
                    // Beispiel-Element: Sonne oben links
                    {
                      type: "state-badge",
                      entity: "sun.sun",
                      style: {
                        top: "10%",
                        left: "10%"
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };
  }
}

// Registriere die Strategie unter einem neuen Namen
customElements.define("ll-strategy-simon42-2d-dashboard", Simon422DStrategy);