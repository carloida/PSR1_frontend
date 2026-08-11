import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useState } from "react";

import { apiBaseUrl, askInferenceAgent, fetchDashboardData, fetchSensorStream, runPipelineStep, uploadSourceFile, type AgentAttachmentPayload, type PipelineRunResult, type PipelineStep } from "./api";
import { mockData } from "./mockData";
import type { DashboardData, DataFile, ModelRow, PlotFile, SensorPoint, SensorStream, WindowRecord } from "./types";

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
const HOTSPOT_STEPS = ["4", "10", "11", "5", "17", "8", "6", "2"];
const HOTSPOT_SENSORS = ["TC301温度", "TC107温度", "TC100温度", "TC609加热温度", "E100功率反馈", "TC103温度", "TC104温度", "TC205流段温度"];

type AlertLevel = "watch" | "warning" | "alarm";
type AlertReviewStatus = "new" | "acknowledged" | "needs_engineer_review" | "likely_false_alarm";

type RealtimeAlert = {
  id: string;
  timestamp: string;
  sensor: string;
  processStep: string;
  mlModelName?: string;
  mlModelMetric?: string;
  level: AlertLevel;
  anomalyScore: number;
  mlProbability: number;
  rangeAnomaly: boolean;
  triggeredFeatures: string[];
  detectedPatterns: string[];
  featureEvidence: Array<{ feature: string; evidence: string }>;
  possibleCauses: string[];
  recommendedActions: string[];
  missingEvidence: string[];
  nextQuestions: string[];
  hotspot: boolean;
  status: AlertReviewStatus;
  notes: string[];
  context: Partial<Record<ContextKind, string>>;
};

type ContextKind = "error_logs" | "maintenance_notes" | "operator_notes" | "product_material" | "assembly_line" | "physical_properties";

type ChartFocusRequest = {
  requestId: number;
  sensor: string;
  processStep: string;
  timestamp: string;
};

type LiveModelOption = {
  id: string;
  label: string;
  metricLabel: string;
  metricName: "roc_auc" | "f1" | "accuracy" | "precision" | "recall" | "available";
  score: number;
  row: ModelRow;
};

type LiveChartSnapshot = {
  sensor: string;
  processStep: string;
  timestamp: string;
  value: number;
  mlModelName?: string;
  mlModelMetric?: string;
  mlProbability?: number;
  guardrail: "in_band" | "outside_3sigma";
  sourceMode: "csv_replay" | "live_edge";
  progress: string;
  mean?: number;
  std?: number;
};

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
  const [liveSignalAlert, setLiveSignalAlert] = useState<RealtimeAlert | undefined>();
  const [chartFocusRequest, setChartFocusRequest] = useState<ChartFocusRequest | undefined>();
  const [liveChartSnapshot, setLiveChartSnapshot] = useState<LiveChartSnapshot | undefined>();
  const [plotRailHidden, setPlotRailHidden] = useState(() => window.localStorage.getItem("psr-fdc-plot-rail-hidden") === "true");
  const [liveChartHidden, setLiveChartHidden] = useState(() => window.localStorage.getItem("psr-fdc-live-chart-hidden") === "true");
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

  function updateLiveChartHidden(hidden: boolean) {
    setLiveChartHidden(hidden);
    window.localStorage.setItem("psr-fdc-live-chart-hidden", String(hidden));
  }

  function focusLiveChart(alert: RealtimeAlert) {
    setChartFocusRequest({
      processStep: alert.processStep,
      requestId: Date.now(),
      sensor: alert.sensor,
      timestamp: alert.timestamp
    });
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
            {liveChartHidden ? (
              <button className="project-show-live-chart" type="button" onClick={() => updateLiveChartHidden(false)}>
                Show live chart
              </button>
            ) : null}
            {plotRailHidden ? (
              <button className="project-show-plots" type="button" onClick={() => updatePlotRailHidden(false)}>
                Show insights
              </button>
            ) : null}
            <button type="button" onClick={() => setAboutOpen(true)}>About project</button>
          </div>
        </header>

        {!liveChartHidden ? (
          <>
            <LiveControlChart
              compact
              focusRequest={chartFocusRequest}
              modelRows={data.model_comparison}
              onChartSnapshot={setLiveChartSnapshot}
              onHide={() => updateLiveChartHidden(true)}
              onSignalAlert={setLiveSignalAlert}
            />
            <RealtimeAlertDashboard currentAlert={liveSignalAlert} data={data} onFocusAlert={focusLiveChart} />
          </>
        ) : null}

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
          data={data}
          liveChartSnapshot={liveChartSnapshot}
          liveSignalAlert={liveSignalAlert}
          plotRailWidth={plotRailWidth}
          plots={data.plot_files}
          selectedPlot={selectedPlot}
          selectedWindow={selectedWindow}
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

function LiveControlChart({
  compact = false,
  focusRequest,
  modelRows,
  onChartSnapshot,
  onHide,
  onSignalAlert
}: {
  compact?: boolean;
  focusRequest?: ChartFocusRequest;
  modelRows: ModelRow[];
  onChartSnapshot?: (snapshot: LiveChartSnapshot | undefined) => void;
  onHide?: () => void;
  onSignalAlert?: (alert: RealtimeAlert | undefined) => void;
}) {
  const [stream, setStream] = useState<SensorStream | null>(null);
  const [selectedSensor, setSelectedSensor] = useState("");
  const [selectedStep, setSelectedStep] = useState("All steps");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [viewMode, setViewMode] = useState<"replay" | "live">("replay");
  const [status, setStatus] = useState("Loading PM1 sensor stream...");
  const modelOptions = useMemo(() => liveModelOptions(modelRows), [modelRows]);
  const bestModel = modelOptions[0];
  const selectedModel = modelOptions.find((model) => model.id === selectedModelId) ?? bestModel;

  useEffect(() => {
    void loadStream();
  }, []);

  useEffect(() => {
    if (!modelOptions.length) {
      setSelectedModelId("");
      return;
    }
    setSelectedModelId((current) => (modelOptions.some((model) => model.id === current) ? current : modelOptions[0].id));
  }, [modelOptions]);

  useEffect(() => {
    if (!focusRequest) return;
    void focusStreamOnAlert(focusRequest);
  }, [focusRequest?.requestId]);

  useEffect(() => {
    if (!stream || !isPlaying) return;
    const timer = window.setInterval(() => {
      setPlayhead((current) => {
        const lastIndex = Math.max(stream.points.length - 1, 0);
        const next = Math.min(current + speed, lastIndex);
        if (next >= lastIndex && viewMode === "replay") {
          window.clearInterval(timer);
          setIsPlaying(false);
        }
        return next;
      });
    }, 260);
    return () => window.clearInterval(timer);
  }, [isPlaying, speed, stream, viewMode]);

  async function loadStream(sensorName = selectedSensor, stepName = selectedStep) {
    setStatus("Loading PM1 sensor stream...");
    try {
      const result = await fetchSensorStream(sensorName || undefined, stepName);
      setStream(result);
      setSelectedSensor(result.sensor);
      setSelectedStep(result.step || "All steps");
      setPlayhead(viewMode === "live" ? Math.max(result.points.length - 1, 0) : 0);
      setStatus(result.mode === "csv_replay" ? "CSV replay ready" : "Live stream connected");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load the PM1 sensor stream.");
    }
  }

  async function focusStreamOnAlert(request: ChartFocusRequest) {
    setIsPlaying(false);
    setViewMode("replay");
    setStatus(`Loading ${request.sensor} alert window...`);
    try {
      let result = await fetchSensorStream(request.sensor, request.processStep);
      if (!result.points.length && request.processStep !== "All steps") {
        result = await fetchSensorStream(request.sensor, "All steps");
      }
      setStream(result);
      setSelectedSensor(result.sensor);
      setSelectedStep(result.step || "All steps");
      setPlayhead(closestPointIndex(result.points, request.timestamp));
      setStatus("Focused on selected alert history row");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to focus the selected alert on the chart.");
    }
  }

  function chooseSensor(sensorName: string) {
    setSelectedSensor(sensorName);
    setIsPlaying(false);
    void loadStream(sensorName, selectedStep);
  }

  function chooseStep(stepName: string) {
    setSelectedStep(stepName);
    setIsPlaying(false);
    void loadStream(selectedSensor, stepName);
  }

  function goLive() {
    if (!stream) return;
    setViewMode("live");
    setPlayhead(Math.max(stream.points.length - 1, 0));
    setIsPlaying(true);
  }

  function restartReplay() {
    setViewMode("replay");
    setPlayhead(0);
    setIsPlaying(false);
  }

  const points = stream?.points ?? [];
  const lastIndex = Math.max(points.length - 1, 0);
  const safePlayhead = Math.min(playhead, lastIndex);
  const currentPoint = points[safePlayhead];
  const windowStart = Math.max(0, safePlayhead - 180);
  const visiblePoints = points.slice(windowStart, safePlayhead + 1);
  const chart = stream ? chartGeometry(visiblePoints, stream.summary) : null;
  const atLiveEdge = safePlayhead >= Math.max(lastIndex - 1, 0);
  const outsideBand = Boolean(
    stream &&
      currentPoint &&
      (currentPoint.value > stream.summary.upper_3sigma || currentPoint.value < stream.summary.lower_3sigma)
  );
  const currentLiveAlert = useMemo(() => {
    return stream && currentPoint ? alertFromSignal(stream, currentPoint, selectedModel) : undefined;
  }, [currentPoint, selectedModel, stream]);

  useEffect(() => {
    if (!stream || !currentPoint) {
      onSignalAlert?.(undefined);
      onChartSnapshot?.(undefined);
      return;
    }
    onSignalAlert?.(currentLiveAlert);
    onChartSnapshot?.({
      guardrail: outsideBand ? "outside_3sigma" : "in_band",
      mean: stream.summary.mean,
      mlModelMetric: selectedModel?.metricLabel,
      mlModelName: selectedModel?.label,
      mlProbability: currentLiveAlert?.mlProbability,
      processStep: selectedStep,
      progress: points.length ? `${safePlayhead + 1}/${points.length}` : "-",
      sensor: selectedSensor,
      sourceMode: viewMode === "live" ? "live_edge" : "csv_replay",
      std: stream.summary.std,
      timestamp: currentPoint.timestamp,
      value: currentPoint.value
    });
  }, [currentLiveAlert, currentPoint, onChartSnapshot, onSignalAlert, outsideBand, points.length, safePlayhead, selectedModel, selectedSensor, selectedStep, stream, viewMode]);

  return (
    <div className={compact ? "persistent-live-chart" : ""}>
    <Panel title="Live Sensor Control Chart" subtitle="CSV replay now; live historian streaming ready">
      <section className="live-control-shell">
        <div className="stream-toolbar">
          <label htmlFor="live-sensor-select">
            <span>Sensor</span>
            <select id="live-sensor-select" disabled={!stream?.sensors.length} value={selectedSensor} onChange={(event) => chooseSensor(event.target.value)}>
              {stream?.sensors.map((sensorName) => <option key={sensorName}>{sensorName}</option>)}
            </select>
          </label>
          <label htmlFor="live-step-select">
            <span>Process step</span>
            <select id="live-step-select" disabled={!stream?.steps.length} value={selectedStep} onChange={(event) => chooseStep(event.target.value)}>
              <option>All steps</option>
              {stream?.steps.map((stepName) => <option key={stepName}>{stepName}</option>)}
            </select>
          </label>
          <label className="stream-model-select" htmlFor="live-model-select">
            <span>ML model</span>
            <select id="live-model-select" disabled={!modelOptions.length} value={selectedModel?.id ?? ""} onChange={(event) => setSelectedModelId(event.target.value)}>
              {modelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label} · {model.metricLabel}
                </option>
              ))}
            </select>
            {selectedModel && bestModel?.id === selectedModel.id ? <small>Best evaluated model</small> : null}
          </label>
          <div className="stream-mode-tabs" role="tablist" aria-label="Stream mode">
            <button className={viewMode === "replay" ? "active" : ""} type="button" onClick={() => {
              setViewMode("replay");
              setIsPlaying(false);
            }}>
              Replay CSV
            </button>
            <button className={viewMode === "live" ? "active" : ""} type="button" onClick={goLive}>
              <span className="live-dot" /> Live edge
            </button>
          </div>
          <button className="stream-refresh" type="button" onClick={() => void loadStream()}>
            Refresh stream
          </button>
          {onHide ? (
            <button className="live-chart-hide-button" type="button" onClick={onHide}>
              Hide panel
            </button>
          ) : null}
        </div>

        <div className="stream-stage">
          <div className="stream-chart-card">
            <div className="stream-status-row">
              <div>
                <span className={viewMode === "live" && atLiveEdge ? "live-pill on" : "live-pill"}>
                  {viewMode === "live" && atLiveEdge ? "LIVE" : "REPLAY"}
                </span>
                <strong>{currentPoint ? preciseTimestamp(currentPoint.timestamp) : status}</strong>
              </div>
              <small>{atLiveEdge ? "At latest available sample" : "Viewing history"}</small>
            </div>

            <div className="stream-metrics" aria-label="Live chart context">
              <article className={outsideBand ? "alert" : "ok"}>
                <span>Guardrail</span>
                <strong>{outsideBand ? "Outside 3-sigma" : "In band"}</strong>
              </article>
              <article>
                <span>Current</span>
                <strong>{currentPoint ? formatNum(currentPoint.value) : "-"}</strong>
              </article>
              <article>
                <span>ML probability</span>
                <strong>{currentLiveAlert ? formatMetric(currentLiveAlert.mlProbability) : "Below watch"}</strong>
              </article>
              <article>
                <span>Model</span>
                <strong title={selectedModel ? `${selectedModel.label} · ${selectedModel.metricLabel}` : undefined}>{selectedModel?.label ?? "No model"}</strong>
              </article>
              <article>
                <span>Baseline</span>
                <strong>{stream ? `${formatNum(stream.summary.mean)} mean · ${formatNum(stream.summary.std)} std` : "-"}</strong>
              </article>
              <article>
                <span>Progress</span>
                <strong>{points.length ? `${safePlayhead + 1}/${points.length}` : "-"}</strong>
              </article>
            </div>

            <div className="chart-shell">
              {chart && visiblePoints.length ? (
                <svg aria-label={`${selectedSensor} control chart`} className="control-chart" role="img" viewBox="0 0 720 260">
                  <rect className="control-band" x="48" y={chart.upperY} width="632" height={Math.max(chart.lowerY - chart.upperY, 1)} />
                  <line className="control-line upper" x1="48" x2="680" y1={chart.upperY} y2={chart.upperY} />
                  <line className="control-line mean" x1="48" x2="680" y1={chart.meanY} y2={chart.meanY} />
                  <line className="control-line lower" x1="48" x2="680" y1={chart.lowerY} y2={chart.lowerY} />
                  <path className="control-path" d={chart.path} />
                  {chart.latest ? <circle className={outsideBand ? "latest-dot alert" : "latest-dot"} cx={chart.latest.x} cy={chart.latest.y} r="5.5" /> : null}
                </svg>
              ) : (
                <div className="empty">{status}</div>
              )}
            </div>

            <div className="stream-controls">
              <button type="button" disabled={!points.length} onClick={() => setIsPlaying((value) => !value)}>
                {isPlaying ? "Pause" : "Play"}
              </button>
              <button className="stream-restart" type="button" disabled={!points.length} onClick={restartReplay}>
                Restart
              </button>
              <input
                aria-label="Replay timeline"
                disabled={!points.length}
                max={lastIndex}
                min={0}
                type="range"
                value={safePlayhead}
                onChange={(event) => {
                  setPlayhead(Number(event.target.value));
                  setIsPlaying(false);
                }}
              />
              <select aria-label="Replay speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={4}>4x</option>
                <option value={8}>8x</option>
              </select>
            </div>
          </div>
        </div>
      </section>
    </Panel>
    </div>
  );
}

function RealtimeAlertDashboard({
  currentAlert,
  data,
  onFocusAlert
}: {
  currentAlert?: RealtimeAlert;
  data: DashboardData;
  onFocusAlert: (alert: RealtimeAlert) => void;
}) {
  const seedAlerts = useMemo(() => mockRealtimeAlerts(data.windows), [data.windows]);
  const [alerts, setAlerts] = useState<RealtimeAlert[]>(seedAlerts);
  const [selectedAlertId, setSelectedAlertId] = useState("");
  const [contextKind, setContextKind] = useState<ContextKind>("operator_notes");
  const [contextDraft, setContextDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");

  useEffect(() => {
    setAlerts((current) => {
      const liveAlerts = current.filter((alert) => !alert.id.includes("-window-"));
      const next = mergeAlerts(liveAlerts, seedAlerts);
      setSelectedAlertId((selected) => (next.some((alert) => alert.id === selected) ? selected : ""));
      return next;
    });
  }, [seedAlerts]);

  useEffect(() => {
    if (!currentAlert) return;
    setAlerts((current) => mergeAlerts([currentAlert], current));
  }, [currentAlert]);

  const activeAlert = alerts.find((alert) => alert.id === selectedAlertId);
  const bannerAlert = currentAlert ?? alerts.find((alert) => alert.status === "new") ?? alerts[0];

  function updateAlert(id: string, updater: (alert: RealtimeAlert) => RealtimeAlert) {
    setAlerts((current) => current.map((alert) => (alert.id === id ? updater(alert) : alert)));
  }

  function setReviewStatus(status: AlertReviewStatus) {
    if (!activeAlert) return;
    updateAlert(activeAlert.id, (alert) => ({ ...alert, status }));
  }

  function addNote() {
    const note = noteDraft.trim();
    if (!activeAlert || !note) return;
    updateAlert(activeAlert.id, (alert) => ({ ...alert, notes: [...alert.notes, note] }));
    setNoteDraft("");
  }

  function addContext() {
    const context = contextDraft.trim();
    if (!activeAlert || !context) return;
    updateAlert(activeAlert.id, (alert) => refreshExplanationWithContext(alert, contextKind, context));
    setContextDraft("");
  }

  function selectAlert(alert: RealtimeAlert) {
    setSelectedAlertId(alert.id);
    onFocusAlert(alert);
  }

  return (
    <section className="realtime-alert-console" aria-label="Real-time anomaly alert console">
      {bannerAlert ? (
        <button className={`alert-banner ${bannerAlert.level}`} type="button" onClick={() => selectAlert(bannerAlert)}>
          <span>{formatAlertLevel(bannerAlert.level)}</span>
          <strong>{bannerAlert.sensor}: possible issue</strong>
          <small>
            Step {bannerAlert.processStep} · score {formatMetric(bannerAlert.anomalyScore)} · ML {formatMetric(bannerAlert.mlProbability)} · {preciseTimestamp(bannerAlert.timestamp)}
          </small>
          {bannerAlert.hotspot ? <em>Historical hotspot</em> : null}
        </button>
      ) : (
        <div className="alert-banner idle">
          <span>Monitoring</span>
          <strong>No current anomaly evidence above watch threshold</strong>
          <small>This is anomaly evidence, not confirmed fault classification.</small>
        </div>
      )}

      <div className="alert-grid">
        <Panel title="Anomaly Watchlist" subtitle={`${alerts.length} local alerts; click a row to focus the chart`}>
          <div className="watchlist-layout">
            <aside className="hotspot-panel">
              <div>
                <strong>Hotspot steps</strong>
                <div className="hotspot-chips">
                  {HOTSPOT_STEPS.map((item) => <span className={bannerAlert?.processStep === item ? "active" : ""} key={item}>Step {item}</span>)}
                </div>
              </div>
              <div>
                <strong>Common sensors</strong>
                <div className="hotspot-chips sensors">
                  {HOTSPOT_SENSORS.map((item) => <span className={bannerAlert?.sensor === item ? "active" : ""} key={item}>{item}</span>)}
                </div>
              </div>
              <p>This is anomaly evidence, not confirmed fault classification.</p>
            </aside>
            <AlertHistoryTable alerts={alerts} selectedAlertId={activeAlert?.id} onSelect={selectAlert} />
          </div>
        </Panel>
      </div>

      {activeAlert ? (
        <section className={`alert-detail-drawer ${activeAlert.level}`}>
          <header>
            <div>
              <p>{formatAlertLevel(activeAlert.level)} anomaly detected</p>
              <h2>{activeAlert.sensor} · Step {activeAlert.processStep}</h2>
              <span>This is anomaly evidence, not confirmed fault classification.</span>
            </div>
            <button type="button" onClick={() => setSelectedAlertId("")}>Close</button>
          </header>

          <div className="alert-detail-layout">
            <div className="alert-detail-main">
              <div className="alert-score-grid">
                <Metric label="Anomaly score" value={formatMetric(activeAlert.anomalyScore)} tone={activeAlert.level === "alarm" ? "warn" : undefined} />
                <Metric label="ML probability" value={formatMetric(activeAlert.mlProbability)} />
                <Metric label="Range guardrail" value={activeAlert.rangeAnomaly ? "Triggered" : "Clear"} tone={activeAlert.rangeAnomaly ? "warn" : undefined} />
                <Metric label="Review status" value={formatReviewStatus(activeAlert.status)} />
              </div>

              <div className="alert-section-grid">
                <AlertList title="Triggered features" items={activeAlert.triggeredFeatures} />
                <AlertList title="Detected patterns" items={activeAlert.detectedPatterns} />
                <AlertList title="Possible causes" items={activeAlert.possibleCauses} />
                <AlertList title="Recommended actions" items={activeAlert.recommendedActions} />
                <AlertList title="Missing evidence" items={activeAlert.missingEvidence} />
                <AlertList title="Next questions" items={activeAlert.nextQuestions} />
              </div>

              <div className="feature-evidence-list">
                <h3>Feature evidence</h3>
                {activeAlert.featureEvidence.map((item) => (
                  <article key={`${activeAlert.id}-${item.feature}-${item.evidence}`}>
                    <strong>{item.feature}</strong>
                    <span>{item.evidence}</span>
                  </article>
                ))}
              </div>
            </div>

            <aside className="alert-review-panel">
              <div className="review-actions">
                <button type="button" onClick={() => setReviewStatus("acknowledged")}>Acknowledge</button>
                <button type="button" onClick={() => setReviewStatus("needs_engineer_review")}>Needs engineer review</button>
                <button type="button" onClick={() => setReviewStatus("likely_false_alarm")}>Likely false alarm</button>
              </div>

              <label>
                <span>Add context</span>
                <select value={contextKind} onChange={(event) => setContextKind(event.target.value as ContextKind)}>
                  <option value="error_logs">Error logs</option>
                  <option value="maintenance_notes">Maintenance notes</option>
                  <option value="operator_notes">Operator notes</option>
                  <option value="product_material">Product/material description</option>
                  <option value="assembly_line">Assembly/process-line notes</option>
                  <option value="physical_properties">Physical property notes</option>
                </select>
              </label>
              <textarea value={contextDraft} placeholder="Paste relevant context for the deterministic explainer..." onChange={(event) => setContextDraft(event.target.value)} />
              <button type="button" onClick={addContext}>Refresh explanation</button>

              <label>
                <span>Add note</span>
                <textarea value={noteDraft} placeholder="Local review note..." onChange={(event) => setNoteDraft(event.target.value)} />
              </label>
              <button type="button" onClick={addNote}>Add note</button>

              <div className="notes-list">
                <strong>{activeAlert.notes.length} notes</strong>
                {activeAlert.notes.map((note, index) => <span key={`${activeAlert.id}-note-${index}`}>{note}</span>)}
              </div>
            </aside>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function AlertHistoryTable({
  alerts,
  onSelect,
  selectedAlertId
}: {
  alerts: RealtimeAlert[];
  onSelect: (alert: RealtimeAlert) => void;
  selectedAlertId?: string;
}) {
  return (
    <div className="table-wrap alert-history-wrap">
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Sensor</th>
            <th>Step</th>
            <th>Level</th>
            <th>Score</th>
            <th>ML prob.</th>
            <th>Top pattern</th>
            <th>Status</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {alerts.slice(0, 10).map((alert) => (
            <tr className={selectedAlertId === alert.id ? "selected" : ""} key={alert.id} onClick={() => onSelect(alert)}>
              <td>{preciseTimestamp(alert.timestamp)}</td>
              <td>{alert.sensor}</td>
              <td>{alert.processStep}</td>
              <td><span className={`badge severity ${alert.level}`}>{formatAlertLevel(alert.level)}</span></td>
              <td>{formatMetric(alert.anomalyScore)}</td>
              <td>{formatMetric(alert.mlProbability)}</td>
              <td>{alert.detectedPatterns[0] ?? "-"}</td>
              <td>{formatReviewStatus(alert.status)}</td>
              <td>{alert.notes.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlertList({ items, title }: { items: string[]; title: string }) {
  return (
    <article>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => <li key={`${title}-${item}`}>{item}</li>)}
      </ul>
    </article>
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

function ExplainabilityAgent({
  data,
  liveChartSnapshot,
  liveSignalAlert,
  onCollapse,
  plots,
  selectedPlot,
  selectedWindow
}: {
  data: DashboardData;
  liveChartSnapshot?: LiveChartSnapshot;
  liveSignalAlert?: RealtimeAlert;
  onCollapse: () => void;
  plots: PlotFile[];
  selectedPlot?: PlotFile;
  selectedWindow: WindowRecord;
}) {
  const [messages, setMessages] = useState<Array<{ role: "agent" | "user"; text: string; meta?: string }>>([
    {
      role: "agent",
      meta: "Deterministic first",
      text: "Ask about the selected window, live control chart, guardrails, clean ML outputs, generated evidence, logs, or engineering actions. I run the hard-coded PSR1 troubleshooting logic first, then use the economical AI layer only when the server key is configured."
    }
  ]);
  const [draft, setDraft] = useState("");
  const [contextFiles, setContextFiles] = useState<File[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const promptChips = [
    "Explain this anomaly",
    "Show guardrail evidence",
    "Summarize multiple signals",
    "What context is missing?"
  ];

  async function submitAgentQuestion(value = draft) {
    const question = value.trim();
    if (!question || isThinking) return;
    const caseFile = buildAgentCaseFile({ data, liveChartSnapshot, liveSignalAlert, plots, question, selectedPlot, selectedWindow });
    const deterministicAnswer = deterministicAgentAnswer(caseFile);
    const history = messages.slice(-6);
    setMessages((current) => [
      ...current,
      { role: "user", text: question },
      {
        role: "agent",
        meta: "Deterministic pass",
        text: deterministicAnswer
      }
    ]);
    setDraft("");
    setIsThinking(true);
    try {
      const attachments = await readAgentAttachments(contextFiles);
      const response = await askInferenceAgent({
        attachments,
        chat_history: history,
        deterministic_answer: deterministicAnswer,
        deterministic_findings: caseFile.deterministicFindings,
        question,
        screen_context: caseFile.screenContext
      });
      setMessages((current) => [
        ...current,
        {
          role: "agent",
          meta: response.used_api ? `AI synthesis · ${response.model ?? "configured model"}` : "Deterministic fallback",
          text: response.answer
        }
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "agent",
          meta: "Deterministic fallback",
          text: `The deterministic review is available, but the AI endpoint could not be reached: ${error instanceof Error ? error.message : "unknown error"}.`
        }
      ]);
    } finally {
      setIsThinking(false);
    }
  }

  return (
    <section className="agent-card" aria-label="Inference agent">
      <header>
        <div>
          <p>Inference agent</p>
          <h2>PSR1 analysis copilot</h2>
        </div>
        <div className="agent-header-actions">
          <span>{isThinking ? "Synthesizing" : "Deterministic first"}</span>
          <button aria-label="Collapse explainability agent" title="Collapse" type="button" onClick={onCollapse}>-</button>
        </div>
      </header>

      <div className="agent-context">
        <span>Selected: {selectedPlot?.title ?? "No plot"}</span>
        <span>{liveChartSnapshot ? `${liveChartSnapshot.sensor} · Step ${liveChartSnapshot.processStep}` : "Live chart ready"}</span>
        <span>{plots.length} plots indexed</span>
        <span>{liveSignalAlert ? `${formatAlertLevel(liveSignalAlert.level)} alert` : "No active alert"}</span>
      </div>

      <div className="agent-messages">
        {messages.map((message, index) => (
          <article className={message.role === "user" ? "user" : "agent"} key={`${message.role}-${index}`}>
            {message.meta ? <small>{message.meta}</small> : null}
            {message.text}
          </article>
        ))}
        {isThinking ? <article className="agent"><small>AI layer</small>Checking compact case file...</article> : null}
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
  data,
  liveChartSnapshot,
  liveSignalAlert,
  openPlot,
  plotRailWidth,
  plots,
  selectedPlot,
  selectedWindow,
  setPlotRailHidden,
  setPlotRailWidth,
  setSelectedPlotId
}: {
  data: DashboardData;
  liveChartSnapshot?: LiveChartSnapshot;
  liveSignalAlert?: RealtimeAlert;
  openPlot: (plot: PlotFile) => void;
  plotRailWidth: number;
  plots: PlotFile[];
  selectedPlot?: PlotFile;
  selectedWindow: WindowRecord;
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
        <CollapsedRailPanel count="AI-ready" title="Inference agent" onExpand={() => updateAgentPanelCollapsed(false)} />
      ) : (
        <ExplainabilityAgent
          data={data}
          liveChartSnapshot={liveChartSnapshot}
          liveSignalAlert={liveSignalAlert}
          onCollapse={() => updateAgentPanelCollapsed(true)}
          plots={plots}
          selectedPlot={selectedPlot}
          selectedWindow={selectedWindow}
        />
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

function buildAgentCaseFile({
  data,
  liveChartSnapshot,
  liveSignalAlert,
  plots,
  question,
  selectedPlot,
  selectedWindow
}: {
  data: DashboardData;
  liveChartSnapshot?: LiveChartSnapshot;
  liveSignalAlert?: RealtimeAlert;
  plots: PlotFile[];
  question: string;
  selectedPlot?: PlotFile;
  selectedWindow: WindowRecord;
}) {
  const topWindows = data.windows
    .slice()
    .sort((a, b) => Math.abs(Number(b.z_score ?? 0)) - Math.abs(Number(a.z_score ?? 0)))
    .slice(0, 6)
    .map((row) => ({
      sensor: row.sensor_name,
      step: row.process_step,
      target_anomaly: row.target_anomaly,
      weak_fault_category: row.weak_fault_category,
      window_start: row.window_start,
      z_score: row.z_score
    }));
  const modelScores = data.model_comparison.slice(0, 8).map((row) => ({
    accuracy: row.accuracy,
    f1: row.f1,
    model: formatModelName(modelDisplayName(row)),
    precision: row.precision,
    recall: row.recall,
    roc_auc: row.roc_auc
  }));
  const selectedRules = triggeredRules(selectedWindow);
  const patterns = inferDeterministicPatterns({ liveChartSnapshot, liveSignalAlert, selectedWindow });
  const evidence = [
    liveChartSnapshot ? `Live chart: ${liveChartSnapshot.sensor}, step ${liveChartSnapshot.processStep}, value ${formatNum(liveChartSnapshot.value)}, guardrail ${liveChartSnapshot.guardrail}, ML model ${liveChartSnapshot.mlModelName ?? "not selected"}${liveChartSnapshot.mlModelMetric ? ` (${liveChartSnapshot.mlModelMetric})` : ""}.` : "",
    liveSignalAlert ? `Alert: ${formatAlertLevel(liveSignalAlert.level)} with score ${formatMetric(liveSignalAlert.anomalyScore)} and ML probability ${formatMetric(liveSignalAlert.mlProbability)}.` : "",
    `Selected SPC window: ${selectedWindow.sensor_name}, step ${selectedWindow.process_step}, z-score ${formatMetric(selectedWindow.z_score)}, target_anomaly=${selectedWindow.target_anomaly}.`,
    selectedRules.length ? `Triggered SPC rules: ${selectedRules.join(", ")}.` : "No explicit SPC rule flag is selected in the current window.",
    selectedPlot ? `Selected evidence plot: ${selectedPlot.group} / ${selectedPlot.title}.` : ""
  ].filter(Boolean);
  const actions = [
    "Compare neighboring sensors in the same recipe step before treating this as a fault.",
    "Check operator notes, maintenance events, product/material changes, and recent tool interventions.",
    "Verify whether deterministic SPC/range guardrails agree with clean ML anomaly probability.",
    "Escalate for engineering review only if the same pattern persists or affects hotspot steps/sensors."
  ];
  return {
    deterministicFindings: {
      actions,
      evidence,
      patterns,
      selected_rules: selectedRules
    },
    screenContext: {
      caveat: "This is anomaly evidence, not confirmed fault classification.",
      current_alert: liveSignalAlert,
      live_chart: liveChartSnapshot,
      model_scores: modelScores,
      overview: data.overview,
      plot_count: plots.length,
      question,
      selected_plot: selectedPlot,
      selected_window: selectedWindow,
      top_anomaly_windows: topWindows
    }
  };
}

function deterministicAgentAnswer(caseFile: ReturnType<typeof buildAgentCaseFile>) {
  const findings = caseFile.deterministicFindings;
  const context = caseFile.screenContext;
  const alert = context.current_alert;
  const liveChart = context.live_chart;
  const selectedWindow = context.selected_window;
  const subject = alert?.sensor ?? liveChart?.sensor ?? selectedWindow.sensor_name;
  const step = alert?.processStep ?? liveChart?.processStep ?? selectedWindow.process_step;
  return [
    `Deterministic review first: ${subject} at step ${step} is being treated as anomaly evidence, not confirmed fault classification.`,
    `Patterns checked: ${findings.patterns.join(", ")}.`,
    `Supporting evidence: ${findings.evidence.slice(0, 4).join(" ")}`,
    `Next actions: ${findings.actions.slice(0, 3).join(" ")}`
  ].join("\n");
}

function inferDeterministicPatterns({
  liveChartSnapshot,
  liveSignalAlert,
  selectedWindow
}: {
  liveChartSnapshot?: LiveChartSnapshot;
  liveSignalAlert?: RealtimeAlert;
  selectedWindow: WindowRecord;
}) {
  const patterns = new Set<string>();
  if (liveSignalAlert?.detectedPatterns.length) {
    liveSignalAlert.detectedPatterns.forEach((pattern) => patterns.add(pattern));
  }
  if (liveChartSnapshot?.guardrail === "outside_3sigma" || Number(selectedWindow.is_3sigma_outlier)) {
    patterns.add("range_guardrail");
  }
  if (Math.abs(Number(selectedWindow.window_slope ?? 0)) > 0.15) {
    patterns.add("trend_change");
  }
  if (Number(selectedWindow.window_std ?? 0) > Number(selectedWindow.baseline_std ?? 0) * 1.8) {
    patterns.add("high_variability");
  }
  if (Math.abs(Number(selectedWindow.window_mean ?? 0) - Number(selectedWindow.baseline_mean ?? 0)) > Number(selectedWindow.baseline_std ?? 1) * 1.5) {
    patterns.add("mean_shift");
  }
  if (!patterns.size) {
    patterns.add("spc_ml_context_review");
  }
  return Array.from(patterns).slice(0, 6);
}

async function readAgentAttachments(files: File[]): Promise<AgentAttachmentPayload[]> {
  const readable = new Set(["text/plain", "text/markdown", "application/json", "text/csv"]);
  const output: AgentAttachmentPayload[] = [];
  for (const file of files.slice(0, 5)) {
    const canRead = readable.has(file.type) || /\.(txt|md|json|csv)$/i.test(file.name);
    output.push({
      kind: canRead ? "text_context" : "file_reference",
      name: file.name,
      text: canRead ? (await file.text()).slice(0, 1800) : undefined
    });
  }
  return output;
}

function alertFromSignal(stream: SensorStream, point: SensorPoint, model?: LiveModelOption): RealtimeAlert | undefined {
  const std = Number(stream.summary.std) || 1;
  const z = Math.abs((Number(point.value) - Number(stream.summary.mean)) / std);
  const rangeAnomaly = Number(point.value) > stream.summary.upper_3sigma || Number(point.value) < stream.summary.lower_3sigma;
  const hotspot = isHotspot(stream.sensor, stream.step);
  const anomalyScore = clamp01((z / 3.1) + (rangeAnomaly ? 0.22 : 0) + (hotspot && z > 0.8 ? 0.08 : 0));
  const modelCalibration = model ? Math.max(0.72, Math.min(1.08, 0.68 + model.score * 0.4)) : 0.9;
  const mlProbability = clamp01((anomalyScore * modelCalibration) + (hotspot ? 0.05 : 0));
  const level = alertLevel(anomalyScore, mlProbability, rangeAnomaly);
  if (!level) return undefined;
  return buildAlert({
    anomalyScore,
    level,
    mlModelMetric: model?.metricLabel,
    mlModelName: model?.label,
    mlProbability,
    rangeAnomaly,
    sensor: stream.sensor,
    processStep: stream.step || "All steps",
    timestamp: point.timestamp,
    value: point.value,
    windowMean: stream.summary.mean,
    windowStd: std,
    zScore: z
  });
}

function mockRealtimeAlerts(rows: WindowRecord[]) {
  return rows
    .filter((row) => Number(row.target_anomaly) === 1 || Math.abs(Number(row.z_score ?? 0)) >= 2)
    .sort((a, b) => Math.abs(Number(b.z_score ?? 0)) - Math.abs(Number(a.z_score ?? 0)))
    .slice(0, 10)
    .map((row, index) => {
      const z = Math.abs(Number(row.z_score ?? 0));
      const rangeAnomaly = Boolean(Number(row.is_3sigma_outlier) || Number(row.is_iqr_outlier));
      const anomalyScore = clamp01(Math.max(0.35, z / 5));
      const mlProbability = clamp01(Number(row.weak_fault_confidence ?? anomalyScore * 0.92));
      return buildAlert({
        anomalyScore,
        level: alertLevel(anomalyScore, mlProbability, rangeAnomaly) ?? "watch",
        mlProbability,
        rangeAnomaly,
        sensor: row.sensor_name,
        processStep: String(row.process_step),
        timestamp: row.window_start,
        value: row.window_mean,
        windowMean: row.window_mean,
        windowStd: row.window_std,
        zScore: z,
        idSuffix: `window-${index}`
      });
    });
}

function buildAlert({
  anomalyScore,
  idSuffix = "live",
  level,
  mlModelMetric,
  mlModelName,
  mlProbability,
  processStep,
  rangeAnomaly,
  sensor,
  timestamp,
  value,
  windowMean,
  windowStd,
  zScore
}: {
  anomalyScore: number;
  idSuffix?: string;
  level: AlertLevel;
  mlModelMetric?: string;
  mlModelName?: string;
  mlProbability: number;
  processStep: string;
  rangeAnomaly: boolean;
  sensor: string;
  timestamp: string;
  value?: number;
  windowMean?: number;
  windowStd?: number;
  zScore: number;
}): RealtimeAlert {
  const hotspot = isHotspot(sensor, processStep);
  const detectedPatterns = detectedAlertPatterns({ rangeAnomaly, sensor, windowStd, zScore });
  const triggeredFeatures = [
    zScore >= 1.4 ? "mean_shift" : "",
    Number(windowStd ?? 0) > 0 ? "window_std" : "",
    mlModelName ? `ml_model:${mlModelName}` : "",
    rangeAnomaly ? "range_guardrail" : "",
    hotspot ? "historical_hotspot" : ""
  ].filter(Boolean);
  return {
    id: `${timestamp}-${sensor}-${processStep}-${idSuffix}`,
    anomalyScore,
    context: {},
    detectedPatterns,
    featureEvidence: [
      { feature: "anomaly_score", evidence: `Anomaly score is ${formatMetric(anomalyScore)}; combined evidence reached ${formatAlertLevel(level).toLowerCase()} level.` },
      { feature: "ml_probability", evidence: `ML probability estimate is ${formatMetric(mlProbability)}${mlModelName ? ` using ${mlModelName} (${mlModelMetric}).` : "."}` },
      { feature: "z_score", evidence: `Absolute z-style deviation is ${formatMetric(zScore)}.` },
      { feature: "current_value", evidence: value === undefined ? "Current signal value was not supplied." : `Current value is ${formatNum(value)} versus local mean ${formatNum(windowMean)}.` },
      ...(hotspot ? [{ feature: "historical_hotspot", evidence: `${sensor} or step ${processStep} appears in historical anomaly hotspots.` }] : [])
    ],
    hotspot,
    level,
    missingEvidence: [
      "Tool/chamber event log around this timestamp",
      "Maintenance or calibration notes",
      "Lot/product and recipe context",
      "Operator observation at the equipment"
    ],
    mlModelMetric,
    mlModelName,
    mlProbability,
    nextQuestions: [
      "Did this step recently change recipe timing or setpoint?",
      "Was maintenance performed before this run?",
      "Do neighboring sensors show the same pattern?",
      "Is the deviation repeating across lots or isolated?"
    ],
    notes: [],
    possibleCauses: possibleAlertCauses(detectedPatterns, sensor),
    processStep,
    rangeAnomaly,
    recommendedActions: recommendedAlertActions(detectedPatterns, rangeAnomaly),
    sensor,
    status: "new",
    timestamp,
    triggeredFeatures
  };
}

function mergeAlerts(primary: RealtimeAlert[], secondary: RealtimeAlert[]) {
  const byId = new Map<string, RealtimeAlert>();
  for (const alert of secondary) {
    byId.set(alert.id, alert);
  }
  for (const alert of primary) {
    const existing = byId.get(alert.id);
    byId.set(alert.id, existing ? { ...alert, context: existing.context, notes: existing.notes, status: existing.status } : alert);
  }
  return Array.from(byId.values())
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 18);
}

function refreshExplanationWithContext(alert: RealtimeAlert, contextKind: ContextKind, context: string): RealtimeAlert {
  const label = formatContextKind(contextKind);
  return {
    ...alert,
    context: { ...alert.context, [contextKind]: context },
    featureEvidence: [
      { feature: label, evidence: context },
      ...alert.featureEvidence.filter((item) => item.feature !== label)
    ],
    missingEvidence: alert.missingEvidence.filter((item) => !item.toLowerCase().includes(label.toLowerCase().split(" ")[0])),
    nextQuestions: [
      `Does the added ${label.toLowerCase()} support or contradict the sensor pattern?`,
      ...alert.nextQuestions.filter((item) => !item.includes(label))
    ],
    notes: [...alert.notes, `${label} added; deterministic explanation refreshed locally.`]
  };
}

function alertLevel(anomalyScore: number, mlProbability: number, rangeAnomaly: boolean): AlertLevel | undefined {
  if (rangeAnomaly || anomalyScore >= 0.75 || mlProbability >= 0.75) return "alarm";
  if (anomalyScore >= 0.55 || mlProbability >= 0.55) return "warning";
  if (anomalyScore >= 0.35 || mlProbability >= 0.35) return "watch";
  return undefined;
}

function detectedAlertPatterns({
  rangeAnomaly,
  sensor,
  windowStd,
  zScore
}: {
  rangeAnomaly: boolean;
  sensor: string;
  windowStd?: number;
  zScore: number;
}) {
  const patterns = [
    rangeAnomaly ? "range_guardrail" : "",
    zScore >= 2.5 ? "mean_shift" : "",
    zScore >= 1.6 && zScore < 2.5 ? "trend_change" : "",
    Number(windowStd ?? 0) > 1 ? "high_variability" : "",
    sensor.includes("功率") ? "setpoint_tracking_error" : "",
    sensor.includes("温度") && Number(windowStd ?? 0) > 0.5 ? "oscillation" : ""
  ].filter(Boolean);
  return unique(patterns.length ? patterns : ["mean_shift"]);
}

function possibleAlertCauses(patterns: string[], sensor: string) {
  const causes = [
    patterns.includes("setpoint_tracking_error") ? "Controller or actuator may be lagging the setpoint." : "",
    patterns.includes("high_variability") || patterns.includes("oscillation") ? "Signal instability may indicate tuning, heater, or flow variation." : "",
    patterns.includes("range_guardrail") ? "Observed value crossed deterministic SPC/range guardrail." : "",
    sensor.includes("温度") ? "Temperature control drift or heater response change may be contributing." : "",
    "Recipe-step context or product conditions may explain part of the deviation."
  ].filter(Boolean);
  return unique(causes);
}

function recommendedAlertActions(patterns: string[], rangeAnomaly: boolean) {
  return [
    "Compare adjacent sensors in the same time window.",
    rangeAnomaly ? "Review guardrail threshold crossing before continuing unattended operation." : "Keep monitoring through the next few windows.",
    patterns.includes("setpoint_tracking_error") ? "Check setpoint versus feedback traces and controller state." : "",
    patterns.includes("high_variability") ? "Inspect variability against recent maintenance and recipe transitions." : "",
    "Attach logs or operator notes to refresh deterministic explanation."
  ].filter(Boolean);
}

function isHotspot(sensor: string, processStep: string) {
  return HOTSPOT_SENSORS.includes(sensor) || HOTSPOT_STEPS.includes(String(processStep));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function formatAlertLevel(level: AlertLevel) {
  const labels: Record<AlertLevel, string> = {
    alarm: "Alarm",
    warning: "Warning",
    watch: "Watch"
  };
  return labels[level];
}

function formatReviewStatus(status: AlertReviewStatus) {
  const labels: Record<AlertReviewStatus, string> = {
    acknowledged: "Acknowledged",
    likely_false_alarm: "Likely false alarm",
    needs_engineer_review: "Needs engineer review",
    new: "New"
  };
  return labels[status];
}

function formatContextKind(kind: ContextKind) {
  const labels: Record<ContextKind, string> = {
    assembly_line: "Assembly/process-line notes",
    error_logs: "Error logs",
    maintenance_notes: "Maintenance notes",
    operator_notes: "Operator notes",
    physical_properties: "Physical property notes",
    product_material: "Product/material description"
  };
  return labels[kind];
}

function chartGeometry(points: SensorPoint[], summary: SensorStream["summary"]) {
  const width = 720;
  const height = 260;
  const pad = { top: 18, right: 40, bottom: 26, left: 48 };
  const values = points.map((point) => Number(point.value)).filter(Number.isFinite);
  const rawMin = Math.min(...values, summary.lower_3sigma, summary.min);
  const rawMax = Math.max(...values, summary.upper_3sigma, summary.max);
  const span = rawMax - rawMin || 1;
  const min = rawMin - span * 0.08;
  const max = rawMax + span * 0.08;

  function x(index: number) {
    if (points.length <= 1) return pad.left;
    return pad.left + (index / (points.length - 1)) * (width - pad.left - pad.right);
  }

  function y(value: number) {
    return pad.top + ((max - value) / (max - min)) * (height - pad.top - pad.bottom);
  }

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(2)} ${y(Number(point.value)).toFixed(2)}`)
    .join(" ");
  const latest = points.length ? { x: x(points.length - 1), y: y(Number(points[points.length - 1].value)) } : null;

  return {
    latest,
    lowerY: y(summary.lower_3sigma),
    meanY: y(summary.mean),
    path,
    upperY: y(summary.upper_3sigma)
  };
}

function closestPointIndex(points: SensorPoint[], timestamp: string) {
  if (!points.length) return 0;
  const target = new Date(timestamp).getTime();
  if (Number.isNaN(target)) return 0;
  return points.reduce((bestIndex, point, index) => {
    const current = new Date(point.timestamp).getTime();
    const best = new Date(points[bestIndex].timestamp).getTime();
    if (Number.isNaN(current)) return bestIndex;
    if (Number.isNaN(best)) return index;
    return Math.abs(current - target) < Math.abs(best - target) ? index : bestIndex;
  }, 0);
}

function weakFault(row: WindowRecord) {
  return row.weak_fault_category ?? "UNKNOWN_SPC_ANOMALY";
}

function triggeredRules(row: WindowRecord) {
  return rules.filter((rule) => Number(row[rule.key]) === 1).map((rule) => rule.label);
}

function liveModelOptions(rows: ModelRow[]): LiveModelOption[] {
  return rows
    .map((row, index) => {
      const metric = bestModelMetric(row);
      const label = formatModelName(modelDisplayName(row) || row.description || `Model ${index + 1}`);
      return metric
        ? {
            id: `${modelDisplayName(row) || row.description || "model"}-${index}`,
            label,
            metricLabel: `${formatMetricName(metric.name)} ${formatMetric(metric.score)}`,
            metricName: metric.name,
            row,
            score: metric.score
          }
        : undefined;
    })
    .filter((item): item is LiveModelOption => Boolean(item))
    .sort((a, b) => modelMetricRank(a.metricName) - modelMetricRank(b.metricName) || b.score - a.score || a.label.localeCompare(b.label));
}

function bestModelMetric(row: ModelRow): { name: LiveModelOption["metricName"]; score: number } | undefined {
  const candidates: Array<{ name: LiveModelOption["metricName"]; score?: number }> = [
    { name: "f1", score: row.f1 },
    { name: "roc_auc", score: row.roc_auc },
    { name: "accuracy", score: row.accuracy },
    { name: "precision", score: row.precision },
    { name: "recall", score: row.recall }
  ];
  const metric = candidates.find((candidate) => candidate.score !== undefined && candidate.score !== null && Number.isFinite(Number(candidate.score)));
  return metric ? { name: metric.name, score: Number(metric.score) } : undefined;
}

function modelMetricRank(metric: LiveModelOption["metricName"]) {
  const ranks: Record<LiveModelOption["metricName"], number> = {
    f1: 0,
    roc_auc: 1,
    accuracy: 2,
    precision: 3,
    recall: 4,
    available: 5
  };
  return ranks[metric];
}

function formatMetricName(metric: LiveModelOption["metricName"]) {
  const labels: Record<LiveModelOption["metricName"], string> = {
    accuracy: "Accuracy",
    available: "Available",
    f1: "F1",
    precision: "Precision",
    recall: "Recall",
    roc_auc: "ROC AUC"
  };
  return labels[metric];
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

function preciseTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  return new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "2-digit",
    second: "2-digit"
  })
    .formatToParts(date)
    .map((part) => (part.type === "second" ? `${part.value}.${milliseconds}` : part.value))
    .join("");
}

export default App;
