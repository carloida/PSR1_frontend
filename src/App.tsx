import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useState } from "react";

import { apiBaseUrl, fetchDashboardData, runPipelineStep, uploadSourceFile, type PipelineRunResult, type PipelineStep } from "./api";
import { mockData } from "./mockData";
import type { DashboardData, DataFile, ModelRow, PlotFile, WindowRecord } from "./types";

type ViewKey = "review" | "ingest" | "windows" | "models" | "files";

const views: Array<{ key: ViewKey; label: string }> = [
  { key: "ingest", label: "1 Live Pipeline" },
  { key: "windows", label: "2 SPC Windows" },
  { key: "models", label: "3 Clean ML" },
  { key: "review", label: "4 Engineering Review" },
  { key: "files", label: "Outputs" }
];

const rules: Array<{ key: keyof WindowRecord; label: string }> = [
  { key: "is_3sigma_outlier", label: "3-sigma" },
  { key: "is_iqr_outlier", label: "IQR" },
  { key: "ewma_flag", label: "EWMA" },
  { key: "cusum_flag", label: "CUSUM" }
];

const DEFAULT_PLOT_RAIL_WIDTH = 400;
const MIN_PLOT_RAIL_WIDTH = 320;
const MAX_PLOT_RAIL_WIDTH = 760;

function App() {
  const [data, setData] = useState<DashboardData>(mockData);
  const [source, setSource] = useState<"api" | "sample">("sample");
  const [activeView, setActiveView] = useState<ViewKey>("ingest");
  const [selectedWindow, setSelectedWindow] = useState<WindowRecord>(mockData.windows[0]);
  const [selectedPlotId, setSelectedPlotId] = useState(mockData.plot_files[0]?.id ?? "");
  const [sensor, setSensor] = useState("All sensors");
  const [step, setStep] = useState("All steps");
  const [anomalyOnly, setAnomalyOnly] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [modalPlot, setModalPlot] = useState<PlotFile | undefined>();
  const [plotZoom, setPlotZoom] = useState(100);
  const [plotRailHidden, setPlotRailHidden] = useState(() => window.localStorage.getItem("psr-fdc-plot-rail-hidden") === "true");
  const [plotRailWidth, setPlotRailWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem("psr-fdc-plot-rail-width"));
    return Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_PLOT_RAIL_WIDTH;
  });

  useEffect(() => {
    void refreshDashboard();
  }, []);

  async function refreshDashboard() {
    const result = await fetchDashboardData();
    setData(result.data);
    setSource(result.source);
    setSelectedWindow(result.data.windows.find((row) => row.target_anomaly === 1) ?? result.data.windows[0] ?? mockData.windows[0]);
    setSelectedPlotId(result.data.plot_files[0]?.id ?? "");
  }

  const sensors = useMemo(() => unique(data.windows.map((row) => row.sensor_name)), [data.windows]);
  const steps = useMemo(() => unique(data.windows.map((row) => row.process_step)), [data.windows]);
  const selectedPlot = data.plot_files.find((plot) => plot.id === selectedPlotId) ?? data.plot_files[0];

  const filteredWindows = useMemo(() => {
    return data.windows
      .filter((row) => sensor === "All sensors" || row.sensor_name === sensor)
      .filter((row) => step === "All steps" || row.process_step === step)
      .filter((row) => !anomalyOnly || Number(row.target_anomaly) === 1)
      .sort((a, b) => Math.abs(Number(b.z_score ?? 0)) - Math.abs(Number(a.z_score ?? 0)));
  }, [anomalyOnly, data.windows, sensor, step]);

  const page = {
    review: <ReviewPage data={data} selectedWindow={selectedWindow} setActiveView={setActiveView} setSelectedWindow={setSelectedWindow} />,
    ingest: <IngestPage data={data} onRefresh={refreshDashboard} />,
    windows: (
      <WindowsPage
        anomalyOnly={anomalyOnly}
        filteredWindows={filteredWindows}
        selectedWindow={selectedWindow}
        sensor={sensor}
        sensors={sensors}
        setAnomalyOnly={setAnomalyOnly}
        setSelectedWindow={setSelectedWindow}
        setSensor={setSensor}
        setStep={setStep}
        step={step}
        steps={steps}
      />
    ),
    models: <ModelsPage data={data} />,
    files: <FilesPage files={data.files} openPlot={openPlot} plots={data.plot_files} setSelectedPlotId={setSelectedPlotId} />
  };

  function openPlot(plot: PlotFile) {
    setSelectedPlotId(plot.id);
    setModalPlot(plot);
    setPlotZoom(100);
  }

  function updatePlotRailWidth(width: number) {
    const next = Math.min(MAX_PLOT_RAIL_WIDTH, Math.max(MIN_PLOT_RAIL_WIDTH, Math.round(width)));
    setPlotRailWidth(next);
    window.localStorage.setItem("psr-fdc-plot-rail-width", String(next));
  }

  function updatePlotRailHidden(hidden: boolean) {
    setPlotRailHidden(hidden);
    window.localStorage.setItem("psr-fdc-plot-rail-hidden", String(hidden));
  }

  return (
    <div className={`app-shell ${plotRailHidden ? "plots-hidden" : ""}`} style={{ "--plot-rail-width": `${plotRailWidth}px` } as CSSProperties}>
      <aside className="left-nav">
        <div className="brand">
          <strong>PSR1</strong>
          <span>PM1 live anomaly review</span>
        </div>

        <nav>
          {views.map((view) => (
            <button className={activeView === view.key ? "active" : ""} key={view.key} onClick={() => setActiveView(view.key)}>
              {view.label}
            </button>
          ))}
        </nav>

        <div className="source-card">
          <span className={source === "api" ? "dot on" : "dot"} />
          <div>
            <strong>{source === "api" ? "API connected" : "Sample fallback"}</strong>
            <small>{data.plot_files.length} plots indexed</small>
          </div>
        </div>
      </aside>

      <main className="main-pane">
        <header className="project-header">
          <div>
            <div className="project-logo-row" aria-label="Project affiliations">
              <span className="logo-tile logo-tile-nus">
                <img alt="National University of Singapore" src="/logos/nus-logo.png" />
              </span>
              <span className="logo-tile logo-tile-msba">
                <img alt="NUS Master of Science Business Analytics" src="/logos/nus-msba-logo.png" />
              </span>
            </div>
            <h1>PSR1 Real-Time FDC Console</h1>
            <div className="project-color-strip" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className="project-header-actions">
            {plotRailHidden ? (
              <button className="project-show-plots" type="button" onClick={() => updatePlotRailHidden(false)}>
                Show insights
              </button>
            ) : null}
            <button type="button" onClick={() => setAboutOpen(true)}>About project</button>
          </div>
        </header>

        <header className="page-header">
          <div>
            <p>Semiconductor FDC prototype</p>
            <h1>{views.find((view) => view.key === activeView)?.label}</h1>
          </div>
          <span className="scope-pill">Real-time anomaly support, not confirmed fault-code diagnosis</span>
        </header>

        <section className="notice">
          Live flow: ingest PM1 sensor data, convert readings into 5-minute step-aware windows, score anomalies with clean ML plus SPC/range guardrails, then explain deterministic patterns for engineering review.
        </section>

        {page[activeView]}
      </main>

      {plotRailHidden ? null : (
        <PlotRail
          openPlot={openPlot}
          plotRailWidth={plotRailWidth}
          plots={data.plot_files}
          selectedPlot={selectedPlot}
          setPlotRailHidden={updatePlotRailHidden}
          setPlotRailWidth={updatePlotRailWidth}
          setSelectedPlotId={setSelectedPlotId}
        />
      )}

      {modalPlot ? (
        <PlotModal
          plot={modalPlot}
          setPlotZoom={setPlotZoom}
          zoom={plotZoom}
          onClose={() => setModalPlot(undefined)}
        />
      ) : null}

      {aboutOpen ? <AboutModal onClose={() => setAboutOpen(false)} /> : null}
    </div>
  );
}

function ReviewPage({
  data,
  selectedWindow,
  setActiveView,
  setSelectedWindow
}: {
  data: DashboardData;
  selectedWindow: WindowRecord;
  setActiveView: (view: ViewKey) => void;
  setSelectedWindow: (row: WindowRecord) => void;
}) {
  const topWindows = data.windows
    .filter((row) => Number(row.target_anomaly) === 1)
    .sort((a, b) => Math.abs(Number(b.z_score ?? 0)) - Math.abs(Number(a.z_score ?? 0)))
    .slice(0, 8);

  return (
    <div className="stack">
      <div className="metric-strip">
        <Metric label="Windows scored" value={data.overview.total_windows} />
        <Metric label="Anomaly windows" value={data.overview.anomaly_windows} detail={formatPct(data.overview.anomaly_rate)} tone="warn" />
        <Metric label="Sensors watched" value={data.overview.sensor_count} />
        <Metric label="Recipe steps" value={data.overview.process_step_count} />
        <Metric label="Clean ML F1" value={formatMetric(data.overview.random_forest?.f1)} />
      </div>

      <LiveInferenceStatus data={data} selectedWindow={selectedWindow} />

      <div className="two-col">
        <Panel title="Backend Flow Match" subtitle="Mirrors the updated PSR1 repo">
          <ol className="pipeline-list">
            <li><strong>PM1 source intake</strong><span>Load CSV/XLSX sensor exports now; prepare read-only database links for later streaming.</span></li>
            <li><strong>5-minute feature windows</strong><span>Build mean, std, min/max, range, slope, setpoint error, oscillation, and prior-window trends.</span></li>
            <li><strong>SPC pseudo-labels</strong><span>Create target_anomaly from statistical rules and keep those guardrails separate from learned inputs.</span></li>
            <li><strong>Clean ML anomaly models</strong><span>Compare Logistic Regression, Random Forest, XGBoost, LightGBM, Isolation Forest, LOF, and autoencoder-style baselines when outputs exist.</span></li>
            <li><strong>Deterministic explanation</strong><span>Summarize causes, evidence, missing evidence, next questions, and troubleshooting actions without AI tokens.</span></li>
          </ol>
        </Panel>

        <Panel title="Selected Evidence" subtitle={selectedWindow.sensor_name}>
          <Evidence row={selectedWindow} />
        </Panel>
      </div>

      <Panel title="Live Review Queue" subtitle="Highest absolute z-score anomaly windows">
        <SimpleWindowTable
          rows={topWindows}
          onSelect={(row) => {
            setSelectedWindow(row);
            setActiveView("windows");
          }}
        />
      </Panel>
    </div>
  );
}

function LiveInferenceStatus({ data, selectedWindow }: { data: DashboardData; selectedWindow: WindowRecord }) {
  const activeAnomaly = Number(selectedWindow.target_anomaly) === 1;
  const latestWindow = data.windows
    .slice()
    .sort((a, b) => new Date(b.window_start).getTime() - new Date(a.window_start).getTime())[0] ?? selectedWindow;

  const cards = [
    {
      label: "Equipment",
      value: "PM1 chamber",
      detail: `${data.overview.sensor_count} sensors indexed`
    },
    {
      label: "Latest window",
      value: shortDate(latestWindow.window_start),
      detail: `${latestWindow.process_step} / ${latestWindow.sensor_name}`
    },
    {
      label: "Guardrail status",
      value: activeAnomaly ? "Triggered" : "Within range",
      detail: triggeredRules(selectedWindow).join(", ") || "No SPC rules triggered",
      tone: activeAnomaly ? "alert" : "ok"
    },
    {
      label: "Inference agent",
      value: "Token-free",
      detail: "Case file ready for deterministic explanation"
    }
  ];

  return (
    <section className="live-strip" aria-label="Real-time equipment inference status">
      {cards.map((card) => (
        <article className={card.tone ?? ""} key={card.label}>
          <span>{card.label}</span>
          <strong>{card.value}</strong>
          <small>{card.detail}</small>
        </article>
      ))}
    </section>
  );
}

function WindowsPage({
  anomalyOnly,
  filteredWindows,
  selectedWindow,
  sensor,
  sensors,
  setAnomalyOnly,
  setSelectedWindow,
  setSensor,
  setStep,
  step,
  steps
}: {
  anomalyOnly: boolean;
  filteredWindows: WindowRecord[];
  selectedWindow: WindowRecord;
  sensor: string;
  sensors: string[];
  setAnomalyOnly: (value: boolean) => void;
  setSelectedWindow: (row: WindowRecord) => void;
  setSensor: (value: string) => void;
  setStep: (value: string) => void;
  step: string;
  steps: string[];
}) {
  return (
    <div className="stack">
      <div className="filters">
        <label>
          <span>Sensor</span>
          <select value={sensor} onChange={(event) => setSensor(event.target.value)}>
            <option>All sensors</option>
            {sensors.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>Process step</span>
          <select value={step} onChange={(event) => setStep(event.target.value)}>
            <option>All steps</option>
            {steps.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="check">
          <input checked={anomalyOnly} type="checkbox" onChange={(event) => setAnomalyOnly(event.target.checked)} />
          <span>Anomaly only</span>
        </label>
      </div>

      <div className="two-col wide-left">
        <Panel title="SPC Window Table" subtitle={`${filteredWindows.length} windows shown`}>
          <SimpleWindowTable rows={filteredWindows.slice(0, 80)} selected={selectedWindow} onSelect={setSelectedWindow} />
        </Panel>
        <Panel title="Window Detail" subtitle="SPC rules and weak mapping">
          <Evidence row={selectedWindow} />
        </Panel>
      </div>
    </div>
  );
}

function ModelsPage({ data }: { data: DashboardData }) {
  const modelRows = data.model_comparison.filter((row) => modelDisplayName(row) || hasModelMetric(row));
  const defaultModelName = modelDisplayName(modelRows[0] ?? {});
  const [selectedModelName, setSelectedModelName] = useState(defaultModelName);

  useEffect(() => {
    if (!modelRows.length) return;
    const names = modelRows.map(modelDisplayName);
    if (!selectedModelName || !names.includes(selectedModelName)) {
      setSelectedModelName(defaultModelName || names[0]);
    }
  }, [defaultModelName, modelRows, selectedModelName]);

  const selectedModel = modelRows.find((row) => modelDisplayName(row) === selectedModelName) ?? modelRows[0] ?? {};
  const selectedDescription = selectedModel.description ?? selectedModel.type ?? "Clean anomaly target_anomaly evaluation";

  return (
    <div className="stack">
      <Panel title="Model Scorecard" subtitle="Choose a trained model to inspect its evaluation metrics">
        <div className="model-picker">
          <label>
            <span>Selected model</span>
            <select value={modelDisplayName(selectedModel)} onChange={(event) => setSelectedModelName(event.target.value)}>
              {modelRows.map((row) => (
                <option key={modelDisplayName(row)} value={modelDisplayName(row)}>
                  {formatModelName(modelDisplayName(row))}
                </option>
              ))}
            </select>
          </label>
          <p>{selectedDescription}</p>
        </div>
      </Panel>

      <div className="metric-strip">
        <Metric label="Accuracy" value={formatMetric(selectedModel.accuracy)} />
        <Metric label="Precision" value={formatMetric(selectedModel.precision)} />
        <Metric label="Recall" value={formatMetric(selectedModel.recall)} />
        <Metric label="F1" value={formatMetric(selectedModel.f1)} />
        <Metric label="ROC AUC" value={formatMetric(selectedModel.roc_auc)} />
      </div>

      <Panel title="Leakage-Safe Training Contract" subtitle="How the updated PSR1 backend should be interpreted">
        <div className="model-note">
          <article>
            <strong>Learned inputs</strong>
            <span>Use clean window features such as mean, std, range, slope, setpoint error, oscillation, and previous-window trends.</span>
          </article>
          <article>
            <strong>Excluded from ML</strong>
            <span>Do not train on z_score, abs_z_score, baseline stats, control-limit distances, SPC flags, or prior anomaly labels.</span>
          </article>
          <article>
            <strong>Runtime decision</strong>
            <span>Combine clean ML probability with deterministic SPC/range guardrails, then send the case into the inference agent.</span>
          </article>
        </div>
      </Panel>

      <div className="two-col">
        <Panel title="Model Comparison" subtitle="Click a row to update the scorecard">
          <ModelTable rows={modelRows} selected={selectedModel} onSelect={(row) => setSelectedModelName(modelDisplayName(row))} />
        </Panel>
        <Panel title="Feature Importance" subtitle="Random Forest baseline">
          <Bars items={data.feature_importance.map((row) => ({ label: row.feature, value: row.importance }))} />
        </Panel>
      </div>
    </div>
  );
}

function IngestPage({ data, onRefresh }: { data: DashboardData; onRefresh: () => Promise<void> }) {
  const [sourceMode, setSourceMode] = useState<"upload" | "database">("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dbType, setDbType] = useState("PostgreSQL");
  const [connectionName, setConnectionName] = useState("PSR PM1 historian");
  const [runningStep, setRunningStep] = useState<PipelineStep | null>(null);
  const [runLog, setRunLog] = useState("Ready. Load or validate PM1 data, then run the live anomaly pipeline.");
  const [pipelineProgress, setPipelineProgress] = useState({ active: false, label: "Ready", percent: 0 });
  const [uploadStatus, setUploadStatus] = useState("");
  const [databaseStatus, setDatabaseStatus] = useState("");

  const stepButtons: Array<{ step: Exclude<PipelineStep, "all">; label: string; percent: number }> = [
    { step: "validate", label: "Validate source", percent: 10 },
    { step: "eda", label: "Profile PM1 signals", percent: 30 },
    { step: "spc", label: "Build SPC windows", percent: 52 },
    { step: "ml", label: "Train clean ML", percent: 78 },
    { step: "faults", label: "Refresh evidence library", percent: 100 }
  ];

  async function runStep(step: PipelineStep) {
    if (step === "all") {
      await runFullPipeline();
      return;
    }
    setRunningStep(step);
    setPipelineProgress({ active: true, label: `Running ${stepLabel(step)}`, percent: 0 });
    setRunLog(`Running ${stepLabel(step)}...`);
    try {
      const result = await runPipelineStep(step);
      setPipelineProgress({ active: false, label: `${result.label} complete`, percent: 100 });
      setRunLog(formatRunResult(result));
      await onRefresh();
    } catch (error) {
      setPipelineProgress({ active: false, label: `${stepLabel(step)} failed`, percent: 0 });
      setRunLog(error instanceof Error ? error.message : "Pipeline run failed.");
    } finally {
      setRunningStep(null);
    }
  }

  async function runFullPipeline() {
    const completed: PipelineRunResult[] = [];
    setRunningStep("all");
    setPipelineProgress({ active: true, label: "Starting full pipeline", percent: 0 });
    setRunLog("Starting full pipeline...");
    try {
      for (const item of stepButtons) {
        setPipelineProgress((current) => ({ active: true, label: item.label, percent: current.percent }));
        setRunLog(`Running ${item.label}...\n\n${formatRunResult({ step: "all", label: "Run live pipeline", ok: true, results: completed })}`);
        const result = await runPipelineStep(item.step);
        completed.push(result);
        setPipelineProgress({ active: true, label: `${item.label} complete`, percent: item.percent });
        setRunLog(formatRunResult({ step: "all", label: "Run live pipeline", ok: true, results: completed }));
      }
      setPipelineProgress({ active: false, label: "Pipeline complete", percent: 100 });
      await onRefresh();
    } catch (error) {
      setPipelineProgress((current) => ({ active: false, label: "Pipeline failed", percent: current.percent }));
      setRunLog(error instanceof Error ? error.message : "Pipeline run failed.");
    } finally {
      setRunningStep(null);
    }
  }

  async function uploadSelectedFile() {
    if (!selectedFile) {
      setUploadStatus("Choose one CSV or XLSX PM1 source file first.");
      return;
    }
    setUploadStatus(`Uploading ${selectedFile.name}...`);
    try {
      const result = await uploadSourceFile(selectedFile);
      setUploadStatus(`${result.filename} staged as data-0513PM1.csv with ${result.columns.length} columns.`);
      await onRefresh();
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : "Upload failed.");
    }
  }

  function saveDatabaseDraft() {
    setDatabaseStatus(`${connectionName || "Database"} draft saved locally for ${dbType}. Backend driver execution can be added next.`);
  }

  return (
    <div className="stack">
      <Panel title="Run Pipeline" subtitle="Main execution control">
        <div className="run-primary">
          <div>
            <button disabled={runningStep !== null} type="button" onClick={() => void runStep("all")}>
              {runningStep === "all" ? `Running ${pipelineProgress.percent}%` : "Run live pipeline"}
            </button>
            <strong>{"Validate source -> PM1 EDA -> SPC windows -> clean ML -> evidence refresh"}</strong>
            <span>Executes the current backend scripts in order, refreshes dashboard tables, and prepares outputs for live anomaly review.</span>
          </div>
        </div>
        <div className="live-strip pipeline-mini" aria-label="Current inference readiness">
          <article>
            <span>Window size</span>
            <strong>5 min</strong>
            <small>Step-aware sensor windows</small>
          </article>
          <article>
            <span>Runtime scoring</span>
            <strong>ML + SPC</strong>
            <small>Clean model probability with deterministic guardrails</small>
          </article>
          <article>
            <span>Agent mode</span>
            <strong>No tokens</strong>
            <small>Deterministic case-file explanation</small>
          </article>
          <article>
            <span>Indexed outputs</span>
            <strong>{data.plot_files.length}</strong>
            <small>Plots available in the insight rail</small>
          </article>
        </div>
        <div className="pipeline-progress" aria-live="polite">
          <div>
            <strong>{pipelineProgress.label}</strong>
            <span>{pipelineProgress.percent}%</span>
          </div>
          <div aria-label="Pipeline progress" aria-valuemax={100} aria-valuemin={0} aria-valuenow={pipelineProgress.percent} role="progressbar">
            <span style={{ background: progressColor(pipelineProgress.percent), width: `${pipelineProgress.percent}%` }} />
          </div>
        </div>
        <div className="run-sequence">
          {stepButtons.map((item, index) => (
            <button disabled={runningStep !== null} key={item.step} type="button" onClick={() => void runStep(item.step)}>
              {runningStep === item.step ? "Running..." : `${index + 1}. ${item.label}`}
            </button>
          ))}
        </div>
        <pre className="run-output">{runLog}</pre>
      </Panel>

      <Panel title="Data Source" subtitle="Choose how PM1 data enters the realtime review loop">
        <div className="source-switch" role="tablist" aria-label="Data source mode">
          <button className={sourceMode === "upload" ? "active" : ""} type="button" onClick={() => setSourceMode("upload")}>
            Upload data
          </button>
          <button className={sourceMode === "database" ? "active" : ""} type="button" onClick={() => setSourceMode("database")}>
            Link database
          </button>
        </div>

        {sourceMode === "upload" ? (
          <div className="source-panel">
            <label className="drop-zone compact">
              <input
                type="file"
                accept=".csv,.xlsx"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              />
              <strong>{selectedFile ? selectedFile.name : "Choose CSV or XLSX"}</strong>
              <span>{selectedFile ? `${Math.max(selectedFile.size / 1024, 1).toFixed(1)} KB selected` : "The upload becomes the canonical data-0513PM1.csv source."}</span>
            </label>
            <div className="ingest-actions inline">
              <button disabled={!selectedFile} type="button" onClick={() => void uploadSelectedFile()}>
                Stage upload
              </button>
              <small>{uploadStatus || "After staging, run the full pipeline from the top card."}</small>
            </div>
          </div>
        ) : (
          <div className="source-panel">
            <div className="db-card minimal">
              <label>
                <span>Connection name</span>
                <input value={connectionName} onChange={(event) => setConnectionName(event.target.value)} />
              </label>
              <label>
                <span>Database type</span>
                <select value={dbType} onChange={(event) => setDbType(event.target.value)}>
                  <option>PostgreSQL</option>
                  <option>SQL Server</option>
                  <option>MySQL</option>
                  <option>Oracle</option>
                  <option>SQLite</option>
                  <option>ODBC / historian</option>
                </select>
              </label>
              <label>
                <span>Host</span>
                <input placeholder="db.company.local" />
              </label>
              <label>
                <span>Port</span>
                <input placeholder={dbType === "PostgreSQL" ? "5432" : "1433"} />
              </label>
              <label>
                <span>Database / schema</span>
                <input placeholder="pm1_process_data" />
              </label>
              <label>
                <span>User</span>
                <input placeholder="readonly_user" />
              </label>
            </div>
            <div className="ingest-actions inline">
              <button type="button" onClick={saveDatabaseDraft}>Save source profile</button>
              <small>{databaseStatus || "Database execution is prepared as a source profile; credentials are not stored in this frontend."}</small>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

function FilesPage({ files, openPlot, plots, setSelectedPlotId }: { files: DataFile[]; openPlot: (plot: PlotFile) => void; plots: PlotFile[]; setSelectedPlotId: (id: string) => void }) {
  return (
    <div className="stack">
      <Panel title="Generated Tables" subtitle="CSV, JSON, and notes expected from PSR1">
        <FileTable files={files} />
      </Panel>
      <Panel title="Evidence Gallery" subtitle="Click an output to pin it in the right rail or open the zoom modal">
        <div className="plot-file-grid">
          {plots.map((plot) => (
            <button key={plot.id} onClick={() => {
              setSelectedPlotId(plot.id);
              openPlot(plot);
            }}>
              <strong>{plot.title}</strong>
              <span>{plot.group} / {plot.name}</span>
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function ExplainabilityAgent({ onCollapse, plots, selectedPlot }: { onCollapse: () => void; plots: PlotFile[]; selectedPlot?: PlotFile }) {
  const [messages, setMessages] = useState([
    {
      role: "agent",
      text: "Ask about the selected window, guardrails, clean ML outputs, generated evidence, logs, or engineering actions. This placeholder represents the deterministic PSR1 explainer; no AI model call is made."
    }
  ]);
  const [draft, setDraft] = useState("");
  const [contextFiles, setContextFiles] = useState<File[]>([]);
  const promptChips = [
    "Explain this anomaly",
    "Show guardrail evidence",
    "What context is missing?"
  ];

  function submitAgentQuestion(value = draft) {
    const question = value.trim();
    if (!question) return;
    setMessages((current) => [
      ...current,
      { role: "user", text: question },
      {
        role: "agent",
        text: `Placeholder response: the inference agent would inspect ${selectedPlot?.title ?? "the selected evidence"}, current dashboard rows, deterministic patterns such as setpoint error, variability, oscillation, drift, trend change, and range excursions, plus any uploaded logs or notes. It would return possible causes, supporting evidence, missing evidence, next questions, and troubleshooting actions without consuming AI tokens.`
      }
    ]);
    setDraft("");
  }

  return (
    <section className="agent-card" aria-label="Deterministic inference agent placeholder">
      <header>
        <div>
          <p>Inference agent</p>
          <h2>Deterministic anomaly explainer</h2>
        </div>
        <div className="agent-header-actions">
          <span>Token-free</span>
          <button aria-label="Collapse explainability agent" title="Collapse" type="button" onClick={onCollapse}>-</button>
        </div>
      </header>

      <div className="agent-context">
        <span>Selected: {selectedPlot?.title ?? "No plot"}</span>
        <span>{plots.length} plots indexed</span>
        <span>Case file ready</span>
      </div>

      <div className="agent-messages">
        {messages.map((message, index) => (
          <article className={message.role === "user" ? "user" : "agent"} key={`${message.role}-${index}`}>
            {message.text}
          </article>
        ))}
      </div>

      <div className="agent-prompts">
        {promptChips.map((prompt) => (
          <button key={prompt} type="button" onClick={() => submitAgentQuestion(prompt)}>
            {prompt}
          </button>
        ))}
      </div>

      <div className="agent-input">
        <label title="Attach local context for the future agent">
          +
          <input
            multiple
            type="file"
            accept=".csv,.xlsx,.json,.txt,.md,.png,.jpg,.jpeg,.pdf"
            onChange={(event) => setContextFiles(Array.from(event.target.files ?? []))}
          />
        </label>
        <input
          value={draft}
          placeholder="Ask about anomalies, signals, evidence..."
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitAgentQuestion();
          }}
        />
        <button type="button" onClick={() => submitAgentQuestion()}>Ask</button>
      </div>

      {contextFiles.length ? (
        <div className="agent-files">
          {contextFiles.slice(0, 3).map((file) => (
            <span key={`${file.name}-${file.size}`}>{file.name}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PlotRail({
  openPlot,
  plotRailWidth,
  plots,
  selectedPlot,
  setPlotRailHidden,
  setPlotRailWidth,
  setSelectedPlotId
}: {
  openPlot: (plot: PlotFile) => void;
  plotRailWidth: number;
  plots: PlotFile[];
  selectedPlot?: PlotFile;
  setPlotRailHidden: (hidden: boolean) => void;
  setPlotRailWidth: (width: number) => void;
  setSelectedPlotId: (id: string) => void;
}) {
  const groups = unique(plots.map((plot) => plot.group));
  const [plotPanelCollapsed, setPlotPanelCollapsed] = useState(() => window.localStorage.getItem("psr-fdc-plot-panel-collapsed") === "true");
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(() => window.localStorage.getItem("psr-fdc-agent-panel-collapsed") === "true");
  const [railSplitPercent, setRailSplitPercent] = useState(() => {
    const saved = Number(window.localStorage.getItem("psr-fdc-rail-split-percent"));
    return Number.isFinite(saved) && saved >= 45 && saved <= 78 ? saved : 68;
  });
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem("psr-fdc-collapsed-plot-groups") ?? "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });

  function toggleGroup(group: string) {
    setCollapsedGroups((current) => {
      const next = { ...current, [group]: !current[group] };
      window.localStorage.setItem("psr-fdc-collapsed-plot-groups", JSON.stringify(next));
      return next;
    });
  }

  function updatePlotPanelCollapsed(value: boolean) {
    setPlotPanelCollapsed(value);
    window.localStorage.setItem("psr-fdc-plot-panel-collapsed", String(value));
  }

  function updateAgentPanelCollapsed(value: boolean) {
    setAgentPanelCollapsed(value);
    window.localStorage.setItem("psr-fdc-agent-panel-collapsed", String(value));
  }

  function railRows() {
    if (plotPanelCollapsed && agentPanelCollapsed) return "2.3rem 2.8rem 2.8rem";
    if (plotPanelCollapsed) return "2.8rem minmax(0, 1fr)";
    if (agentPanelCollapsed) return "minmax(0, 1fr) 2.8rem";
    return `minmax(0, ${railSplitPercent}fr) 0.72rem minmax(0, ${100 - railSplitPercent}fr)`;
  }

  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = plotRailWidth;

    function onMove(moveEvent: PointerEvent) {
      setPlotRailWidth(startWidth - (moveEvent.clientX - startX));
    }

    function onUp() {
      document.body.classList.remove("is-resizing-plot-rail");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    document.body.classList.add("is-resizing-plot-rail");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startRailSplitResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const rail = event.currentTarget.parentElement;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    let latest = railSplitPercent;

    function onMove(moveEvent: PointerEvent) {
      const next = Math.min(78, Math.max(45, ((moveEvent.clientY - rect.top) / rect.height) * 100));
      latest = Math.round(next);
      setRailSplitPercent(latest);
    }

    function onUp() {
      document.body.classList.remove("is-resizing-rail-split");
      window.localStorage.setItem("psr-fdc-rail-split-percent", String(latest));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    document.body.classList.add("is-resizing-rail-split");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <aside className="plot-rail" style={{ gridTemplateRows: railRows() }}>
      <button
        aria-label="Resize generated plots panel"
        className="plot-resize-handle"
        onDoubleClick={() => setPlotRailWidth(DEFAULT_PLOT_RAIL_WIDTH)}
        onPointerDown={startResize}
        title="Drag to resize. Double-click to reset."
        type="button"
      />
      {plotPanelCollapsed && agentPanelCollapsed ? (
        <button className="rail-minimized-hide" type="button" onClick={() => setPlotRailHidden(true)}>Hide panel</button>
      ) : null}
      {plotPanelCollapsed ? (
        <CollapsedRailPanel count={`${plots.length} outputs`} title="Generated evidence" onExpand={() => updatePlotPanelCollapsed(false)} />
      ) : (
      <div className="plot-card">
        <div className="plot-header">
          <div>
            <p>Generated evidence</p>
            <h2>{selectedPlot?.title ?? "No plot found"}</h2>
          </div>
          <div className="plot-header-actions">
            <button aria-label="Collapse generated plots" title="Collapse" type="button" onClick={() => updatePlotPanelCollapsed(true)}>-</button>
            <button className="hide-panel-button" type="button" onClick={() => setPlotRailHidden(true)}>Hide panel</button>
          </div>
        </div>

        <div className="plot-stage">
          {selectedPlot ? (
            <button className="plot-open" onClick={() => openPlot(selectedPlot)} type="button">
              <img alt={selectedPlot.title} src={plotUrl(selectedPlot)} />
                <span>Click to zoom evidence</span>
            </button>
          ) : (
            <div className="empty">Run PSR1 output scripts to populate evidence.</div>
          )}
        </div>

        <div className="plot-list">
          {groups.map((group) => (
            <section key={group}>
              <button
                aria-expanded={!collapsedGroups[group]}
                className="plot-group-toggle"
                type="button"
                onClick={() => toggleGroup(group)}
              >
                <span>{collapsedGroups[group] ? "+" : "-"}</span>
                <strong>{group}</strong>
                <small>{plots.filter((plot) => plot.group === group).length}</small>
              </button>
              {!collapsedGroups[group] ? (
                <div className="plot-group-items">
                  {plots.filter((plot) => plot.group === group).map((plot) => (
                    <button className={plot.id === selectedPlot?.id ? "active" : ""} key={plot.id} onClick={() => setSelectedPlotId(plot.id)}>
                      <span>{plot.title}</span>
                      <small>{plot.name}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </div>
      )}
      {!plotPanelCollapsed && !agentPanelCollapsed ? (
        <button
          aria-label="Resize generated evidence and inference agent"
          className="rail-split-handle"
          title="Drag to resize the evidence and agent panels"
          type="button"
          onPointerDown={startRailSplitResize}
        />
      ) : null}
      {agentPanelCollapsed ? (
        <CollapsedRailPanel count="Token-free" title="Inference agent" onExpand={() => updateAgentPanelCollapsed(false)} />
      ) : (
        <ExplainabilityAgent onCollapse={() => updateAgentPanelCollapsed(true)} plots={plots} selectedPlot={selectedPlot} />
      )}
    </aside>
  );
}

function CollapsedRailPanel({ count, onExpand, title }: { count: string; onExpand: () => void; title: string }) {
  return (
    <button className="rail-collapsed-panel" type="button" onClick={onExpand}>
      <strong>{title}</strong>
      <span>{count}</span>
      <small aria-hidden="true">+</small>
    </button>
  );
}

function PlotModal({
  onClose,
  plot,
  setPlotZoom,
  zoom
}: {
  onClose: () => void;
  plot: PlotFile;
  setPlotZoom: (value: number) => void;
  zoom: number;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${plot.title} zoom viewer`}>
      <div className="plot-modal">
        <header>
          <div>
            <p>{plot.group}</p>
            <h2>{plot.title}</h2>
          </div>
          <button onClick={onClose} type="button">Close</button>
        </header>

        <div className="zoom-controls">
          <button onClick={() => setPlotZoom(Math.max(50, zoom - 25))} type="button">-</button>
          <input
            min="50"
            max="300"
            step="10"
            type="range"
            value={zoom}
            onChange={(event) => setPlotZoom(Number(event.target.value))}
          />
          <button onClick={() => setPlotZoom(Math.min(300, zoom + 25))} type="button">+</button>
          <button onClick={() => setPlotZoom(100)} type="button">Reset</button>
          <strong>{zoom}%</strong>
        </div>

        <div className="modal-image-wrap">
          <img alt={plot.title} src={plotUrl(plot)} style={{ width: `${zoom}%` }} />
        </div>
      </div>
    </div>
  );
}

function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="About the PSR1 PM1 FDC prototype">
      <section className="about-modal">
        <header>
          <div>
            <p>About this project</p>
            <h2>PSR1 Real-Time FDC Prototype</h2>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </header>

        <div>
          <p>
            PSR1 is a semiconductor equipment FDC prototype for PM1 sensor anomaly review. It converts raw time-series readings into 5-minute, step-aware windows, creates SPC pseudo-labels, trains clean anomaly models, and prepares generated evidence for engineering review.
          </p>
          <p>
            It is not yet a confirmed fault-code classifier because true fault labels are missing. The stronger current claim is real-time sensor anomaly detection and deterministic explanation: ML scores are paired with SPC/range guardrails, and the token-free agent summarizes possible causes, evidence, missing evidence, next questions, and troubleshooting actions.
          </p>
          <div className="about-usecases">
            <article>
              <strong>Live anomaly triage</strong>
              <span>Watch PM1 sensor windows, guardrail triggers, and review priority in one local workspace.</span>
            </article>
            <article>
              <strong>Clean ML review</strong>
              <span>Compare leakage-safe model outputs while keeping SPC proxy features as deterministic guardrails.</span>
            </article>
            <article>
              <strong>Explainable action</strong>
              <span>Attach logs, maintenance notes, product context, and operator descriptions for structured case-file explanations.</span>
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}

function Panel({ children, subtitle, title }: { children: ReactNode; subtitle?: string; title: string }) {
  return (
    <section className="panel">
      <header>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Metric({ detail, label, tone, value }: { detail?: string; label: string; tone?: "warn"; value: number | string }) {
  return (
    <article className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function Evidence({ row }: { row: WindowRecord }) {
  return (
    <div className="evidence">
      <div><span>Window</span><strong>{shortDate(row.window_start)}</strong></div>
      <div><span>Process step</span><strong>{row.process_step}</strong></div>
      <div><span>Sensor</span><strong>{row.sensor_name}</strong></div>
      <div><span>Target</span><strong>{Number(row.target_anomaly) === 1 ? "Anomaly" : "Normal"}</strong></div>
      <div><span>Z-score</span><strong>{formatNum(row.z_score)}</strong></div>
      <div><span>Mean vs baseline</span><strong>{formatNum(row.window_mean)} / {formatNum(row.baseline_mean)}</strong></div>
      <div><span>Rules</span><strong>{triggeredRules(row).join(", ") || "None"}</strong></div>
      <div><span>Weak category</span><strong>{weakFault(row)}</strong></div>
      <p>{row.rationale ?? "No rationale supplied yet."}</p>
    </div>
  );
}

function SimpleWindowTable({ onSelect, rows, selected }: { onSelect: (row: WindowRecord) => void; rows: WindowRecord[]; selected?: WindowRecord }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Start</th>
            <th>Sensor</th>
            <th>Step</th>
            <th>Z</th>
            <th>Target</th>
            <th>Weak category</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className={selected === row ? "selected" : ""} key={`${row.window_start}-${row.sensor_name}`} onClick={() => onSelect(row)}>
              <td>{shortDate(row.window_start)}</td>
              <td>{row.sensor_name}</td>
              <td>{row.process_step}</td>
              <td>{formatNum(row.z_score)}</td>
              <td><span className={Number(row.target_anomaly) === 1 ? "badge bad" : "badge"}>{Number(row.target_anomaly) === 1 ? "Anomaly" : "Normal"}</span></td>
              <td>{weakFault(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelTable({ onSelect, rows, selected }: { onSelect?: (row: ModelRow) => void; rows: ModelRow[]; selected?: ModelRow }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Accuracy</th>
            <th>Precision</th>
            <th>Recall</th>
            <th>F1</th>
            <th>ROC AUC</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className={selected === row ? "selected" : ""} key={modelDisplayName(row)} onClick={() => onSelect?.(row)}>
              <td>{formatModelName(modelDisplayName(row))}</td>
              <td>{formatMetric(row.accuracy)}</td>
              <td>{formatMetric(row.precision)}</td>
              <td>{formatMetric(row.recall)}</td>
              <td>{formatMetric(row.f1)}</td>
              <td>{formatMetric(row.roc_auc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bars({ items }: { items: Array<{ label: string; value: number }> }) {
  const max = Math.max(...items.map((item) => Number(item.value)), 0.01);
  return (
    <div className="bars">
      {items.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          <div><i style={{ width: `${Math.max((item.value / max) * 100, 4)}%` }} /></div>
          <strong>{item.value.toFixed(3)}</strong>
        </div>
      ))}
    </div>
  );
}

function FileTable({ files }: { files: DataFile[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Status</th>
            <th>Modified</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.name}>
              <td>{file.name}</td>
              <td><span className={file.exists ? "badge ok" : "badge"}>{file.exists ? "Ready" : "Missing"}</span></td>
              <td>{file.last_modified ? new Date(file.last_modified * 1000).toLocaleString() : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function weakFault(row: WindowRecord) {
  return row.weak_fault_category ?? "UNKNOWN_SPC_ANOMALY";
}

function triggeredRules(row: WindowRecord) {
  return rules.filter((rule) => Number(row[rule.key]) === 1).map((rule) => rule.label);
}

function modelDisplayName(row: ModelRow) {
  return row.model ?? row.method ?? "";
}

function formatModelName(value: string) {
  return value
    ? value
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
        .replace(/\bXgboost\b/i, "XGBoost")
        .replace(/\bLightgbm\b/i, "LightGBM")
        .replace(/\bLof\b/i, "LOF")
    : "Unnamed model";
}

function hasModelMetric(row: ModelRow) {
  return [row.accuracy, row.precision, row.recall, row.f1, row.roc_auc].some((value) => value !== undefined && value !== null);
}

function plotUrl(plot: PlotFile) {
  if (plot.url.startsWith("http") || plot.url.startsWith("/fdc-process")) return plot.url;
  return `${apiBaseUrl}${plot.url}`;
}

function formatRunResult(result: PipelineRunResult): string {
  if (result.results?.length) {
    return result.results
      .map((item) => `${item.ok ? "OK" : "FAIL"} ${item.label}${item.duration_seconds ? ` (${item.duration_seconds}s)` : ""}`)
      .join("\n");
  }
  const lines = [
    `${result.ok ? "OK" : "FAIL"} ${result.label}${result.duration_seconds ? ` (${result.duration_seconds}s)` : ""}`,
    result.message ?? "",
    result.stdout ? `\n${result.stdout.trim()}` : "",
    result.stderr ? `\n${result.stderr.trim()}` : ""
  ].filter(Boolean);
  return lines.join("\n");
}

function stepLabel(step: PipelineStep) {
  const labels: Record<PipelineStep, string> = {
    all: "live pipeline",
    eda: "PM1 signal profiling",
    faults: "evidence library refresh",
    ml: "clean ML training",
    spc: "SPC windows",
    validate: "source validation"
  };
  return labels[step];
}

function progressColor(percent: number) {
  const value = Math.max(0, Math.min(100, percent));
  const stops = [
    { at: 0, color: "#d62828" },
    { at: 45, color: "#f77f00" },
    { at: 75, color: "#fcbf49" },
    { at: 100, color: "#147d64" }
  ];
  const nextIndex = stops.findIndex((stop) => value <= stop.at);
  if (nextIndex <= 0) return stops[0].color;
  const start = stops[nextIndex - 1];
  const end = stops[nextIndex];
  const ratio = (value - start.at) / (end.at - start.at);
  return mixHex(start.color, end.color, ratio);
}

function mixHex(start: string, end: string, ratio: number) {
  const startRgb = hexToRgb(start);
  const endRgb = hexToRgb(end);
  const channel = (index: number) => Math.round(startRgb[index] + (endRgb[index] - startRgb[index]) * ratio);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function hexToRgb(value: string) {
  const hex = value.replace("#", "");
  return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function formatNum(value?: number) {
  return value === undefined || Number.isNaN(Number(value)) ? "-" : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatMetric(value?: number) {
  return value === undefined ? "-" : Number(value).toFixed(3);
}

function formatPct(value: number) {
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default App;
