const regionCatalog = [
  ["서울특별시", "서울"], ["부산광역시", "부산"], ["대구광역시", "대구"],
  ["인천광역시", "인천"], ["광주광역시", "광주"], ["대전광역시", "대전"],
  ["울산광역시", "울산"], ["세종특별자치시", "세종"], ["경기도", "경기"],
  ["강원도", "강원"], ["충청북도", "충북"], ["충청남도", "충남"],
  ["전라북도", "전북"], ["전라남도", "전남"], ["경상북도", "경북"],
  ["경상남도", "경남"], ["제주특별자치도", "제주"]
];
const regions = regionCatalog.map(([name, short]) => ({ name, short }));
const modeKeys = ["rail", "express", "intercity"];
const modeLabels = { rail: "철도", express: "고속버스", intercity: "시외버스" };
const modeColors = { rail: "#66d9ff", express: "#a58bff", intercity: "#55e6b2" };
const causeKeys = ["visitor", "smoking", "burning", "other"];
const causeLabels = { visitor: "입산자 실화", smoking: "담뱃불", burning: "소각", other: "기타" };
const fireRegionAliases = {
  "서울": "서울특별시", "부산": "부산광역시", "대구": "대구광역시", "인천": "인천광역시",
  "광주": "광주광역시", "전남광주": "광주광역시", "대전": "대전광역시", "울산": "울산광역시",
  "세종": "세종특별자치시", "경기": "경기도", "강원": "강원도", "충북": "충청북도",
  "충남": "충청남도", "전북": "전라북도", "전남": "전라남도", "경북": "경상북도",
  "경남": "경상남도", "제주": "제주특별자치도"
};

const state = {
  month: 0,
  modes: new Set(modeKeys),
  direction: "outflow",
  cause: "all",
  selected: "강원도",
  metric: "fires",
  corrMetric: "fires",
  corrTrafficView: "both",
  corrView: "timeline",
  heatmapMetric: "outflow",
  mapTransform: d3.zoomIdentity
};

let geoData;
let renderFrame;
let mapSvg;
let mapZoomBehavior;
let months = [];
let trafficRecords = [];
let fireRecords = [];
let trafficByPeriod = new Map();
let fireByPeriodRegion = new Map();
let monthRenderFrame;
const byName = new Map(regions.map(d => [d.name, d]));
const tooltip = d3.select("#tooltip");

function fireCauseKey(cause) {
  if (cause.includes("입산")) return "visitor";
  if (cause.includes("담뱃불")) return "smoking";
  if (cause.includes("소각") || cause.includes("논·밭두렁")) return "burning";
  return "other";
}

function formatPeriod(period) {
  const [year, month] = period.split("-");
  return `${year}년 ${Number(month)}월`;
}

function rowFor(region, month = state.month, cause = state.cause, direction = state.direction) {
  const period = months[month];
  const routes = trafficByPeriod.get(period) ?? [];
  const trafficValue = d3.sum(routes, route => {
    const matches = direction === "inflow" ? route.target === region.name : route.source === region.name;
    if (!matches) return 0;
    return d3.sum(modeKeys, key => state.modes.has(key) ? route[key] : 0);
  });
  const incidents = (fireByPeriodRegion.get(period)?.get(region.name) ?? [])
    .filter(record => cause === "all" || record.causeKey === cause);
  return {
    ...region,
    trafficValue,
    fireValue: incidents.length,
    areaValue: d3.sum(incidents, record => record.damagearea)
  };
}

function allRows(month = state.month, cause = state.cause, direction = state.direction) {
  return regions.map(region => rowFor(region, month, cause, direction));
}

function incidentsFor(period, regionName = null) {
  const byRegion = fireByPeriodRegion.get(period);
  if (!byRegion) return [];
  if (regionName) return byRegion.get(regionName) ?? [];
  return [...byRegion.values()].flat();
}

function routeValues(month = state.month) {
  const period = months[month];
  const routes = trafficByPeriod.get(period) ?? [];
  return routes.flatMap(route => modeKeys
    .filter(mode => state.modes.has(mode) && route[mode] > 0)
    .map(mode => ({ source: route.source, target: route.target, mode, value: route[mode] })))
    .sort((a, b) => b.value - a.value);
}

function formatTraffic(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}백만 건`;
  if (value >= 10000) return `${(value / 10000).toFixed(1)}만 건`;
  return `${Math.round(value).toLocaleString("ko-KR")}건`;
}

function shortName(name) {
  return byName.get(name)?.short || name.replace(/특별자치|광역|특별/g, "").replace(/시$|도$/, "");
}

function showTooltip(event, html) {
  tooltip.html(html).attr("hidden", null);
  const box = tooltip.node().getBoundingClientRect();
  const left = Math.min(event.clientX + 16, window.innerWidth - box.width - 12);
  const top = Math.max(12, Math.min(event.clientY + 14, window.innerHeight - box.height - 12));
  tooltip.style("left", `${left}px`).style("top", `${top}px`);
}

function hideTooltip() {
  tooltip.attr("hidden", true);
}

function chooseRegion(name) {
  state.selected = name;
  document.querySelector("#regionSelect").value = name || "all";
  renderAll();
}

function setupControls() {
  const monthSelect = document.querySelector("#monthSelect");
  const monthSlider = document.querySelector("#monthSlider");
  months.forEach((period, index) => monthSelect.add(new Option(formatPeriod(period), index)));
  monthSelect.value = state.month;
  monthSlider.max = String(Math.max(0, months.length - 1));
  monthSlider.value = String(state.month);

  const regionSelect = document.querySelector("#regionSelect");
  regionSelect.add(new Option("전국", "all"));
  regions.forEach(region => regionSelect.add(new Option(region.name, region.name)));
  regionSelect.value = state.selected;

  monthSelect.addEventListener("change", event => {
    chooseMonth(Number(event.target.value));
  });

  monthSlider.addEventListener("input", event => {
    const nextMonth = Number(event.target.value);
    cancelAnimationFrame(monthRenderFrame);
    monthRenderFrame = requestAnimationFrame(() => chooseMonth(nextMonth));
  });

  document.querySelector("#monthPrevButton").addEventListener("click", () => chooseMonth(state.month - 1));
  document.querySelector("#monthNextButton").addEventListener("click", () => chooseMonth(state.month + 1));

  document.querySelector("#causeSelect").addEventListener("change", event => {
    state.cause = event.target.value;
    renderAll();
  });

  document.querySelectorAll('.mode-filter input[type="checkbox"]').forEach(input => {
    input.addEventListener("change", event => {
      if (event.target.checked) state.modes.add(event.target.value);
      else state.modes.delete(event.target.value);
      if (!state.modes.size) {
        state.modes.add(event.target.value);
        event.target.checked = true;
      }
      renderAll();
    });
  });

  document.querySelectorAll('.direction-filter input[type="radio"]').forEach(input => {
    input.addEventListener("change", event => {
      if (!event.target.checked) return;
      state.direction = event.target.value;
      renderAll();
    });
  });

  regionSelect.addEventListener("change", event => chooseRegion(event.target.value === "all" ? null : event.target.value));

  document.querySelector("#metricButton").addEventListener("click", () => {
    state.metric = state.metric === "fires" ? "area" : "fires";
    document.querySelector("#metricButton").textContent = state.metric === "fires" ? "피해면적 보기" : "발생건수 보기";
    renderScatter();
    renderInsights();
  });

  document.querySelectorAll("[data-corr-metric]").forEach(button => {
    button.addEventListener("click", () => {
      state.corrMetric = button.dataset.corrMetric;
      document.querySelectorAll("[data-corr-metric]").forEach(item => {
        const active = item === button;
        item.setAttribute("aria-pressed", String(active));
      });
      renderCorrelation();
    });
  });

  document.querySelectorAll("[data-corr-traffic]").forEach(button => {
    button.addEventListener("click", () => {
      state.corrTrafficView = button.dataset.corrTraffic;
      document.querySelectorAll("[data-corr-traffic]").forEach(item => {
        item.setAttribute("aria-pressed", String(item === button));
      });
      renderCorrelation();
    });
  });

  document.querySelectorAll("[data-corr-view]").forEach(button => {
    button.addEventListener("click", () => {
      state.corrView = button.dataset.corrView;
      document.querySelectorAll("[data-corr-view]").forEach(item => {
        item.setAttribute("aria-pressed", String(item === button));
      });
      renderCorrelation();
    });
  });

  document.querySelectorAll("[data-heatmap-metric]").forEach(button => {
    button.addEventListener("click", () => {
      state.heatmapMetric = button.dataset.heatmapMetric;
      document.querySelectorAll("[data-heatmap-metric]").forEach(item => {
        item.setAttribute("aria-pressed", String(item === button));
      });
      renderHeatmap();
    });
  });

  document.querySelector("#heatmapCollapseButton").addEventListener("click", event => {
    const panel = document.querySelector(".heatmap-panel");
    const host = document.querySelector("#anomalyHeatmap");
    const note = panel.querySelector(".heatmap-note");
    const expanded = event.currentTarget.getAttribute("aria-expanded") !== "true";
    event.currentTarget.setAttribute("aria-expanded", String(expanded));
    event.currentTarget.textContent = expanded ? "접기" : "펼치기";
    panel.classList.toggle("is-collapsed", !expanded);
    host.hidden = !expanded;
    note.hidden = !expanded;
    if (expanded) requestAnimationFrame(renderHeatmap);
  });

  document.querySelector("#mapZoomIn").addEventListener("click", () => zoomMap(1.45));
  document.querySelector("#mapZoomOut").addEventListener("click", () => zoomMap(1 / 1.45));
  document.querySelector("#mapZoomReset").addEventListener("click", resetMapZoom);
  document.querySelector("#mapExpandButton").addEventListener("click", toggleMapExpansion);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && document.querySelector(".map-panel").classList.contains("is-expanded")) toggleMapExpansion();
  });

}

function setupEntryScreen() {
  const entry = document.querySelector("#entryScreen");
  const dashboard = document.querySelector("#dashboardContent");
  let burning = false;
  const enterDashboard = () => {
    if (burning) return;
    burning = true;
    entry.classList.add("is-burning");
    entry.removeAttribute("tabindex");
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 20 : 1650;
    window.setTimeout(() => {
      entry.hidden = true;
      document.body.classList.remove("entry-active");
      dashboard.removeAttribute("inert");
      dashboard.setAttribute("aria-hidden", "false");
      window.scrollTo({ top: 0, behavior: "auto" });
    }, delay);
  };
  entry.addEventListener("click", enterDashboard);
  entry.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    enterDashboard();
  });
}

function zoomMap(factor) {
  if (!mapSvg || !mapZoomBehavior) return;
  mapSvg.transition().duration(220).call(mapZoomBehavior.scaleBy, factor);
}

function resetMapZoom() {
  state.mapTransform = d3.zoomIdentity;
  if (mapSvg && mapZoomBehavior) mapSvg.transition().duration(260).call(mapZoomBehavior.transform, d3.zoomIdentity);
}

function toggleMapExpansion() {
  const panel = document.querySelector(".map-panel");
  const button = document.querySelector("#mapExpandButton");
  const expanded = !panel.classList.contains("is-expanded");
  panel.classList.toggle("is-expanded", expanded);
  document.body.classList.toggle("has-expanded-map", expanded);
  button.setAttribute("aria-pressed", String(expanded));
  button.querySelector(".expand-label").textContent = expanded ? "원래 크기로" : "지도 크게 보기";
  requestAnimationFrame(renderMap);
}

function chooseMonth(month) {
  state.month = Math.max(0, Math.min(months.length - 1, month));
  document.querySelector("#monthSelect").value = state.month;
  hideTooltip();
  renderAll();
}

function chooseRegionAndMonth(name, month) {
  state.selected = name;
  state.month = Math.max(0, Math.min(months.length - 1, month));
  document.querySelector("#regionSelect").value = name;
  document.querySelector("#monthSelect").value = state.month;
  hideTooltip();
  renderAll();
}

function renderAll() {
  syncDirectionLabels();
  const monthSlider = document.querySelector("#monthSlider");
  const sliderProgress = months.length > 1 ? state.month / (months.length - 1) * 100 : 0;
  document.querySelector("#monthLabel").textContent = formatPeriod(months[state.month]);
  monthSlider.value = String(state.month);
  monthSlider.style.setProperty("--slider-progress", `${sliderProgress}%`);
  monthSlider.setAttribute("aria-valuetext", formatPeriod(months[state.month]));
  document.querySelector("#monthPrevButton").disabled = state.month === 0;
  document.querySelector("#monthNextButton").disabled = state.month === months.length - 1;
  renderMap();
  renderScatter();
  renderCorrelation();
  renderDetails();
  renderInsights();
  renderHeatmap();
}

function syncDirectionLabels() {
  const word = state.direction === "inflow" ? "유입" : "유출";
  document.querySelector("#mapDirectionLabel").textContent = `지역 ${word} 교통`;
  document.querySelector("#mapLegendDirection").textContent = `${word} 교통`;
  document.querySelector("#trafficMetricLabel").textContent = `월간 ${word}`;
  document.querySelector("#routeEyebrow").textContent = `주요 ${word}`;
  document.querySelector("#routeTitle").textContent = state.direction === "inflow" ? "지역으로 들어온 경로" : "지역을 벗어난 경로";
}

function renderMap() {
  if (!geoData) return;
  const host = document.querySelector("#mapChart");
  const width = Math.max(host.clientWidth, 560);
  const height = Math.max(host.clientHeight, 480);
  const rows = allRows();
  const rowMap = new Map(rows.map(d => [d.name, d]));
  const trafficMax = d3.max(rows, d => d.trafficValue) || 1;
  const fireMax = d3.max(rows, d => d.areaValue) || 1;
  const projection = d3.geoMercator().fitExtent([[28, 22], [width - 28, height - 28]], geoData);
  const path = d3.geoPath(projection);
  const fill = d3.scaleSequential().domain([0, trafficMax]).interpolator(t => d3.interpolateRgb("#101f32", "#17608a")(Math.pow(t, 0.7)));
  const fireRadius = d3.scaleSqrt().domain([0, fireMax]).range([0, 15]);
  const svg = d3.select(host).selectAll("svg").data([null]).join("svg").attr("viewBox", `0 0 ${width} ${height}`);
  svg.selectAll("*").remove();

  const defs = svg.append("defs");
  Object.entries(modeColors).forEach(([mode, color]) => {
    defs.append("marker")
      .attr("id", `arrow-${mode}`)
      .attr("viewBox", "0 -4 8 8")
      .attr("refX", 7)
      .attr("refY", 0)
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .attr("orient", "auto")
      .append("path").attr("d", "M0,-3L8,0L0,3").attr("fill", color).attr("opacity", 0.82);
  });

  const features = geoData.features.filter(feature => rowMap.has(feature.properties.name));
  const centroid = new Map(features.map(feature => [feature.properties.name, path.centroid(feature)]));
  const zoomLayer = svg.append("g").attr("class", "map-zoom-layer");
  mapZoomBehavior = d3.zoom()
    .scaleExtent([1, 6])
    .on("zoom", event => {
      state.mapTransform = event.transform;
      zoomLayer.attr("transform", event.transform);
    });
  mapSvg = svg.call(mapZoomBehavior).on("dblclick.zoom", null);
  mapSvg.call(mapZoomBehavior.transform, state.mapTransform);

  zoomLayer.append("g").selectAll("path")
    .data(features)
    .join("path")
    .attr("class", feature => `province ${state.selected === feature.properties.name ? "is-selected" : ""}`)
    .attr("d", path)
    .attr("fill", feature => fill(rowMap.get(feature.properties.name).trafficValue))
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", feature => `${feature.properties.name} 선택`)
    .on("click", (_, feature) => chooseRegion(feature.properties.name))
    .on("keydown", (event, feature) => { if (event.key === "Enter" || event.key === " ") chooseRegion(feature.properties.name); })
    .on("mousemove", (event, feature) => {
      const row = rowMap.get(feature.properties.name);
      const direction = state.direction === "inflow" ? "유입" : "유출";
      showTooltip(event, `<b>${feature.properties.name}</b><span>${direction} 교통 ${formatTraffic(row.trafficValue)}</span><span>산불 ${Math.round(row.fireValue)}건 · ${row.areaValue.toFixed(1)}ha</span>`);
    })
    .on("mouseleave", hideTooltip);

  const routePool = state.selected
    ? state.direction === "inflow"
      ? routeValues().filter(route => route.target === state.selected)
      : routeValues().filter(route => route.source === state.selected)
    : routeValues();
  const visibleRoutes = routePool.filter(route => centroid.has(route.source) && centroid.has(route.target)).sort((a, b) => b.value - a.value).slice(0, state.selected ? 9 : 20);
  const routeWidth = d3.scaleSqrt().domain([0, d3.max(visibleRoutes, d => d.value) || 1]).range([0.8, 6]);
  zoomLayer.append("g").attr("class", "flows").selectAll("path")
    .data(visibleRoutes)
    .join("path")
    .attr("class", "flow-line")
    .attr("d", route => {
      const [x1, y1] = centroid.get(route.source);
      const [x2, y2] = centroid.get(route.target);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const bend = Math.min(34, Math.hypot(dx, dy) * 0.18);
      const mx = (x1 + x2) / 2 - (dy / Math.max(Math.hypot(dx, dy), 1)) * bend;
      const my = (y1 + y2) / 2 + (dx / Math.max(Math.hypot(dx, dy), 1)) * bend;
      return `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
    })
    .attr("stroke", route => modeColors[route.mode])
    .attr("stroke-width", route => routeWidth(route.value))
    .attr("marker-end", route => `url(#arrow-${route.mode})`)
    .on("mousemove", (event, route) => showTooltip(event, `<b>${shortName(route.source)} → ${shortName(route.target)}</b><span>${modeLabels[route.mode]} · ${formatTraffic(route.value)}</span>`))
    .on("mouseleave", hideTooltip);

  zoomLayer.append("g").attr("class", "fire-points").selectAll("circle")
    .data(rows.filter(row => centroid.has(row.name)))
    .join("circle")
    .attr("class", row => `fire-point ${state.selected === row.name ? "is-selected" : ""}`)
    .attr("cx", row => centroid.get(row.name)[0] + Math.sin(row.name.length * 2.3) * 5)
    .attr("cy", row => centroid.get(row.name)[1] + Math.cos(row.name.length * 1.7) * 5)
    .attr("r", row => fireRadius(row.areaValue))
    .on("click", (_, row) => chooseRegion(row.name))
    .on("mousemove", (event, row) => showTooltip(event, `<b>${row.name}</b><span>산불 ${Math.round(row.fireValue)}건</span><span>피해 ${row.areaValue.toFixed(1)}ha</span>`))
    .on("mouseleave", hideTooltip);

  const labels = rows.filter(row => state.selected === row.name || ["서울특별시", "강원도", "경상북도", "부산광역시", "전라남도", "제주특별자치도"].includes(row.name));
  zoomLayer.append("g").attr("class", "map-labels").selectAll("text")
    .data(labels.filter(row => centroid.has(row.name)))
    .join("text")
    .attr("x", row => centroid.get(row.name)[0])
    .attr("y", row => centroid.get(row.name)[1] - fireRadius(row.areaValue) - 7)
    .attr("text-anchor", "middle")
    .attr("class", row => state.selected === row.name ? "is-selected" : null)
    .text(row => row.short);
}

function renderScatter() {
  const host = document.querySelector("#scatterChart");
  const width = Math.max(host.clientWidth, 430);
  const height = Math.max(host.clientHeight, 440);
  const margin = { top: 54, right: 92, bottom: 44, left: 28 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const inflowByName = new Map(allRows(state.month, state.cause, "inflow").map(row => [row.name, row]));
  const outflowByName = new Map(allRows(state.month, state.cause, "outflow").map(row => [row.name, row]));
  const rows = regions.map(region => {
    const inflow = inflowByName.get(region.name);
    const outflow = outflowByName.get(region.name);
    return {
      ...region,
      inflowValue: inflow.trafficValue,
      outflowValue: outflow.trafficValue,
      netValue: outflow.trafficValue - inflow.trafficValue,
      fireValue: inflow.fireValue,
      areaValue: inflow.areaValue
    };
  }).sort((a, b) => d3.ascending(a.netValue, b.netValue));
  const fireKey = state.metric === "fires" ? "fireValue" : "areaValue";
  const fireLabel = state.metric === "fires" ? "발생건수" : "피해면적";
  const maxTraffic = d3.max(rows, row => Math.max(row.inflowValue, row.outflowValue)) || 1;
  const maxFire = d3.max(rows, row => row[fireKey]) || 1;
  const x = d3.scaleLinear().domain([-maxTraffic, maxTraffic]).nice().range([0, innerWidth]);
  const y = d3.scaleBand().domain(rows.map(row => row.name)).range([0, innerHeight]).padding(.22);
  const fireRadius = d3.scaleSqrt().domain([0, maxFire]).range([2.5, 10.5]);
  const centerX = x(0);
  const fireX = innerWidth + 30;
  const compactTraffic = value => value >= 1000000 ? `${(value / 1000000).toFixed(1)}M` : value >= 1000 ? `${Math.round(value / 1000)}k` : Math.round(value);
  const fireText = row => state.metric === "fires" ? `${Math.round(row.fireValue)}건` : `${row.areaValue.toFixed(1)}ha`;
  const svg = d3.select(host).selectAll("svg").data([null]).join("svg").attr("viewBox", `0 0 ${width} ${height}`);
  svg.selectAll("*").remove();
  const defs = svg.append("defs");
  const inflowGradient = defs.append("linearGradient").attr("id", "balance-inflow-gradient").attr("x1", "100%").attr("x2", "0%");
  inflowGradient.append("stop").attr("offset", "0%").attr("stop-color", "#5fb7ff").attr("stop-opacity", .95);
  inflowGradient.append("stop").attr("offset", "100%").attr("stop-color", "#356fa8").attr("stop-opacity", .55);
  const outflowGradient = defs.append("linearGradient").attr("id", "balance-outflow-gradient").attr("x1", "0%").attr("x2", "100%");
  outflowGradient.append("stop").attr("offset", "0%").attr("stop-color", "#58d6ce").attr("stop-opacity", .95);
  outflowGradient.append("stop").attr("offset", "100%").attr("stop-color", "#238b8a").attr("stop-opacity", .55);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  g.append("g").attr("class", "chart-grid balance-grid").attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(5).tickSize(-innerHeight).tickFormat(""));
  g.append("g").attr("class", "x-axis balance-axis").attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(value => compactTraffic(Math.abs(value))));
  g.append("line").attr("class", "balance-center-line").attr("x1", centerX).attr("x2", centerX).attr("y1", -9).attr("y2", innerHeight);
  g.append("text").attr("class", "balance-zone-label inflow-zone").attr("x", 0).attr("y", -34).attr("text-anchor", "start").text("순유입 우세");
  g.append("text").attr("class", "balance-zone-label outflow-zone").attr("x", innerWidth).attr("y", -34).attr("text-anchor", "end").text("순유출 우세");
  g.append("text").attr("class", "balance-direction-label inflow-zone").attr("x", centerX * .5).attr("y", -14).attr("text-anchor", "middle").text("← 유입량");
  g.append("text").attr("class", "balance-direction-label outflow-zone").attr("x", centerX + centerX * .5).attr("y", -14).attr("text-anchor", "middle").text("유출량 →");
  g.append("text").attr("class", "balance-fire-heading").attr("x", fireX).attr("y", -14).attr("text-anchor", "middle").text(`산불 ${fireLabel}`);

  const rowGroups = g.append("g").selectAll("g.balance-row")
    .data(rows, row => row.name)
    .join("g")
    .attr("class", row => `balance-row ${state.selected === row.name ? "is-selected" : ""}`)
    .attr("transform", row => `translate(0,${y(row.name)})`)
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", row => `${row.name}, 유입 ${formatTraffic(row.inflowValue)}, 유출 ${formatTraffic(row.outflowValue)}, 산불 ${fireText(row)}, 선택`)
    .on("click", (_, row) => chooseRegion(row.name))
    .on("keydown", (event, row) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      chooseRegion(row.name);
    })
    .on("mousemove", (event, row) => {
      const balance = Math.abs(row.netValue) < 1 ? "유입·유출 균형" : `${row.netValue > 0 ? "순유출" : "순유입"} ${formatTraffic(Math.abs(row.netValue))}`;
      showTooltip(event, `<b>${row.name}</b><span>유입 ${formatTraffic(row.inflowValue)}</span><span>유출 ${formatTraffic(row.outflowValue)}</span><span>${balance}</span><span>산불 ${Math.round(row.fireValue)}건 · 피해 ${row.areaValue.toFixed(1)}ha</span>`);
    })
    .on("mouseleave", hideTooltip);

  rowGroups.append("rect")
    .attr("class", "balance-row-background")
    .attr("x", -12).attr("y", -2).attr("width", innerWidth + margin.right - 8).attr("height", y.bandwidth() + 4).attr("rx", 7);
  rowGroups.append("rect")
    .attr("class", "balance-bar inflow-bar")
    .attr("x", row => x(-row.inflowValue)).attr("y", y.bandwidth() * .2)
    .attr("width", row => centerX - x(-row.inflowValue)).attr("height", y.bandwidth() * .6).attr("rx", 3);
  rowGroups.append("rect")
    .attr("class", "balance-bar outflow-bar")
    .attr("x", centerX).attr("y", y.bandwidth() * .2)
    .attr("width", row => x(row.outflowValue) - centerX).attr("height", y.bandwidth() * .6).attr("rx", 3);
  rowGroups.append("text")
    .attr("class", "balance-region-label")
    .attr("x", centerX).attr("y", y.bandwidth() / 2 + 3.4).attr("text-anchor", "middle").text(row => row.short);
  rowGroups.append("circle")
    .attr("class", "balance-fire-dot")
    .attr("cx", fireX).attr("cy", y.bandwidth() / 2)
    .attr("r", row => row[fireKey] > 0 ? fireRadius(row[fireKey]) : 2)
    .attr("fill", state.metric === "fires" ? "#ff9a5a" : "#ff5f69")
    .attr("opacity", row => row[fireKey] > 0 ? .9 : .22);
  rowGroups.append("text")
    .attr("class", "balance-fire-value")
    .attr("x", fireX + 14).attr("y", y.bandwidth() / 2 + 3.2).text(fireText);
}

function correlationLabel(value) {
  const strength = Math.abs(value) >= 0.7 ? "강한" : Math.abs(value) >= 0.4 ? "보통" : Math.abs(value) >= 0.2 ? "약한" : "거의 없는";
  if (Math.abs(value) < 0.2) return `${strength} 상관`;
  return `${strength} ${value > 0 ? "양의" : "음의"} 상관`;
}

function pearson(data, xKey, yKey) {
  const xMean = d3.mean(data, d => d[xKey]);
  const yMean = d3.mean(data, d => d[yKey]);
  const numerator = d3.sum(data, d => (d[xKey] - xMean) * (d[yKey] - yMean));
  const xSpread = d3.sum(data, d => (d[xKey] - xMean) ** 2);
  const ySpread = d3.sum(data, d => (d[yKey] - yMean) ** 2);
  return numerator / Math.sqrt(Math.max(xSpread * ySpread, Number.EPSILON));
}

function correlationSeries() {
  return d3.range(months.length).map(month => {
    const inflowRows = state.selected
      ? [rowFor(byName.get(state.selected), month, state.cause, "inflow")]
      : allRows(month, state.cause, "inflow");
    const outflowRows = state.selected
      ? [rowFor(byName.get(state.selected), month, state.cause, "outflow")]
      : allRows(month, state.cause, "outflow");
    return {
      month,
      period: months[month],
      date: new Date(`${months[month]}-01T00:00:00Z`),
      inflowValue: d3.sum(inflowRows, d => d.trafficValue),
      outflowValue: d3.sum(outflowRows, d => d.trafficValue),
      fireValue: d3.sum(inflowRows, d => d.fireValue),
      areaValue: d3.sum(inflowRows, d => d.areaValue)
    };
  });
}

function renderCorrelation() {
  const data = correlationSeries();
  const fireKey = state.corrMetric === "fires" ? "fireValue" : "areaValue";
  const fireLabel = state.corrMetric === "fires" ? "발생건수" : "피해면적";
  const fireTopic = state.corrMetric === "fires" ? "발생건수는" : "피해면적은";
  const inflowValue = pearson(data, "inflowValue", fireKey);
  const outflowValue = pearson(data, "outflowValue", fireKey);
  const regionName = state.selected || "전국";
  const trafficViewLabel = state.corrTrafficView === "both" ? "유입·유출" : state.corrTrafficView === "inflow" ? "유입" : "유출";
  const trafficSeries = [
    { key: "inflowValue", label: "유입량", color: "#5fb7ff", gradient: "corr-inflow-gradient", className: "inflow-dot" },
    { key: "outflowValue", label: "유출량", color: "#58d6ce", gradient: "corr-outflow-gradient", className: "outflow-dot" }
  ];
  const activeTraffic = trafficSeries.filter(series => state.corrTrafficView === "both" || series.key.startsWith(state.corrTrafficView));
  const host = document.querySelector("#correlationChart");
  const isEventView = state.corrView === "event";
  document.querySelector("#corrRegion").textContent = regionName;
  document.querySelector("#corrTitleMode").textContent = isEventView ? "산불 발생 전후 이동 변화" : "월별 산불과 교통 흐름";
  document.querySelector("#corrInValue").textContent = `${inflowValue >= 0 ? "+" : ""}${inflowValue.toFixed(2)}`;
  document.querySelector("#corrOutValue").textContent = `${outflowValue >= 0 ? "+" : ""}${outflowValue.toFixed(2)}`;
  document.querySelector("#corrInScore").hidden = state.corrTrafficView === "outflow";
  document.querySelector("#corrOutScore").hidden = state.corrTrafficView === "inflow";
  document.querySelector("#corrLabel").textContent = state.corrTrafficView === "both"
    ? `${fireLabel} 기준 · 유입 ${correlationLabel(inflowValue)} · 유출 ${correlationLabel(outflowValue)}`
    : `${fireLabel} 기준 · ${trafficViewLabel} ${correlationLabel(state.corrTrafficView === "inflow" ? inflowValue : outflowValue)}`;
  document.querySelector(".correlation-score").hidden = isEventView;
  document.querySelector("#eventSummary").hidden = !isEventView;
  if (isEventView) {
    renderEventComparison({ host, data, fireKey, fireLabel, regionName, trafficViewLabel, activeTraffic });
    return;
  }
  document.querySelector("#corrCopy").textContent = `${regionName}의 ${months.length}개월 ${trafficViewLabel} 교통량은 위쪽, 산불 ${fireTopic} 아래쪽에서 비교합니다. 점을 선택하면 기준월이 함께 바뀝니다.`;
  host.setAttribute("aria-label", "선택 지역의 월별 유입량, 유출량, 산불 지표 추이 그래프");

  const width = Math.max(host.clientWidth, 620);
  const height = Math.max(host.clientHeight, 370);
  const margin = { top: 48, right: 72, bottom: 52, left: 68 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const plotGap = 44;
  const trafficHeight = Math.round((innerHeight - plotGap) * .58);
  const fireHeight = innerHeight - plotGap - trafficHeight;
  const fireTop = trafficHeight + plotGap;
  const x = d3.scaleUtc()
    .domain(d3.extent(data, d => d.date))
    .range([0, innerWidth]);
  const trafficMax = d3.max(data, d => d3.max(activeTraffic, series => d[series.key])) || 1;
  const fireMax = d3.max(data, d => d[fireKey]) || 1;
  const yTraffic = d3.scaleLinear().domain([0, trafficMax * 1.08]).nice().range([trafficHeight, 0]);
  const yFire = state.corrMetric === "area"
    ? d3.scaleSymlog().constant(1).domain([0, fireMax * 1.08]).nice().range([fireHeight, 0])
    : d3.scaleLinear().domain([0, fireMax * 1.12]).nice().range([fireHeight, 0]);
  const svg = d3.select(host).selectAll("svg").data([null]).join("svg").attr("viewBox", `0 0 ${width} ${height}`);
  svg.selectAll("*").remove();
  const defs = svg.append("defs");
  const progress = months.length > 1 ? state.month / (months.length - 1) : 0;
  const addProgressGradient = (id, color) => {
    const gradient = defs.append("linearGradient").attr("id", id).attr("x1", "0%").attr("x2", "100%");
    const split = Math.max(0, Math.min(1, progress));
    gradient.append("stop").attr("offset", "0%").attr("stop-color", color).attr("stop-opacity", .32);
    gradient.append("stop").attr("offset", `${split * 100}%`).attr("stop-color", color).attr("stop-opacity", 1);
    gradient.append("stop").attr("offset", `${Math.min(100, split * 100 + .15)}%`).attr("stop-color", color).attr("stop-opacity", .16);
    gradient.append("stop").attr("offset", "100%").attr("stop-color", color).attr("stop-opacity", .16);
  };
  addProgressGradient("corr-inflow-gradient", "#5fb7ff");
  addProgressGradient("corr-outflow-gradient", "#58d6ce");
  addProgressGradient("corr-fire-gradient", state.corrMetric === "fires" ? "#ff9a5a" : "#ff5f69");
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const tickInterval = width < 780 ? d3.utcMonth.every(6) : d3.utcMonth.every(3);
  g.append("g").attr("class", "chart-grid traffic-grid").call(d3.axisLeft(yTraffic).ticks(4).tickSize(-innerWidth).tickFormat(""));
  g.append("g").attr("class", "chart-grid fire-grid").attr("transform", `translate(0,${fireTop})`)
    .call(d3.axisLeft(yFire).ticks(3).tickSize(-innerWidth).tickFormat(""));
  g.append("g").attr("class", "x-axis").attr("transform", `translate(0,${fireTop + fireHeight})`)
    .call(d3.axisBottom(x).ticks(tickInterval).tickFormat(d3.utcFormat("%y.%m")));
  g.append("g").attr("class", "y-axis").call(d3.axisLeft(yTraffic).ticks(4).tickFormat(value => value >= 1000000 ? `${(value / 1000000).toFixed(1)}M` : value >= 1000 ? `${Math.round(value / 1000)}k` : value));
  g.append("g").attr("class", "y-axis fire-y-axis").attr("transform", `translate(0,${fireTop})`)
    .call(d3.axisLeft(yFire).ticks(3).tickFormat(value => value >= 10000 ? `${Math.round(value / 1000)}k` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : Math.round(value)));
  g.append("text").attr("class", "axis-title").attr("transform", "rotate(-90)").attr("x", -trafficHeight / 2).attr("y", -52).attr("text-anchor", "middle").text("월간 교통량");
  g.append("text").attr("class", "axis-title fire-axis-title").attr("transform", "rotate(-90)").attr("x", -(fireTop + fireHeight / 2)).attr("y", -52).attr("text-anchor", "middle").text(state.corrMetric === "fires" ? "산불 발생 건수" : "산불 피해면적 (ha · symlog)");
  g.append("line").attr("class", "correlation-plot-divider").attr("x1", 0).attr("x2", innerWidth).attr("y1", trafficHeight + plotGap / 2).attr("y2", trafficHeight + plotGap / 2);
  g.append("text").attr("class", "correlation-band-label traffic-band-label").attr("x", 8).attr("y", 16).text(`${trafficViewLabel} 교통량 · 상단`);
  g.append("text").attr("class", "correlation-band-label fire-band-label").attr("x", 8).attr("y", fireTop + 16).text(`산불 ${fireLabel} · 하단`);

  const trafficLine = key => d3.line().curve(d3.curveMonotoneX).x(d => x(d.date)).y(d => yTraffic(d[key]));
  const fireLine = d3.line().curve(d3.curveMonotoneX).x(d => x(d.date)).y(d => fireTop + yFire(d[fireKey]));
  activeTraffic.forEach(series => {
    g.append("path").datum(data).attr("class", `correlation-line ${series.key === "inflowValue" ? "inflow-line" : "outflow-line"}`).attr("stroke", `url(#${series.gradient})`).attr("d", trafficLine(series.key));
  });
  g.append("path").datum(data).attr("class", "correlation-line fire-line").attr("stroke", "url(#corr-fire-gradient)").attr("d", fireLine);

  const selected = data[state.month];
  g.append("line").attr("class", "correlation-month-guide")
    .attr("x1", x(selected.date)).attr("x2", x(selected.date)).attr("y1", 0).attr("y2", fireTop + fireHeight);
  g.append("text").attr("class", "correlation-month-label").attr("x", x(selected.date)).attr("y", -10).attr("text-anchor", "middle").text(selected.period.replace("-", "."));

  const pointOpacity = d => {
    if (d.month > state.month) return .14;
    if (state.month === 0) return d.month === 0 ? 1 : .14;
    return .34 + .66 * (d.month / state.month);
  };
  const pointRadius = d => d.month === state.month ? 5.8 : 3.2;
  const tooltipText = d => {
    const trafficRows = activeTraffic.map(series => `<span>${series.label.replace("량", "")} ${formatTraffic(d[series.key])}</span>`).join("");
    return `<b>${formatPeriod(d.period)}</b>${trafficRows}<span>산불 ${Math.round(d.fireValue)}건 · 피해 ${d.areaValue.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}ha</span>`;
  };
  const bindPointEvents = selection => selection
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", d => `${formatPeriod(d.period)}을 기준월로 선택`)
    .on("click", (_, d) => chooseMonth(d.month))
    .on("keydown", (event, d) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      chooseMonth(d.month);
    })
    .on("mousemove", (event, d) => showTooltip(event, tooltipText(d)))
    .on("mouseleave", hideTooltip);

  activeTraffic.forEach(series => {
    bindPointEvents(g.append("g").selectAll(`circle.${series.className}`).data(data).join("circle")
      .attr("class", d => `correlation-dot ${series.className} ${d.month === state.month ? "is-current" : ""}`)
      .attr("cx", d => x(d.date)).attr("cy", d => yTraffic(d[series.key])).attr("r", pointRadius).attr("opacity", pointOpacity));
  });
  bindPointEvents(g.append("g").selectAll("circle.fire-dot").data(data).join("circle")
    .attr("class", d => `correlation-dot fire-dot ${d.month === state.month ? "is-current" : ""}`)
    .attr("cx", d => x(d.date)).attr("cy", d => fireTop + yFire(d[fireKey])).attr("r", pointRadius).attr("opacity", pointOpacity));

  const legendData = [...activeTraffic, { label: `산불 ${fireLabel}`, color: state.corrMetric === "fires" ? "#ff9a5a" : "#ff5f69" }];
  const legend = g.append("g").attr("class", "correlation-legend").attr("transform", "translate(0,-30)");
  const legendItem = legend.selectAll("g").data(legendData).join("g").attr("transform", (_, index) => `translate(${index * 112},0)`);
  legendItem.append("line").attr("x1", 0).attr("x2", 22).attr("y1", 0).attr("y2", 0).attr("stroke", d => d.color);
  legendItem.append("circle").attr("cx", 11).attr("cy", 0).attr("r", 3).attr("fill", d => d.color);
  legendItem.append("text").attr("x", 29).attr("y", 4).text(d => d.label);
}

function renderEventComparison({ host, data, fireKey, fireLabel, regionName, trafficViewLabel, activeTraffic }) {
  const eventRow = data[state.month];
  const selectedHasFire = eventRow[fireKey] > 0;
  const windowData = data.filter(row => Math.abs(row.month - eventRow.month) <= 1);
  const previous = data[eventRow.month - 1];
  const changeText = activeTraffic.map(series => {
    if (!previous || previous[series.key] === 0) return `${series.label} 전월 비교 없음`;
    const change = (eventRow[series.key] - previous[series.key]) / previous[series.key] * 100;
    return `${series.label.replace("량", "")} ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
  }).join(" · ");
  const fireValueText = state.corrMetric === "fires" ? `${Math.round(eventRow.fireValue)}건` : `${eventRow.areaValue.toFixed(1)}ha`;
  document.querySelector("#eventMonthLabel").textContent = `${selectedHasFire ? "산불 발생월" : "선택 기준월"} · ${formatPeriod(eventRow.period)}`;
  document.querySelector("#eventFireValue").textContent = fireValueText;
  document.querySelector("#eventDeltaLabel").textContent = `전월→기준월 ${changeText}`;
  document.querySelector("#corrCopy").textContent = selectedHasFire
    ? `${regionName}의 선택월을 중심으로 전월·발생월·다음 달 ${trafficViewLabel} 교통량을 비교합니다.`
    : `${regionName}의 선택월에는 해당 산불 기록이 없습니다. 선택월을 중심으로 전월·기준월·다음 달 ${trafficViewLabel} 교통량을 비교합니다.`;
  host.setAttribute("aria-label", "선택 지역의 기준월 전후 산불과 유입량 및 유출량 비교 그래프");

  const width = Math.max(host.clientWidth, 620);
  const height = Math.max(host.clientHeight, 370);
  const margin = { top: 52, right: 34, bottom: 56, left: 68 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const plotGap = 42;
  const trafficHeight = Math.round((innerHeight - plotGap) * .62);
  const fireHeight = innerHeight - plotGap - trafficHeight;
  const fireTop = trafficHeight + plotGap;
  const x = d3.scaleBand().domain(windowData.map(row => row.period)).range([0, innerWidth]).padding(.28);
  const xSeries = d3.scaleBand().domain(activeTraffic.map(series => series.key)).range([0, x.bandwidth()]).padding(.18);
  const trafficMax = d3.max(windowData, row => d3.max(activeTraffic, series => row[series.key])) || 1;
  const fireMax = d3.max(windowData, row => row[fireKey]) || 1;
  const yTraffic = d3.scaleLinear().domain([0, trafficMax * 1.12]).nice().range([trafficHeight, 0]);
  const yFire = state.corrMetric === "area"
    ? d3.scaleSymlog().constant(1).domain([0, fireMax * 1.12]).nice().range([fireHeight, 0])
    : d3.scaleLinear().domain([0, fireMax * 1.15]).nice().range([fireHeight, 0]);
  const svg = d3.select(host).selectAll("svg").data([null]).join("svg").attr("viewBox", `0 0 ${width} ${height}`);
  svg.selectAll("*").remove();
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const focusX = x(eventRow.period);
  if (focusX != null) g.append("rect").attr("class", "event-focus-band").attr("x", focusX - 8).attr("y", -12).attr("width", x.bandwidth() + 16).attr("height", fireTop + fireHeight + 20).attr("rx", 12);
  g.append("g").attr("class", "chart-grid").call(d3.axisLeft(yTraffic).ticks(4).tickSize(-innerWidth).tickFormat(""));
  g.append("g").attr("class", "chart-grid").attr("transform", `translate(0,${fireTop})`).call(d3.axisLeft(yFire).ticks(3).tickSize(-innerWidth).tickFormat(""));
  g.append("g").attr("class", "y-axis").call(d3.axisLeft(yTraffic).ticks(4).tickFormat(value => value >= 1000000 ? `${(value / 1000000).toFixed(1)}M` : value >= 1000 ? `${Math.round(value / 1000)}k` : value));
  g.append("g").attr("class", "y-axis fire-y-axis").attr("transform", `translate(0,${fireTop})`).call(d3.axisLeft(yFire).ticks(3).tickFormat(value => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : Math.round(value)));
  g.append("g").attr("class", "x-axis").attr("transform", `translate(0,${fireTop + fireHeight})`)
    .call(d3.axisBottom(x).tickFormat(period => `${period === eventRow.period ? (selectedHasFire ? "발생월 " : "기준월 ") : ""}${period.replace("-", ".")}`));
  g.append("text").attr("class", "axis-title").attr("transform", "rotate(-90)").attr("x", -trafficHeight / 2).attr("y", -52).attr("text-anchor", "middle").text("월간 교통량");
  g.append("text").attr("class", "axis-title fire-axis-title").attr("transform", "rotate(-90)").attr("x", -(fireTop + fireHeight / 2)).attr("y", -52).attr("text-anchor", "middle").text(state.corrMetric === "fires" ? "산불 발생 건수" : "산불 피해면적 (ha · symlog)");
  g.append("line").attr("class", "correlation-plot-divider").attr("x1", 0).attr("x2", innerWidth).attr("y1", trafficHeight + plotGap / 2).attr("y2", trafficHeight + plotGap / 2);
  g.append("text").attr("class", "correlation-band-label traffic-band-label").attr("x", 8).attr("y", 16).text(`${trafficViewLabel} 교통량 · 상단`);
  g.append("text").attr("class", "correlation-band-label fire-band-label").attr("x", 8).attr("y", fireTop + 16).text(`산불 ${fireLabel} · 하단`);

  const monthGroups = g.append("g").selectAll("g.event-month")
    .data(windowData)
    .join("g")
    .attr("class", row => `event-month ${row.period === eventRow.period ? "is-event" : ""}`)
    .attr("transform", row => `translate(${x(row.period)},0)`);
  monthGroups.selectAll("rect.event-traffic-bar")
    .data(row => activeTraffic.map(series => ({ row, series })))
    .join("rect")
    .attr("class", item => `event-traffic-bar ${item.series.key === "inflowValue" ? "is-inflow" : "is-outflow"}`)
    .attr("x", item => xSeries(item.series.key)).attr("width", xSeries.bandwidth())
    .attr("y", item => yTraffic(item.row[item.series.key])).attr("height", item => trafficHeight - yTraffic(item.row[item.series.key])).attr("rx", 5);
  monthGroups.append("line").attr("class", "event-fire-stem")
    .attr("x1", x.bandwidth() / 2).attr("x2", x.bandwidth() / 2)
    .attr("y1", fireTop + fireHeight).attr("y2", row => fireTop + yFire(row[fireKey]));
  monthGroups.append("circle").attr("class", "event-fire-dot")
    .attr("cx", x.bandwidth() / 2).attr("cy", row => fireTop + yFire(row[fireKey])).attr("r", row => row.period === eventRow.period ? 6 : 4)
    .attr("fill", state.corrMetric === "fires" ? "#ff9a5a" : "#ff5f69");
  monthGroups.append("rect").attr("class", "event-hit-area")
    .attr("x", 0).attr("y", -8).attr("width", x.bandwidth()).attr("height", fireTop + fireHeight + 12)
    .attr("tabindex", 0).attr("role", "button").attr("aria-label", row => `${formatPeriod(row.period)}을 기준월로 선택`)
    .on("click", (_, row) => chooseMonth(row.month))
    .on("keydown", (event, row) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      chooseMonth(row.month);
    })
    .on("mousemove", (event, row) => {
      const trafficRows = activeTraffic.map(series => `<span>${series.label} ${formatTraffic(row[series.key])}</span>`).join("");
      showTooltip(event, `<b>${formatPeriod(row.period)}</b>${trafficRows}<span>산불 ${Math.round(row.fireValue)}건 · 피해 ${row.areaValue.toFixed(1)}ha</span>`);
    })
    .on("mouseleave", hideTooltip);

  const legendData = [...activeTraffic, { label: `산불 ${fireLabel}`, color: state.corrMetric === "fires" ? "#ff9a5a" : "#ff5f69" }];
  const legend = g.append("g").attr("class", "correlation-legend").attr("transform", "translate(0,-30)");
  const legendItem = legend.selectAll("g").data(legendData).join("g").attr("transform", (_, index) => `translate(${index * 112},0)`);
  legendItem.append("line").attr("x1", 0).attr("x2", 22).attr("stroke", row => row.color);
  legendItem.append("circle").attr("cx", 11).attr("r", 3).attr("fill", row => row.color);
  legendItem.append("text").attr("x", 29).attr("y", 4).text(row => row.label);
}

function renderDetails() {
  const rows = allRows();
  let selected;
  if (state.selected) selected = rows.find(row => row.name === state.selected);
  else {
    selected = {
      name: "전국",
      trafficValue: d3.sum(rows, d => d.trafficValue),
      fireValue: d3.sum(rows, d => d.fireValue),
      areaValue: d3.sum(rows, d => d.areaValue)
    };
  }
  document.querySelector("#selectedRegionName").textContent = selected.name;
  document.querySelector("#trafficMetric").textContent = formatTraffic(selected.trafficValue);
  document.querySelector("#fireMetric").textContent = `${Math.round(selected.fireValue).toLocaleString("ko-KR")}건`;
  document.querySelector("#areaMetric").textContent = `${selected.areaValue.toFixed(1)}ha`;
  document.querySelector("#routePeriod").textContent = formatPeriod(months[state.month]);
  document.querySelector("#incidentCount").textContent = state.cause === "all"
    ? `총 ${Math.round(selected.fireValue)}건`
    : `${causeLabels[state.cause]} ${Math.round(selected.fireValue)}건`;

  let incoming = state.selected
    ? state.direction === "inflow"
      ? routeValues().filter(route => route.target === state.selected)
      : routeValues().filter(route => route.source === state.selected)
    : routeValues();
  incoming = incoming.sort((a, b) => b.value - a.value).slice(0, 4);
  const routeMax = d3.max(incoming, d => d.value) || 1;
  const routeList = d3.select("#routeList");
  routeList.selectAll(".route-item").data(incoming, d => `${d.source}-${d.target}-${d.mode}`).join(
    enter => {
      const item = enter.append("div").attr("class", "route-item");
      const meta = item.append("div").attr("class", "route-meta");
      meta.append("span").attr("class", "route-rank");
      meta.append("div").html('<b class="route-name"></b><span class="route-mode"></span>');
      item.append("strong").attr("class", "route-value");
      item.append("div").attr("class", "route-bar").append("span");
      return item;
    },
    update => update,
    exit => exit.remove()
  ).each(function(route, index) {
    const item = d3.select(this);
    item.select(".route-rank").text(String(index + 1).padStart(2, "0"));
    item.select(".route-name").text(`${shortName(route.source)} → ${shortName(route.target)}`);
    item.select(".route-mode").text(modeLabels[route.mode]);
    item.select(".route-value").text(formatTraffic(route.value));
    item.select(".route-bar span").style("width", `${(route.value / routeMax) * 100}%`).style("background", modeColors[route.mode]);
  });

  const periodIncidents = incidentsFor(months[state.month], state.selected);
  const causeData = causeKeys.map(key => {
    const rawValue = periodIncidents.filter(record => record.causeKey === key).length;
    return {
      key,
      label: causeLabels[key],
      value: state.cause === "all" || state.cause === key ? rawValue : 0
    };
  });
  const causeMax = d3.max(causeData, d => d.value) || 1;
  d3.select("#causeBars").selectAll(".cause-row").data(causeData, d => d.key).join(
    enter => {
      const row = enter.append("div").attr("class", "cause-row");
      const head = row.append("div").attr("class", "cause-head");
      head.append("span").attr("class", "cause-name");
      head.append("b").attr("class", "cause-value");
      row.append("div").attr("class", "cause-track").append("span");
      return row;
    },
    update => update,
    exit => exit.remove()
  ).each(function(cause) {
    const row = d3.select(this);
    row.classed("is-muted", state.cause !== "all" && state.cause !== cause.key)
      .classed("is-active", state.cause !== "all" && state.cause === cause.key);
    row.select(".cause-name").text(cause.label);
    row.select(".cause-value").text(`${Math.round(cause.value)}건`);
    row.select(".cause-track span").style("width", `${(cause.value / causeMax) * 100}%`);
  });
}

function renderInsights() {
  const regionName = state.selected || "전국";
  const directionLabel = state.direction === "inflow" ? "유입" : "유출";
  const aggregate = (month, direction) => {
    const rows = state.selected ? [rowFor(byName.get(state.selected), month, state.cause, direction)] : allRows(month, state.cause, direction);
    return {
      trafficValue: d3.sum(rows, row => row.trafficValue),
      fireValue: d3.sum(rows, row => row.fireValue),
      areaValue: d3.sum(rows, row => row.areaValue)
    };
  };
  const current = aggregate(state.month, state.direction);
  const previous = state.month > 0 ? aggregate(state.month - 1, state.direction) : null;
  if (!previous || previous.trafficValue === 0) {
    document.querySelector("#trafficInsightTitle").textContent = `${directionLabel} ${formatTraffic(current.trafficValue)}`;
    document.querySelector("#trafficInsightCopy").textContent = `${regionName}의 첫 비교 가능 월입니다.`;
  } else {
    const change = (current.trafficValue - previous.trafficValue) / previous.trafficValue * 100;
    const movement = Math.abs(change) < .05 ? "거의 동일" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
    document.querySelector("#trafficInsightTitle").textContent = `전월 대비 ${movement}`;
    document.querySelector("#trafficInsightCopy").textContent = `${regionName} ${directionLabel} ${formatTraffic(current.trafficValue)} · ${formatPeriod(months[state.month])}`;
  }

  const fireRows = allRows(state.month, state.cause, "outflow");
  const fireKey = state.metric === "area" ? "areaValue" : "fireValue";
  const selectedFire = state.selected ? fireRows.find(row => row.name === state.selected) : null;
  if (!selectedFire) {
    const totalFire = d3.sum(fireRows, row => row.fireValue);
    const totalArea = d3.sum(fireRows, row => row.areaValue);
    document.querySelector("#fireInsightTitle").textContent = `전국 산불 ${Math.round(totalFire)}건`;
    document.querySelector("#fireInsightCopy").textContent = `피해면적 ${totalArea.toFixed(1)}ha · 같은 달 기록 합계`;
  } else {
    const rank = 1 + fireRows.filter(row => row[fireKey] > selectedFire[fireKey]).length;
    const metricValue = state.metric === "area" ? `${selectedFire.areaValue.toFixed(1)}ha` : `${Math.round(selectedFire.fireValue)}건`;
    document.querySelector("#fireInsightTitle").textContent = `${state.metric === "area" ? "피해면적" : "발생건수"} 전국 ${rank}위`;
    document.querySelector("#fireInsightCopy").textContent = `${regionName} ${metricValue} · 17개 지역 기준`;
  }

  const inflow = aggregate(state.month, "inflow").trafficValue;
  const outflow = aggregate(state.month, "outflow").trafficValue;
  const net = outflow - inflow;
  const balanceTitle = Math.abs(net) < 1 ? "유입·유출 균형" : `${net > 0 ? "순유출" : "순유입"} ${formatTraffic(Math.abs(net))}`;
  document.querySelector("#balanceInsightTitle").textContent = balanceTitle;
  document.querySelector("#balanceInsightCopy").textContent = `유입 ${formatTraffic(inflow)} · 유출 ${formatTraffic(outflow)}`;
}

function renderHeatmap() {
  const host = document.querySelector("#anomalyHeatmap");
  if (!host || host.hidden) return;
  const metric = state.heatmapMetric;
  const metricLabel = { outflow: "유출량", inflow: "유입량", fires: "산불 발생건수", area: "산불 피해면적" }[metric];
  const records = [];
  regions.forEach(region => {
    const raw = months.map((period, month) => {
      const direction = metric === "inflow" ? "inflow" : "outflow";
      const row = rowFor(region, month, state.cause, direction);
      const value = metric === "fires" ? row.fireValue : metric === "area" ? row.areaValue : row.trafficValue;
      return { region, period, month, value };
    });
    const mean = d3.mean(raw, row => row.value) || 0;
    const deviation = d3.deviation(raw, row => row.value) || 1;
    raw.forEach(row => records.push({ ...row, mean, z: (row.value - mean) / deviation }));
  });

  const width = Math.max(host.clientWidth, 820);
  const height = Math.max(host.clientHeight, 410);
  const margin = { top: 24, right: 18, bottom: 48, left: 76 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const x = d3.scaleBand().domain(months).range([0, innerWidth]).padding(.06);
  const y = d3.scaleBand().domain(regions.map(region => region.name)).range([0, innerHeight]).padding(.08);
  const color = d3.scaleDiverging().domain([-2.5, 0, 2.5]).interpolator(t => d3.interpolateRgbBasis(["#244d72", "#14263b", "#ff6a5f"])(t));
  const svg = d3.select(host).selectAll("svg").data([null]).join("svg").attr("viewBox", `0 0 ${width} ${height}`);
  svg.selectAll("*").remove();
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  g.append("rect").attr("class", "heatmap-current-column").attr("x", x(months[state.month]) - 2).attr("y", -6).attr("width", x.bandwidth() + 4).attr("height", innerHeight + 12).attr("rx", 4);
  g.append("g").attr("class", "y-axis heatmap-y-axis").call(d3.axisLeft(y).tickFormat(name => shortName(name)).tickSize(0));
  const tickMonths = months.filter((_, index) => index % 3 === 0 || index === months.length - 1);
  g.append("g").attr("class", "x-axis heatmap-x-axis").attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).tickValues(tickMonths).tickFormat(period => period.replace("-", ".")).tickSize(0));

  const cells = g.append("g").selectAll("rect.heatmap-cell")
    .data(records)
    .join("rect")
    .attr("class", row => `heatmap-cell ${state.selected === row.region.name ? "is-selected-region" : ""} ${state.month === row.month ? "is-selected-month" : ""}`)
    .attr("x", row => x(row.period)).attr("y", row => y(row.region.name))
    .attr("width", x.bandwidth()).attr("height", y.bandwidth()).attr("rx", 2)
    .attr("fill", row => color(Math.max(-2.5, Math.min(2.5, row.z))))
    .attr("tabindex", 0).attr("role", "button")
    .attr("aria-label", row => `${row.region.name} ${formatPeriod(row.period)} ${metricLabel} 선택`)
    .on("click", (_, row) => chooseRegionAndMonth(row.region.name, row.month))
    .on("keydown", (event, row) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      chooseRegionAndMonth(row.region.name, row.month);
    })
    .on("mousemove", (event, row) => {
      const valueText = metric === "fires" ? `${Math.round(row.value)}건` : metric === "area" ? `${row.value.toFixed(1)}ha` : formatTraffic(row.value);
      const deviationText = Math.abs(row.z) < .35 ? "평소 수준" : row.z > 0 ? `평소보다 높음 (+${row.z.toFixed(1)}σ)` : `평소보다 낮음 (${row.z.toFixed(1)}σ)`;
      showTooltip(event, `<b>${row.region.name} · ${formatPeriod(row.period)}</b><span>${metricLabel} ${valueText}</span><span>${deviationText}</span>`);
    })
    .on("mouseleave", hideTooltip);
  cells.filter(row => state.selected === row.region.name && state.month === row.month).classed("is-current-cell", true);
}

function observeResize() {
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(() => {
      renderMap();
      renderScatter();
      renderCorrelation();
      renderHeatmap();
    });
  });
  observer.observe(document.querySelector("#mapChart"));
  observer.observe(document.querySelector("#scatterChart"));
  observer.observe(document.querySelector("#anomalyHeatmap"));
}

async function init() {
  setupEntryScreen();
  try {
    const [mapData, trafficData, fireData] = await Promise.all([
      d3.json("data/korea-provinces.json"),
      d3.json("data/traffic-records.json"),
      d3.json("data/fire-records.json")
    ]);
    geoData = mapData;
    trafficRecords = trafficData.records;
    const periodStart = new Date(`${trafficData.meta.periodStart}-01T00:00:00Z`);
    const periodEndExclusive = d3.utcMonth.offset(new Date(`${trafficData.meta.periodEnd}-01T00:00:00Z`), 1);
    months = d3.utcMonth.range(periodStart, periodEndExclusive).map(date => d3.utcFormat("%Y-%m")(date));
    fireRecords = fireData.records
      .filter(record => months.includes(record.period))
      .map(record => ({
        ...record,
        region: fireRegionAliases[record.locsi],
        causeKey: fireCauseKey(record.firecause)
      }))
      .filter(record => record.region);

    trafficByPeriod = d3.group(trafficRecords, record => record.period);
    fireByPeriodRegion = d3.group(fireRecords, record => record.period, record => record.region);
    state.month = Math.max(0, months.indexOf("2025-03"));

    const periodText = `${months[0].replace("-", ".")}—${months.at(-1).replace("-", ".")}`;
    document.querySelector("#dataStatus").textContent = `공공데이터 ${Number(trafficData.meta.recordCount + fireRecords.length).toLocaleString("ko-KR")}건`;
    document.querySelector("#dataPeriodLabel").textContent = periodText;
    document.querySelector("#periodEndLabel").textContent = formatPeriod(months.at(-1));
    document.querySelector(".prototype-note").innerHTML = `<strong>데이터 안내</strong> ${periodText} 공통 기간의 실제 기록만 사용했습니다. 교통은 시도 간 철도·고속·시외버스 월별 O/D ${trafficData.meta.recordCount.toLocaleString("ko-KR")}건, 산불은 발생기록 ${fireRecords.length.toLocaleString("ko-KR")}건입니다. 시도 내부 이동과 출·도착지 미상 교통은 유출·유입 분석에서 제외하며, 상관계수는 인과관계를 의미하지 않습니다.`;

    setupControls();
    renderAll();
    observeResize();
  } catch (error) {
    document.querySelector("#mapChart").innerHTML = '<p class="load-error">공공데이터를 불러오지 못했습니다. 페이지를 새로고침해 주세요.</p>';
    document.querySelector("#dataStatus").textContent = "데이터 로드 오류";
    document.querySelector("#dataPeriodLabel").textContent = "새로고침 필요";
    console.error(error);
  }
}

init();
