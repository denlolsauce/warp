"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createPlan,
  coverageAt,
  positionAt,
  type PlanOptions,
} from "@/lib/maritime";
import "./maritime.css";

type IconName =
  | "grid"
  | "drone"
  | "map"
  | "chart"
  | "settings"
  | "help"
  | "arrow"
  | "play"
  | "pause"
  | "reset"
  | "download"
  | "layers"
  | "target"
  | "check"
  | "close"
  | "wind"
  | "clock"
  | "route";
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    drone: (
      <>
        <path d="m8 8 8 8m0-8-8 8M9 12h6m-3-3v6" />
        <circle cx="5.5" cy="5.5" r="3" />
        <circle cx="18.5" cy="5.5" r="3" />
        <circle cx="5.5" cy="18.5" r="3" />
        <circle cx="18.5" cy="18.5" r="3" />
      </>
    ),
    map: (
      <>
        <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15" />
      </>
    ),
    chart: (
      <>
        <path d="M4 3v17h17M8 15l4-5 4 3 5-8" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3v.2" />
      </>
    ),
    arrow: <path d="m9 5 7 7-7 7" />,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    reset: (
      <>
        <path d="M3 10a9 9 0 1 1 1 7M3 4v6h6" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 10 6-10 6L2 9l10-6Zm-9 11 9 5 9-5M3 18l9 5 9-5" />
      </>
    ),
    target: (
      <>
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2" />
        <path d="M12 1v4m0 14v4M1 12h4m14 0h4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    wind: (
      <>
        <path d="M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h5" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    route: (
      <>
        <circle cx="5" cy="5" r="2" />
        <circle cx="19" cy="19" r="2" />
        <path d="M7 5h8a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h8" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
const COLORS = ["#50c7b1", "#6aa9f5", "#ac8ee8", "#e9b75c", "#e58a8b"];
const NAMES = ["ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO"];
const ASSETS = [
  { x: 2.3, y: 2.1, name: "North wind farm", kind: "wind" },
  { x: 6.5, y: 3.7, name: "Offshore platform", kind: "platform" },
  { x: 7.9, y: 7.5, name: "Subsea cable hub", kind: "cable" },
];
const fmtTime = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function MaritimeDashboard() {
  const [options, setOptions] = useState<PlanOptions>({
    speed: 18,
    swath: 500,
    overlap: 10,
    strategy: "optimized",
  });
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [rate, setRate] = useState(10);
  const [tab, setTab] = useState("Mission overview");
  const [selectedDrone, setSelectedDrone] = useState<number | null>(null);
  const [routesVisible, setRoutesVisible] = useState(true);
  const [assetsVisible, setAssetsVisible] = useState(true);
  const [layerMenu, setLayerMenu] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [dialog, setDialog] = useState<"mission" | "help" | null>(null);
  const [missionName, setMissionName] = useState(
    "North Sea infrastructure patrol",
  );
  const [notice, setNotice] = useState("");
  const plan = useMemo(() => createPlan(options), [options]);
  const coverage = useMemo(
    () => coverageAt(plan, elapsed, options.speed, options.swath),
    [plan, elapsed, options.speed, options.swath],
  );
  const completed = elapsed >= plan.duration;
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = ((now - last) / 1000) * rate;
      last = now;
      setElapsed((value) => Math.min(plan.duration, value + delta));
    }, 200);
    return () => window.clearInterval(timer);
  }, [running, rate, plan.duration]);
  useEffect(() => {
    if (completed) setRunning(false);
  }, [completed]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>(".mission-modal");
    const focusable = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]') ??
          [],
      );
    (modal?.querySelector<HTMLElement>("input") ?? focusable()[0])?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setDialog(null);
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0],
        last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previous?.focus();
    };
  }, [dialog]);
  function updateOptions(patch: Partial<PlanOptions>) {
    setOptions((value) => ({ ...value, ...patch }));
    setElapsed(0);
    setRunning(false);
  }
  function reset() {
    setElapsed(0);
    setRunning(false);
  }
  function exportMission() {
    const data = {
      name: missionName,
      areaKm2: 100,
      assumptions:
        "Synthetic 10 × 10 km square, constant groundspeed, flat sensor footprint, common launch and return point; no weather, battery, terrain or separation model. Candidate search, not a global optimum.",
      options,
      plan,
      elapsedSeconds: elapsed,
      coveragePercent: coverage,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "pelagic-mission.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Mission plan exported as JSON");
  }
  const navItems: { name: string; icon: IconName }[] = [
    { name: "Mission overview", icon: "grid" },
    { name: "Drone fleet", icon: "drone" },
    { name: "Infrastructure", icon: "map" },
    { name: "Analytics", icon: "chart" },
  ];
  return (
    <div className="pelagic-app">
      <aside className="sidebar">
        <a href="/" className="brand" aria-label="Pelagic home">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          PELAGIC<span className="brand-dot">®</span>
        </a>
        <div className="workspace-label">MARITIME OPERATIONS</div>
        <div className="workspace">
          <span className="workspace-icon">
            <Icon name="layers" size={18} />
          </span>
          <div>
            North Sea workspace<small>Simulation environment</small>
          </div>
          <span className="workspace-chevron">⌄</span>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {navItems.map((item) => (
            <button
              key={item.name}
              onClick={() => {
                setTab(item.name);
                if (item.name === "Drone fleet")
                  document
                    .getElementById("fleet")
                    ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
              }}
              className={tab === item.name ? "nav-item active" : "nav-item"}
            >
              <Icon name={item.icon} size={19} />
              {item.name}
              {item.name === "Drone fleet" && (
                <span className="nav-count">5</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-mission">
          <span className="live-dot" /> SIMULATION MODE
          <p>
            A clearer view.
            <br />A smarter patrol.
          </p>
          <span>
            Plan, test, and optimize your
            <br />
            maritime coverage.
          </span>
          <div className="signal-lines">⌁⌁⌁⌁⌁⌁⌁⌁</div>
        </div>
        <div className="sidebar-bottom">
          <button
            className="nav-item"
            onClick={() => {
              setTab("Mission overview");
              document
                .getElementById("mission-config")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            <Icon name="settings" size={19} />
            Mission settings
          </button>
          <button className="nav-item" onClick={() => setDialog("help")}>
            <Icon name="help" size={19} />
            Help & documentation
            <Icon name="arrow" size={14} />
          </button>
          <div className="user">
            <span className="avatar">RO</span>
            <div>
              Rian O Donnell<small>Workspace owner</small>
            </div>
            <span className="user-online" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <Icon name="arrow" size={13} />
            <span>{tab}</span>
          </div>
          <div className="topbar-right">
            <span className="environment">
              <span className="live-dot" />
              Simulation environment
            </span>
            <span className="top-divider" />
            <span className="mini-avatar">RO</span>
          </div>
        </header>
        <main className="dashboard">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                MISSION CONTROL <span>/</span> SIM–001
              </div>
              <h1>
                {tab === "Mission overview" ? "Maritime swarm simulation" : tab}
              </h1>
              <p>
                Five drones. One coordinated mission. Complete situational
                awareness.
              </p>
            </div>
            <button className="button secondary export" onClick={exportMission}>
              <Icon name="download" size={17} />
              Export mission
            </button>
          </div>
          <div className="mission-bar">
            <div>
              <span className="mission-indicator" />
              <strong>{missionName}</strong>
              <span className="tag">DRAFT MISSION</span>
            </div>
            <button onClick={() => setDialog("mission")}>
              Edit mission <Icon name="arrow" size={14} />
            </button>
          </div>
          <section className="stats-grid" aria-label="Mission metrics">
            <Metric
              icon="map"
              label="MONITORING AREA"
              value="100"
              unit="km²"
              detail="10 × 10 km operational zone"
            />
            <Metric
              icon="drone"
              label="ACTIVE FLEET"
              value="05"
              unit="drones"
              detail="Coordinated autonomous coverage"
              badge={
                completed
                  ? "Returned"
                  : running
                    ? "In flight"
                    : elapsed > 0
                      ? "Paused"
                      : "All ready"
              }
            />
            <Metric
              icon="clock"
              label="EST. MISSION TIME"
              value={Math.ceil(plan.duration / 60).toString()}
              unit="min"
              detail="Including launch & return transit"
            />
            <Metric
              icon="route"
              label="ROUTE EFFICIENCY"
              value={plan.improvement.toFixed(1)}
              unit="%"
              detail="Faster than baseline sweep"
              badge={
                options.strategy === "optimized" ? "Optimized" : "Baseline"
              }
            />
          </section>
          {tab === "Analytics" && (
            <section className="context-panel">
              <Icon name="chart" />
              <div>
                <strong>Route comparison</strong>
                <p>
                  Baseline: {Math.ceil(plan.baselineDuration / 60)} min ·
                  Selected plan: {Math.ceil(plan.duration / 60)} min · Fleet
                  distance: {plan.totalDistance.toFixed(1)} km. Efficiency is
                  the reduction in time until the last drone returns.
                </p>
              </div>
            </section>
          )}
          {tab === "Infrastructure" && (
            <section className="context-panel">
              <Icon name="map" />
              <div>
                <strong>Three synthetic infrastructure sites</strong>
                <p>
                  {ASSETS.map((a) => a.name).join(" · ")}. These are
                  illustrative map markers; the planner covers the full area
                  uniformly, not priority-weighted inspections.
                </p>
              </div>
            </section>
          )}
          <div className="simulation-grid">
            <section className="map-panel" aria-label="Live mission map">
              <div className="panel-heading">
                <h2>
                  <span className="live-dot" />
                  Live mission map
                </h2>
                <span className="map-heading-meta">
                  NORTH SEA <span>•</span> 100 KM²
                </span>
              </div>
              <div className="map-canvas">
                <svg
                  className="sea-map"
                  viewBox="0 0 940 510"
                  role="img"
                  aria-label="Synthetic maritime map showing five colored coverage routes and drone positions"
                >
                  <defs>
                    <pattern
                      id="sea-grid"
                      width="42"
                      height="42"
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        d="M42 0H0V42"
                        fill="none"
                        stroke="#799f9c"
                        strokeOpacity=".075"
                        strokeWidth="1"
                      />
                    </pattern>
                    <pattern
                      id="land-texture"
                      width="15"
                      height="15"
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        d="m0 15 15-15"
                        stroke="#7c9988"
                        strokeWidth=".4"
                        strokeOpacity=".12"
                      />
                    </pattern>
                    <radialGradient id="ocean">
                      <stop stopColor="#203e47" />
                      <stop offset="1" stopColor="#152c36" />
                    </radialGradient>
                    <filter id="drone-glow">
                      <feGaussianBlur stdDeviation="3" />
                    </filter>
                  </defs>
                  <rect width="940" height="510" fill="url(#ocean)" />
                  <rect width="940" height="510" fill="url(#sea-grid)" />
                  <g
                    fill="none"
                    stroke="#58757b"
                    strokeWidth=".8"
                    opacity=".19"
                  >
                    {Array.from({ length: 8 }, (_, i) => (
                      <path
                        key={i}
                        d={`M${120 + i * 32} -20 C${190 + i * 22} 100,${60 + i * 32} 130,${160 + i * 30} 240 S${150 + i * 40} 410,${270 + i * 45} 540`}
                      />
                    ))}
                    <path d="M480 0C500 90 820 95 780 240S620 460 980 480M900 0C700 80 900 230 940 250" />
                  </g>
                  <path
                    d="M0 0H151L146 22 164 45 143 65 151 83 126 103 132 127 107 143 118 162 87 186 93 211 64 226 75 252 45 276 53 303 26 326 31 358 0 379Z"
                    fill="#344c48"
                    stroke="#698276"
                    strokeWidth="1.3"
                  />
                  <path
                    d="M0 0H151L146 22 164 45 143 65 151 83 126 103 132 127 107 143 118 162 87 186 93 211 64 226 75 252 45 276 53 303 26 326 31 358 0 379Z"
                    fill="url(#land-texture)"
                  />
                  <path
                    d="m38 23 17 65-13 54 23 37-34 67M0 101l54-13 55 36M10 275l45-36"
                    stroke="#8d9e87"
                    strokeOpacity=".28"
                    fill="none"
                  />
                  <text
                    x="40"
                    y="66"
                    fill="#8faaa2"
                    fontSize="10"
                    letterSpacing="3"
                    transform="rotate(-25 40 66)"
                  >
                    COASTLINE
                  </text>
                  <g
                    transform={`translate(${470 - 470 * zoom} ${255 - 255 * zoom}) scale(${zoom})`}
                  >
                    <rect
                      x="219"
                      y="46"
                      width="570"
                      height="405"
                      fill="#56c2aa"
                      fillOpacity=".025"
                      stroke="#96b5ad"
                      strokeOpacity=".4"
                      strokeDasharray="5 6"
                    />
                    <path
                      d="M219 62V46h16m538 0h16v16M219 435v16h16m538 0h16v-16"
                      fill="none"
                      stroke="#a2bfb8"
                      strokeWidth="1.5"
                    />
                    <text
                      x="224"
                      y="33"
                      fill="#8da9a7"
                      fontSize="9"
                      letterSpacing="1.7"
                    >
                      OPERATIONAL BOUNDARY
                    </text>
                    <text x="732" y="33" fill="#8da9a7" fontSize="9">
                      10.0 km
                    </text>
                    {plan.routes.map((route, i) => {
                      const p = positionAt(
                        route.points,
                        Math.min(
                          route.distance,
                          (elapsed * options.speed) / 1000,
                        ),
                      );
                      const x = 219 + p.x * 57,
                        y = 46 + p.y * 40.5;
                      const traveled = Math.min(
                        route.distance,
                        (elapsed * options.speed) / 1000,
                      );
                      let accumulated = 0;
                      const visited = route.points.filter((pt, index) => {
                        if (index > 0)
                          accumulated += Math.hypot(
                            pt.x - route.points[index - 1].x,
                            pt.y - route.points[index - 1].y,
                          );
                        return accumulated <= traveled;
                      });
                      const visitedPoints = [...visited, p]
                        .map((pt) => `${219 + pt.x * 57},${46 + pt.y * 40.5}`)
                        .join(" ");
                      const isSelected =
                        selectedDrone === null || selectedDrone === i;
                      const points = route.points
                        .map((pt) => `${219 + pt.x * 57},${46 + pt.y * 40.5}`)
                        .join(" ");
                      return (
                        <g key={route.id} opacity={isSelected ? 1 : 0.2}>
                          {routesVisible && (
                            <>
                              <polyline
                                points={points}
                                fill="none"
                                stroke={COLORS[i]}
                                strokeWidth="1.25"
                                opacity=".7"
                                strokeLinejoin="round"
                              />
                              <polyline
                                points={points}
                                fill="none"
                                stroke={COLORS[i]}
                                strokeWidth={(options.swath / 1000) * 40.5}
                                opacity=".025"
                                strokeLinejoin="round"
                              />
                              <polyline
                                points={visitedPoints}
                                fill="none"
                                stroke={COLORS[i]}
                                strokeWidth={(options.swath / 1000) * 40.5}
                                opacity=".22"
                                strokeLinejoin="round"
                                strokeLinecap="round"
                              />
                            </>
                          )}
                          <g
                            onClick={() =>
                              setSelectedDrone(selectedDrone === i ? null : i)
                            }
                            style={{ cursor: "pointer" }}
                          >
                            <circle
                              cx={x}
                              cy={y}
                              r="19"
                              fill={COLORS[i]}
                              opacity=".1"
                            />
                            <circle
                              cx={x}
                              cy={y}
                              r="11"
                              fill="#102c34"
                              stroke={COLORS[i]}
                              strokeWidth="1.5"
                            />
                            <path
                              d={`m${x - 4} ${y - 4} 8 8m0-8-8 8`}
                              stroke={COLORS[i]}
                              strokeWidth="1.6"
                            />
                            <circle
                              cx={x - 4}
                              cy={y - 4}
                              r="2"
                              fill={COLORS[i]}
                            />
                            <circle
                              cx={x + 4}
                              cy={y - 4}
                              r="2"
                              fill={COLORS[i]}
                            />
                            <circle
                              cx={x - 4}
                              cy={y + 4}
                              r="2"
                              fill={COLORS[i]}
                            />
                            <circle
                              cx={x + 4}
                              cy={y + 4}
                              r="2"
                              fill={COLORS[i]}
                            />
                            <rect
                              x={x + 15}
                              y={y - 10 - i * 2}
                              width="47"
                              height="19"
                              rx="3"
                              fill="#152d36"
                              stroke={COLORS[i]}
                              strokeOpacity=".4"
                            />
                            <text
                              x={x + 22}
                              y={y + 3 - i * 2}
                              fill={COLORS[i]}
                              fontSize="9"
                              fontFamily="monospace"
                            >
                              UAV–0{i + 1}
                            </text>
                          </g>
                        </g>
                      );
                    })}
                    {assetsVisible &&
                      ASSETS.map((asset, i) => (
                        <g
                          key={asset.name}
                          transform={`translate(${219 + asset.x * 57},${46 + asset.y * 40.5})`}
                        >
                          <circle
                            r="15"
                            fill="#213c44"
                            stroke="#b8cac3"
                            strokeOpacity=".35"
                          />
                          {asset.kind === "wind" ? (
                            <g stroke="#d0dcd5" fill="none">
                              <path d="M0 1v10M0-1l0-10M0-1l-9 5M0-1l8 5" />
                              <circle cy="-1" r="2" />
                            </g>
                          ) : asset.kind === "platform" ? (
                            <g stroke="#d0dcd5" fill="none">
                              <path d="M-7-4H7V5H-7ZM-4 5v5M4 5v5M0-4v-7M-4-7h8" />
                            </g>
                          ) : (
                            <g stroke="#d0dcd5" fill="none">
                              <path d="M-8 2q4-7 8 0t8 0M-8 7q4-7 8 0t8 0" />
                            </g>
                          )}
                          <rect
                            x="-56"
                            y="20"
                            width="112"
                            height="19"
                            rx="3"
                            fill="#18303a"
                            fillOpacity=".9"
                          />
                          <text
                            y="33"
                            textAnchor="middle"
                            fill="#c1ceca"
                            fontSize="9"
                          >
                            {asset.name}
                          </text>
                          <text x="19" y="-9" fill="#7c9a99" fontSize="8">
                            0{i + 1}
                          </text>
                        </g>
                      ))}
                    <g transform="translate(504 451)">
                      <rect
                        x="-12"
                        y="-12"
                        width="24"
                        height="24"
                        rx="6"
                        fill="#d9e7dd"
                      />
                      <path
                        d="m-6 1 6-6 6 6M-4 0v6h8V0"
                        fill="none"
                        stroke="#24463f"
                        strokeWidth="1.5"
                      />
                      <text
                        y="29"
                        textAnchor="middle"
                        fontSize="9"
                        fill="#c6d6ce"
                      >
                        HOME / LAUNCH POINT
                      </text>
                    </g>
                  </g>
                  <text
                    x="420"
                    y="265"
                    fontSize="21"
                    fontWeight="400"
                    letterSpacing="9"
                    fill="#9eb9ba"
                    opacity=".12"
                  >
                    NORTH SEA
                  </text>
                  <g transform="translate(889 51)">
                    <path d="m0-17 6 22-6-4-6 4Z" fill="#d4e1db" />
                    <text
                      y="-24"
                      textAnchor="middle"
                      fill="#c8d8d4"
                      fontSize="10"
                    >
                      N
                    </text>
                  </g>
                  <g transform="translate(25 467)" fill="#a4b9b7" fontSize="9">
                    <path
                      d="M0 0v5h82v-5M41 0v5"
                      fill="none"
                      stroke="#a4b9b7"
                    />
                    <text y="20">0</text>
                    <text x="32" y="20">
                      1 km
                    </text>
                    <text x="73" y="20">
                      2 km
                    </text>
                  </g>
                </svg>
                <div className="map-status">
                  <span className={running ? "live-dot" : "idle-dot"} />
                  {completed
                    ? "Mission complete"
                    : running
                      ? "Simulation running"
                      : elapsed > 0
                        ? "Simulation paused"
                        : "Ready to simulate"}
                </div>
                <div className="map-controls">
                  <button
                    aria-label="Zoom in"
                    onClick={() => setZoom((v) => Math.min(1.6, v + 0.2))}
                  >
                    +
                  </button>
                  <button
                    aria-label="Zoom out"
                    onClick={() => setZoom((v) => Math.max(0.8, v - 0.2))}
                  >
                    −
                  </button>
                  <span />
                  <button
                    aria-label="Reset map view"
                    onClick={() => setZoom(1)}
                  >
                    <Icon name="target" size={17} />
                  </button>
                </div>
                <div className="map-layers">
                  <button
                    onClick={() => setLayerMenu(!layerMenu)}
                    aria-expanded={layerMenu}
                  >
                    <Icon name="layers" size={16} />
                    Map layers
                    <Icon name="arrow" size={12} />
                  </button>
                  {layerMenu && (
                    <div className="layers-menu">
                      <label>
                        <input
                          type="checkbox"
                          checked={routesVisible}
                          onChange={(e) => setRoutesVisible(e.target.checked)}
                        />
                        Drone routes
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={assetsVisible}
                          onChange={(e) => setAssetsVisible(e.target.checked)}
                        />
                        Infrastructure
                      </label>
                    </div>
                  )}
                </div>
                <span className="map-attribution">
                  SYNTHETIC BATHYMETRY · SIMULATION ONLY
                </span>
              </div>
              <div className="map-legend">
                {NAMES.map((name, i) => (
                  <button
                    key={name}
                    onClick={() =>
                      setSelectedDrone(selectedDrone === i ? null : i)
                    }
                    className={selectedDrone === i ? "selected" : ""}
                  >
                    <span style={{ background: COLORS[i] }} />
                    UAV–0{i + 1}
                    <small>{name}</small>
                  </button>
                ))}
                <span className="legend-boundary">
                  <i />
                  Mission boundary
                </span>
              </div>
              <div className="playback">
                <button
                  className="play-round"
                  aria-label={running ? "Pause simulation" : "Play simulation"}
                  onClick={() => {
                    if (completed) setElapsed(0);
                    setRunning(!running);
                  }}
                >
                  <Icon name={running ? "pause" : "play"} size={16} />
                </button>
                <span className="elapsed-time" data-testid="elapsed-time">
                  {fmtTime(elapsed)}
                </span>
                <input
                  className="timeline"
                  aria-label="Simulation timeline"
                  type="range"
                  min="0"
                  max={plan.duration}
                  step="any"
                  value={elapsed}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setElapsed(
                      next >= plan.duration - 0.001 ? plan.duration : next,
                    );
                    setRunning(false);
                  }}
                />
                <span className="duration-time">{fmtTime(plan.duration)}</span>
                <select
                  aria-label="Playback speed"
                  value={rate}
                  onChange={(e) => setRate(Number(e.target.value))}
                >
                  <option value="1">1× speed</option>
                  <option value="10">10× speed</option>
                  <option value="50">50× speed</option>
                  <option value="100">100× speed</option>
                </select>
                <button
                  className="reset-playback"
                  aria-label="Reset simulation"
                  onClick={reset}
                >
                  <Icon name="reset" size={17} />
                </button>
              </div>
            </section>
            <aside className="config-panel" id="mission-config">
              <div className="panel-heading">
                <h2>Mission configuration</h2>
                <Icon name="settings" size={17} />
              </div>
              <div className="config-content">
                <div className="section-label">COVERAGE STRATEGY</div>
                <label
                  className={`strategy-card ${options.strategy === "optimized" ? "chosen" : ""}`}
                >
                  <input
                    type="radio"
                    name="strategy"
                    value="optimized"
                    checked={options.strategy === "optimized"}
                    onChange={() => updateOptions({ strategy: "optimized" })}
                  />
                  <span>
                    <strong>
                      Coordinated sweep
                      <span className="recommended">RECOMMENDED</span>
                    </strong>
                    <small>Balanced sectors. Less transit.</small>
                  </span>
                </label>
                <label
                  className={`strategy-card ${options.strategy === "baseline" ? "chosen" : ""}`}
                >
                  <input
                    type="radio"
                    name="strategy"
                    value="baseline"
                    checked={options.strategy === "baseline"}
                    onChange={() => updateOptions({ strategy: "baseline" })}
                  />
                  <span>
                    <strong>Parallel sweep</strong>
                    <small>Fixed strips. Baseline comparison.</small>
                  </span>
                </label>
                <div className="config-divider" />
                <div className="section-label">FLIGHT PARAMETERS</div>
                <Parameter
                  label="Cruise speed"
                  value={options.speed}
                  unit="m/s"
                  min={8}
                  max={30}
                  step={1}
                  onChange={(v) => updateOptions({ speed: v })}
                />
                <Parameter
                  label="Sensor swath"
                  value={options.swath}
                  unit="m"
                  min={200}
                  max={1000}
                  step={50}
                  onChange={(v) => updateOptions({ swath: v })}
                />
                <Parameter
                  label="Coverage overlap"
                  value={options.overlap}
                  unit="%"
                  min={0}
                  max={40}
                  step={5}
                  onChange={(v) => updateOptions({ overlap: v })}
                />
                <div className="config-divider" />
                <div className="coverage-header">
                  <span>Area covered</span>
                  <strong data-testid="coverage-value">
                    {coverage.toFixed(1)}
                    <small> / 100 km²</small>
                  </strong>
                </div>
                <div className="coverage-track">
                  <span style={{ width: `${coverage}%` }} />
                </div>
                <div className="coverage-caption">
                  <span>{coverage.toFixed(1)}% coverage</span>
                  <span>Target: 100%</span>
                </div>
                <div className="model-note">
                  <Icon name="check" size={14} />
                  <span>
                    Best of candidate sweep routes.
                    <br />
                    Includes return to launch point.
                  </span>
                </div>
                <button
                  className="button primary run-button"
                  onClick={() => {
                    if (completed) setElapsed(0);
                    setRunning(!running);
                  }}
                >
                  <Icon name={running ? "pause" : "play"} size={17} />
                  {running
                    ? "Pause simulation"
                    : completed
                      ? "Run again"
                      : elapsed > 0
                        ? "Resume simulation"
                        : "Run simulation"}
                </button>
                <div className="config-footnote">
                  Local simulation · No live aircraft connected
                </div>
              </div>
            </aside>
          </div>
          <section className="fleet-panel" id="fleet">
            <div className="fleet-heading">
              <div>
                <h2>
                  Fleet status <span>5 drones</span>
                </h2>
                <p>Your coordinated eyes over the water.</p>
              </div>
              <div className="fleet-ready">
                <span className="live-dot" />
                {completed
                  ? "All drones returned"
                  : running
                    ? "Mission in progress"
                    : elapsed > 0
                      ? "Simulation paused"
                      : "All systems ready"}
              </div>
            </div>
            <div className="fleet-grid">
              {plan.routes.map((route, i) => {
                const progress = Math.min(
                  100,
                  ((elapsed * options.speed) / 1000 / route.distance) * 100,
                );
                return (
                  <button
                    key={route.id}
                    className={`drone-card ${selectedDrone === i ? "drone-selected" : ""}`}
                    onClick={() =>
                      setSelectedDrone(selectedDrone === i ? null : i)
                    }
                    style={
                      { "--drone-color": COLORS[i] } as React.CSSProperties
                    }
                  >
                    <div className="drone-card-top">
                      <span className="drone-icon">
                        <Icon name="drone" size={23} />
                      </span>
                      <div>
                        <strong>UAV–0{i + 1}</strong>
                        <small>{NAMES[i]}</small>
                      </div>
                      <span className="drone-status">
                        {progress >= 100
                          ? "Home"
                          : running
                            ? "Flying"
                            : elapsed > 0
                              ? "Paused"
                              : "Ready"}
                      </span>
                    </div>
                    <div className="drone-metrics">
                      <div>
                        Route length
                        <strong>
                          {route.distance.toFixed(1)} <small>km</small>
                        </strong>
                      </div>
                      <div>
                        Flight time
                        <strong>
                          {Math.ceil(
                            (route.distance * 1000) / options.speed / 60,
                          )}{" "}
                          <small>min</small>
                        </strong>
                      </div>
                    </div>
                    <div className="drone-progress">
                      <span style={{ width: `${progress}%` }} />
                    </div>
                    <div className="drone-bottom">
                      <span>Sector 0{i + 1}</span>
                      <span>{progress.toFixed(0)}% complete</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
          <footer className="dashboard-footer">
            <span>
              <span className="live-dot" />
              Simulation engine ready <i>•</i> Deterministic coverage model
            </span>
            <span>
              Ideal conditions <i>•</i> No battery or weather constraints{" "}
              <Icon name="help" size={13} />
            </span>
          </footer>
        </main>
      </div>
      {notice && (
        <div role="status" className="toast">
          <Icon name="check" size={18} />
          {notice}
        </div>
      )}
      {dialog && (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <section
            className="mission-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close-modal"
              onClick={() => setDialog(null)}
              aria-label="Close dialog"
            >
              <Icon name="close" />
            </button>
            {dialog === "mission" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  setMissionName(
                    String(form.get("name")).trim() ||
                      "Untitled maritime mission",
                  );
                  setDialog(null);
                  setNotice("Mission details updated");
                }}
              >
                <div className="eyebrow">MISSION DETAILS</div>
                <h2 id="modal-title">Make the mission yours.</h2>
                <label htmlFor="mission-name">Mission name</label>
                <input
                  id="mission-name"
                  name="name"
                  defaultValue={missionName}
                  maxLength={70}
                  required
                  autoFocus
                />
                <p>
                  The simulation uses a fixed 100 km² synthetic maritime area
                  and five drones. Adjust flight parameters in the configuration
                  panel.
                </p>
                <button className="button primary" type="submit">
                  Save mission
                </button>
              </form>
            ) : (
              <>
                <div className="eyebrow">SIMULATION GUIDE</div>
                <h2 id="modal-title">Plan. Simulate. Compare.</h2>
                <p>
                  Choose a coverage strategy and set your cruise speed, sensor
                  swath, and overlap. Press Run simulation or scrub the timeline
                  to inspect coverage.
                </p>
                <h3>How the model works</h3>
                <p>
                  Five drones launch from a common base, sweep assigned sectors,
                  and return. Coordinated sweep compares candidate partitions
                  and directions to minimize the longest flight time. Parallel
                  sweep is the fixed-strip baseline.
                </p>
                <p>
                  Coverage is estimated from sampled sensor footprints. This is
                  a synthetic, ideal-conditions planning model—not flight-ready
                  navigation. It excludes wind, endurance, collision avoidance,
                  restricted airspace, and asset-specific inspection
                  requirements.
                </p>
                <button
                  className="button primary"
                  onClick={() => setDialog(null)}
                >
                  Got it
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Metric({
  icon,
  label,
  value,
  unit,
  detail,
  badge,
}: {
  icon: IconName;
  label: string;
  value: string;
  unit: string;
  detail: string;
  badge?: string;
}) {
  return (
    <div className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <Icon name={icon} size={18} />
      </div>
      <div className="metric-value">
        {value}
        <span>{unit}</span>
        {badge && (
          <small className="metric-badge">
            {badge === "All ready" && <span className="live-dot" />}
            {badge}
          </small>
        )}
      </div>
      <div className="metric-detail">{detail}</div>
    </div>
  );
}
function Parameter({
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="parameter">
      <label>
        <span>{label}</span>
        <strong>
          {value} <small>{unit}</small>
        </strong>
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={
            {
              "--range-progress": `${((value - min) / (max - min)) * 100}%`,
            } as React.CSSProperties
          }
        />
      </label>
      <div className="range-labels">
        <span>
          {min} {unit}
        </span>
        <span>
          {max} {unit}
        </span>
      </div>
    </div>
  );
}
